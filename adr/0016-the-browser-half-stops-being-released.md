# ADR 0016 — The browser half stops being released, and `builder-v*` is retired

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:**
`.github/workflows/release-please.yml`, `release-please-config.json`,
`.release-please-manifest.json`, [`docs/releases.md`](../docs/releases.md)

## Context

[ADR 0006](0006-builder-and-hardware-one-repo.md) kept the builder and the
hardware in one repository, and its consequences named the price: two
releasable things out of one repository need two tag prefixes, because `v*`
already means a firmware image and a second meaning for it would be worse than
a second prefix. So `builder-v*` was cut by release-please for the page in
`src/`, and `v*` by hand for the firmware.
[`docs/releases.md`](../docs/releases.md) is where both were written down.

[ADR 0012](0012-the-repository-splits-editor-leaves.md) then took the editor to
`vorlaut-editor`, and that ADR's consequences say `v*` keeps meaning a firmware
release, that nothing is re-prefixed, and that no tag already out in the world
changes meaning. All of that holds. What it did not say — because the question
was not asked — is what `builder-v*` is *for* afterwards.

The answer arrived by itself, on the day. release-please had an open pull
request, #4, proposing `builder-v1.0.0`; the split commit refreshed it, and its
changelog is overwhelmingly `editor:`, `editor-app:` and `app:` scoped features
for a product this repository no longer contains. Merging it would have
published, permanently and from the device's repository, a 1.0.0 release note
describing the editor. The same commits exist in `vorlaut-editor` under
different ids, and that repository has an empty tag namespace.

## Decision

**The browser half of this repository stops being released, and `builder-v*` is
retired.**

- `.github/workflows/release-please.yml`, `release-please-config.json` and
  `.release-please-manifest.json` are deleted.
- Pull request #4 is **closed unmerged**, and its branch deleted.
- The `builder-v0.1.0` tag and its GitHub release **stay exactly as they are**.
  Nothing is re-cut, deleted or re-pointed.
- `CHANGELOG.md` stays, frozen, with a note at its head saying what it records
  and where the editor's continuation is.
- **`v*` is the only release prefix this repository cuts.** `exchange-v*` went
  with `exchange/` to `vorlaut-editor`; `device-v*` is still reserved and still
  uncut.
- The conventional-commit gate stays, and
  [`.github/workflows/commit-messages.yml`](../.github/workflows/commit-messages.yml)
  now says why on its own terms rather than by pointing at release-please.

## Why

**The condition that justified a second prefix was two products, and there is
one.** ADR 0006's consequence is conditional in its own wording: a second
releasable thing here would need its own prefix. It was read for years as
"`builder-v*` exists", which is the same sentence with the condition dropped.
The condition is what left with the editor. Retiring the prefix is not a
reversal of 0006 — it is 0006 applied to the repository as it now is.

**A continuously deployed page is published, not released, and the difference
is not pedantry.** [`pages.yml`](../.github/workflows/pages.yml) deploys
`loader/` on every merge to `main`. There is no artefact anybody downloads, no
consumer that pins a version, and no moment at which one build is the current
one and another is not — the current one is whatever `main` last deployed.
`docs/releases.md` already conceded half of this: *"a release of it is a
changelog and a version, not an artefact anybody downloads."* What made that
worth doing anyway was that the editor was a product somebody used on its own
schedule. The loader page is the front end of the firmware's own workflow, and
its schedule is `main`.

**The failure mode was concrete rather than theoretical, and it was one merge
away.** This is the part worth recording, because a decision made against a
hypothetical gets re-argued and one made against an open pull request does not.
Pull request #4 would have cut `builder-v1.0.0` from `vorlaut-diy-talker` with
a changelog of the editor's features. A release note is not a working file: it
is published, it is what a stranger finds first, and it cannot be quietly
corrected later. That the version was **1.0.0** makes it worse rather than
better — the major came from `feat!: the talker keeps the repository`, so the
split itself would have been announced as version one of a builder that had
just left.

**The remaining releasable artefact is real, and it is the firmware.** An 8 MB
image somebody flashes onto a device a child then uses, with notes written by
hand for a person holding a soldering iron. That is what a version is for here.
Keeping a second scheme beside it, for a page that changes when `main` changes,
was costing a workflow, three configuration files, a bot-maintained pull
request in a repository that otherwise never uses them, and — as of today — one
near-miss.

**The convention survives its original justification, and that is not an
accident to be tidied up.** Conventional commit subjects were adopted because
release-please reads them; `commit-messages.yml` is the gate, and its own
header explains itself in terms of a changelog that will no longer be
generated. The prefixes are worth keeping regardless: they say what a commit
*is* before its sentence says what it does, they make `git log --oneline`
skimmable across three languages, and `feat!:` is how a breaking change
announces itself to a reader. What changes is only the reason written down, and
it is rewritten rather than left to rot — see
[`format-freeze.md` §9](../docs/format-freeze.md#9-prose-that-has-drifted-from-the-code)
on prose that outlives its subject.

## Consequences

- **`CHANGELOG.md` stops growing**, and the browser half's history is
  `git log` from here on. That is a real loss and it is small: the file records
  one release, `builder-v0.1.0`, and the work since is in commit messages this
  repository already writes carefully.
- **`package.json`'s `version` is frozen at `0.1.0` and now means nothing.** It
  is left rather than removed because the package is `private: true` and never
  published, and a version field that nothing reads is cheaper than an edit
  that makes somebody wonder what depended on it.
- **Re-adopting release-please later is a small change**, and deliberately so:
  restore three files from this commit's parent. What would *not* come back is
  the tag continuity, and whoever wants it should read the next section first.
- **`v*` is now unambiguous** in a way it has never been here. One prefix, one
  artefact, one workflow — and `docs/releases.md` shrinks to match.

## Not to be "fixed" later

**Somebody will propose a release train for the loader page**, and it will look
obviously right: a deployed page with no version, in a repository that has a
`CHANGELOG.md` and a commit convention that was adopted to feed one. The
argument against is not that versions are bad. It is that this page has no
consumer who can hold an old one — there is no download, no pin, no install,
and no way to run a build other than the one `main` last deployed. A version
nobody can select is a number, not a version.

What somebody proposing one would have to establish is that a *second* build of
this page can exist at the same time as the current one and that somebody has a
reason to name which they mean. A tagged offline copy for a bench with no
network would qualify. "The repository has a changelog" would not.

**Somebody will propose re-cutting `builder-v0.1.0`, or reusing the prefix for
`loader-v*`.** Both are worse than either keeping or retiring. The published tag
is history and stays; a new prefix for the same page would leave two namespaces
describing one thing, which is the confusion ADR 0006 introduced prefixes to
prevent. If this page is ever genuinely released, it earns the argument above
first, and then a prefix — not the other way round.

**Somebody will delete `CHANGELOG.md` as dead weight.** It is the only record
of what the browser half was before the split, in this repository's own words,
and its head says so. `vorlaut-editor` has the continuation under different ids;
neither file is reconstructable from the other.
