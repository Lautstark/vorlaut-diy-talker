#!/usr/bin/env python3
"""Plays the two questions through that discovery.py answers.

The device side of it cannot be run here - that needs an ESP32 and a network
that carries broadcasts. What can be run is everything the device depends on:
that a query is answered at all, that the answer names the right port, that
junk gets nothing back, and that the mDNS reply really contains an A record
for vorlaut.local rather than something a resolver will quietly discard.

The queries go to 127.0.0.1 instead of to the broadcast address. A CI runner
carries no broadcast worth the name, and the responder cannot tell the
difference anyway - it binds every address and answers whatever arrives. What
that leaves untested is the broadcast itself, which is the one part only real
hardware on a real network can show: stage 7 in docs/bring-up.md.
"""

from __future__ import annotations

import os
import socket
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import discovery  # noqa: E402

QUERY_PORT = 8796      # not the real one - this may run while a server is up
HTTP_PORT = 8797


def ask(port: int, question: bytes, timeout: float = 1.0) -> bytes:
    """One packet out, one answer back, or empty if nobody said anything."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        sock.sendto(question, ("127.0.0.1", port))
        try:
            return sock.recvfrom(2048)[0]
        except socket.timeout:
            return b""


def dns_query(name: str, kind: int = 1, ident: int = 0x1234) -> bytes:
    """A DNS question for one name, the way a resolver would put it."""
    labels = b"".join(bytes([len(p)]) + p
                      for p in name.encode("ascii").split(b".")) + b"\x00"
    return struct.pack("!HHHHHH", ident, 0, 1, 0, 0, 0) + labels + \
        struct.pack("!HH", kind, 1)


def a_record(answer: bytes) -> tuple[str, int, int]:
    """Pulls address, class and TTL out of a reply that holds exactly one."""
    _ident, _flags, questions, answers = struct.unpack_from("!HHHH", answer, 0)
    assert answers == 1, f"{answers} answer(s) in the reply"
    at = 12
    for _ in range(questions):           # step over the echoed question
        while answer[at]:
            at += 1 + answer[at]
        at += 1 + 4
    while answer[at]:                    # ... and over the record's own name
        at += 1 + answer[at]
    at += 1
    kind, klass, ttl, length = struct.unpack_from("!HHIH", answer, at)
    assert kind == 1, f"record type {kind}, not A"
    at += 10
    return socket.inet_ntoa(answer[at:at + length]), klass, ttl


def main() -> int:
    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = ""):
        print(f"  {'ok  ' if condition else 'FAIL'}  {name}"
              f"{'   ' + detail if detail else ''}")
        if not condition:
            failures.append(name)

    # --- what the device asks ------------------------------------------
    # Without the name responder: binding 5353 is a machine-wide affair and
    # this test has no business fighting over it.
    finder = discovery.start(HTTP_PORT, query_port=QUERY_PORT, mdns=False,
                             announce=lambda line: None)
    try:
        answer = ask(QUERY_PORT, b"vorlaut? 1").decode("ascii", "replace")
        fields = dict(line.split(" ", 1) for line in answer.split("\n") if " " in line)
        check("a query is answered", bool(answer))
        check("the answer says so in its first word",
              answer.startswith(f"vorlaut {discovery.PROTOCOL}"))
        check("and it carries the port of the web interface",
              fields.get("port") == str(HTTP_PORT), fields.get("port", "nothing"))
        check("the address is deliberately not in it - the packet carries it",
              "host" not in fields)

        check("junk is not answered", ask(QUERY_PORT, b"hello?", 0.4) == b"")
        check("and neither is an empty packet", ask(QUERY_PORT, b"", 0.4) == b"")

        # A field nobody knows yet must not upset the reader on either side.
        check("a query with something appended still counts",
              ask(QUERY_PORT, b"vorlaut? 1 extra") != b"")
    finally:
        finder.stop()

    check("and once it is stopped, nothing answers any more",
          ask(QUERY_PORT, b"vorlaut? 1", 0.4) == b"")

    # A port already taken must not take the web interface down with it.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as blocker:
        blocker.bind(("", QUERY_PORT))
        said: list[str] = []
        try:
            discovery.start(HTTP_PORT, query_port=QUERY_PORT, mdns=False,
                            announce=said.append).stop()
            check("a port that is taken is survived", True)
        except OSError as exc:
            check("a port that is taken is survived", False, str(exc))
        check("... and it says so instead of failing silently",
              any("shut" in line for line in said))

    # --- the port a container is reachable at ---------------------------
    # Published as 8798 on the NAS, listening on 8771 inside: the device has
    # to be sent to the first, and nothing but this variable knows that.
    os.environ["VORLAUT_PUBLIC_PORT"] = "8798"
    try:
        finder = discovery.start(8771, query_port=QUERY_PORT, mdns=False,
                                 announce=lambda line: None)
        answer = ask(QUERY_PORT, b"vorlaut? 1").decode("ascii", "replace")
        check("a published port is what the device gets told",
              "port 8798" in answer, answer.replace("\n", " ").strip())
        finder.stop()
        os.environ["VORLAUT_PUBLIC_PORT"] = "nonsense"
        check("and nonsense in it falls back on the real port",
              discovery.public_port(8771) == 8771)
    finally:
        del os.environ["VORLAUT_PUBLIC_PORT"]

    # --- what a person asks --------------------------------------------
    # By hand rather than over a socket: multicast on a CI runner is a
    # different fight, and the packet is the part that has to be right.
    sender = ("127.0.0.1", 5353)
    replies = discovery._answer_name(dns_query("vorlaut.local"), sender)
    check("an mDNS query for vorlaut.local is answered", len(replies) == 1)
    if replies:
        body, target = replies[0]
        address, klass, ttl = a_record(body)
        check("the answer goes to the group, so every cache hears it",
              target == (discovery.MDNS_GROUP, discovery.MDNS_PORT), str(target))
        check("it names an address of this machine", address == "127.0.0.1", address)
        check("with the cache-flush bit set", klass == 0x8001, hex(klass))
        check("and the mDNS lifetime", ttl == discovery.MDNS_TTL, str(ttl))

    # Same question from a plain resolver: unicast, question echoed, no bit.
    legacy = discovery._answer_name(dns_query("vorlaut.local", ident=0x4321),
                                    ("127.0.0.1", 41234))
    check("a plain resolver is answered too", len(legacy) == 1)
    if legacy:
        body, target = legacy[0]
        ident, _flags, questions, _answers = struct.unpack_from("!HHHH", body, 0)
        address, klass, ttl = a_record(body)
        check("straight back to it", target == ("127.0.0.1", 41234), str(target))
        check("with its own id", ident == 0x4321, hex(ident))
        check("its question repeated, which is what it waits for", questions == 1)
        check("plain class IN, no mDNS bit", klass == 0x0001, hex(klass))
        check("and a short lifetime, because it hears about no changes",
              ttl == discovery.LEGACY_TTL, str(ttl))

    check("another name is none of our business",
          discovery._answer_name(dns_query("fritz.box"), sender) == [])
    check("and neither is a question about something other than an address",
          discovery._answer_name(dns_query("vorlaut.local", kind=28), sender) == [])
    check("a truncated packet is survived",
          discovery._answer_name(dns_query("vorlaut.local")[:9], sender) == [])
    check("an answer is not mistaken for a question",
          discovery._answer_name(
              struct.pack("!HHHHHH", 1, 0x8400, 0, 1, 0, 0), sender) == [])

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
