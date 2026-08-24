# ADR 0002 — No server and no accounts, anywhere in the toolchain

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** every Lautstark
project

## Context

There are four places in this toolchain where a server is the obvious answer,
and none of them has one.

**The builder** is a static page. It is served from GitHub Pages and it is the
same app as a clone; there is no API behind it, no `.env` to write and no key to
obtain before the first sentence can be typed. Boards, symbols and settings live
in the browser's own storage, on that machine.

**Speech** happens in the tab. piper runs as WASM through
`@lautstark/stimmquelle`, and the second route — Azure Speech — is driven
against a key the user brings and keeps; `src/data/backup.ts` drops it from
every exported artefact.

**Symbols** are fetched from ARASAAC by the browser, or read from the user's own
licensed METACOM folder through the File System Access API.
`@lautstark/bildquelle` is built so that folder cannot be uploaded even by
mistake: symbols leave as object URLs rather than bytes, and a test fails the
build if a network call appears in the METACOM provider.

**Getting content onto the talker** is a USB-C cable. The device has no radio at
all. The Android viewer, likewise, makes no network requests and is sideloaded.

Each of these was decided separately, and each time the reasoning ran the same
way. That is what this ADR is for: to say it once, as a rule, rather than four
times as a coincidence.

## Decision

**No component of any Lautstark project runs a server of ours, and none has
accounts, sign-in, or a credential we issue.**

Concretely, and permanently:

- No backend, no API of ours, no database of ours.
- No user accounts, no sign-in, no password reset, no OAuth client of ours.
- No telemetry, no analytics, no crash reporting, no error collection.
- No sync service. A user's content is on the machine they put it on.
- Static hosting only. GitHub Pages serves bytes and runs nothing of ours.

Third-party endpoints the *user's own browser* talks to are not servers of ours
and are not covered: ARASAAC's public API, Azure Speech against the user's own
key, and a sync client the user installed themselves. The distinction is who
holds the data and who is accountable for it, not whether a packet crosses the
network.

## Why

**The content is the most sensitive kind there is.** A talker holds a disabled
child's own words, photographs of their family, and recordings of a voice.
Nothing in this project is worth putting that on a machine I control. A server
that holds it can be lost, breached, or compelled; a server that never holds it
cannot. Not storing something is the only guarantee that does not depend on my
future competence.

**An account is a wall at the exact wrong moment.** The person setting a talker
up is usually a parent or a therapist, often on borrowed time, sometimes on a
borrowed device. "Create an account to continue" is where they stop. The first
visit seeds an empty set with four keys precisely so there is something to type
into immediately.

**One maintainer cannot promise uptime for a decade.** A server is a commitment
measured in years — renewals, migrations, patches, someone awake when it breaks.
A static page that stops being maintained keeps working, and a clone of it keeps
working after that. A service that stops being maintained goes dark and takes
the content with it. This project is for a child who will need it for a very
long time.

**It removes an entire legal surface.** No personal data reaches me, so there is
no controller relationship, no processing agreement, no subject access request,
no deletion request, no breach notification. For a solo, unfunded project in the
EU, that is not a nice-to-have; it is the difference between shipping and not.

**Cost is the least of it, and still real.** Zero marginal cost per user means
there is never a reason to meter, to tier, or to look for revenue in the
content.

## Consequences

- **No sync between devices, and no account recovery.** A cleared browser
  profile loses the boards. This is why the download button exists, and why
  `@lautstark/sicherung` exists beside it: a folder the user picks once, inside
  a Dropbox or iCloud or Nextcloud tree they already installed, so a sync client
  *they* chose carries the file. That is the whole of the cloud story.
- **`sicherung` works on Chromium on the desktop and nowhere else.**
  `showDirectoryPicker` is missing from Safari, from Firefox, and from every
  browser on Android. `src/shell/backupFolder.ts` therefore hides the offer rather
  than showing a promise the tablet cannot keep.
- **ARASAAC sees the user's IP address.** The old Python server proxied symbol
  search so that the page never talked to the outside; with no server there is
  nothing to proxy through. What crosses is one search term and no identifier.
  This is a real change in who sees what, it is written down in
  `docs/symbol-search.md`, and it is the price of the rule rather than an
  oversight.
- **No usage data at all.** I do not know which features are used, how many
  people have one of these, or what crashed. Bug reports are the entire
  feedback channel, and that is accepted.
- **No over-the-air update for the Android viewer or the firmware.** A new
  firmware is a flash; a new viewer is a sideload.
- **Some features are simply unavailable.** Sharing a board with another family
  through the app cannot be built. Where that matters, the answer is a file the
  user moves themselves — which is what the exchange format is for.

## Not to be "fixed" later

This will be re-proposed, and it will be re-proposed in a reasonable voice:
*just* a small sync service so nobody loses their boards. *Just* accounts, so
sync has something to hang on. *Just* anonymous analytics, to find out which
symbols people actually pick. *Just* a crash reporter, since bug reports are
so thin.

Every one of those is individually defensible, and every one of them ends the
guarantee, because the guarantee is not "we handle your data carefully" — it is
"your child's words are not on a machine I control." That sentence is either
true or it is not.

The test for any future proposal is therefore not "is this feature worth it" but
**"does it create a place where a user's content lives on infrastructure we
operate, or a credential we issue?"** If yes, it does not go in, however small.
If the answer is genuinely no — a file the user carries, a folder the user
picked, an endpoint the user's own browser calls with the user's own key — it
was never in conflict with this ADR to begin with.
