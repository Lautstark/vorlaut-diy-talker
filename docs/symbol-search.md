# Finding a symbol, without a server

The app half is being rewritten as a static site, so `metacom.py` and the
ARASAAC endpoints in `app.py` have to exist a second time in the browser — the
same move `tiles.py` already made into [`static/tiles.js`](../static/tiles.js).

This one is not a port. bildhaft had already written it, so the code was lifted
out into [bildquelle](https://github.com/Lautstark/bildquelle), a package the
two projects share, and [`static/symbols.js`](../static/symbols.js) is only the
adapter between that package and the shapes vorlaut speaks.

The bench is [`tools/symbolcheck.html`](../tools/symbolcheck.html), the way
`ttscheck.html` is the bench for speech. Everything measured below came from it.

## Why a package rather than a port

METACOM is licensed per person. The rule both projects keep is that no METACOM
file is shipped, downloaded, transmitted or stored, and nothing derived from the
user's folder leaves the browser — not even a filename index.

Written twice, that rule gets broken once by accident, and an accident there is
a licensing problem rather than a bug. So it is written once, in a package that
enforces it: symbols leave as object URLs and never as bytes, the METACOM
provider contains no network call and a test fails the build if one appears,
storage is split so the METACOM half has no method that takes a Blob, and the
filename index is reachable only through a search someone typed.

vorlaut already honoured the rule — `/api/pick` keeps a METACOM symbol as a
reference and never copies the file. The package is how it keeps honouring it
once the server is gone.

## What changes when the server goes

**Where the collection comes from.** Today the server reads
`VORLAUT_METACOM_DIR` on whatever machine runs it. In the browser the folder is
chosen with the File System Access API and remembered as a handle in IndexedDB.
That is strictly more local — the collection is read by the person who owns the
licence, on their own machine — but it is a different setup step, and during the
transition both have to point at the same collection or a build will not resolve
what the picker found.

**Who talks to ARASAAC.** Today the page never does: `arasaac_search` and
`/api/thumb` run on the server, deliberately, "so the page does not have to make
requests to the outside". With no server there is nothing to proxy through, so
the browser fetches ARASAAC directly and ARASAAC sees the user's address rather
than the server's. This is inherent to the rewrite rather than a choice, but it
is a real change to who sees what and it should not arrive unannounced. What
crosses the wire either way is one search term and no identifier; bildquelle's
README states it in full.

## The canvas is the part that nearly broke

`renderSymbol()` in `tiles.js` calls `getImageData`, so a symbol has to survive
being drawn to a canvas and read back or there is no RGB565 and no tile.

bildquelle hands back a `blob:` URL for anything it holds, which is same-origin
and reads back fine. But when an image fetch fails it returns ARASAAC's own URL
instead — on purpose, so the `<img>` can still try rather than leaving a spinner
up for ever. That URL is cross-origin, and a canvas drawn from a cross-origin
image is tainted.

Measured in `symbolcheck.html`:

| Source | `getImageData` |
| --- | --- |
| `blob:` URL from the package's cache | readable |
| `static.arasaac.org`, no `crossOrigin` | **`SecurityError`** |
| `static.arasaac.org`, `crossOrigin="anonymous"` | readable |

ARASAAC sends `access-control-allow-origin: *`, so asking for CORS costs nothing
and works for both shapes. `loadImage()` in `symbols.js` exists to make sure
nobody builds their own `<img>` and forgets, because the failure only appears on
the fallback path — a tile that looks right on screen and throws at build time,
depending on the network.

## Before the switch is thrown

`symbols.js` is not wired into `picker.js` yet. Two decisions belong to the
rewrite rather than to this file, and both change stored data:

1. **What an ARASAAC pick becomes.** Today the server downloads it into
   `symbols/` and the layout holds a bare filename, which `obf.py` reads as
   `OWN_SET`. With no server there is no `symbols/`, so it wants to become an
   `arasaac:<id>` reference and a set of its own in the OBF mapping.
2. **Whether the browser or the server owns METACOM.** It cannot be both: the
   picker searching one collection while the build resolves another is worse
   than either. Switching the picker means switching the build with it.

The import map is part of that. `symbols.js` imports the package by its real
name, which needs a map until there is a bundler, and a module cannot install
one for its own import. `tools/symbolcheck.html` carries it and `ui.html`
deliberately does not — the server-rendered app imports nothing from here yet,
and `static/tts/speak.js` makes the same point about its own dependency. The map
moves to whatever page the rewrite grows.

Not as a stopgap. Native modules with an import map are somewhere vorlaut can
stop: its pitch is a web interface built from the standard library with no build
step, and every browser that can do WebSerial can do both. A bundler would buy
node_modules, a lockfile and CI to run them, for a project with none of the
three. The specifier is bare rather than relative because that costs nothing and
leaves the door open, not because the door is expected to be used.

METACOM references are unaffected: `symbols.js` derives `metacom:<stem>` from
the package's path exactly as `metacom.py` does, so existing layouts and the OBF
converter keep reading.
