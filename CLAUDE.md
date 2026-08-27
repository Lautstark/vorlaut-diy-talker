# Working in this repository

## Where you are

`vorlaut-diy-talker` is **the device**: `firmware/`, `case/`, `device/` and
`loader/` — the page that takes a board exported from the editor, compiles it
into what a talker reads and sends it down the cable. It keeps this
repository's name, its history, its published address and its `v*` tags.

The editor left on 2026-08-27 and is
[`Lautstark/vorlaut-editor`](https://github.com/Lautstark/vorlaut-editor):
`src/`, `exchange/`, the symbol search, the voices and the three `.obz` doors.
[ADR 0012](adr/0012-the-repository-splits-editor-leaves.md) is the decision.

Two things follow for anybody working here. **The boundary is a file, not a
dependency** — nothing here imports the editor and nothing there imports this,
so a change that needs both halves is two changes in two repositories, not one.
And **you cannot fix the editor from here.** A crossing that turns out to be
wrong is answered on this side or reported, never by vendoring a copy of the
editor's code: `docs/split-crossings.md` names that as the edit that must not
happen, and `device/fixtures/` is the arrangement that makes it unnecessary.

Several agents work here at once, in parallel worktrees. Three rules keep them
from colliding. They exist because on 2026-08-24 three agents independently
committed the same repository rename, none of them wrong to do it.

## 1. The branch name is the only name

A worktree lives at `.claude/worktrees/<branch without the `claude/` prefix>`.
No generated names. A worktree named after one task while holding another
task's branch is how four parallel agents become untrackable, so
`git worktree list` is meant to be the whole dashboard:

```bash
git worktree list
```

## 2. Say who you are, first

Before anything else — before reading the task, before the first edit — an
agent records what it is working on:

```bash
git config branch.$(git branch --show-current).description "Agent A - multi-board + shell extraction"
```

At spawn time, never retroactively: a description written afterwards is a
reconstruction, and the case that made this rule necessary was one where
authorship could no longer be established at all. Read them all back with:

```bash
git config --get-regexp 'branch\..*\.description'
```

## 3. Repo-wide edits belong on main, and to one session

A repo-wide edit is anything touching unrelated files for a single mechanical
reason: a rename, a mass find-and-replace, a formatting sweep, a dependency
bump, a licence header.

Since the split there is a second way to acquire one without meaning to. Prose
in `docs/` and `adr/` cites the editor's files by relative path, and those paths
now resolve across a repository boundary; `tests/test_links.py` is what notices,
and it checks every tracked file rather than every changed one. Fixing the whole
sweep is a repo-wide edit and belongs on `main`. Fixing the links your own
change broke is not one — it is part of your change.

A feature branch never contains one. It lands on `main` in its own session, and
every other branch rebases onto it.

The temptation is to clear the ground before starting the real task — one of
the three duplicate renames said so outright, that it went first so the work
after it had a clean base. That instinct is right and the rule still holds:
ask for it on `main` and wait, rather than doing it yourself.

## 4. Land your own finished work

**Ask about decisions, not about permission to merge.** A design fork, a
tradeoff, something the task did not settle — those are worth stopping for.
Work that is finished and green is not; leaving it on a branch waiting to be
noticed is how a repository ends up with twenty-one of them.

From the worktree:

```bash
git push -u origin "$(git branch --show-current)"
```

GitHub answers that with an offer to open a pull request. Ignore it — that
hint comes from GitHub and applies to every repository, and this one has never
merged through a pull request. What the push is actually for is CI.

**Know what that push proves, and what it does not.** Only
`commit-messages.yml` runs on a `claude/**` branch. Tests, Pages and the
firmware build trigger on `main` and on pull requests, so a green branch push
means the commit subjects are well formed and nothing else. Run the rest
yourself, and run it **after `git add`** — `test_links.py` and
`test_language.py` take their file list from `git ls-files`, so an untracked
file is invisible to them and the suite comes up green until you commit:

```bash
git add -A
npm run typecheck && npm test && npm run test:e2e && python3 tests/run.py
```

Then land it. `main` is checked out at `~/Code/vorlaut-diy-talker`, shared with
every other agent, so look before touching it — and use `git -C`, never `cd`, or
every command after it runs in the wrong tree:

```bash
git -C ~/Code/vorlaut-diy-talker status -sb          # must say main, and be clean
git -C ~/Code/vorlaut-diy-talker merge --no-ff "$(git branch --show-current)"
git -C ~/Code/vorlaut-diy-talker push origin main
```

**The path is `vorlaut-diy-talker`, and `~/Code/vorlaut` is somebody else.** The
folder was renamed on 2026-08-27 to match the repository, because
`Lautstark/vorlaut` now exists as a separate, unrelated repository — the
explainer site. A merge run against `~/Code/vorlaut` would land this repository's
branch in that one and push it, and the commands would look right the whole way.
If a transitional symlink is still standing there, it is on its way out; write
the real path.

`--no-ff` always, even where the branch would fast-forward. A branch stays
visible as a unit that way, which is worth more than a linear history when
several of them land in an afternoon.

If `main` has moved underneath you between two commands — it does, several
times a day — merge again rather than forcing anything. If it is dirty with
another agent's uncommitted work, wait. It is usually clean again within the
hour, and the alternative is stashing somebody else's work, which has gone
wrong here before.

Delete the branch and its worktree afterwards, so `git worktree list` stays
the dashboard rule 1 says it is.
