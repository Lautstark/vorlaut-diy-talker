# `loader/` — the page that puts a file on the talker

The editor writes an `.obz` and stops. This is what happens next: choose the
file, check it, compile it into what the device reads, connect, send. It is a
second page out of the same build, published at `<base>loader/`, and
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) is the decision behind
it.

## Why the directory is here and not under `src/`

Because it is going to move again, and this is the shape that makes that a move
rather than an excavation.

[`docs/repository-map.md`](../docs/repository-map.md) has already settled which
half leaves if this repository is ever split, and it is the **editor**: the
talker keeps the repository, the name and the history, and `vorlaut-editor` is
new. So the question for anything device-shaped is not "where does it go", it is
"what does it sit beside when the editor is gone". The answer is `firmware/`,
`case/` and `device/` — and now this, a fourth sibling holding the browser half
of the same product.

That was not true a commit ago. The tile renderer was in `src/data/`, the cable
was in `src/backend/`, the transfer sheet was in `src/editor-diy/` and the wire
protocol was in `tools/`, so "the talker's browser code" was a list somebody
would have had to reconstruct. It is a directory now.

The name is the job rather than the transport. A cable is one way in and a
folder for `mklittlefs` is another — both are in here — and `flasher/` would
have named the firmware's business rather than this one's.

## What is in it

| | |
|---|---|
| `index.html`, `src/main.ts`, `src/style.css` | the page: five steps, and the log at the end |
| `src/validate.ts` | the checks — the job that did not exist while one program wrote the file and read it back |
| `src/read.ts`, `src/unzip.ts` | the archive, opened |
| `src/compile.ts`, `src/browser_host.ts` | the package as the files a talker holds |
| `src/tiles.ts`, `src/layout_format.ts` | the device's own formats: a tile, and the table the firmware reads |
| `src/cable.ts`, `src/device.ts`, `src/serial.d.ts` | WebSerial: which port, and the transfer |
| `src/folder.ts` | the same files on a disk, for the bench and for `mklittlefs` |
| `tools/cable.js`, `tools/cable_mock.js` | the wire protocol, and a device made of a Map |

`tools/` stays a directory of its own inside this one for the reason it always
was: `tools/serialcheck.html` and `tests/cable_node.mjs` import `cable.js` raw,
from two runtimes that are not the page, and a copy beside the modules would be
a second implementation of a protocol whose whole point is that one
implementation is checked against the firmware's C reader.

## What it does not do

**It never sends the file anywhere.** The archive is read with the File API and
compiled in the browser. There is no `fetch` on this page, no form and nothing
to configure. `exchange/SPEC.md` §5.2 permits a METACOM licensee to bake their
own symbols into a package *for the person they support* and sideload it, which
is exactly what this file is; a page that uploaded one would turn the one
blessed case into the travelling file the rule exists to prevent.
[ADR 0002](../adr/0002-no-server-no-accounts.md) says the same about the product
as a whole.

**It does not edit.** It refuses a file it cannot compile and it names what will
be different once one is on the device, and neither of those is an offer to fix
anything. The fix is in the editor, and the loop is: change it there, export
again, choose the new file.

## The words on it

There is no second label table. `src/core/boot_data.ts` is the product's, in
both languages, and this page reads it through the same `t()` the editor uses —
which is why that function lives in `core/boot.ts` beside the table rather than
in the editor's `core/texts.ts`. What this page owns is a prefix: everything it
says is `load.*`, plus the `cable.*` and `err.cable_*` entries that were already
there for the transfer and came across unchanged.

A prefix rather than a file is what keeps the eventual split cheap. The table
divides along a line that is already drawn, and nobody has to decide, three
months from now, which of two tables a sentence was supposed to be in. A second
table would have drifted from the first within a week — one language gains a
label, the other does not, and `tests/unit/boot_data.test.ts` is watching only
one of them.

There is no language picker here. The choice is the editor's, kept in
`localStorage` under `vorlaut.language`, and both pages read it; somebody who
only ever opens this page gets their browser's own preference, which is the
right answer for them.

## What crosses into `src/`, and what comes back

Six names in one direction and two modules in the other, and they are counted
rather than forbidden.

`src/` takes out of here `SLOTS_PER_SET`, `HASH_BYTES`, `LANGUAGE_CODES`,
`DEFAULT_LANGUAGE` — facts about the format, because the editor writes a file a
talker has to be able to read — and `renderSymbol()` with `TILE_SIZE`, which is
the editor's device preview: a symbol drawn the way a ScreenKey draws it, so a
pictogram can be judged at 15.21 mm. `tests/unit/layers.test.ts` holds that list
to exactly those six and is where a seventh has to be argued for.

This page takes out of `src/` the label table above, and
`src/data/device_package.ts`, which is the format itself — the writer, the
reader, and the four form rules. That module stays with the writer for the
reason [`exchange/README.md`](../exchange/README.md) gives about fixtures living
with the writer, and when this repository is split it is the one file that has
to answer for itself the way [ADR 0009](../adr/0009-device-interface-fixtures.md)
says a format with two implementations has to.

## Running it

`npm run dev` serves both pages; this one is at `/loader/`. The e2e suite drives
it in `e2e/loader.spec.ts`, against `tools/cable_mock.js` and a package built
through the editor's own writer in `e2e/package.ts` — no fixture binary, and
nothing synthesised.
