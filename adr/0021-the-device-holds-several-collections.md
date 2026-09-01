# ADR 0021 — The device holds several collections, and a collection is one file

**Status:** accepted, amended 2026-09-01 (decisions 1 and 2 — see *The amendment*) · **Date:** 2026-09-01 · **Applies to:**
[`firmware/vorlaut/collections.h`](../firmware/vorlaut/collections.h),
[`firmware/vorlaut/cable_format.h`](../firmware/vorlaut/cable_format.h),
[`loader/src/compile.ts`](../loader/src/compile.ts),
[`loader/src/cable.ts`](../loader/src/cable.ts),
[`loader/tools/cable.js`](../loader/tools/cable.js),
[`device/fixtures/collections.expected.json`](../device/fixtures/collections.expected.json)

## Context

A talker carried exactly one collection, in `/layout.bin`, and every transfer
replaced it. That was right while a device held one game: what the payload does
not name is stale, so the sweep in `plan()` is a correct sweep.

It stopped being right the moment there was a second thing worth carrying.
Three finished collections are waiting — *Spiegel und Ei*, *Schattenspiel*,
*Plauderbuch* — and with Bente's speech vocabulary they come to about 6500 KiB
against the 7040 the file area has had since
[ADR 0018](0018-the-file-area-takes-the-ota-slot.md). **They fit. What does not
fit is the format**: each one arrives and sweeps the last one off, so a device
that could hold all three holds whichever was sent most recently, and switching
between them means standing at a desk with a cable.

The thing that makes this a decision rather than a loop is that the sweep
cannot simply be turned off. Every tile and recording is named for its
content, so two collections that use the same picture use the *same file*. Once
a device holds several, "on the device and not in this payload" no longer means
stale — it means *belongs to the other game*, and a sweep is the one edit that
silently breaks a collection nobody touched.

## Decision

### 1. A collection is one file, under a name of its own

`c<32 hex>.bin`, holding exactly the bytes
[`layout_format.h`](../firmware/vorlaut/layout_format.h) has always read. **Not
a new format and not a new `LAYOUT_VERSION`** — a collection is parsed by
`parseLayout()` and by nothing else.

The hash is of the **Sammlung's own id**, not of the bytes, so a collection
sent twice lands on one file both times and is replaced rather than
duplicated — and two Sammlungen are two files however alike their contents.

**The list of collections is not a structure anybody maintains — it is what
lies in the directory.** Adding one is `put`, removing one is `rm`, and both of
those verbs already existed. There is no index file to fall out of step with
the files it names, and none to repair when it does.

### 2. A collection's name lives at the head of its file

There is no name field of its own, and that is a decision rather than an
omission. The header is twelve bytes with nothing spare, so a name would be a
longer header, a new `LAYOUT_VERSION` and a MAJOR of the whole device
interface. The first set's name is already there at a fixed offset, so **the
first `NAME_BYTES` after the header is what the menu shows**, and the device
reads 44 bytes of each file to learn it.

That is what keeps holding sixteen collections a directory walk instead of
sixteen parses. **Only the active collection is parsed**, which is why the cost
of a second game is disk and not the 13580 bytes of SRAM a layout occupies.

What goes into that slot is the **Sammlung's own name**, which the loader
writes there when it renders the file. Where the package carries no name — one
written before `ext_lautstark_package_name` existed — the slot keeps the first
set's name, which is what every collection already on a talker is listed
under.

### 3. The greeting says how many, and silence means one

`< collections 16`, beside `tiles` and for the same reason
[ADR 0019](0019-tiles-travel-compressed.md) gave: **the device is the end that
knows.** A browser that assumed a number would be back to guessing at a
constant it was never told.

A talker flashed before 2026-08-31 does not say the word. **Absence means one**,
which is what those devices really hold, and a transfer to one really is a
replacement. This is what decides whether `plan()` sweeps or adds, and it is
also what says whether `get` below may be sent at all.

### 4. A seventh verb, `get`, hands one file back

```
> get <name>                 hand one back, as raw bytes
< data c3bd7….bin 5104 1a2b3c4d
  …that many raw bytes…
< sent c3bd7….bin 5104
```

Working out what a *removed* collection leaves behind means knowing what the
collections that **stay** still name. There were two ways to get that, and they
are the whole of the choice:

- **the device walks its own layouts** — parses every collection, unions the
  names, and answers a question; or
- **the device hands the files over** and the browser does the arithmetic it
  already does for `put`.

This takes the verb. It is one more thing the device *does* and no more
thinking — the same shape `crc` already had — and it keeps the deciding on the
side with the memory and the language for it, which is the sentence
[`docs/cable.md`](../docs/cable.md) has led with since there was a cable.

### 5. Which one is showing is in NVS, by file name

Beside the volume, for the reason the volume is there: it is something the
person in the room changes, so it is not a field in a format. A collection file
that had to be rewritten to answer a key press would be a format doing a
setting's job.

The **file name** and not an index, because an index means something different
the moment a collection is added or removed — and adding and removing is what
this whole change is for. A name that is no longer there falls back to the
first in the order, out loud on the serial port, and **the fallback is not
written back**: a collection that comes back should be showing again without
anybody choosing it twice.

### 6. The menu gains one level, and only one

`Sammlung` is the fourth key of the menu and the only thing below it.
**Volume stays on the first level**, because it is the one thing in here
somebody presses more than once and it must not move under them. Info stops
being a key: its job — telling a device with no content from a device whose
file system will not mount, [`bring-up.md`](../docs/bring-up.md) stage 7 — moves
into the **empty state of the collection screen**, which is exactly the screen
that has four keys standing free and something to explain.

Four names to a screen, three once it has to page, and sixteen is the cap: past
that, choosing is more work than a person holding a talker should have.

## Why

**Because the alternative is an index file.** A manifest of collections is the
obvious shape and it is the one thing this must not be: it is a second source
of truth about what is on the partition, it goes stale whenever a `put` or an
`rm` lands without it, and repairing it means the walk it was meant to avoid.
The directory already *is* the list.

**Because the sweep had to become a decision the device makes, not the page.**
Whether a transfer replaces or adds is now answered by the device's own
greeting. A page that chose for itself would be a page that is wrong about
every talker it has not met.

**Because holding sixteen collections had to cost disk and not RAM.** Sixteen
parsed layouts do not fit and never will. Names out of file heads do: 71 bytes
each, against 13580 for the one that is showing.

## Consequences

- **The device interface is 2.3.0**: 2.2.0 for the collections themselves, and
  2.3.0 for the two package fields the amendment below adds. Both MINOR: a
  capability added, nothing existing changed, no reader made to misread anything
  it already accepts.
- **A collection travels under the old name to a device that only knows the old
  name.** The loader sends `layout.bin` where the greeting says one collection,
  and `c<hash>.bin` where it says more — decided in `underDeviceNames()` in
  [`loader/src/cable.ts`](../loader/src/cable.ts), in the same place and for the
  same reason the tiles pick their form: *here is the first place that knows who
  is listening.* Without it a new page sends an old talker a file it never opens
  and sweeps away the one it does, and the device comes back with five black
  keys from a transfer that reported success. `tests/unit/cable_legacy_name.test.ts`
  is what holds that.
- **An old device keeps working, and so does its file.** `layout.bin` is read
  as the one collection it has always been, listed and switchable like any
  other. Nothing writes that name any more except the case above.
- **The folder export writes `c<hash>.bin` and removes `layout.bin`.** It has no
  talker to ask, so unlike the cable it cannot adapt — an image built with
  `mklittlefs` from a folder written today and flashed onto firmware from before
  2026-08-31 shows nothing. That is the bring-up path, where the firmware and
  the image are written in the same sitting from the same checkout, and it is
  the same trade [ADR 0019](0019-tiles-travel-compressed.md) made in the other
  direction when it kept that export raw.
- **Removing a collection is a separate act with a subtraction of its own.** It
  is not `plan()`, because it needs the collections that stay; that is
  `planRemoval()`, and it is what `get` exists to feed.
- **A collection this page cannot read cannot be removed.** Sweeping on behalf
  of a collection whose contents are unknown would take another one's files
  with it, so such a collection is listed and left alone.
- **Two collections a person has given the same name look the same in the
  menu.** The order stays deterministic — `collectionOrder()` breaks the tie on
  the file name — but a person cannot tell them apart. They are still two
  collections and neither replaces the other; what is lost is only the ability
  to choose between them by reading. The remedy is a rename in the editor, and
  a page that warned when a payload would land a second collection under a name
  already on the device would close it properly. **It is built.**
  `sameNameOnDevice()` in [`loader/src/cable.ts`](../loader/src/cable.ts) reads
  the head of every other collection during the session the diff already opens,
  and what it finds travels in the `Plan` beside the numbers — so the sentence
  is said by both presses that ask what a transfer would do, the cost button
  and the transfer itself, before the first file crosses. It warns and does not
  refuse, for the reason the bullet gives: nothing is broken and both
  collections stay. What the timing buys is the size of the remedy — before the
  transfer it is a rename, after it a rename, a re-export and a second
  transfer. Three things it deliberately does not call a clash: a collection
  replacing itself, which lands on its own file both times because the name is
  a hash of the Sammlung's id; a device that says it holds one, which has
  nothing to collide with and no `get` to be asked with; and a collection this
  page cannot read, which is passed over rather than guessed at, exactly as the
  listing passes over it. `tests/unit/cable_same_name.test.ts` is what holds
  all four.
- **The set a talker is on resets when the collection changes.** Set 4 of one
  collection is not set 4 of another.
- **About 1.2 KiB of RAM**, static: sixteen names and file names.

## The amendment

Decisions 1 and 2 were written believing two things about an `.obz` that are
not true, and both were found the same day by looking at the three real
collections this was built for rather than at the format.

**A root board's id does not identify a Sammlung.** Decision 1 named a
collection's file after it, on the reasoning — written into
`loader/src/device_package.ts` — that it was "the only thing in a `.obz` that is
about the Sammlung rather than about a board". It is about a board, exactly as
it says. The editor's `boardId(at)` is `set-${at + 1}`, so **every Sammlung ever
exported carried the root board id `set-1`**, every one of them hashed to the
same `c<hash>.bin`, and a second collection sent to a talker replaced the first.
That is the one failure this ADR exists to prevent, arriving through the door it
did not look at.

**An `.obz` did not carry the Sammlung's name, and did not have to stay that
way.** Decision 2 read that absence as a fact about the format. It was a fact
about the export: the name went into the download's filename and nowhere else.
Of the three collections here, two have a root board called `Runde 1`, so the
menu showed one name twice and neither named a game.

Both are one omission — the device package carried no package identity — and
both are closed by writing the two fields `exchange/SPEC.md` already defines for
exactly this, `ext_lautstark_package_id` and `ext_lautstark_package_name`, on
the root board of the device export. **No format changed and no version moved.**
The loader hashes the package id where there is one and the root board's id
where there is not, and writes the package name into the head of the collection
file where there is one and leaves the first set's name where there is not — so
a package written before this keeps compiling to exactly the file it compiled to
before.

## Not to be "fixed" later

**`layout.bin` is not deprecated and must not stop being read.** It is what
every talker flashed before today carries, and the loader still writes it to
any device that says it holds one collection. A change that made `c<hash>.bin`
the only name the firmware opens, or the only name the page sends, would brick
those devices the first time somebody sent them a board — silently, from a
transfer that says it worked.

**The list must not become an index file.** See *Why*. Every proposal to speed
up the directory walk by writing down what it found is this, and the walk is
44 bytes a file on a partition that holds sixteen.

**The collection's identity must not go back to being read off a board.** A
root board's id, its name, a hash of its bytes — each looks like it identifies
a Sammlung and none of them does. The id is the editor's own, opaque here, and
it is opaque on purpose: it survives a rename, it survives an edit, and two
Sammlungen holding identical boards are still two.

**`collections` in the greeting is a number and must not become a flag.** The
page has to refuse a payload that would push a device past what it can hold,
and it cannot do that against a boolean.

**The verb must not grow a second argument.** `get <name>` hands back one file
and the browser does the thinking — a `get` that took a range, or answered a
question about a layout, is the device growing an opinion, which is the thing
[`docs/cable.md`](../docs/cable.md) is about not doing.
