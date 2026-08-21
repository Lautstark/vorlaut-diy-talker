#!/usr/bin/env python3
"""Being found, so that nobody has to type an address.

Two questions get answered here, on two sockets, and neither of them is
allowed to matter:

  * **The device asks.** It shouts one small UDP packet into the local
    network and we answer with the port the web interface is reachable at.
    That replaces the address field in the setup portal, which was only ever
    right until the router handed out a different address.
  * **A person asks.** A minimal mDNS responder claims `vorlaut.local`, so
    the interface can be bookmarked as <http://vorlaut.local:8771> instead of
    as whatever number is current today.

Same work, twice used: both are a socket that reads a question and writes an
answer, and both fail quietly. If a port is taken or the network swallows
broadcasts, the web interface runs on exactly as before - the device still
has the address that worked last time, and a typed address still works.

Standard library only, like the rest of the project. mDNS is a small enough
protocol to answer one kind of question in forty lines; what it is not is a
reason for a dependency.

The other side is firmware/vorlaut/discover.h.
"""

from __future__ import annotations

import os
import socket
import struct
import threading

# --- The device's question ---------------------------------------------------

# Deliberately a fixed number, and deliberately not --port: this is the one
# thing both sides have to agree on in advance. The port of the web interface
# is what the answer carries, so "--port 8798" stays findable.
QUERY_PORT = 8771
QUERY = b"vorlaut?"
PROTOCOL = 1

# --- The name a person types -------------------------------------------------

NAME = "vorlaut"            # so: vorlaut.local
MDNS_GROUP = "224.0.0.251"
MDNS_PORT = 5353
MDNS_TTL = 120              # how long a resolver may keep the answer
LEGACY_TTL = 10             # ... and a plain DNS client, which hears about no changes


def public_port(http_port: int) -> int:
    """What to tell the device, which is not always the port we bound.

    Behind a published container port the two differ: inside the container the
    interface listens on 8771, while from outside the NAS it is whatever
    docker-compose published. Nothing on this side can work that out, so
    VORLAUT_PUBLIC_PORT says it. Unset, or nonsense, and it is the port we
    listen on - which is the answer in every case that is not a container.
    """
    value = (os.environ.get("VORLAUT_PUBLIC_PORT") or "").strip()
    return int(value) if value.isdigit() and 0 < int(value) < 65536 else http_port


def address_towards(peer: str) -> str:
    """The address this computer can be reached at from that peer.

    Nothing is sent - connect() on a datagram socket only makes the kernel
    say which interface it would have gone out of. The same trick as
    local_addresses() in app.py, except that here the answer is per asker,
    which is what a machine with several interfaces needs.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect((peer, 9))
        return probe.getsockname()[0]


# --- Answering ---------------------------------------------------------------

def _answer_device(packet: bytes, sender, told_port: int) -> list[tuple[bytes, tuple]]:
    """The device's broadcast, answered straight back to where it came from.

    The answer says the port and not the address on purpose. The address is
    the one the packet arrived from, and the device reads it off there - that
    is the one address it is certain to be able to reach us at, which no
    amount of guessing on this side can promise.

    Lines, not JSON, for the same reason the manifest is lines: on the other
    end sits an ESP32 without a parser. See docs/software.md.
    """
    if not packet.strip().startswith(QUERY):
        return []
    body = f"vorlaut {PROTOCOL}\nport {told_port}\nname {NAME}\n"
    return [(body.encode("ascii"), sender)]


def _question(packet: bytes) -> tuple[bool, int, bytes]:
    """Is this a DNS query for our name? Also: its id and its question section.

    A legacy answer has to repeat the question, so it gets handed back rather
    than parsed twice.
    """
    if len(packet) < 12:
        return False, 0, b""
    ident, flags, questions = struct.unpack_from("!HHH", packet, 0)
    if flags & 0x8000:
        return False, 0, b""             # an answer, not a question
    at = 12
    for _ in range(questions):
        start = at
        labels = []
        while True:
            if at >= len(packet):
                return False, 0, b""
            length = packet[at]
            at += 1
            if length == 0:
                break
            if length & 0xC0:
                return False, 0, b""     # a pointer has no business in a question
            labels.append(packet[at:at + length])
            at += length
        if at + 4 > len(packet):
            return False, 0, b""
        kind, _class = struct.unpack_from("!HH", packet, at)
        at += 4
        name = b".".join(labels).decode("ascii", "replace").lower()
        # 1 = A, 255 = anything. Names are case insensitive, hence the lower().
        if name == f"{NAME}.local" and kind in (1, 255):
            return True, ident, packet[start:at]
    return False, 0, b""


def _record(address: str, legacy: bool) -> bytes:
    """One A record for our name."""
    name = b"".join(bytes([len(part)]) + part
                    for part in (NAME.encode("ascii"), b"local")) + b"\x00"
    # 0x8001 is class IN with the cache-flush bit - it tells an mDNS resolver
    # to drop what it held for this name. A plain resolver would not know what
    # to do with it, so a legacy answer goes out as plain IN.
    return (name
            + struct.pack("!HHIH", 1, 0x0001 if legacy else 0x8001,
                          LEGACY_TTL if legacy else MDNS_TTL, 4)
            + socket.inet_aton(address))


def _answer_name(packet: bytes, sender) -> list[tuple[bytes, tuple]]:
    """mDNS, in the two shapes a query can arrive in.

    From port 5353 it is a real mDNS query and the answer belongs to the whole
    group, so everybody's cache learns of it. From any other port it is a
    plain resolver that happens to know where to ask, and it wants a normal
    DNS reply, unicast, with its own question echoed back.
    """
    wanted, ident, question = _question(packet)
    if not wanted:
        return []
    address = address_towards(sender[0])
    legacy = sender[1] != MDNS_PORT
    if legacy:
        header = struct.pack("!HHHHHH", ident, 0x8400, 1, 1, 0, 0)
        return [(header + question + _record(address, True), sender)]
    header = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 0)
    return [(header + _record(address, False), (MDNS_GROUP, MDNS_PORT))]


# --- The sockets -------------------------------------------------------------

class _Listener(threading.Thread):
    """One socket, one thread, one kind of question.

    A daemon thread: whatever it is in the middle of, it must never be the
    reason the program stays up.
    """

    def __init__(self, sock: socket.socket, answer, name: str):
        super().__init__(name=name, daemon=True)
        self._sock = sock
        self._answer = answer

    def run(self) -> None:
        while True:
            try:
                packet, sender = self._sock.recvfrom(2048)
            except OSError:
                return                   # closed from stop(), and that is that
            try:
                for body, target in self._answer(packet, sender):
                    self._sock.sendto(body, target)
            except OSError:
                pass                     # one answer lost, and the device asks again

    def stop(self) -> None:
        self._sock.close()


class Discovery:
    """Whatever came up. stop() is safe on all of it, including nothing."""

    def __init__(self, listeners: list[_Listener]):
        self._listeners = listeners

    def stop(self) -> None:
        for listener in self._listeners:
            listener.stop()


def _device_socket(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", port))                # every address, or broadcasts do not arrive
    return sock


def _name_socket() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        # A Mac already runs a responder on 5353 and would otherwise refuse
        # the bind. Sharing the port is fine: it answers for its own name, we
        # answer for ours.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    sock.bind(("", MDNS_PORT))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
                    socket.inet_aton(MDNS_GROUP) + socket.inet_aton("0.0.0.0"))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)  # mDNS says 255
    return sock


def start(http_port: int, query_port: int = QUERY_PORT,
          mdns: bool = True, announce=print) -> Discovery:
    """Bring both responders up. Whatever fails, the caller carries on."""
    listeners: list[_Listener] = []
    told = public_port(http_port)

    try:
        listeners.append(_Listener(_device_socket(query_port),
                                   lambda packet, sender: _answer_device(
                                       packet, sender, told),
                                   "vorlaut-discovery"))
        announce(f"  the device finds this by itself   (UDP {query_port})")
        if told != http_port:
            announce(f"  ... and is sent to port {told}, not {http_port} "
                     "(VORLAUT_PUBLIC_PORT)")
    except OSError as exc:
        announce(f"  the device cannot find this by itself: UDP {query_port} "
                 f"stayed shut ({exc}).")
        announce("  Type the address into the setup portal instead.")

    if mdns:
        try:
            listeners.append(_Listener(_name_socket(), _answer_name, "vorlaut-mdns"))
            announce(f"  http://{NAME}.local:{told}   <- this one does not "
                     "change with the address")
        except OSError as exc:
            announce(f"  no {NAME}.local, port {MDNS_PORT} stayed shut ({exc}).")

    for listener in listeners:
        listener.start()
    return Discovery(listeners)
