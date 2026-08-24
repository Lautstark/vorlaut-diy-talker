# Working in this repository

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

A feature branch never contains one. It lands on `main` in its own session, and
every other branch rebases onto it.

The temptation is to clear the ground before starting the real task — one of
the three duplicate renames said so outright, that it went first so the work
after it had a clean base. That instinct is right and the rule still holds:
ask for it on `main` and wait, rather than doing it yourself.
