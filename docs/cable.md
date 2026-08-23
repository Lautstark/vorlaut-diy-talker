# Content over the cable

How the editor gets pictures and sentences onto the device once there is no
server left to fetch them from: down the USB-C cable it is charged through
anyway.

The way that is being replaced — the search, the five digits, the manifest over
HTTP — is in [software.md](software.md), and it is worth reading first. Almost
every decision here is that one turned around, and the reasons it is turned
around are the interesting part.

## Why the old way stopped being possible

The device used to **pull**. It looked for the computer with a UDP broadcast,
paired itself, fetched a manifest and then fetched the files it did not have.
That worked because there was a server: something with an address, listening.

The editor is becoming a page and nothing else. Two things follow, and neither
is a matter of taste:

- **A browser tab cannot be an HTTP server.** There is no address for the
  device to fetch from. Nothing in the browser can be given one.
- **A page served over HTTPS may not talk to a plain-HTTP device on the local
  network.** That is mixed content, and it is blocked. Serving the page over
  plain HTTP instead would cost every other browser API the rewrite depends on,
  because those need a secure context too.

So the device cannot pull, and it has to be pushed to. The only wire left
between the two is the one that was always there: the cable that charges the
battery. That is why the USB-C socket has to reach an edge of the case — see
[hardware.md](hardware.md), where it is a requirement for a different reason.

## Lines, and a mark on every one of them

Everything here is `keyword value` lines, for the reason
[software.md](software.md) gives at length for the manifest and the pairing
format: **a JSON parser on the ESP32 means a library, a heap and a class of
failure a fixed line format does not have.** A reader skips keywords it does
not know, so either side can gain a field later without the other falling over.

What is new is that every line is **marked**, in both directions:

```
> hello                    the browser speaks
< vorlaut 1                the device answers
```

This wire is not a private channel. It is the same USB CDC serial port the
firmware prints its log to, and it prints all the way through a transfer —
`menu opened`, `key 1: /a8c1….wav`, `LittleFS: 486400 of 1441792 bytes used`.
Without the marks, the browser would have to guess whether a line was an answer
or a diary entry, and the device would take a serial monitor's stray keystrokes
for commands.

With them, the rule on each side is one line long:

| | |
|---|---|
| the browser | ignores everything that does not begin `< ` |
| the device | ignores everything that does not begin `> ` |

The device's log survives that instead of being crushed by it: the browser puts
every unmarked line in its log pane, which is the most useful thing on the wire
when something has gone wrong. `tools/serialcheck.html` shows them mixed in,
and the mock in `tools/cable_mock.js` chatters on purpose so that a client
which only works on a silent wire fails here rather than on a bench.

## The device is deliberately stupid

Six verbs, and each of them is one thing:

```
> hello                      who are you
> list                       what have you got
> crc <name>                 checksum one file
> put <name> <size> <crc>    one file follows, as raw bytes
> rm <name>                  throw one away
> done                       that is all
```

It does **not** work out what is missing. Over Wi-Fi the device did exactly
that — it compared the server's manifest against its own file system — and it
had to, because the server could not push. Here the browser can, and the
browser is the end with the memory, the language and the whole layout in front
of it. Everything the device would have had to hold in a `String` to do the
comparison is a `String` it does not allocate.

So `list` walks the directory and prints it as it goes, and the diff happens in
`tools/cable.js`. The answers:

```
< vorlaut 1                  it is one of ours, and 1 is the protocol version
< total 1441792              the partition
< free 1146880               what is left of it
< files 37
< end hello

< file t3bd7….bin 26912
< file a8c1….wav 41008
< end list 37

< crc layout.bin 1a2b3c4d
< go
< ok a8c1….wav 41008
< gone t3bd7….bin
< bye 12 3 486400            stored, removed, bytes
< err nospace                may replace any of the above
```

**`hello` is how the browser knows what it is talking to at all.** The person
picks a port out of a dialog, and a laptop has several — a dongle, a printer,
another dev board. A port that does not answer `vorlaut` within a moment is
not the talker, and saying so is nicer than timing out later mid-transfer.
`free` earns its place in the same answer: it is what lets the browser refuse a
payload that will not fit *before* it starts sending one.

**A verb the device does not know is answered, not ignored.** `err verb` comes
back. A browser waiting for a reply that never arrives looks exactly like a
broken cable, and the two are worth telling apart.

## The names already say what changed

The file names are hashes, so the manifest thinking from
[software.md](software.md) carries over whole: **the same symbol or sentence in
three sets is one file, and a name that is already on the device is already the
right content.** The browser lists, subtracts, and sends the difference. In use
that means almost nothing moves — changing one symbol and one sentence in a
five-set layout sends three files and deletes two.

`layout.bin` is the exception at both ends, exactly as it was over Wi-Fi. Its
name never changes, so presence proves nothing about it, which is why `crc`
exists as a verb. It is the only file the browser has to ask about, and asking
about it costs one line.

## A name is not a checksum

This is the trap in the paragraph above, and it is easy to read past in
[software.md](software.md), which states it plainly and then moves on:

> the names are hashes of the **input** — source image plus pipeline version,
> or text plus voice configuration — not of the output bytes.

So a name tells the device which content was *meant*. It cannot tell it what
actually *arrived*. Every `put` therefore carries a CRC-32 of the bytes, and
the device refuses the file if what it received does not match.

CRC-32 rather than something cryptographic, because what is being guarded
against is a transfer that went wrong, not somebody choosing bytes to fool us —
whoever is holding the cable can write whatever they like anyway. What it
catches is the silent set: a truncated transfer, a byte count one out, a
partition that quietly stopped accepting writes. All of those otherwise end as
a file under a name that promises whole content. It is the same CRC-32 as
`zlib.crc32`, so a value can be checked by hand.

## The order, and why layout.bin goes last

A push is: send what is missing, send `layout.bin`, then delete what is stale.

That order is not arbitrary. `layout.bin` is the table that says which file
belongs to which key, so **it is the commit**. Until it lands the device still
reads the old one — and the old one still points at files that are all still
there, because nothing has been deleted yet. The moment it lands, every file it
points at has already arrived. There is no instant at which the device holds a
layout referring to a file that is not there.

Doing it the other way round — clearing out first — has a failure that is quiet
and nasty: a transfer that breaks off halfway leaves the old layout pointing at
symbols that have been deleted, and the device comes up with silent keys and no
explanation.

The cost of the safe order is room. For the length of the transfer both the old
files and the new ones sit on a partition of **1.5 MB** (`FS_SIZE = 0x180000`
in the firmware's partition table). A full payload is around 950 KB, so
replacing *every* symbol and *every* sentence at once does not fit. That is
rare and it is real, so the browser checks: `free` came back in the `hello`,
and if the new files will not fit alongside the old ones it falls back to
clearing out first and says so on the page. If it will not fit even then, the
payload is simply too big for the partition and nothing is sent at all.

## Half a file, and the handshake that prevents worse

Files land under `/.part` and are renamed only once they are whole and their
checksum agrees — the same rule `sync.h` follows, for the same reason. **A
transfer that breaks off leaves a fragment behind, never half a file under a
name that promises whole content.** The name was shared with the Wi-Fi sync
while both existed — deliberately, since the two never ran at once — and it is
this one's alone now.

The `go` in the middle of a `put` is the other half of that:

```
> put a8c1….wav 41008 1a2b3c4d
< go
<41008 raw bytes>
< ok a8c1….wav 41008
```

**The bytes are sent only after `go`.** By then the device has checked the name,
checked that the file will fit, and opened `/.part`. Without the handshake, a
device that refused the file would be followed by 41008 bytes of WAV arriving in
its line reader — and somewhere in a WAV there is eventually something that
looks like a command. The round trip costs about a millisecond and removes the
whole category.

**The name is created by the rename and by nothing else.** That is worth
stating on its own, because more rests on it than on any other line of the
device's code. The order is: write every byte into `/.part`, check the
checksum, and only then rename. There is no point at which the final name
exists holding bytes that have not been checked — an interrupt leaves a
fragment under a name nobody consults, or it leaves nothing.

Two things follow that would otherwise both be wrong:

- **Keeping a file because its name is present is sound.** The browser skips
  what the device already has, on the name alone. If a transfer could leave a
  short file under its real name, that file would be kept for its name, never
  sent again, and `layout.bin` would eventually point at a truncated tile or a
  truncated recording. Silent, and permanent, because nothing ever looks at it
  again. The rename is what makes the skip safe.
- **Stopping is free, at any moment.** A cancelled push costs the fragment in
  `/.part` and nothing else, so cancelling is a matter of not sending the next
  thing rather than of undoing the last one.

The browser compares the size as well as the name — one comparison, and `list`
already reports sizes. That is a net under the rename rather than a second
opinion: if the invariant above were ever broken, by another implementation or
a damaged file system, a wrong length turns a silent-and-permanent fault into a
file that is simply sent again.

The bytes are raw rather than base64 or hex. Base64 would cost a third of the
budget on a 1.5 MB partition and, worse, would make the *device* do work per
byte to undo it. The device reads exactly `size` bytes and then goes back to
reading lines; it never has to look for a newline inside file content.

## Losing the thread, and finding it again

The one thing that can genuinely desynchronise this protocol is a `put` that
does not finish: the browser tab was closed, the person walked off, the cable
came out and went back in. The device is then counting down to a byte total
that will never arrive, while the rest of a file may still be in flight.

Three rules handle it, and they are the part of this protocol that most wants a
real device to be tried on:

1. **Give up on silence.** Four seconds without a byte and the transfer is
   abandoned, `/.part` is deleted and `err short` goes back. Nothing here may
   hang: a device parked in a transfer is a device that has stopped being a
   talker, which is the same rule the setup portal's three-minute timeout
   follows. A file system that stops accepting bytes partway through says
   `err lost`, which is a different word from the `err write` of a file that
   could not be opened at all — the distinction is not cosmetic, it is
   whether there are still bytes in flight to be thrown away.
2. **Drain before listening.** The rest of the file is still coming, so the
   device throws bytes away until the wire has been quiet for 400 ms. Only then
   does it read lines again.
3. **Only `hello` gets back in.** Everything else is answered `err session`
   until the browser introduces itself again. A stretch of a WAV that happens
   to contain `\n> hello\n` would have to be chosen on purpose, and whoever is
   holding the cable has easier things to do.

### The four seconds are a guess until they are a measurement

`CABLE_QUIET_MS` is the one constant here with a real design risk behind it: it
has to be longer than any pause LittleFS can take in the middle of a transfer,
and nothing on a computer can say what that is. A run that works only shows the
pause did not exceed four seconds *once*. It says nothing about the margin, and
a constant that survived one evening is not evidence.

So the device measures and reports, before every `ok`:

```
< gap 12         longest stretch this file spent with nothing arriving
< stall 340      longest single write into LittleFS
```

Two numbers, because they are two different risks and one would hide the
other. `gap` is what `CABLE_QUIET_MS` is actually compared against. `stall` is
where a garbage collection pause shows up — and it does **not** appear in `gap`,
because while it happens the device is inside `file.write()` rather than
waiting for bytes.

Both are ordinary keyword lines, so a reader that does not know them steps over
them. That rule is stated all through this document; these are the first lines
to depend on it, which is worth saying because until they existed the browser
client did not actually follow it. It does now, and the mock reports fixed
values so every test run goes through that path rather than only the one test
aimed at it.

The bench shows the worst of each after a push, with the margin. **When a full
transfer has run on real hardware, the numbers belong here** — and then 4000
either has a measurement behind it or is changed to one:

| | |
|---|---|
| longest `gap` over a full payload | **0 ms** |
| longest `stall` over a full payload | **53 ms** |
| `CABLE_QUIET_MS` | 4000 |

Measured on 2026-08-23, the first hardware to run this: a full payload of ten
files and 199 KiB, across in 3.3 s at 60 KB/s. So 4000 has a measurement behind
it now, and an enormous one — the margin is the timeout itself, near enough.

**That margin is only real because of `CABLE_RX_BUFFER`, and the two have to be
read together.** Before it, the same transfer reported a `gap` of 4001 ms and
died on the first file, and no value of `CABLE_QUIET_MS` would have saved it:
the device was not waiting for bytes that were late, it was waiting for bytes
that had been thrown away. The gap being 0 now does not mean the wire got
faster - it means nothing is being discarded, so the device never waits at
all.

That third rule is not a special case. **A device that has not been greeted is
in exactly the same state as one that has just lost a transfer** — refusing
everything but `hello`. One rule, two uses, and no separate idea of "in a
session" to get wrong.

Before a greeting the device only waits a quarter of a second for a whole line,
rather than four. Until a browser has said `hello`, whatever is on this wire is
as likely to be a serial monitor or one stray byte, and every millisecond spent
here is a millisecond the keys are not being read.

## Stopping halfway on purpose

A push takes a cable's worth of time, and the page needs to be able to stop —
a dialog closing, a navigation, somebody changing their mind. That is an
`AbortSignal` passed into `push()` rather than a `cancel()` on the connection:
all the time is inside that one function, and a signal composes with the page's
own reasons to stop through `AbortSignal.any()` in a way a bespoke method
cannot.

**It is checked between files, not inside one.** It could be checked inside
one — the rename above makes stopping safe at any instant — but a push stopped
mid-file leaves the device counting down its four seconds to bytes that will
never arrive, after which the session is shut until `hello`. A step boundary is
at most one file away, well under a second, and leaves the connection usable.

An aborted push never sends `done`, which is the point: `done` is what makes
the device read its new layout in, and a half-sent payload is not one to start
reading. Closing the connection is the caller's business, not `push()`'s — the
cable was handed in, and a caller that wants to abort and retry should not find
its port shut underneath it.

## No pairing, and no key

Over the network, the device showed five digits and somebody typed them into
the page. That existed to answer one question: is the thing asking for this
content actually standing in front of the device? The digits were a way of
proving physical presence over a wire that anybody on the network shares.

**The cable is that proof.** Whoever has hold of it is in the room, with the
device in their hand. There is nothing left for five digits to establish, and
so there is no pairing, no secret, no token and nothing stored in NVS.

That does mean anyone who can plug into the device can rewrite its content.
That is worth saying out loud, and it is the same trust the project already
extends to physical access — anyone who can plug in can also reflash it
entirely. What has genuinely gone away is the harder case the digits were
really guarding: a second machine *on the network* claiming to be the device.
There is no network.

## Two facts about the browser that shaped this

**`requestPort()` needs a click; `getPorts()` does not.** Opening the port
picker requires transient user activation, which expires in about five seconds
in Chrome — so it cannot be called after a long build, and it cannot be called
from a timer. But `getPorts()` returns ports the person has already granted,
with no gesture at all. That decides the shape of the whole interaction:

> **one explicit connect, the first time, and silent reconnect forever after.**

So the page must not do anything slow between the click and the call, and it
should try `getPorts()` by itself on load. `tools/serialcheck.html` does both.

**WebSerial needs a secure context.** `https://` and `http://localhost` both
qualify; a page opened as a `file://` does not. That is not a constraint the
static site has to work around — it needs a secure context for several other
reasons already — but it does mean the harness has to be *served*.

The baud rate is a formality. `port.open()` will not run without one and the
sketch calls `Serial.begin(115200)`, so both say 115200; on the ESP32-S3's
native USB there is no UART in the path to run at it, and the throughput is
whatever USB and LittleFS manage between them.

One thing to leave alone: **DTR and RTS.** Toggling the two together in the
right pattern is exactly how `esptool` drops an ESP32 into its bootloader.
Raising DTR on its own is wanted — it is what makes the device's own `Serial`
report a connection — but nothing should ever drive the pair in sequence.

## What this does not do

- **It cannot wake a sleeping device.** After its idle timeout the talker goes
  into deep sleep, and USB traffic is not one of the things that wakes it.
  Press any key first, then push. The device stays awake for the whole session
  because every line resets the idle timer.
- **There is no other path to fall back to.** `sync.h`, `discover.h`,
  `networks.h`, `pairing.h` and `pair_format.h` were deleted on 2026-08-23,
  along with the radio and the five digits — see [The Wi-Fi path is
  gone](#the-wi-fi-path-is-gone) for why that happened before this had run once.
  The one thing the two used to share is handled: a device that was synced
  before still has `/version` on it, and because the name is now an ordinary one
  the first cable session sweeps it off.
- **It has not run on real hardware yet.** Everything below has been checked
  on a computer — see [Where it lives](#where-it-lives-and-what-is-checked) —
  but no board has spoken this protocol. The parts that most want a real device
  are the three timing rules above, none of which a test without a clock can
  exercise. What a first run has to show is set out in
  [The Wi-Fi path is gone](#the-wi-fi-path-is-gone).

## Running it on a device

Nothing here needs sound or the case — a flashed board and a cable are
enough, so this can be tried well before [bring-up.md](bring-up.md) reaches its
last stage.

**1. Check the one setting that stops everything.** *Tools → USB CDC On Boot*
must be **Enabled**, or `Serial` is not the USB CDC and no part of this can
work. Under `arduino-cli` it is already the default for this board.

**2. Flash the firmware.** The content does not have to go with it — that is
what the cable is for — so the program alone is enough:

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/vorlaut
```

Upload it with the same `--fqbn` and `-p /dev/cu.usbmodemXXXX`, as in
[firmware.md](firmware.md). A device with an empty file system is a fine
starting point here and is worth using at least once: it is the first row of
the table below.

**3. Serve the bench.** Any static server will do — it needs no back end, and
`localhost` is a secure context, which is all WebSerial asks for:

```bash
python3 -m http.server 8799
```

**4. Press *Send to the device* in the editor.** That is the whole of it: the
first press opens the port picker, every press after it finds the same port
again by itself, and in between it builds the board, works out what the talker
is missing and sends that. The page's log carries the device's own serial
output inline while it happens.

**Closing that dialog does nothing at all** — no build, no log, nothing on the
screen changed. The dialog has to come before the build, because the activation
`requestPort()` needs expires in about five seconds and a build with speech in
it takes longer; so a dismissal that went on to build anyway read as the dialog
having been ignored, which is what it did once. Choosing a different port later
is in the settings, under *Device*, along with the folder export.

**The bench is still here for what that button cannot be.** `tools/serialcheck.html`
is where a payload can be invented with no build behind it — so that a failure
is the wire or the firmware and not one of several new things at once — or read
off the disk with *Pick a `data/` folder*. Serve it as in step 3 and open
<http://localhost:8799/tools/serialcheck.html>. It cannot reach into the
editor's storage — a different origin is a different IndexedDB — which is why
the editor writes the folder and the bench reads it.

Close the serial monitor first if one is open, and close whichever of the page
and the bench you are not using. Two programs cannot hold the same port, and
the symptom is a port that simply will not open.

**5. Watch the device, not only the page.** All five displays should show
*Kabel* with a count climbing, and the talker should come back by itself
afterwards holding the new content. The page's log shows the device's own
serial output inline — that is where a mount failure or a wrong partition
scheme will say so.

If nothing answers, the page says so within a moment rather than hanging: a
port that does not reply `vorlaut` to `hello` is not the talker, and that is a
different problem from a transfer that failed.

## The Wi-Fi path is gone

It was deleted on 2026-08-23, and none of the six rows below had been ticked.
This section used to say that must not happen, so it says what changed instead.

**The bar was one real end-to-end success**, and the reasoning behind it was
sound: `tiles.py`, `tts.py` and `layout_format.py` had been *oracles* — the only
reason anybody knew the browser ports were right — but the firmware Wi-Fi stack
was an oracle for nothing. It was just the old transport, kept because a working
way to get content onto a device is worth having while the new one is unproven.

**What expired was not the bar but the fallback.** That argument rests entirely
on the Wi-Fi path still being a way in, and it stopped being one when `app.py`
was deleted: the device could still find a network, and there was nothing on it
to find. `build.py` and `flashing.py` went the same day. So what was being kept
as insurance was a radio, a captive portal, four stored networks and a token in
NVS, all serving a path whose other end no longer existed — 850 KB of program
space and 24 KB of RAM, and a device that would have spent seconds looking for a
server nobody was running.

**Prove first, delete second, in separate commits** was the other rule, and that
one was kept. The cable landed on its own, with the browser test that drives it
against the mock; the deletion is the commit after it. A revert of either is
still a revert of one thing.

**What that cost, and what closed it.** For a day it cost the only way back:
if the cable turned out to be wrong on hardware there was no way at all to put
content on a device — not because the radio went, but because nothing wrote the
files to disk. `build.py` had written `firmware/vorlaut/data/`, the browser
build writes IndexedDB, and the backup export leaves build output out on
purpose, so `mklittlefs` had nothing to image and this bench's folder picker
had nothing to pick.

That is what *Device → Write the build into a folder* in the editor's
settings is for. It writes exactly what the cable would send, into a folder you
choose, and it is the second way in:

- **The bench can send it.** Pick that folder under *Pick a `data/` folder*
  below. The page and the bench are then two independent clients of the same
  protocol, which is worth having when one of them is the suspect.
- **`mklittlefs` can image it**, and `esptool` writes the image straight into
  the partition. That path uses no cable protocol at all, so it is the one that
  still works when the wire itself is wrong.

It refuses to write a build that no longer matches the board, which is the one
failure a folder cannot show you: yesterday's content looks exactly like
today's once it is on a disk.

So the table is unchanged and none of it has been ticked. It is no longer the
gate on a deletion; it is the gate on trusting the only path there is.

What has to be true, written down before the run rather than remembered after
it. **Results belong in this table as they come in** — a row that was checked
once and remembered is a row nobody can audit later:

| | |
|---|---|
| a full payload transfers | all five sets, worst case near the 1.5 MB partition |
| an incremental transfer moves only what changed | the whole point of the content-addressed names |
| an interrupted transfer leaves a fragment | pull the cable mid-transfer: `.part` and no half-file under a real name |
| the device *speaks* the new content | not merely reports success |
| a second transfer needs no port picker | `getPorts()` finds the device again — **this one decides an interface question, see below** |
| a device that already holds content is updated | rather than confused by what is already there |

None of the six has been run. The bench can produce every one of them except
the third — pulling the cable out mid-transfer is a thing only hands can do —
and the third is the one whose device-side behaviour has no test at all, since
it is the timeout, the drain and the refusal that only `hello` clears.

Two of them now have a version that runs in a browser: `e2e/build.spec.ts`
presses the editor's button against `cable_mock.js` and checks that the device
ends up holding exactly the build, and that a second press sends nothing. That
is the second and sixth rows in everything except the part that matters here —
there is no flash, no re-enumeration and no clock in it. It is what says the
wiring is right, so that a failure on the bench is about the hardware rather
than about which file the page read. The rows stay unticked until a board has
done it.

**Row five is not a convenience.** The editor's one button *is* the way content
reaches the talker now — it builds and it sends, in one press, with no dialog
after the first. That rests entirely on `getPorts()` returning a
previously-granted port without a gesture, because the press that would open
the picker is the same press that starts the build, and by the time a build is
over the transient activation `requestPort()` needs has long expired. If a
granted port does not survive the device re-enumerating, there is a picker on
*every* transfer and that promise has to be withdrawn — so this row settles an
interface question rather than measuring a nicety, and it should be reported as
such.

**Before blaming the wire format, check whether opening the port resets the
board.** On classic ESP32 boards the USB-UART bridge has DTR and RTS wired to
EN and BOOT, so merely opening a connection reboots the chip. The Feather S3
has no such circuit — it is the S3's own USB — but the Arduino core's CDC stack
watches for the DTR/RTS pattern `esptool` uses and resets in software, which is
why flashing needs no buttons pressed. Whether a plain `port.open()` from
Chrome trips that depends on which signals Chrome asserts, and that is not
knowable from here.

If it does trip it, every transfer starts with a reboot, the port handle goes
stale mid-session, and the whole thing presents as an unreliable protocol
rather than as a reset. `setSignals({ dataTerminalReady, requestToSend })` is
the lever; the bench already raises DTR alone and never drives the pair in
sequence. It also asks `hello` up to three times on a first connect, so that a
board which *is* rebooting costs a second rather than looking dead — if that
retry turns out to be load-bearing, that is the symptom, and it is worth
knowing rather than being quietly absorbed.

Three things about the hardware that bear on that list, from
[bring-up.md](bring-up.md):

- ***Tools → USB CDC On Boot* has to be Enabled.** Without it `Serial` is not
  the USB CDC at all and none of this can work. It is already the default under
  `arduino-cli` for this board and a setting to check in the IDE.
- **The S3 re-enumerates when it resets**, and can come back under a different
  `/dev/cu.usbmodem…`. That is the one thing likely to make the fifth row above
  fail for a reason that is not this protocol's fault, so it is worth being
  deliberate about: reset the board between the two transfers on purpose and see
  whether the granted port survives it.
- **None of this needs sound or the case.** A flashed board and a cable are
  enough, so it can be tried at the bench well before stage 7 is finished.

When that list is genuinely true, the deletion is a clean follow-up — and it
takes the five-digit pairing with it on both sides, which is a satisfying
amount of code to remove and deserves to say so in its own commit.

## Where it lives, and what is checked

| | |
|---|---|
| [`firmware/vorlaut/cable_format.h`](../firmware/vorlaut/cable_format.h) | the wire format, with no Arduino in it |
| [`firmware/vorlaut/cable.h`](../firmware/vorlaut/cable.h) | the session: Serial, LittleFS, the half-written file |
| [`tools/cable.js`](../tools/cable.js) | the browser's half, and the diff |
| [`tools/cable_mock.js`](../tools/cable_mock.js) | a device made of a `Map`, for when there is no board |
| [`tools/serialcheck.html`](../tools/serialcheck.html) | the bench, standalone |
| [`src/backend/cable.ts`](../src/backend/cable.ts) | the page's side: which port, where the files come from, what the page is told |
| [`src/ui/release.ts`](../src/ui/release.ts) | the one button — build, then send, with progress and a way to stop |
| `tests/test_cable_format.py` | the wire format, held against the firmware's own reader |
| `e2e/build.spec.ts` | the wiring: a press, against the mock served into a real browser |

The split between the last two is the useful one. `tools/cable.js` is the
protocol and is checked by the C; nothing above it in `src/` has any business
knowing what a `put` line looks like. What the page adds is everything the C
cannot see — that a press builds, that the build is read back out of storage
rather than passed around, that the diff is against what the device really
holds, and that a second press sends nothing. Those are the two tests, and they
are deliberately not the same test.

The format header is deliberately free of any Arduino dependency, like
`layout_format.h` and `pair_format.h`, so that the same code the device runs
can be compiled and examined on a computer.

A protocol whose two halves are only ever run against their own author's idea
of the other one is not tested, it is asserted. So the check that matters is
the one in the middle: the browser client is driven through whole sessions
against the mock, **every byte it wrote is recorded**, and those exact bytes
are then replayed into the C reader compiled out of the sketch, which starts
with an empty file system and can only be reached through the wire. Both ends
are then asked what files they are holding, and the answers have to agree down
to the checksums. The other direction is closed the same way: the C formatters
print one of every line the device can send, and the browser client is made to
read them back.

```bash
.venv/bin/python tests/test_cable_format.py
```

That needs a compiler and Node, like the other format tests.

### How we know those checks bite

A fixture that catches nothing looks exactly like one that catches everything,
because both of them pass. So the faults are introduced on purpose and the
suite is watched:

```bash
python3 tools/cablemutate.py
```

Twenty-three of them, one at a time, plus two changes that alter no behaviour
and are expected to survive — a run in which everything fails proves only that
the harness is broken. **23 of 23 caught, both controls surviving.**

It did not start there. The first run caught 12, and each of the five misses
was a real hole rather than a missing assertion:

| what went unnoticed | why |
|---|---|
| a checksum losing its zero padding | every value in the fixture happened to have eight significant digits, so the case the format string exists for was the one case not present |
| `done` sent after an abort | the check inside the loop covered everything except aborting on the *last* step, which is the only case the guard before `done` is for |
| `layout.bin` no longer sent last | nothing looked at the order at all |
| the browser no longer skipping unknown keywords | it read the timing line where it expected `ok`, took a number out of it, and nothing compared that number with what was sent |
| the device no longer reporting its timings | nothing asked for them |

Two of those were worth fixing in the code rather than in the test. `put()` now
compares the length the device echoes back with what was sent — agreeing on the
name but not the length is what a slipped stream looks like from this end, and
it was the one failure that would have stayed quiet, because the next command
would still have been answered normally. And the transcript is now walked the
way the device walks it, counting the bytes after each `put` instead of
searching for text: a file's content is followed straight by the next command
with no newline between them, so counting is the only exactly right reading.

**What none of this reaches is `cable.h`.** It needs Arduino and LittleFS and
is not compiled here, so the `.part` rule, the timeouts and the drain have no
mutation testing behind them — they are the same half a run on the bench has to
answer for.

## Trying it without a device

`tools/serialcheck.html` runs against the mock with nothing plugged in, which
is the whole path apart from the wire itself: connect, list, work out what is
missing, push it, and read every file back off the device to compare. Serve the
repository and open it — WebSerial and the directory picker both need a secure
context, and `localhost` is one:

```bash
python3 -m http.server 8799
```

Then <http://localhost:8799/tools/serialcheck.html>. **Use the mock instead**
needs no hardware; **Make a payload up** needs nothing set up at all, and
**Pick a `data/` folder** takes whatever the last build left in
`firmware/vorlaut/data/` — which is now the only payload there is, since
nothing can make a new one. Ticking *change two files and the layout* is how to
see the case that matters: the second push should send three files and delete
two, and leave the rest alone.

**Take the build from the editor** was a fourth button here, and it has gone.
It could not have worked: this bench is served on its own port so that
`localhost` gives it a secure context, and a different origin is a different
IndexedDB — there is nothing of the editor's for it to read. The editor sends
its own build now, through this same `tools/cable.js`, which is the answer that
button was standing in for.

What is left here is what that button cannot be: a payload with no build behind
it, and a folder read straight off the disk. Both are better for a first bench
run than anything that goes through a build, because a failure is then the wire
or the firmware rather than one of several new things at once.

Two things it did that the editor's own path does instead, and both are worth
naming because they are easy to leave out:

- **Yesterday's content is not sendable.** The bench had to check the build's
  `current` flag, because it could be pointed at a stale `data/`. The editor
  cannot be: the press builds first and then sends what that build produced, so
  there is no window in which the two disagree.
- **Each file is checked against the length the manifest declared**, which is
  what a build moving underneath the read looks like. `src/backend/cable.ts`
  does this and refuses the whole transfer rather than sending a mixture of two
  builds — a device that is half one and half another is wrong in a way nothing
  downstream would notice.

And one rule that outlives all of it. `/api/build/*` was page-facing;
`/api/device/*` was **not**, and must never be called from a page — those sat
behind the talker's own token, and handing that to anything served to a browser
hands it to whoever asked for the page. Both are gone with `app.py`, and the
test that asserted the difference went with them, so whoever writes the next
pair has only this paragraph to go on.
