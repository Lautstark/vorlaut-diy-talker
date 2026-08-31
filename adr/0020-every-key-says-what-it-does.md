# ADR 0020 — Every key says what it does and where it goes, and the device holds 64 sets

**Status:** accepted · **Date:** 2026-08-31 · **Applies to:**
[`firmware/vorlaut/layout_format.h`](../firmware/vorlaut/layout_format.h),
[`loader/src/layout_format.ts`](../loader/src/layout_format.ts),
[`loader/src/device_package.ts`](../loader/src/device_package.ts),
[`device/fixtures/layout/`](../device/fixtures/layout/),
[`device/fixtures/package/`](../device/fixtures/package/)

## Context

A joining game is meant to run on the talker. A round fills all five panels:
the set key shows a tile split down the diagonal with the two halves of a
compound word on it — *Spiegel* and *Ei* — and says them out loud; the four
speech keys show the word those halves make and three that they do not. **It
only goes on with the right key.** A wrong key says its own word and the round
stays where it is.

None of that is a mode. There is no round counter in the firmware, no notion of
an answer being right, and nothing that knows a game is being played. **The
right key is simply the only key on the board that leads anywhere**, and
everything else follows from two facts the format could not state:

1. **A key could not say what it does.** A speech key spoke, always. The set
   key switched sets, always, in `(rtcCurrentSet + 1) % layout.setCount` in
   [`vorlaut.ino`](../firmware/vorlaut/vorlaut.ino) — arithmetic in the one
   file no test can include, and a ring nothing in the file described. So a
   round could not have a right key, and it could not have a fifth panel that
   speaks: `SetEntry` carried a `label` hash and no sound at all.
2. **`MAX_SETS` was 5.** A round is a set. Twenty rounds is a session, and five
   is not a game.

[`docs/format-freeze.md`](../docs/format-freeze.md) says no tag has been cut.
Both changes are cheap today and expensive after the first talker is in a
house, and they are one change to one structure, so they land together rather
than one behind the other.

## Decision

### 1. A set holds five keys, and each of them says what it does

`layout.bin` goes to **version 3**. A set entry is a name and five keys — the
set key first, where the label hash sat, then the four speech keys — and a key
is 36 bytes:

| | |
|---|---|
| `image` | 16 bytes, as before |
| `audio` | 16 bytes; the set key could not have one before |
| has-audio | 1 byte, as before |
| `does` | 1 byte: 0 speak, 1 speak and then go, 2 go |
| `target` | 1 byte: the set it goes to |
| spare | 1 byte |

A set entry is 212 bytes where it was 184, and `LAYOUT_MAX_BYTES` is 13580.

The editor's three names for `does` are **Wort**, **Wort & weiter** and
**weiter**. In an `.obz` it is not one field but two: a key that goes somewhere
carries a `load_board`, and **`ext_lautstark_speak_on_navigate`** beside it says
whether it also says its own word first — the exact sibling of
`ext_lautstark_append_on_navigate`, which SPEC.md has carried since 1.2.0.

Three things about that byte are decided here rather than left to a reader:

- **The parser hands it back as it stands**, and what it MEANS is settled in
  `layoutKeySpeaks()` and `layoutKeyGoesTo()` beside it. The same division
  `sleepSeconds` and `layoutIdleSeconds()` have, for the same reason: a lock or
  a fixture that recorded only the meaning could not tell a reader that repairs
  a field from one that reads it.
- **A `does` no version has explained is a key that speaks and stays put** —
  which is what every key in version 2 did. A layout from a newer builder can
  therefore make a key quieter than its author meant and can do nothing worse.
- **A `target` naming no set is not a jump.** The field is a uint8 and so is
  the set count, so the format can say it and `sets[]` cannot hold it. The key
  stays where it is, rather than falling back to set 0:
  [`device-interface.md`](../docs/device-interface.md) §6 is the argument — a
  key that jumps somewhere arbitrary looks like it worked.

### 2. `MAX_SETS` is 64

Measured on the real toolchain rather than estimated, `arduino-cli` against
`adafruit_feather_esp32s3_nopsram`:

| | globals | free for locals | program |
|---|---|---|---|
| version 2, 5 sets | 109,864 B (33 %) | 217,816 B | 493,490 B (47 %) |
| version 3, 64 sets | 135,592 B (41 %) | 192,088 B | 494,186 B (47 %) |

**25,728 bytes**, which is the `Layout` array and the buffer `loadLayout()`
reads the file into — 8 % of the 327,680 bytes the board has, and the board has
no PSRAM. Both scale linearly at about 420 bytes a set, so the number could have
been almost anything; what decided it is which ceiling actually binds.

- **The need is twenty.** Twenty rounds is a session.
- **The format's own ceiling is 255**, because the set count and the target are
  each one byte.
- **The file partition runs out first.** It is 7040 KiB
  ([ADR 0018](0018-the-file-area-takes-the-ota-slot.md)). A round of the game
  shares nothing between its keys: five tiles at roughly 5.7 KiB compressed
  ([ADR 0019](0019-tiles-travel-compressed.md)) and five recordings of about a
  second at 16 kHz mono 16-bit, so ~32 KiB each — near 190 KiB a round, which is
  **thirty-five to forty rounds** before the partition is full. A Sammlung whose
  sets share pictures and words goes much further, but the game is the case that
  does not share.
- **The number cannot be raised for a device already in a house.** Raising it
  later is not a format change — `MAX_SETS` is not in the file — but it is a
  re-flash, and a talker in a kitchen does not get one.

64 is past every ceiling that binds and costs 8 % of SRAM. 128 would cost 16 %
and buy room the flash cannot fill.

### 3. The boards in a package are a graph, not a ring

Two consequences in [`device_package.ts`](../loader/src/device_package.ts),
because a speech key can now carry a `load_board`:

- **The set order is the order the boards are first reached from the root,
  following every key that goes anywhere**, each board's keys in the order the
  board lists them. For a talker that is the same walk and the same order it
  always was: one key per board goes anywhere and it is the set key. For the
  game the boards hang off each other by their speech keys. A board nothing
  reaches is still refused, and `package/a-board-nothing-reaches` is that
  fixture, renamed from `ring-misses-a-board`.
- **The set key is the button the grid puts in the set key's cell** — the last
  row's first cell, which is where the case puts it
  ([`hardware.md`](../docs/hardware.md): speaker top left, the set key below
  it). It was "the one button on the board with a `load_board`", and that stops
  being an answer the moment a second button has one.

## What this costs

- **Every talker flashed before today refuses a file written after it**, with
  `LAYOUT_BAD_VERSION`, and the other way round. That is the expensive outcome
  and it is the safe one: the version byte moved with the strides, so neither
  end reads the other's names and hashes at the wrong pitch. `layout/version-two`
  and `layout/version-four` are the two fixtures that say so.
  `device_interface_version` is **2.0.0**.
- **`tests/reference/layout.lock.json` needed a second derivation.** The lock
  is Python's output from before 2026-08-22 and there is nothing left to refreeze
  from ([`frozen-references.md`](../docs/frozen-references.md)), so
  `test_layout_frozen.py` transforms it: `THE_COLOUR_IS_GONE` took two bytes
  out of each entry, and `THE_KEYS_ARE_FIVE` puts twenty-eight back. **The
  colour was a deletion and this is an insertion**, which is the harder of the
  two — a deletion needs nothing the lock does not hold, and an insertion needs
  somebody to say what goes in the gap. What goes in is stated in one function
  and is a zero or a number the set count decides, because version 3 wrote down
  what version 2 did in arithmetic. Nine bytes a set are new fields the lock can
  say nothing about, and their check is `device/fixtures/layout/keys-that-go`,
  `key-does-past-the-table` and `key-goes-past-the-last-set`, authored from the
  strides and met by the two runners from opposite sides.
- **The spare byte is kept.** [`format-freeze.md`](../docs/format-freeze.md) §4
  called the byte after the has-audio flag the only room `layout.bin` had left.
  It is spent on `does`, and a new one is put back — five bytes a set — so the
  format still has the one trick it has ever had for growing without a MAJOR.
- **The firmware acted on none of it when this was written, and does now** —
  later the same day, 2026-08-31. `drawCurrentSet()` drew the set key's picture
  and the set key still cycled; what was named here as the next change is
  [`key_press.h`](../firmware/vorlaut/key_press.h), where `keyPress()` finally
  calls `layoutKeyGoesTo()` and the four steps after a key that goes somewhere —
  a second's pause, wait until she has let go, show the new board, then 400 ms
  of hearing nothing — are an enumeration `vorlaut.ino` walks rather than four
  statements in a row. The set key's cycle went with it: the ring is what a
  builder writes into the targets, not what the sketch computes, so a round the
  file gives no way out of is a round the device stays in.
  `device/fixtures/layout/four-rounds` is a whole small game walked press by
  press from both ends, and `device/fixtures/press.expected.json` — the first
  kind with no browser half at all — is the timings and their order.

## When somebody proposes tidying this up

**"The set key does not need to be a key — give it a sound and leave it."**
That is the same 36 bytes with a second shape to remember, and it puts the
question "what does this panel do" in two places. The panels are five.

**"Two bits would do for `does`, and the target could take the other six."**
It would, for 64 sets, and it would mean the day `MAX_SETS` goes past 64 is the
day the format changes again. The byte is not scarce: a set entry is 212 bytes
and the ceiling is a 7 MiB partition.

**"`MAX_SETS` should be 20, which is what was asked for."** The number cannot be
raised for a talker already in a house. Every byte above the need is bought once
and spent never.

**"Read the manifest's board order instead of walking the keys."** A manifest is
an index any tool that touches the archive rebuilds. The keys are what a person
can actually press, and the walk is what notices a board nobody can get to.
