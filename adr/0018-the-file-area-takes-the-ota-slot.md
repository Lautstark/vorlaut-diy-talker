# ADR 0018 — The device carries its own partition table, and the file area takes the OTA slot

**Status:** accepted · **Date:** 2026-08-31 · **Applies to:**
[`firmware/vorlaut/partitions.csv`](../firmware/vorlaut/partitions.csv),
[`firmware/vorlaut/vorlaut.ino`](../firmware/vorlaut/vorlaut.ino),
[`.github/actions/firmware/action.yml`](../.github/actions/firmware/action.yml),
[`docs/firmware.md`](../docs/firmware.md)

## Context

The firmware was built with the board's own partition scheme,
`PartitionScheme=default_8MB`, from the first flash until now. It is the ESP32
core's ordinary 8 MB layout and it divides the flash like this:

| | at | size |
|---|---|---|
| `nvs` | `0x9000` | 20 KiB |
| `otadata` | `0xe000` | 8 KiB |
| `app0` | `0x10000` | 3264 KiB |
| `app1` | `0x340000` | 3264 KiB |
| `spiffs` | `0x670000` | 1536 KiB |
| `coredump` | `0x7f0000` | 64 KiB |

Two app slots and an `otadata` are what an over-the-air update needs: the
program that is running cannot overwrite itself, so a new one is written into
the slot that is idle and `otadata` is flipped to say which of the two the
bootloader should start. That is the arrangement `default_8MB` is designed
around, and it is why 6528 KiB of an 8 MB flash is program.

**This device cannot do an over-the-air update, and the reason is not a gap to
be filled.** The radio went on 2026-08-23 — `discover.h`, `networks.h`,
`pairing.h`, `pair_format.h` and `sync.h` with it — under
[ADR 0002](0002-no-server-no-accounts.md)'s constraint and for the reasons
[`docs/cable.md`](../docs/cable.md) sets out: a talker that reaches nothing
needs no network to be set up, no portal, no five digits, and cannot be reached
by anything either. A new program arrives one way, over USB in the bootloader,
which writes `app0` while nothing is running. `app1` and `otadata` were never
written by anything and never could be.

Meanwhile `app0` held a program of 482 KiB in a partition of 3264 KiB, and the
file area — the one thing on this device that is actually scarce, because every
symbol and every recorded sentence lives on it — held 1536 KiB. A full layout
of five sets is around 630 KiB, so 40 % of the file area, and
[`docs/cable.md`](../docs/cable.md) had to describe a fallback for the case
where the old content and the new do not fit on it at once.

## Decision

**The sketch brings its own partition table, and everything the OTA layout
reserved goes to the file area.**

```
# Name,   Type, SubType, Offset,   Size,     Flags
nvs,      data, nvs,     0x9000,   0x5000,
app0,     app,  factory, 0x10000,  0x100000,
coredump, data, coredump,0x110000, 0x10000,
spiffs,   data, spiffs,  0x120000, 0x6E0000,
```

- The file is `firmware/vorlaut/partitions.csv`, in the sketch folder. The
  ESP32 core's third prebuild hook copies `{build.source.path}/partitions.csv`
  over whatever the FQBN's `PartitionScheme` put there, so **the table is the
  sketch's and the FQBN no longer decides it.**
- The FQBN keeps `PartitionScheme=default_8MB` anyway, and the name is now a
  leftover: the scheme's CSV is copied in and then overwritten by ours. What it
  still does is keep the board's first menu entry from being chosen. Leaving
  `PartitionScheme=` off selects *tinyuf2*, which brings a bootloader of its
  own and an `upload.extra_flags` that writes `tinyuf2.bin` to `0x410000` —
  inside the file area, on this table.
- `.github/actions/firmware` passes `upload.maximum_size=1048576`, so that the
  size arduino-cli checks is `app0` from this table rather than 3264 KiB from a
  scheme that is no longer in force.
- **The partition is still named `spiffs`.** It carries LittleFS and always
  did; `LittleFS.begin()` looks the partition up by that name.
- `app0` is 1024 KiB, twice the 482 KiB the program measures, and it stays at
  `0x10000`.
- No `otadata`, and the 8 KiB it occupied stays unpartitioned.
- The file area is **7040 KiB**, from `0x120000` to the end of the flash.

## Why

**A partition that nothing can write is not a reserve, it is a hole.** The
usual argument for keeping `app1` is that OTA might come back. It cannot come
back without a radio, and the radio's removal is a decision with its own
reasons that this one does not reopen. If a radio ever returns, so does this
question, and the answer then is a different table and a flash to go with it —
which is exactly what this change is, so the cost of having been wrong is one
afternoon rather than a design that cannot be undone.

**The scarce resource and the plentiful one were the wrong way round.** 6528
KiB of program space for a 482 KiB program, against 1536 KiB for the content
that is the entire point of the device. Nothing in the firmware grew to justify
it; the split came from a board default written for a class of device this one
is not.

**A number the firmware does not know cannot go stale in it.** The obvious
mistake here would be to write `7208960` into the sketch as a constant beside
the CSV. The firmware asks `LittleFS.totalBytes()` and reports it in the
cable's `hello`; the browser plans a transfer from that answer. So a device
with the old table and a device with the new one are both handled correctly by
the same page, without the page knowing which is which. The one place the
number must be repeated by hand is `mklittlefs -s`, on the rare route that
writes a file-system image from a computer, and
[`docs/firmware.md`](../docs/firmware.md) says so at that line.

**`app0` is doubled rather than sized to fit.** 1024 KiB for 482 KiB is 542 KiB
of headroom that could have gone to the file area. It buys the thing this ADR
is otherwise about: room to grow the program without a second flash-everything
day. The file area gives up 7 % of itself for it.

## Consequences

**Every existing talker needs one whole flash, and it loses its content.** A
partition table lives at `0x8000` and cannot be sent down the cable; a
program-only update writes `0x10000` and leaves the table alone. So a device
flashed before this change keeps its 1536 KiB file area indefinitely, works
perfectly, and simply never sees the room. Getting it takes
`write-flash 0x0 vorlaut.ino.merged.bin`, which erases the file area and the
`nvs` with it: the content has to be sent again from the editor and the volume
is back at its default. There is one such device.

**The loader page is not the way to do that, and this ADR does not change
it.** [ADR 0017](0017-the-loader-page-writes-the-firmware.md) has the page
offer the whole image only where nothing answered, and the program alone to a
talker that answers — because writing everything is the one that costs somebody
their content. A talker running this firmware answers, so the page will offer
it the program and nothing else, and the one write that would grow its file
area is the one the page deliberately does not offer. That is the right default
and the wrong outcome exactly once per device. It is left alone here rather
than widened in passing: an *everything* button beside *the program alone*, on
a page a carer uses, is a decision of its own and 0017 is where it belongs.
`flash.program_warning` says what the program-only write leaves behind, which
is the smallest honest thing this change can do to that page.

**The two file-area addresses now both exist in the world.** `0x670000` for a
device on the old table, `0x120000` for one on the new. Only the manual route —
`mklittlefs` plus `esptool write-flash` — has to care, and it is the route
`docs/firmware.md` already calls the rare one. Writing the image at the wrong
address of the two does not fail loudly; it writes into `app1`'s old ground, or
past the end of the file area, and the device comes up with nothing on it.

**No coredump is lost and no NVS moves.** `coredump` keeps its 64 KiB, `nvs`
keeps its 20 KiB and its address. The volume setting survives a content
transfer exactly as before, and is wiped by the same one thing as before: a
whole image written at 0.

**The first start after the whole flash formats 7040 KiB instead of 1536**, and
the displays are dark for it — `LittleFS.begin(true)` runs before the backlight
comes on. Nobody has timed it on hardware.

**OTA is now impossible rather than merely unused.** With no `otadata` and one
app partition, `esp_ota_*` has nowhere to write even if something called it.
That is the intended reading of the radio's removal, made structural.

## Not to be "fixed" later

**The partition is called `spiffs` and holds LittleFS. Renaming it breaks the
device.** `LittleFS.begin()` takes a partition label, and its default is
`"spiffs"`. A table that renamed it to something honest would mount nothing,
and the failure is five black displays at start-up rather than an error anybody
sees. `vorlaut.ino` says so where it mounts, and
[`docs/bring-up.md`](../docs/bring-up.md) says so from the other end. Whoever
proposes the rename has to change the `begin()` call in the same commit and
accept that every device in the field then needs another whole flash.

**The 8 KiB gap at `0xe000` is not free space to give to `nvs`.** The ESP32
core's upload and merge-bin recipes write `tools/partitions/boot_app0.bin`
there unconditionally, whether or not a partition covers the address — it is
hard-coded in the core's `platform.txt`, not read from the table. An `nvs`
grown into that gap would have its tail overwritten by every upload, and the
first symptom would be a volume setting that does not survive a flash.

**`app0` at 1024 KiB is not padding to be reclaimed.** The program is 482 KiB
today. Sizing the partition to what the program currently measures would make
every future 100 KiB of firmware a flash-everything day for every device, and
that day costs the owner their content.
