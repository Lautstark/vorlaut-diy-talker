# The two shared packages

vorlaut uses two packages of its own, shared with the other tools in this
organisation. Neither is on npm. Both are **git dependencies pinned by commit**
in `package.json`, which npm resolves and builds through each package's own
`prepare` script:

```json
"@lautstark/bildquelle": "github:Lautstark/bildquelle#<sha>",
"@lautstark/stimmquelle": "github:Lautstark/stimmquelle#<sha>"
```

They used to be copied into `static/vendor/` by hand, with a `VENDORED.md`
beside each recording which commit it came from. That worked and had one cost,
which is the reason this file exists: **nothing compared the recorded commit to
upstream**, so a copy could sit twelve commits behind and the only way anybody
found out was by asking. The pin is in the lockfile now instead of in prose.

> **This does not fix staleness on its own.** Dependabot and Renovate do not
> reliably bump a `github:` dependency pinned to a commit. Publishing both to a
> registry is what would buy that, and it is not done yet.

## bildquelle — symbols

ARASAAC and the user's own licensed METACOM folder, behind one interface. The
package exists for the licensing rule rather than for the line count: it ships
no symbols, downloads no METACOM file, transmits none, and `getImageUrl()`
deliberately returns an object URL rather than bytes so that a caller can render
a symbol but cannot serialise, upload or store one.

`src/data/symbols.ts` is the adapter between it and the shapes vorlaut speaks.

## stimmquelle — speech

The recording chain and the voice catalogue. What vorlaut asks of it:

```ts
speak(text, voice, { rate: 16000, fadeSec: 0.012, padSec: 0.06 })
```

The rate is the device's. The other two are the contract's "permitted device
extras" (`CONTRACT.md` §2) and are off by default: a 12 ms fade against clicks
on a class-D amplifier, and 60 ms of quiet so the MAX98357A does not switch off
mid-syllable. Neither changes measured loudness, and §2 spells out that they are
applied to the trimmed signal *before* the measurement.

`shippable()` is the other thing vorlaut leans on, and it is a licensing gate
rather than a filter: it drops what cannot speak in a tab, what may not be handed
on at all, and what may be handed on only with an attribution this interface does
not render. **Five voices are offered out of a catalogue of fifteen.**
`de_DE-mls-medium` is CC-BY and is refused with a sentence saying so — render the
notices from `attributionsFor()`, pass `{ rendersAttribution: true }`, and it
comes back.

## Refreshing either of them

```bash
npm install @lautstark/stimmquelle@github:Lautstark/stimmquelle#<new-sha>
npm test
```

Read the package's own `CHANGELOG.md` first — stimmquelle's says which edits a
consumer needs, and moving to 2.0.0 needed exactly one here.

**A refresh that moves §1 or §2 of stimmquelle's contract re-renders every
recording on every device, so it is a decision and not an update.**
`PIPELINE_VERSION` says whether it did. `tests/unit/level.test.ts` holds the
chain against `tests/reference/tts.lock.json`, which is what real ffmpeg said
about fixed inputs while there was still a Python half of this project to ask
it. Those numbers are measurements rather than a description of any particular
build, so a refresh does not invalidate them — holding a new one to them is how
it gets shown to be faithful.

`tests/unit/reachable.test.ts` is the other one to watch: a renamed entry point
fails there rather than in a tab.
