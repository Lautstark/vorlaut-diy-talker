# ADR 0017 — The loader page writes the firmware, from an image its own deploy carries

**Status:** accepted · **Date:** 2026-08-28 · **Applies to:**
[`loader/src/flash.ts`](../loader/src/flash.ts),
[`loader/src/firmware.ts`](../loader/src/firmware.ts),
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml),
[`docs/firmware.md`](../docs/firmware.md),
[`docs/cable.md`](../docs/cable.md)

## Context

Everything a talker needs after the first flash arrives through the page:
[ADR 0011](0011-editor-exports-the-talker-repository-sends.md) put the compile
and the transfer here, and `docs/cable.md` is the protocol. The first flash is
the one step that never came along. It is a command line —

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX write-flash 0x0 vorlaut.ino.merged.bin
```

— out of a release note, on a machine that has `esptool`, against a port
somebody found with `ls /dev/cu.usbmodem*`. `docs/firmware.md` walks through
it in four steps and starts by explaining how to find a port.

Two things make that gap smaller than it looks. The page already has the
device: Web Serial is granted, `findTalker()` already asks every port who it
is, and the person is already standing in front of the talker with the cable in
their hand — the same fact `docs/cable.md` uses to argue there is no pairing
code. And since 2026-08-28 the greeting names the build, not only the protocol,
so the page can now tell *which* firmware answered rather than only *that* one
did. What it could not do is act on the answer.

The ROM bootloader that `esptool` talks to is reachable from a browser. It is
the same serial device, the same protocol, and Espressif publish
[`esptool-js`](https://github.com/espressif/esptool-js), which is that client
compiled for the web. Nothing about this is a port of a native tool to a place
it does not belong.

## Decision

**The loader page can write the firmware, and the image comes from the page's
own deploy.**

- **`esptool-js` is a dependency.** The ROM protocol is not reimplemented here
  in any form.
- **The binaries are resolved at deploy time, not at click time.**
  `pages.yml` asks GitHub for the newest `v*` release, downloads its two
  assets, and writes them into `dist/firmware/` beside a `firmware.json` naming
  the tag, the sizes, the SHA-256 sums and the flash offsets. The page fetches
  them from its own origin. **No request to GitHub, and no cross-origin request
  of any kind, is made from the browser.**
- **The merged image is cut down to what it actually contains.** A release's
  `merged.bin` is 8 MB because it covers the whole flash, and all but the first
  ~590 KB of it is erased space. The deploy step truncates it at the end of the
  program and **fails rather than truncates** if the bytes it would drop are not
  all `0xff`.
- **Two writes, and the page picks between them from what the device said.** A
  talker that answered nothing gets the whole cut-down image at `0x0` —
  bootloader, partition table, OTA selector, program. A talker that answered
  with an older tag gets the program alone at `0x10000`, which leaves its
  content where it is.
- **The page puts the board into download mode itself**, by opening the
  running talker's port at 1200 baud and closing it — the touch the Arduino
  IDE uses — and brings it back out with an RTC-watchdog reset. The person
  still chooses the port a second time, because the bootloader is a different
  USB device. **Amended 2026-08-30; see the section below.**
- **Nothing is ordered that is not a tag.** `dev` — what every build that
  `release.yml` did not compile calls itself — and a device that says nothing
  at all are both answered with a sentence, never with "out of date".
- **With no `v*` release in existence, the section is simply not there.** That
  is today: this repository has never cut one.

## Why

**The image belongs to the deploy because that is the only version of this the
page can honestly stand behind.** The alternative is a fetch to
`api.github.com` for the newest release and then to `objects.githubusercontent.com`
for its asset. It would work — those responses do carry the headers — and it
would make the page's behaviour depend on a rate limit it does not control, a
redirect chain it cannot see, and a CDN's CORS policy nobody here decided. A
deployed page that says "this is the firmware I carry" is a claim it can keep.

**And it keeps `main.ts`'s note true rather than making it complicated.** That
note says no fetch, no form, no analytics, and it exists because
`exchange/SPEC.md` §5.2 permits baking METACOM symbols into a package for one
person and sideloading it — a page that uploaded such a package anywhere would
turn the blessed case into the travelling file the rule prevents. Fetching an
asset of this page, from this page's origin, sends nothing and carries nothing
of anybody's. The note gains a sentence about what is fetched; the property it
protects is untouched. A cross-origin fetch would have needed a longer sentence
and a worse one.

**Cutting the image down is worth the moving part.** 8 MB in the Pages artefact
on every deploy, to write ~590 KB of program and 7.8 MB of `0xff`, is a cost
paid by every deploy and every person who flashes. The truncation is arithmetic
— the end of the program is `0x10000` plus the length of the program image —
and the guard makes it safe: if the assumption about the tail ever stops
holding, the deploy fails loudly instead of publishing an image that boots
black.

**Amendment, 2026-08-30: the manual step was written for a device that does
not exist.** What stood here said the person holds BOOT, taps RESET and picks
the port, and that the two presses were the better trade. The first person to
use it had an assembled talker in front of them and could reach neither button:
**BOOT and RESET are inside the case.** Every bare Feather this was reasoned
about is a stage in `bring-up.md`, and the thing this page is for is the device
after that.

So the reset moves into the page, and the argument below survives with its
conclusion inverted — the re-enumeration is real, the second grant is
unavoidable, and what changes is only who does the resetting. Two facts came
off the bench that evening and both are in `flash.ts`:

- **`after("hard_reset")` does nothing on this board.** It toggles DTR and
  RTS, and the S3 reaches the host through its own USB-Serial/JTAG where those
  lines are a fiction. esptool's own hard reset left the chip in the
  bootloader; so did unplugging the cable, because a talker has a battery in it
  and never lost power. The RTC watchdog is what works, and it is four register
  writes over the protocol that just wrote the flash.
- **A device that answers nothing cannot be rebooted by the page**, because
  there is nothing to open a port on. That case keeps the old sentence, now
  saying what it means: the buttons are on the board, and on a closed talker
  the way in is to switch it over before the case goes on.

**The re-enumeration is the honest half of this decision.** The
Feather's USB is native — `USB CDC On Boot`, the S3's own USB rather than a
serial chip — so entering the ROM bootloader re-enumerates the device as a
*different* USB device. The `SerialPort` the page is holding dies at that
moment, and Chrome will not hand over the new one without a fresh grant from a
fresh gesture. ESP Web Tools tells S2/S3 owners the same thing for the same
reason. A page that promised one press would have to survive its own port
vanishing mid-press, and the failure would land on somebody holding a talker
that no longer speaks. Two presses and a sentence is the better trade.

**Refusing to order `dev` is refusing to guess.** A build compiled from the
Arduino IDE, from `arduino-cli` on a desk, or by CI is not a release and carries
no tag —
[`firmware/vorlaut/version.h`](../firmware/vorlaut/version.h) is why. Sorting it
against `v0.4` would mean inventing an ordering the device never promised, in
the one place where the wrong answer overwrites somebody's firmware. The page
says which build answered and which build it carries, and offers the write
without a verdict attached.

## Consequences

- **The page fetches something, for the first time.** Two blobs and a manifest,
  same origin, only when somebody opens the firmware section. The note at the
  top of `main.ts` and the one on the page itself both say so.
- **A `v*` release is what switches the feature on.** With none cut, the
  manifest says so and the section is absent — which is a true page rather than
  a broken one, and is what every deploy has shown so far.
- **`docs/firmware.md` keeps its `esptool` route, and it is not a fallback to be
  deleted.** Firefox and Safari cannot do any of this; nor can a machine with no
  network; nor can somebody flashing a board that is not this one. The command
  line is the general answer and the page is the convenient one.
- **The first flash still erases content.** It writes a partition table, and a
  device that was carrying words comes back empty until the cable fills it
  again. The page says this before the press, and the update path exists so
  that it is not the usual one.
- **`esptool-js` is the second runtime dependency** in a `package.json` that had
  one. `tools/installcheck.mjs` and the pinning discipline in
  [`docs/releases.md`](../docs/releases.md) cover it like any other.

## Not to be "fixed" later

**Somebody will make the flash one press**, by having the page pick the new
port itself instead of asking again. It looks like the last piece of
ceremony left: the page already reboots the board, so why not open what comes
back? Because what comes back is a *different USB device* — Espressif
`303a:1001` where the talker was Adafruit `239a:8113` — and Web Serial grants
are per device. `getPorts()` will not contain it, and `requestPort()` needs a
gesture that the press which started the reboot has already spent by the time
the ROM enumerates. The second press is not politeness, it is the only moment
a browser will hand over the port at all.

What was written here before was the opposite advice — that the *reset* should
stay manual — and it was wrong for the reason the amendment above gives.
`loader/src/cable.ts` still refuses to drive DTR and RTS in sequence during a
transfer, and that rule is untouched: doing it by accident mid-session takes a
working talker off the wire. Doing it on purpose, once, from the one button
whose whole job is to reboot the device, is a different act.

**Somebody will point the page at GitHub Releases so it is always newest.** The
deploy would stop carrying binaries, the artefact would shrink, and a firmware
release would reach people without a deploy. What it buys is a page whose
behaviour depends on a rate limit, and what it costs is the sentence above
about nothing leaving this machine. A deploy per release is not a burden here:
`main` deploys on every merge already.

**Somebody will propose merging content into the image so a first flash
speaks.** The releases did exactly that until `build.py` went, and the note in
`release.yml` explains why it is not coming back: the build runs in a browser
now and a workflow cannot press a button in one. The page is the answer to
that, and it is one press away from a device that has just been flashed.

**Somebody will delete the "does not name its firmware" branch** once every
device in reach names one. It is what a talker flashed before 2026-08-28 says,
those devices exist, and the branch costs one sentence.
