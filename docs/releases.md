# Releasing, and which tag means what

**One prefix is cut in this repository, and one is reserved.** It was four until
2026-08-27, and the shrinking is two decisions rather than a tidy-up:
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) took the editor
and `exchange/` to `vorlaut-editor`, and
[ADR 0016](../adr/0016-the-browser-half-stops-being-released.md) retired
`builder-v*` because what was left of the browser half is a page deployed
continuously to Pages rather than a thing anybody releases.

| Prefix | What it releases | Cut by | Notes written by |
|---|---|---|---|
| `v*` | the firmware image | `git tag v0.5 && git push origin v0.5` | a person, in `release.yml` |
| `device-v*` | the device interface in `device/` | by hand, and not yet | a person |
| ~~`builder-v*`~~ | ~~the page in `src/`~~ | **retired** — [ADR 0016](../adr/0016-the-browser-half-stops-being-released.md). `builder-v0.1.0` stays published and valid; nothing is re-cut. | |
| ~~`exchange-v*`~~ | ~~`SPEC.md` and its fixtures~~ | **gone with `exchange/`** — it is `vorlaut-editor`'s to cut, and the Android viewer's pin is what waits on it. | |

**`v*` means the firmware and nothing else.** Until now that was visible only
by reading the `on: push: tags:` trigger at the top of
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which is
not where anybody looks before choosing a tag name. It is written here so that
`v1.0.0` is never assumed free for something else — and it is now the only
prefix this repository cuts, which is the clearest that sentence has ever been.

**`device-v*` is reserved and has never been cut**, and it is in this table for
the same reason `v*` is: so that the prefix is taken before somebody needs it,
rather than discovered afterwards. It is held to a bar — no tag until the
fixtures have run against both implementations *and* a mutation run says they
bite — written out step by step in
[`format-freeze.md` section 8](format-freeze.md#8-sequencing-what-has-to-be-true-before-device-v1);
as of 2026-08-27 the first run on real hardware has happened and five of the
six rows in [`cable.md`](cable.md)'s table are ticked. The sixth — a cable
pulled mid-send — is what it now waits on. Pin a commit SHA in the meantime.

They are separate prefixes because the things they release have nothing to do
with each other's cadence. A firmware release is an 8 MB image somebody flashes
onto a device that a child then uses, and it goes out when the firmware is worth
flashing. The device interface is a format two implementations have to agree
about. One tag scheme serving both would mean every format change minting a
version of firmware nobody rebuilt.

## The loader page: deployed, not released

[`pages.yml`](../.github/workflows/pages.yml) builds `loader/` and deploys it to
<https://lautstark.github.io/vorlaut-diy-talker/> on every merge to `main`,
behind the full suite. There is no version, no changelog entry and no tag, and
that is the decision in
[ADR 0016](../adr/0016-the-browser-half-stops-being-released.md) rather than an
omission: the current build is whatever `main` last deployed, nobody can select
an older one, and a version nobody can select is a number rather than a version.

**What was here until 2026-08-27.** release-please watched `main`, kept a pull
request open with the next `CHANGELOG.md` and version in it, and merging that
pull request cut `builder-vX.Y.Z`. It cut exactly one release, `builder-v0.1.0`,
which stays published and valid. The workflow, `release-please-config.json` and
`.release-please-manifest.json` are deleted; `CHANGELOG.md` stays, frozen, with
a note at its head saying what it records.

**Before proposing that a release train come back**, ADR 0016's *Not to be
"fixed" later* is the section to read. The short version: the argument is not
that versions are bad, it is that this page has no consumer who can hold an old
one, and what a proposal has to establish is that two builds can exist at once
and somebody needs to name which they mean.

## The firmware: a tag, by hand

**`v0.4` is the first one, cut on 2026-08-28**, and the three numbers below it
were never tags here: this repository published nothing but `builder-v0.1.0`
until then, while the firmware was flashed straight from a checkout. The number
starts at four rather than at one so that the prose and the fixtures already
naming `v0.4` — `docs/cable.md`, `device/fixtures/cable/firmware-named-in-the-hello`
— stop describing a release nobody could find. It is also the first tag that
does anything beyond publishing an image: `release.yml` compiles it into the
firmware, so a device flashed from it answers `firmware v0.4` when the loader
page greets it ([ADR 0017](../adr/0017-the-loader-page-writes-the-firmware.md)),
and the deployed page takes its image from the newest `v*` release.

```bash
git tag v0.5 && git push origin v0.5
```

`release.yml` compiles the sketch, and writes the release notes in the
workflow itself: how to flash with `esptool`, what the merged image contains,
why the device comes up empty, the note that the firmware has run on one
talker and not a fleet, and the SHA-256 sums of both binaries pinned to the
tag's own tree.

**Those notes are written by hand on purpose, and the inconsistency with the
builder's generated ones is not a defect to be fixed.** They are instructions
for somebody holding a soldering iron and a USB cable, and almost none of what
they need to know is derivable from a list of commits. A generated changelog
in their place would be accurate and useless. If the two mechanisms ever get
unified, the notes are the thing to preserve, not the thing to replace.

## Conventional commits

**Nothing generates a changelog from these any more**, and the convention stays
anyway — [ADR 0016](../adr/0016-the-browser-half-stops-being-released.md)'s Why
has the argument. The prefixes say what a commit *is* before its sentence says
what it does, and they make `git log --oneline` skimmable across a repository
holding TypeScript, C++ and Python. The table below is what each one meant to
release-please; the version column is history now, and the left two columns are
still the rule.

| Prefix | For | Version (historical) |
|---|---|---|
| `feat:` | a capability that was not there before | minor |
| `fix:` | something that was wrong is now right | patch |
| `perf:` | the same thing, faster | patch |
| `refactor:` | the same behaviour, arranged differently | — |
| `docs:` | prose | — |
| `test:` `build:` `ci:` `chore:` | everything else | — |

`feat!:` — or a `BREAKING CHANGE:` trailer in the body — was a major, and is
still how a breaking change announces itself to a reader.

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

Older commits were simply invisible to release-please, which was harmless: it
looked for what it had not released yet and found nothing before the first
`feat:` or `fix:`. `builder-v0.1.0` therefore contains only what happened after
the convention started, which was the correct answer rather than a gap.

### The gate is CI, not the hook

[`.github/workflows/commit-messages.yml`](../.github/workflows/commit-messages.yml)
checks every non-merge commit in a push, on `main` and on `claude/**` branches,
and fails if one has no prefix. It has no `paths:` filter: every other workflow
here runs only when something it checks changed, and this one checks the
commits themselves.

This was a hook first, and a hook was the wrong shape. `core.hooksPath` is
per-clone opt-in, so a clone that never ran it has no check at all.

The failure it was guarding used to be *silent*: a commit with no prefix landed
with no changelog entry, no version bump and no complaint, and a silent failure
guarded by a check somebody has to remember to switch on is not guarded. That
particular failure is gone with release-please — a missing prefix now costs a
reader's time and nothing else. The gate stays because the convention does, and
because a rule enforced everywhere is cheaper to keep than one enforced in the
clones that happened to opt in.

**Commits written before the convention existed are not held to it**, and the
boundary needs no marker file: the workflow skips any commit whose tree does
not contain `tools/check-commit-subject.sh`. A commit written before the rule
shipped could not have followed it. That test survives rebases, needs no
maintenance, and stops mattering by itself once those commits are behind every
range anybody pushes.

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

The shared preset in `Lautstark/.github`, which `renovate.json5` extends,
itself extends `:semanticPrefixFixDepsChoreOthers`, so
a runtime dependency bump arrives as `fix(deps):` and a dev dependency bump as
`chore(deps):`. That distinction was about which reached the changelog; with no
changelog it is about which a person skimming `git log` should stop at, and the
answer is the same one.
