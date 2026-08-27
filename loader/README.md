# `loader/` — the page that puts a file on the talker

The editor writes an `.obz` and stops. This is what happens next: choose the
file, check it, compile it into what the device reads, connect, send.
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) is the
decision behind it.

It is now the **only** page this repository publishes, and it is served from the
root: `https://lautstark.github.io/vorlaut-diy-talker/`. It was a second page
beside the editor, at `<base>loader/`, until
[`adr/0012`](../adr/0012-the-repository-splits-editor-leaves.md) took the editor
to [`vorlaut-editor`](https://github.com/Lautstark/vorlaut-editor) on 2026-08-27 and this page moved up. The address
in front of the path did not change, which is the half of the split that
mattered: it is the address somebody opens with a cable in their hand.

## Why the directory keeps its name

The page is at the root; the modules are still under `loader/`. That is
deliberate, and it is the same reason the directory existed in the first place.

[`docs/repository-map.md`](../docs/repository-map.md) had settled which half
leaves — the **editor** — and the question for anything device-shaped was never
"where does it go" but "what does it sit beside when the editor is gone". The
answer is `firmware/`, `case/` and `device/`, and this is the fourth sibling,
holding the browser half of the same product. Flattening it into the repository
root now would put `main.ts` beside `wokwi.toml` and rewrite every import in the
repository to say nothing new.

That grouping was not true a commit before the directory existed. The tile
renderer was in `src/data/`, the cable was in `src/backend/`, the transfer sheet
was in `src/editor-diy/` and the wire protocol was in `tools/`, so "the talker's
browser code" was a list somebody would have had to reconstruct. It is a
directory, and the move it was shaped for has happened.

The name is the job rather than the transport. A cable is one way in and a
folder for `mklittlefs` is another — both are in here — and `flasher/` would
have named the firmware's business rather than this one's.

## What is in it

| | |
|---|---|
| `../index.html`, `src/main.ts`, `src/style.css` | the page: five steps, and the log at the end. The HTML is at the repository root because Vite emits an entry point at its own path |
| `src/validate.ts` | the checks — the job that did not exist while one program wrote the file and read it back |
| `src/preview.ts` | the compiled tiles, at the size a key really is — [ADR 0013](../adr/0013-the-device-preview-moves-to-the-loader-page.md) |
| `src/read.ts`, `src/unzip.ts` | the archive, opened |
| `src/compile.ts`, `src/browser_host.ts` | the package as the files a talker holds |
| `src/tiles.ts`, `src/layout_format.ts` | the device's own formats: a tile, and the table the firmware reads |
| `src/cable.ts`, `src/device.ts`, `src/serial.d.ts` | WebSerial: which port, and the transfer |
| `src/folder.ts` | the same files on a disk, for the bench and for `mklittlefs` |
| `src/device_package.ts` | the reader half of the exported format: the shapes, the WAV rules and `readDevicePackage()` — [`docs/split-crossings.md`](../docs/split-crossings.md) hard case one is where this cut was costed |
| `src/boot.ts`, `src/boot_data.ts` | the label table and `t()`, in both languages |
| `src/errors.ts` | `Trouble`, which carries a word rather than a sentence |
| `tools/cable.js`, `tools/cable_mock.js` | the wire protocol, and a device made of a Map |

`tools/` stays a directory of its own inside this one for the reason it always
was: `tools/serialcheck.html` and `tests/cable_node.mjs` import `cable.js` raw,
from two runtimes that are not the page, and a copy beside the modules would be
a second implementation of a protocol whose whole point is that one
implementation is checked against the firmware's C reader.

## What it does not do

**It never sends the file anywhere.** The archive is read with the File API and
compiled in the browser. There is no `fetch` on this page, no form and nothing
to configure. [`exchange/SPEC.md`](https://github.com/Lautstark/vorlaut-editor/blob/main/exchange/SPEC.md) §5.2 permits a METACOM licensee to bake their
own symbols into a package *for the person they support* and sideload it, which
is exactly what this file is; a page that uploaded one would turn the one
blessed case into the travelling file the rule exists to prevent.
[ADR 0002](../adr/0002-no-server-no-accounts.md) says the same about the product
as a whole.

**It does not edit.** It refuses a file it cannot compile, it names what will be
different once one is on the device, and it shows what the device will show —
and none of those is an offer to fix anything. The fix is in the editor, and the
loop is: change it there, export again, choose the new file.

## The words on it

`src/boot_data.ts` is this page's table, in both languages, read through the
`t()` beside it in `src/boot.ts`.

There was one table for two pages until the split, in the editor's
`src/core/boot_data.ts`, and this page owned a prefix of it: everything it says
is `load.*`, plus the `cable.*` and `err.cable_*` entries that were already there
for the transfer. **That prefix is exactly what came across** — 71 keys, both
languages, in the order they were in — which is what the prefix was for. The
table divided along a line that was already drawn, and nobody had to decide, on
the day, which of two tables a sentence was supposed to be in.

Two tables can now drift, and the drift that matters is a key present in one
language and not the other. `tests/test_language.py` is what notices, and it
reads this file the same way it read the last one.

There is no language picker here. The choice is the editor's, kept in
`localStorage` under `vorlaut.language`, and both pages read it; somebody who
only ever opens this page gets their browser's own preference, which is the
right answer for them.

## What used to cross, and where it went

Nothing crosses now. The two directories are two repositories, and the boundary
between them is a file. `docs/split-crossings.md` is the bill as it was counted
before the day, and it is worth reading for what each crossing cost rather than
for what is left of it, which is nothing.

The editor took out of here `SLOTS_PER_SET`, `HASH_BYTES`, `LANGUAGE_CODES`,
`DEFAULT_LANGUAGE`, `SLEEP_MIN`, `SLEEP_MAX`, `SLEEP_DEFAULT` and
`thumbnailSize()` — eight names, facts about the format, because the editor
writes a file a talker has to be able to read. They are editor-local modules
over there now, and `layers.test.ts`, which held that list to exactly eight,
went with them: a rule about imports has nothing to read once the two
directories are in two repositories.

This page took out of the editor the label table above, `Trouble`, and the
**reader half** of `src/data/device_package.ts` — `readDevicePackage()`,
`planLayout()`, the WAV rules and the shapes, which are `src/device_package.ts`
here now. The writer stayed with the editor and was deliberately not copied: a
vendored writer in the repository that reads the format is the one edit
`docs/split-crossings.md` names as the edit that must not happen. What holds
this half honest instead is `device/fixtures/package/` —
[ADR 0014](../adr/0014-device-fixtures-cover-the-package-too.md) — which is the
arrangement [ADR 0009](../adr/0009-device-interface-fixtures.md) asks for.

## Running it

`npm run dev` serves this page at `/`. The e2e suite drives it in
`e2e/loader.spec.ts`, against `tools/cable_mock.js` and four committed packages
in `e2e/fixtures/packages/` — the editor's writer's own output, taken on the day
of the split, with the provenance and the recipe in the README beside them.
