# Releasing, and which tag means what

Three things in this repository are released, on three schedules, by three
different mechanisms. That is a consequence of keeping the builder and the
hardware together — see [`adr/0006-builder-and-hardware-one-repo.md`](../adr/0006-builder-and-hardware-one-repo.md)
— and it works only as long as the tag prefixes stay out of each other's way.

| Prefix | What it releases | Cut by | Notes written by |
|---|---|---|---|
| `builder-v*` | the page in `src/` | release-please, on merge of its pull request | release-please, from the commits |
| `v*` | the firmware image | `git tag v0.2 && git push origin v0.2` | a person, in `release.yml` |
| `exchange-v*` | `SPEC.md` and its fixtures | by hand, and not yet | a person |

**`v*` means the firmware and nothing else.** Until now that was visible only
by reading the `on: push: tags:` trigger at the top of
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which is
not where anybody looks before choosing a tag name. It is written here so that
`v1.0.0` is never used for the builder by somebody who assumed the obvious
prefix was free.

They are separate because the things they release have nothing to do with each
other's cadence. The builder is deployed to Pages from `main` on every push and
a release of it is a changelog and a version, not an artefact anybody
downloads. A firmware release is an 8 MB image somebody flashes onto a device
that a child then uses, and it goes out when the firmware is worth flashing —
which may be months apart from anything happening in `src/`. One tag scheme
serving both would mean every builder change minting a version of firmware
nobody rebuilt.

## The builder: release-please

[`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml)
watches `main`. When it sees conventional commits it has not released, it opens
— and then keeps updating — a pull request containing the next `CHANGELOG.md`
and the next version in `package.json`. **Merging that pull request is the
release**: it cuts `builder-vX.Y.Z` and creates the GitHub release.

> **This is the one pull request in a repository that does not use them.** The
> convention here is a short branch merged locally into `main` with `--no-ff`.
> release-please's model is a bot-maintained pull request and there is no way
> to run it without one, so this is an exception rather than a change of
> practice. Nobody reviews it; merging it is pressing the button.

> **CI does not run on that pull request.** It is opened with the workflow's
> own `GITHUB_TOKEN`, and events from that token deliberately do not start new
> workflow runs. The pull request only ever changes `CHANGELOG.md` and the
> version in `package.json`, so there is little for CI to say — but do not read
> its lack of a green tick as a problem, and do not read it as an all-clear
> either.

### Which commits count: paths, not scopes

`release-please-config.json` excludes `firmware/`, `case/` and `exchange/`. A
commit whose files all fall inside those is not a builder change and does not
appear in the builder's changelog. **Everything else counts** — `src/`, but
also `docs/`, `tests/`, `e2e/`, `adr/`, `dns/`, and the configuration at the
root.

This is deliberately decided by path rather than by the scope written in the
commit message. A scope is a thing somebody has to remember, and the failure
when they forget is silent: the commit lands, nothing appears in the changelog,
and no version moves. A path is mechanical.

**A commit that touches both `src/` and `firmware/` counts for the builder.**
release-please drops a commit only when *every* file in it is excluded. That
direction is chosen on purpose: an occasional version bump for a change that
was mostly firmware costs nothing, and an omitted change is the failure that
matters.

To stop a new directory from counting, add it to `exclude-paths`. That is the
whole mechanism.

### If the builder ever leaves this repository

`"component": "builder"` with `"include-component-in-tag": true` is what makes
the tag `builder-v1.2.0` instead of `v1.2.0`. In a repository containing only
the builder, `v*` would be free and the prefix would be noise.

Setting `include-component-in-tag` to `false` is the whole change. The
versions, the changelog, the manifest and the workflow all carry over
untouched, and the existing `builder-v*` tags stay valid history. It is a
rename, not a redesign, and it is written this way now so that it stays one.

## The firmware: a tag, by hand

```bash
git tag v0.2 && git push origin v0.2
```

`release.yml` compiles the sketch, and writes the release notes in the
workflow itself: how to flash with `esptool`, what the merged image contains,
why the device comes up empty, the warning that the firmware has never run on
real hardware, and the SHA-256 sums of both binaries pinned to the tag's own
tree.

**Those notes are written by hand on purpose, and the inconsistency with the
builder's generated ones is not a defect to be fixed.** They are instructions
for somebody holding a soldering iron and a USB cable, and almost none of what
they need to know is derivable from a list of commits. A generated changelog
in their place would be accurate and useless. If the two mechanisms ever get
unified, the notes are the thing to preserve, not the thing to replace.

## Conventional commits

release-please reads the prefix of each commit subject and nothing else.

| Prefix | For | Version |
|---|---|---|
| `feat:` | a capability that was not there before | minor |
| `fix:` | something that was wrong is now right | patch |
| `perf:` | the same thing, faster | patch |
| `refactor:` | the same behaviour, arranged differently | — |
| `docs:` | prose | — |
| `test:` `build:` `ci:` `chore:` | everything else | — |

`feat!:` — or a `BREAKING CHANGE:` trailer in the body — is a major.

**This repository's commit subjects have never been written this way.** A
hundred and fifty of them are plain sentences: *Wake in half a second instead
of four and a half.* *Turn the backlight off when the device sleeps, and mean
it.* Adopting conventional commits does not replace that; the prefix goes in
front of the sentence that was going to be written anyway.

```
feat: wake in half a second instead of four and a half
fix: turn the backlight off when the device sleeps, and mean it
docs: write down why waking her device takes three presses
```

Older commits are simply invisible to release-please, which is harmless — it
looks for what it has not released yet, and finds nothing before the first
`feat:` or `fix:`. The first release will therefore contain only what happened
after the convention started, and that is the correct answer rather than a gap.

### The gate is CI, not the hook

[`.github/workflows/commit-messages.yml`](../.github/workflows/commit-messages.yml)
checks every non-merge commit in a push, on `main` and on `claude/**` branches,
and fails if one has no prefix. It has no `paths:` filter: every other workflow
here runs only when something it checks changed, and this one checks the
commits themselves.

This was a hook first, and a hook was the wrong shape. `core.hooksPath` is
per-clone opt-in, and the thing it guards fails *silently* — a commit with no
prefix lands with no changelog entry, no version bump, and no complaint. A
silent failure guarded by a check somebody has to remember to switch on is not
guarded. It is also the same failure that path-filtering exists to prevent,
arriving through a different door.

**Commits written before the convention existed are not held to it**, and the
boundary needs no marker file: the workflow skips any commit whose tree does
not contain `tools/check-commit-subject.sh`. A commit written before the rule
shipped could not have followed it. That test survives rebases, needs no
maintenance, and stops mattering by itself once those commits are behind every
range anybody pushes.

### What 0.1.0 is missing

`fa6e4d2` — *Switch the symbols too, not just the labels* — went onto `main`
with no prefix, and the check caught it after the push rather than before.
It is the change that made symbol search follow the page's language instead of
always asking ARASAAC's German endpoint, and it is the reason this repository
depends on bildquelle 1.6.0.

It is not rewritten, because it is shared history with merges on top of it, and
because that is what the check itself says to do. So it is written down here
instead: **the 0.1.0 notes will not mention it, and they should.** Whoever
merges the release pull request wants this line under *Fixes*:

```
* search ARASAAC in the page's own language, not always German ([fa6e4d2](https://github.com/Lautstark/vorlaut-diy-talker/commit/fa6e4d251fd5e32905be006b9de3f2389d5e837a))
```

The clone it was written in had no `core.hooksPath`, which is the case the last
section is about, and it is set there now. Delete this section once 0.1.0 is
out — it is a record of one commit, not a rule.

### The hook, still there

[`.githooks/commit-msg`](../.githooks/commit-msg) remains as a convenience,
because CI tells you *after* the push — when the commit is already history and
fixing it means rewriting a branch. The hook tells you while the message is
still in the editor.

```bash
git config core.hooksPath .githooks
```

Once per clone. In a worktree it is inherited: worktrees share the main
repository's config, so setting it once covers all of them — a fresh *clone* is
the case that starts without it, and the reason the gate is in CI.

It lets merge commits, reverts and `fixup!` through untouched, and
`git commit --no-verify` overrides it.

### One rule, one file

Both the hook and the workflow call
[`tools/check-commit-subject.sh`](../tools/check-commit-subject.sh), which is
the only place the pattern and the explanation are written. A rule that exists
twice gets relaxed once, and then the two disagree about what landed.

### Renovate agrees with all of this

`.github/renovate-shared.json5` extends `:semanticPrefixFixDepsChoreOthers`,
so a runtime dependency bump arrives as `fix(deps):` and reaches the changelog,
while a dev dependency bump arrives as `chore(deps):` and does not. Nobody
reading a release note needs to know which version of vitest built it.
