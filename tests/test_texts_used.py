#!/usr/bin/env python3
"""Checks that every text in src/core/boot_data.ts is one something asks for.

A text entry is not code. Nothing imports it, nothing calls it, and the
compiler has no opinion about it, so when the screen that showed it is
rewritten the entry stays behind and reads exactly like an entry in use. The
only thing that ever removes one is somebody remembering.

Nobody remembered. Moving the tablet's pages from a strip above the board into
the sidebar left twenty-nine of them behind in two languages, among them the
heading of the strip, the sentence that named the path, the fold-away "+{n}
weitere" and the label of a button that had moved into the overflow menu. They
sat in the file for days looking like the live entries around them, and the
next person wanting a word for a page would have found several with no way to
tell which one the screen actually draws.

They were invisible to grep for one reason. `editor-app/editor.ts` built a key
out of a fragment that was a literal at both call sites:

    flag("app_first_column_share", ...)   ->   t(`ui.${key}`)

One line, and all five hundred `ui.` entries become something that might be
reachable. That is why this check and that call site changed together.

## What counts as asking for a text

  * The whole key, written out and quoted - `t("ui.app_pages_list")`.
  * A family prefix in a template - ``t(`ui.wordclass_${one.key}`)`` - which
    speaks for every `ui.wordclass_*` entry there is.
  * `new Trouble("folder_stale")`, which is a lookup of `err.folder_stale` by
    another name: `Trouble` carries a word, `t(`err.${error.word}`)` turns it
    back into a key, and the word is a literal at every throw site.

A family prefix vouching for its whole family is deliberately generous. It
cannot tell that one member has gone unused, so a dead `ui.theme_*` slips
through. That is the price of having no hand-kept exception list, and it is
worth paying: the families are small and hand-written, the flat keys are five
hundred, and all twenty-nine of the dead ones were flat.

## Why a bare namespace is not automatically an error

`ui.` and `err.` are both prefixes that name no family - they vouch for a whole
table at once. The first made this check vacuous. The second is how `Trouble`
has always worked and is perfectly sound.

The difference is not their length, and a rule about length would only be a
rule about these two names. The difference is whether the wildcard is doing any
work: `err.` vouches for five keys that the throw sites already account for one
by one, so removing it would change nothing. `ui.` vouched for five hundred
that nothing else accounted for at all.

So the rule is: **a wildcard is allowed exactly where it is redundant.** A bare
namespace fails only if some key in it would go unaccounted for without it -
which is precisely the case where it is hiding something. A namespace with no
declared keys at all, like the `package.` used to build fixture paths, vouches
for nothing and passes without a word.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / "src" / "core" / "boot_data.ts"

# A key is a dotted lowercase name. The two table names, "de" and "en", carry
# no dot and are skipped by that alone rather than by being named here.
KEY = r"[a-z0-9_]+\.[a-z0-9_.]+"

DECLARED = re.compile(rf'^    "({KEY})":', re.M)
QUOTED = re.compile(rf'"({KEY})"')
# A template key, but only where it is being passed to something: a `(` or a
# `,` before it. A backtick string in prose or in a class name is not a lookup.
TEMPLATE = re.compile(r"[(,]\s*`([a-z0-9_]+\.[a-z0-9_]*?)\$\{")
TROUBLE = re.compile(r'new Trouble\(\s*"([a-z0-9_]+)"')
# A prefix with nothing after the dot names a whole table rather than a family.
WHOLE_TABLE = re.compile(r"^[a-z0-9_]+\.$")


def sources() -> list[Path]:
    """Every tracked file that could hold a lookup, the table itself aside.

    From `git ls-files` rather than a walk, for the reason the rest of this
    suite uses it: an untracked file is not part of the repository, and a file
    deleted but not yet committed still is.
    """
    listed = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True,
                            capture_output=True, text=True).stdout.split("\n")
    return [ROOT / name for name in listed
            if name.endswith((".ts", ".tsx", ".mjs", ".js", ".html"))
            and (ROOT / name) != TABLE]


def main() -> int:
    text = TABLE.read_text(encoding="utf-8")
    declared = {m.group(1) for m in DECLARED.finditer(text)}

    named: set[str] = set()
    prefixes: dict[str, str] = {}
    for path in sources():
        body = path.read_text(encoding="utf-8", errors="replace")
        named.update(m.group(1) for m in QUOTED.finditer(body))
        named.update("err." + m.group(1) for m in TROUBLE.finditer(body))
        for m in TEMPLATE.finditer(body):
            line = body.count("\n", 0, m.start()) + 1
            prefixes.setdefault(m.group(1), f"{path.relative_to(ROOT)}:{line}")

    families = [p for p in prefixes if not WHOLE_TABLE.match(p)]

    def accounted(key: str) -> bool:
        return key in named or any(key.startswith(p) for p in families)

    problems: list[str] = []

    # A wildcard over a whole table, where something in that table needs it.
    for prefix, where in sorted(prefixes.items()):
        if not WHOLE_TABLE.match(prefix):
            continue
        hidden = sorted(k for k in declared
                        if k.startswith(prefix) and not accounted(k))
        if hidden:
            problems.append(
                f"{where}: `{prefix}${{...}}` names a whole table, and "
                f"{len(hidden)} of its keys are reachable by nothing else - "
                f"so it hides them from this check. First one: {hidden[0]}. "
                f"Pass the whole key, or give the fragment a home this file "
                f"can see the way Trouble does.")

    for key in sorted(k for k in declared if not accounted(k)):
        problems.append(
            f'src/core/boot_data.ts: "{key}" is asked for nowhere. '
            f"Remove it from both tables, or write out the lookup.")

    for line in problems:
        print(line)
    if problems:
        print(f"\n{len(problems)} problem(s). {len(declared)} keys declared.")
        return 1
    print(f"{len(declared)} keys declared, all of them asked for.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
