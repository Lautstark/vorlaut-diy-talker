# ADR 0019 — A tile may travel compressed, and the device says whether it can read one

**Status:** accepted · **Date:** 2026-08-31 · **Applies to:**
[`firmware/vorlaut/tile_format.h`](../firmware/vorlaut/tile_format.h),
[`loader/src/tile_encode.ts`](../loader/src/tile_encode.ts),
[`firmware/vorlaut/cable_format.h`](../firmware/vorlaut/cable_format.h),
[`device/fixtures/tile/`](../device/fixtures/tile/)

## Context

A `t<hash>.bin` is 128 by 128 pixels of RGB565 with no header: 32768 bytes,
whatever the picture. A full board is five sets of four keys and their labels,
so 25 pictures, so 800 KB — and the cable moves 60 KB a second
([`cable.md`](../docs/cable.md#the-four-seconds-and-what-they-are-now-for),
measured 2026-08-27 at 199 KiB in 3.3 s). **Thirteen seconds of somebody
holding a talker still, for the pictures alone, every time a board changes.**

This was begun for a different reason and the reason moved underneath it on the
same day. The partition held 1536 KiB, which is 48 raw tiles, and the speech had
to fit beside them; [ADR 0018](0018-the-file-area-takes-the-ota-slot.md) made
the file area 7040 KiB, which is 220. A board can hold 25. **So the space
argument is gone**, and what is left is the wait, which is a smaller case than
the one this was started for and is still a real one — those seconds are in
front of a person, and they are in front of them every time.

The format was measured before it was chosen, on the fourteen tiles in
[`tests/reference/tiles/`](../tests/reference/tiles/) — the only real rendered
tiles this repository has, frozen from Pillow while there was still a Pillow
half to ask ([`frozen-references.md`](../docs/frozen-references.md)). Five of the
fourteen are what a symbol actually looks like; the rest are gradients and
quantisation ramps that were authored to break a renderer, and they compress
badly on purpose, so both numbers are given throughout.

| | all fourteen | the five real symbols |
|---|---|---|
| raw | 32768 bytes each | 32768 bytes each |
| RGB565 run length, no palette | factor 3.2 | — |
| **palette + runs + escapes** | **factor 5.7** | **factor 8.4** |
| deflate (zlib, level 9) | factor 18.0 | factor 11.7 |

Two facts out of that measurement decided the shape more than the ratios did.
**Five of the fourteen hold more than 256 colours** — 2300 in one — so a plain
palette would have had to leave those files raw. And **naive run-length coding
makes two of them bigger than raw**, which means any scheme needs a way back
to the raw bytes rather than a promise that it always wins.

## Decision

**A tile file is one of two forms, and the reader tells them apart in this
order:**

1. **exactly 32768 bytes** — the raw form, unchanged, decided before a single
   byte is looked at.
2. **otherwise, beginning `vt1`** — the compressed form: a palette of up to 256
   RGB565 colours and a stream of three opcodes (a run of 2..129 of one palette
   entry, up to 64 palette indices, or up to 64 pixels written out in full for
   colours the palette does not hold).
3. **otherwise** — the raw form again, with the forgiveness it has always had:
   a short file draws black from where it stopped, a long one is read to 32768
   and the tail ignored.

The whole of it is written in
[`tile_format.h`](../firmware/vorlaut/tile_format.h) and stated by
[`device/fixtures/tile/`](../device/fixtures/tile/), which both halves are run
against.

**A browser sends the compressed form only to a device that said it can read
one.** The device names its forms in the hello — `< tiles vt1` — and silence
means raw. The word is matched whole; a form this browser does not know is a
device to leave alone, not a newer thing to try.

**The tile's name does not change.** It is a hash of the pixels, so one picture
is one name in either form, and `TILE_PIPELINE` does not move.

## Why

**Why not deflate, at more than twice the ratio on the fourteen.** Three
reasons, and the ratio is the weakest thing in the argument because on the
files that are actually symbols the gap is 11.7 against 8.4 rather than 18
against 5.7.

- `device/fixtures/` must regenerate byte for byte, and
  [`device/README.md`](../device/README.md) already refuses a dependency on a
  deflate implementation for exactly that reason — the `.obz` fixtures are
  stored rather than deflated because "deflate output *is* a property of
  whichever zlib is installed". A compressed tile fixture would be the same
  artefact with the same problem, and the fixtures are how this boundary is
  checked at all.
- The board has **no PSRAM** ([`hardware.md`](../docs/hardware.md)), and an
  inflate window is 32 KiB against a palette's 512 bytes. It would fit; it is
  not free, and it would be the first thing on the device that needed a
  library.
- Every reader here is hand-written and compiled by a test —
  `layout_format.h`, `wav_format.h`, `cable_format.h`. A decoder somebody can
  read in one sitting is the house pattern, and this one is forty lines.

**Why the palette is not a limit.** The third opcode writes pixels out in full,
so a tile past 256 colours compresses rather than falling back to raw. Without
it, five of the fourteen — and every anti-aliased symbol with a gradient in it
— would have travelled whole.

**Why the raw form keeps the right of way.** The first draft of the rule was
"the length says which form", and
[`device/fixtures/tile/over-long`](../device/fixtures/tile/over-long.expected.json)
refused it within a minute: 32784 bytes is not 32768 and carries no magic, and
a two-branch rule would have started refusing a file the device has always
drawn. The fixture had been written for that boundary before there was a second
form to confuse it with. `raw-that-spells-the-magic` is the other half of the
same care: a 32768-byte picture whose first pixels happen to read `vt1` is a
picture, because the length is tested first.

**Why the hello and not a version.** A device flashed before today draws
whatever bytes are in the file. Send it a compressed tile and it draws a
palette as though it were pixels — a full panel of plausible noise, in a house
nobody here knows about, with no update channel
([`device-interface.md`](../docs/device-interface.md) §6). A protocol version
bump would not have helped: it would refuse the transfer outright rather than
let an older talker keep working. The cable's stated extension rule — unknown
keywords skipped in both directions — is what makes an added capability cost
nothing, and `device/fixtures/cable/tiles-named-in-the-hello` states it beside
the eight transcripts of devices that say nothing at all.

## Consequences

- **The first sync after a firmware update re-sends every tile.** `plan()`
  keeps a file by name and size, and the compressed file has a different size,
  so each picture goes across once more. That is one transfer, and it is what
  buys every transfer after it.
- **Two encodings of one picture share a name.** They decode to identical
  pixels, so the hazard `TILE_PIPELINE` exists for — two renderers producing
  different *pixels* under one name — is not this. See
  [`tile-rendering.md`](../docs/tile-rendering.md).
- **The folder export stays raw.** It has no talker to ask, and an image
  written for `mklittlefs` may be flashed onto any firmware, including one from
  before today.
- **The device interface is 1.3.0**: a capability added, nothing existing
  changed, no reader made to misread anything it already accepts.
- **About 700 bytes of RAM**, static, for the palette and the read buffer.
- **A tile can now be refused**, and it is the first file at this boundary that
  can be. Exactly one case: the magic is there and the palette it claims is
  not. Black, which is what a missing file already draws.

## Not to be "fixed" later

**The raw form is not deprecated and must not be removed.** It is what every
talker in the field reads, it is what the folder export writes, and it is the
fallback for a picture that does not compress. A change that made the
compressed form the only one would silently brick every device flashed before
2026-08-31 the first time somebody sent it a board.

**The word in the hello is matched whole and must not become a comparison.**
There is no ordering on these forms. A browser that treated an unknown word as
"newer, so probably fine" would be sending a file it cannot know the device can
read, and the failure is silent on both ends.
