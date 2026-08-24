#!/usr/bin/env python3
"""Holds lautstark.tech's live DNS against the zone file that describes it.

Why this exists: STRATO has no API, so the records are transcribed into a web
form by hand (dns/README.md says how). A hand-made copy drifts - a record
typed with a trailing space, a record somebody added during an afternoon of
debugging and never removed, a change made in the panel and never written
back here. Nothing announces any of that. This does.

    python3 dns/verify.py
    python3 dns/verify.py --zone dns/lautstark.tech.zone
    python3 dns/verify.py --server 1.1.1.1     # ask someone else
    python3 dns/verify.py --pages             # include the Pages records

The Pages block in the zone file is not applied yet - see the banner in the
zone - so by default it is parsed, reported as pending, and not checked.
--pages turns it into a real comparison, which is what you want once the
records are in.

Needs dig, which macOS and every Linux has. Standard library only otherwise,
like the rest of the checks in this repository.

Exit code 0 = live DNS matches the file, 1 = it does not.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_ZONE = Path(__file__).resolve().parent / "lautstark.tech.zone"

# The record types this file knows how to compare. Anything else in the zone
# is reported as unchecked rather than silently skipped.
KNOWN = {"A", "AAAA", "MX", "TXT", "CNAME", "CAA"}

# Everything from the Pages banner to the end of the zone is the pending half.
PENDING_FROM = "THESE ARE NOT READY TO APPLY"


class Record:
    def __init__(self, name: str, rtype: str, value: str, pending: bool):
        self.name = name
        self.rtype = rtype
        self.value = value
        self.pending = pending

    def __repr__(self) -> str:
        return f"{self.name} {self.rtype} {self.value}"


def strip_comment(line: str) -> str:
    """Drops a trailing ; comment, leaving semicolons inside quotes alone.

    This matters more than it looks: a DMARC value is
    "v=DMARC1; p=reject; ..." and cutting at the first semicolon would leave
    a record that is not the one in the file, compare it against the one that
    is, and report drift that does not exist.
    """
    out, quoted = [], False
    for char in line:
        if char == '"':
            quoted = not quoted
        if char == ";" and not quoted:
            break
        out.append(char)
    return "".join(out).rstrip()


def parse(path: Path) -> tuple[str, list[Record]]:
    """Reads the zone. Returns the origin and the records in it."""
    origin = ""
    records: list[Record] = []
    pending = False

    for raw in path.read_text(encoding="utf-8").split("\n"):
        if PENDING_FROM in raw:
            pending = True

        line = strip_comment(raw)
        if not line.strip():
            continue

        if line.startswith("$ORIGIN"):
            origin = line.split()[1].rstrip(".")
            continue
        if line.startswith("$"):
            continue

        # name IN TYPE value...
        matched = re.match(r"^(\S+)\s+IN\s+(\S+)\s+(.*)$", line.strip())
        if not matched:
            print(f"  ??    cannot parse: {line.strip()}")
            continue

        name, rtype, value = matched.groups()
        records.append(Record(name, rtype.upper(), value.strip(), pending))

    return origin, records


def fqdn(name: str, origin: str) -> str:
    if name == "@":
        return origin
    if name.endswith("."):
        return name.rstrip(".")
    return f"{name}.{origin}"


def dig(name: str, rtype: str, server: str | None) -> list[str]:
    command = ["dig", "+short"]
    if server:
        command.append(f"@{server}")
    command += [name, rtype]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.split("\n") if line.strip()]


def normalise(rtype: str, value: str) -> str:
    """The one shape a value has, whichever side it came from.

    dig and a zone file disagree about spacing and about trailing dots, and
    neither disagreement is a difference in the DNS.
    """
    value = value.strip()
    value = re.sub(r"\s+", " ", value)
    if rtype in {"CNAME", "MX", "NS"}:
        value = value.rstrip(".") if rtype == "CNAME" else value
        if rtype == "MX":
            # "0 ." and "0 lautstark.tech." differ only in the target.
            parts = value.split(" ", 1)
            if len(parts) == 2:
                target = parts[1].rstrip(".") or "."
                value = f"{parts[0]} {target}"
    if rtype == "CAA":
        # dig prints CAA flags/tag/value the same way, but quoting can vary.
        value = value.replace('" "', '""')
    return value


failures: list[str] = []
def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zone", type=Path, default=DEFAULT_ZONE)
    parser.add_argument("--server", default=None,
                        help="resolver to ask; default is the system one")
    parser.add_argument("--pages", action="store_true",
                        help="also check the GitHub Pages records")
    args = parser.parse_args()

    if not shutil.which("dig"):
        print("dig is not installed, so nothing could be checked.")
        return 1

    origin, records = parse(args.zone)
    if not origin:
        print(f"{args.zone} has no $ORIGIN, so there is nothing to check.")
        return 1

    print(f"{origin}, against {args.zone}\n")

    # Delegation first. Without it every check below fails for one reason,
    # and twelve failures with one cause read like a catastrophe.
    nameservers = dig(origin, "NS", args.server)
    if not nameservers:
        print(f"  --    {origin} has no NS records: the domain is not in the")
        print("        registry yet, or is registered and not delegated. Until")
        print("        that is fixed nothing typed into the panel can take")
        print("        effect, and nothing below would mean anything.")
        print("\n  Not delegated. Nothing checked.")
        return 1

    print("  ns    " + ", ".join(sorted(ns.rstrip(".") for ns in nameservers)))
    print()

    pending_skipped = 0
    for record in records:
        if record.pending and not args.pages:
            pending_skipped += 1
            continue
        if record.rtype not in KNOWN:
            check(True, f"{record.name} {record.rtype}", "not checked by this script")
            continue

        name = fqdn(record.name, origin)
        label = f"{record.name:<16} {record.rtype:<6} {record.value}"

        if "*" in name:
            check(True, label, "wildcard, not queryable directly")
            continue

        live = {normalise(record.rtype, one) for one in dig(name, record.rtype, args.server)}
        want = normalise(record.rtype, record.value)
        check(want in live, label,
              "" if want in live else f"live: {', '.join(sorted(live)) or 'nothing'}")

    if pending_skipped:
        print(f"\n  --    {pending_skipped} record(s) in the Pages block were not")
        print("        checked: that block is not applied yet. --pages checks them.")

    print()
    if failures:
        print(f"{len(failures)} record(s) do not match the file:")
        for name in failures:
            print(f"  {name}")
        print("\nEither the panel was changed without the file, or the file was")
        print("changed without the panel. dns/README.md says which to fix.")
        return 1

    print("All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
