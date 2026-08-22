# Vendored: @lautstark/stimmquelle

The recording chain and the voice catalogue, shared with mitreden. Not written
here — this is a copy. Edit it upstream.

| | |
|---|---|
| Source | https://github.com/Lautstark/stimmquelle |
| Commit | `40bf6c253716ca4c6f1acc47916c0248f5b6fa30` |
| Vendored | 2026-08-22 |
| Licence | MIT. Bundles [lamejs](https://github.com/gilesgc/lamejs) (LGPL-3.0) in the lazy chunk, which vorlaut never loads. |

This is the `dist/browser/` build: self-contained ES modules with no bare
imports, because vorlaut has no bundler to resolve them. `index.js` is the whole
of it. `lamejs.js` is an MP3 encoder reached only through `encodeMp3()`, behind a
dynamic `import()` — vorlaut writes WAV and never calls it, so those 260 KB are
never fetched. It is kept anyway so the module is whole rather than whole-minus
whichever part nobody happened to need on the day it was copied.

`voices.json` and `CONTRACT.md` are copied alongside because they are what the
code is *about*: the first is the catalogue the picker reads, the second is the
document `tts.py` now has to agree with. `tests/test_browser_tts.py` reads both.

## What vorlaut asks of it

```js
postprocess(wav, { rate: 16000, fadeSec: 0.012, padSec: 0.06 })
```

The rate is the device's. The other two are the contract's "permitted device
extras" (CONTRACT.md §2) and are off by default: a 12 ms fade against clicks on
a class-D amplifier, and 60 ms of quiet so the MAX98357A does not switch off
mid-syllable. Neither changes measured loudness. `tts.py` applies the same two,
and `tools/ttscheck.py` is what checks the two halves still agree.

Piper is not imported by this package — the consumer hands it in with
`usePiper(() => import(…))`. That is why nothing here needs an import map, and
why the only bare specifier in this area is still `onnxruntime-web`, which
vits-web's own bundle asks for. `tools/ttscheck.html` maps it.

## Refreshing it

```bash
git clone https://github.com/Lautstark/stimmquelle /tmp/stimmquelle
cd /tmp/stimmquelle && git checkout <commit> && npm install
cp dist/browser/*.js voices.json CONTRACT.md LICENSE <vorlaut>/static/vendor/stimmquelle/
```

`npm install` runs the build through `prepare`. Update the commit above.

Then run `python3 tests/run.py browser` and `python3 tools/ttscheck.py`. The
first fails if the contract moved away from `tts.py`; the second says by how
much. A refresh that changes §1 or §2 of the contract re-renders every recording
on every device, so it is a decision and not an update.
