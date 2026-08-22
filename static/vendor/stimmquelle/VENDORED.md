# Vendored: @lautstark/stimmquelle

The recording chain and the voice catalogue, shared with mitreden. Not written
here — this is a copy. Edit it upstream.

| | |
|---|---|
| Source | https://github.com/Lautstark/stimmquelle |
| Version | `2.0.0` — also exported as `VERSION`, so a copy can say what it is |
| Commit | `26d7819a7564f51486c837a225806d89e284c398` |
| Vendored | 2026-08-22 |
| Licence | MIT. Bundles [lamejs](https://github.com/gilesgc/lamejs) (LGPL-3.0) in `lamejs.js`, which vorlaut never loads. |

This is the `dist/browser/` build: self-contained ES modules with no bare
imports, because vorlaut has no bundler to resolve them.

| | |
|---|---|
| `index.js` | the entry, and the only one vorlaut imports |
| `chunk.js` | where esbuild's splitting put the code itself |
| `speak.js` | a second entry for consumers that want only `speak()` and its neighbours; vorlaut goes through `index.js` and never loads this |
| `lamejs.js` | an MP3 encoder reached only through `encodeMp3()`, behind a dynamic `import()` — vorlaut writes WAV and never calls it, so those 260 KB are never fetched |

`lamejs.js` is kept anyway so the module is whole rather than whole-minus
whichever part nobody happened to need on the day it was copied.

`voices.json` and `CONTRACT.md` are copied alongside because they are what the
code is *about*: the first is the catalogue the picker reads, the second is the
document the chain keeps.

## What vorlaut asks of it

```js
speak(text, voice, { rate: 16000, fadeSec: 0.012, padSec: 0.06 })
```

The rate is the device's. The other two are the contract's "permitted device
extras" (CONTRACT.md §2) and are off by default: a 12 ms fade against clicks on
a class-D amplifier, and 60 ms of quiet so the MAX98357A does not switch off
mid-syllable. Neither changes measured loudness — §2 now also spells out that
they are applied to the trimmed signal *before* the measurement, which is the
order the chain always used and the document did not say.

`shippable()` is the other thing vorlaut leans on, and it is a licensing gate
rather than a filter: it drops what cannot speak in a tab, what may not be
handed on at all, and what may be handed on only with an attribution this
interface does not render. Five voices are offered out of a catalogue of
fifteen. `de_DE-mls-medium` is CC-BY and is refused with a sentence saying so —
render the notices from `attributionsFor()`, pass `{ rendersAttribution: true }`,
and it comes back.

## Refreshing it

```bash
git clone https://github.com/Lautstark/stimmquelle /tmp/stimmquelle
cd /tmp/stimmquelle && git checkout <commit> && npm install
cp dist/browser/*.js voices.json CONTRACT.md LICENSE <vorlaut>/static/vendor/stimmquelle/
```

`npm install` runs the build through `prepare`. Update the commit and version
above. Check `dist/browser/` for new file names while you are there — 2.0.0
split `index.js` into `index.js` + `chunk.js` and added `speak.js`, and a copy
that missed one would leave a page importing a module that is not there.

Then run `python3 tests/run.py browser`. `tests/browser/level.test.mjs` holds
the chain against `tests/reference/tts.lock.json`, which is what real ffmpeg
said about fixed inputs while there was still a Python half of this project to
ask it. Those numbers are measurements rather than a description of any
particular file, so a refresh does not invalidate them — holding a new build to
them is how it gets shown to be faithful.

`tests/browser/reachable.test.mjs` is the other one to watch: it checks that
every module the page imports is a file that exists, so a renamed entry point
fails there rather than in a tab.

**A refresh that moves §1 or §2 of the contract re-renders every recording on
every device, so it is a decision and not an update.** `PIPELINE_VERSION` says
whether it did — it is still `1`, and 2.0.0 changed no loudness, trimming,
phoneme id or fingerprint. The upstream `CHANGELOG.md` says which edits a
consumer needs; for 2.0.0 vorlaut needed exactly one, `shippable("browser")`
to `shippable()`.
