# The four shared packages

vorlaut uses four packages of its own, shared with the other tools in this
organisation. None is on npm. All are **git dependencies pinned by release
tag** in `package.json`, which npm resolves and builds through each package's
own `prepare` script — the same pin style mitreden uses, so the two can be
compared at a glance:

```json
"@lautstark/bildquelle": "github:Lautstark/bildquelle#v1.4.0",
"@lautstark/design": "github:Lautstark/design#v1.9.0",
"@lautstark/sicherung": "github:Lautstark/sicherung#v1.0.0",
"@lautstark/stimmquelle": "github:Lautstark/stimmquelle#v2.5.0"
```

They used to be copied into `static/vendor/` by hand, with a `VENDORED.md`
beside each recording which commit it came from. That worked and had one cost,
which is the reason this file exists: **nothing compared the recorded commit to
upstream**, so a copy could sit twelve commits behind and the only way anybody
found out was by asking. The pin is in the lockfile now instead of in prose.

> **The pin does not keep itself current.** Dependabot and Renovate do not
> reliably bump a `github:` dependency, tag or sha, and publishing to a
> registry — which would buy that — is still not done. What closed the gap
> instead is a check rather than a service: `node
> node_modules/@lautstark/design/pins.js` runs early in both workflows, asks
> each repository for its newest tag and names the pins that are behind. It
> warns and never fails, deliberately — being a patch behind is no reason to
> block a deploy that fixes something else, and a check that can stop an urgent
> release is a check people route around. `--strict` is there for anybody who
> wants the opposite. It exists because the three products had drifted two
> versions apart on the shared look before anybody looked.
>
> A tag is still worth having over a sha: `#v2.5.0` can be read against the
> package's CHANGELOG without asking git what the sha was.

That check looks outward, at what the repositories have published since. It
has a twin looking the other way — `tools/installcheck.mjs`, which asks whether
what is in `node_modules` is what the pin says. That one fails rather than
warns, and it runs ahead of all three suites. Its reason for existing is the
section below.

## Installing them

```bash
npm ci
```

`npm ci` rather than `npm install`, and the reason is narrower than the folklore
about git dependencies suggests. It was worth measuring rather than repeating,
so here is what is actually true of this repository:

- **`npm install` does not silently re-resolve a tag.** With the lockfile
  present and in sync it installs the commit the lockfile names and never asks
  git what `#v2.7.0` points at now. It completes with the network unplugged.
- **`npm install` does repair a `node_modules` that has drifted** from the
  lockfile. It reports `changed 1 package` and puts the pinned version back.

So the case for `npm ci` is not that `npm install` corrupts the tree. It is
these two:

- **`npm ci` refuses when `package.json` and `package-lock.json` disagree**, and
  names the package that does not match. `npm install` treats the same
  disagreement as an instruction: it resolves the new tag, writes a new commit
  into the lockfile and moves the build, without asking. That is the right
  behaviour when refreshing a pin on purpose and the wrong one when the
  disagreement came from a bad merge or a hand edit — and for a git dependency
  what moves is a commit nobody reviewed.
- **`npm ci` deletes `node_modules` first**, so nothing left behind by another
  branch survives the install.

It costs about ten seconds here against under one, because it re-clones four git
dependencies and runs each one's `prepare` build. That is the price of the
guarantee and it is only paid deliberately.

**Neither command runs itself.** That is the gap the pin does not close and the
one that has actually cost time here: a checkout switched, a worktree made,
a `node_modules` a version behind, and nothing anywhere saying so. What surfaced
instead was `tests/unit/level.test.ts` — a loudness failure with real numbers in
it and a sound explanation about limiters and ceilings, in a recording chain
that was correct, because the installed `@lautstark/stimmquelle` was simply
older than the pinned one. A wrong answer that plausible costs more than an
error does, because it gets investigated as a bug.

`tools/installcheck.mjs` is what closes it. It compares four things already on
disk — the tag in `package.json`, the version and commit in
`package-lock.json`, the commit in `node_modules/.package-lock.json`, and the
version in each installed package's own `package.json` — names any package
where they disagree, prints the pinned version, the installed version and the
command that fixes it, and stops. No network, no resolution, about forty
milliseconds. It runs first in `npm test`, first in `npm run test:e2e`, first in
`python3 tests/run.py`, and as its own step after `npm ci` in both workflows.
`npm run preflight` runs it alone.

It is worth knowing what it will and will not catch. Same version at a different
commit — a moved tag — it catches, by comparing commits once the versions
agree. A `node_modules` that is not there at all it catches. A package whose
directory was replaced by hand it catches, because the installed package's own
`package.json` is read directly rather than npm's record of it being trusted.
What it cannot see is a package whose version is right and whose *contents* are
not; nothing short of hashing the tree would, and that is not what went wrong.

## design — tokens, components, theme

One JSON line per product in Lautstark/design (vorlaut's is its accent,
`#9B7BFF`) generates `tokens/vorlaut.css`; `src/main.ts` imports it ahead of
everything else, exactly the way mitreden imports its own, because what follows
reads the custom properties it defines. Every value that has to clear a
contrast ratio is solved for it rather than picked by eye — the design repo's
README carries the receipts. There used to be a byte-identical copy of the
generated file checked in here; a copy that is identical today drifts tomorrow,
so the pin is the only statement of which version this page wears.

Two more things come out of the same package. `components.css` is the layer
between the tokens and this page's own rules — button, field, chip, menu,
sheet, folded panel, each written once against the token names — and it
restyles nothing by itself except `:focus-visible`, which is what lets
`src/styles/ui.css` be the layout that is vorlaut's alone rather than a second
copy of the shared vocabulary. `theme` is the dark-mode handling the three
products share, so the address bar and the OS turning over under a running page
behave the same in all of them.

`pins.js` above ships here too, for the same reason `components.css` does:
every product already depends on this package, so every product already has it.

### One thing that file owes back: what spaces a sheet body

Not a defect in vorlaut, and written down here because it cannot be fixed from
here. `components.css` spaces the inside of a sheet with two rules:

```css
.sheet > .body > p { margin: 0; }
.sheet > .body > p + p { margin-top: 10px; }
```

That is the rhythm of *prose*, and it holds only while a sheet body is nothing
but paragraphs. The moment anything that is not a `<p>` stands between two, the
adjacency stops matching and `margin: 0` is the whole of what applies — so the
space does not shrink, it is not there at all. It is a silent zero: no warning,
nothing in a stylesheet to read, just two elements touching.

Every sheet in this repository that is not prose has paid for it separately,
which is the argument that the rule and not the callers is what is wrong:

- **the create dialog** — two `<button>` cards, a conditional `<div>` question
  and a closing `<p>`. Nothing in it is a `p` after a `p`, so it had no air
  anywhere: the cards touched each other and the note stood on the second
  card's border. Fixed as `dialog.sheet--target > .body` in `ui.css`.
- **the button and page sheets** — `.sheet--button > .body` is a grid with
  `row-gap: 15px`, written for its two columns and immune to this by accident.
- **the transfer sheet** — pays per element instead: `dl.transfer` carries
  `margin: 16px 0 0` and `.doing` carries `margin: 0 0 10px`, both of them
  spacing that the body should have given them.
- **the legal pages** — sidestep it by putting the prose inside a `<section>`,
  where `.sheet > .body > p` never reaches, and restating the rhythm as
  `.legal p { margin: 0 0 6px }`.
- **the Grid card** (`src/editor-app/editor.ts`) — still has it: the lead
  `<p class="note">` sits flush on the size row under it, and the red
  `.notice` sits flush on the switches above it. Left alone deliberately; that
  card is being folded into the Sammlung's settings sheet in its own session,
  and a rule scoped to a dialog that is about to stop being one is a rule
  nobody would find again.

**What the rule would need to become.** Not a wider adjacency.
`.sheet > .body > * + p` fixes the note in the create dialog and still leaves
the Grid card's `<p>` flush against the `<div>` beneath it; `* + *` fixes both
and puts 10px between every `<details class="panel">` in the settings sheet,
which are stacked edge-to-edge on purpose and share their borders. Widening the
selector only moves which bodies are wrong.

The rhythm belongs to the body, not to the paragraph:

```css
.sheet > .body { display: grid; align-content: start; gap: var(--sheet-body-gap, 10px); }
.sheet > .body > p { margin: 0; }
```

10px so that every sheet that is prose today keeps the number it has now. A
body that wants its children flush says so in one legible line
(`--sheet-body-gap: 0`, which is what the settings sheet's accordion and the
legal pages want) instead of getting it silently. A body that wants columns
sets `grid-template-columns` and stops having to declare `display: grid`
itself, which is what `.sheet--button` does here already.

The cost is real and belongs in the same sentence: this moves spacing in every
sheet in all three products, and the per-element margins listed above would
double up until they are deleted. So it lands in design first and each product
removes its own workaround after — it is not a change any one product can make
half of.

## bildquelle — symbols

ARASAAC and the user's own licensed METACOM folder, behind one interface. The
package exists for the licensing rule rather than for the line count: it ships
no symbols, downloads no METACOM file, transmits none, and `getImageUrl()`
deliberately returns an object URL rather than bytes so that a caller can render
a symbol but cannot serialise, upload or store one.

`src/data/symbols.ts` is the adapter between it and the shapes vorlaut speaks.

There is a second entry point, `@lautstark/bildquelle/german`, which turns what
somebody wrote into the words worth looking up — lemmas, compounds, separable
verbs. `searchIn()` in `src/data/symbols.ts` imports it, lazily, on the first
keystroke in the picker: a key on a board says "Ich habe Durst" where the
collection holds "durstig", and the raw string finds neither. It is its own
entry point because the tables behind it are about 160 KB, which is exactly the
weight a visit that only presses a key to hear it should not carry.

### The 1.6.0 bump, not yet made

Written down on 2026-08-25 because the release it describes was prepared and
then deliberately held. Whoever picks it up should be able to do so without
re-deriving any of this.

**Where things stand.** `v1.5.0` is bildquelle's newest tag and the pin is on
it, so `pins.js` has nothing to report. But bildquelle's `main` is one commit
past that tag — `1b0c0c2`, *Search the language somebody is actually reading*
— and `package.json` there already says `1.6.0`. A release was prepared and
the tag was never cut. At the time of writing `1b0c0c2` is not even pushed:
`origin/main` is still at `95ed75c`.

**What `1b0c0c2` changes.** ARASAAC keeps its keywords per language and the
language is a path segment, which was hardcoded to `/de` for as long as
everything consuming the package was German. So the endpoint, the pipeline and
the licence notice all follow a language now, set through
`setSymbolLanguage(lang)` and read back with `symbolLanguage()`. There is a
sibling `@lautstark/bildquelle/english` beside the German entry point — a
separate pipeline rather than the same one with the tables swapped, with no
compound splitting and no synonym rung. The search cache is keyed by language
too, or a German row would answer an English question for thirty days looking
exactly like a correct answer. One breaking rename: `ARASAAC_ATTRIBUTION` is
now `ARASAAC_ATTRIBUTIONS`, keyed by language. vorlaut never imported it —
`attributionsFor()` is what `attributionFor()` calls — so nothing here has to
move for it.

**Is it safe to ship?** Yes, and it fixes something that was already shipping.
This page has offered English throughout while every symbol search went to
ARASAAC's German endpoint, and that endpoint does not refuse an English word,
it answers one out of its tags and synsets: `/de/search/water` comes back with
a water-transport sign. An English reader was being handed the wrong picture
rather than none, which on a board is worse than an empty square, because an
empty square is something a carer fixes.

**Which of vorlaut's two languages drives it — they agree.** Since 2026-08-25
this repository has two, and [languages.md](languages.md) is where the split is
written down: the *interface's* language belongs to this browser and to the
person building a board in it, and the *device's* belongs to a Sammlung and
travels with an export. The picker is used by the person building the board, so
it is the interface's language that decides which collection is searched, and
the Sammlung's does not enter into it. A carer working in German may be
building an English talker; the symbols they are shown while building it are
theirs to read. That is the same thing bildquelle means by "the language
somebody is actually reading", so the bump needs no reconciliation on this
axis. It is worth having checked: the two settings were one setting until the
day before this note, and the reading that looks equally plausible — that a
Sammlung's language should pick its symbols — would have been wrong in a way
no test would have caught.

**Where they do disagree: METACOM.** `setSymbolLanguage` deliberately does not
touch the METACOM provider, and the package says why. METACOM is a German
product and a symbol's id *is* the filename in somebody's own licensed folder,
so a collection of `trinken.png` matches the German word whatever the language
is set to. But the *pipeline* is chosen per language and then run against
whichever provider the Sammlung uses — `suggest(term, { provider })` takes
either — so an interface set to English with a METACOM Sammlung would put the
English lemmatiser in front of German filenames. `orderedLadder()` tries the
word as written on the first rung, so exact matches survive; what is lost is
the German inflection and compound handling that used to run there
unconditionally. That is a narrow regression rather than a blocker, and it
arrives with the bump rather than being fixed by it.

bildquelle's README names the remedy and it is not a pipeline switch: *a host
offering English should say so where METACOM is chosen — in English, ARASAAC
is the source that works.* vorlaut does not say so today. `ui.metacom_needed`
is the string that would carry it, and `src/shell/picker.ts` is where it is
built. That is a UI decision rather than part of the bump, and it should not
hold the bump up.

**What the bump will need**, in order:

1. **The tag, once.** `1b0c0c2` is held so that one release can carry it *and*
   the symbol-search fix being made in `~/Code/bildquelle` alongside it.
   Tagging `1.6.0` before that fix lands means tagging again straight after,
   and then bumping here twice. Push `main` and cut `v1.6.0` when both are in.
2. **The spec in `package.json`:** `github:Lautstark/bildquelle#v1.6.0`.
3. **The lockfile**, through `npm install` and not `npm ci` — this is the one
   deliberate act the section above says `npm install` is for. It resolves the
   new tag and writes the new commit in.
4. **`node tools/installcheck.mjs` quiet afterwards**, then all four suites.
   Everyone else picks the new commit up with `npm ci`, and until they do,
   installcheck in front of the suites is what tells them.
5. **The example block at the top of this file**, which still shows `v1.4.0`
   for bildquelle.

**Why any of this needed writing down.** On 2026-08-25 the main checkout at
`~/Code/vorlaut-diy-talker` was running `1.6.0` against a pin that said `1.5.0`, so every
test taken there for part of an afternoon measured one version while naming the
other. It was not an accidental re-resolution and it could not have been:
`1b0c0c2` exists only on the local machine, and `node_modules/.package-lock.json`
still recorded a correct `1.5.0` install at `95ed75c`. `dist/`, `src/` and
`package.json` inside the installed package had been overwritten a minute after
that install, byte-for-byte identical to the working tree of `~/Code/bildquelle`,
while `LICENSE` and `README.md` beside them were still the ones npm put there.
A partial in-place overwrite is not something npm does. Somebody was testing the
unreleased search fix by hand, which is a reasonable thing to want and left no
note. `installcheck` caught it, as designed — that is the case it describes
above as "a package whose directory was replaced by hand".

The lasting form of that want is a tag, or failing that a
`file:../bildquelle` pin held in an uncommitted `package.json` and reverted
after. What it must not be is a copy into `node_modules`, which outlives the
session that made it and is invisible to everyone except the check.

## sicherung — the standing backup

A folder the user picks once and vorlaut writes to from then on, without
anybody remembering to. A folder inside Dropbox, iCloud Drive or Nextcloud is
already synced by software the user installed on purpose, so writing a file
there is the whole of the cloud story: no account, no OAuth client, no token to
refresh, no server of ours.

It works on Chromium on the desktop and nowhere else — `showDirectoryPicker` is
absent from Safari and Firefox on every platform, and from every browser on
Android, Chrome included. So this is an addition to the download button beside
it and never a replacement: `src/shell/backupFolder.ts` hides the offer entirely
unless `Sicherung.supported`, because a talker's content must not be shown a
backup story the tablet it runs on cannot have.

The package holds no database and no reference to anything a product keeps. The
`produce` callback is the only way data enters it, and what `src/app.ts` hands
over is `exportEverything()` from `src/data/backup.ts` — the audited artefact,
which carries the board and the pictures in `symbols/` and drops the Azure key
and the METACOM folder path on the way out. That matters more here than
anywhere else in the repository: choosing a folder is choosing to have a sync
client carry the file off the machine, a stored credential there would be
posted to somebody's cloud, and a METACOM path is derived from a collection
licensed per person. `tests/unit/backup_payload.test.ts` holds that wiring in
place, and a failure there is a licence or a leak rather than a bug.

## stimmquelle — speech

The recording chain and the voice catalogue. What vorlaut asks of it:

```ts
speak(text, voice, { rate: 16000, fadeSec: 0.012, padSec: 0.06, ownsInference: true })
```

The rate is the device's. The next two are the contract's "permitted device
extras" (`CONTRACT.md` §2) and are off by default: a 12 ms fade against clicks
on a class-D amplifier, and 60 ms of quiet so the MAX98357A does not switch off
mid-syllable. Neither changes measured loudness, and §2 spells out that they are
applied to the trimmed signal *before* the measurement. `ownsInference` is the
licence half and is described below; it rides in the options rather than in the
constant beside them, because the constant is spread into the WAV fingerprint
and a new key there would rename every recording ever made.

`shippable()` is the other thing vorlaut leans on, and it is a licensing gate
rather than a filter: it drops what cannot speak in a tab, what may not be handed
on at all, and what may be handed on only with an attribution this interface does
not render. **Seven voices are offered out of a catalogue of fifteen.**
`de_DE-mls-medium` is CC-BY and is refused with a sentence saying so — render the
notices from `attributionsFor()`, pass `{ rendersAttribution: true }`, and it
comes back.

Five of those seven were the whole offer until this page started driving piper
itself. `usePiperRuntime(piperRuntime(…))` in `src/backend/local.ts` is that
handover, and `shippable({ ownsInference: true })` is how the page says so: the
runtime question is answered here now rather than by what vits-web could speak,
which is what puts `de_DE-kerstin-low` and `en_US-john-medium` on offer. Kerstin
is worth the trouble on her own — she is the one voice in the catalogue native
at 16 kHz, the device's own rate, so she alone reaches it without a resample.
The claim says nothing about licences; that half is still asked of every voice,
which is why mls goes on waiting for its notice.

One thing the package cannot default for its consumers, so vorlaut passes it:
`piperRuntime()`'s `base`. The default reads `import.meta.env.BASE_URL` through
a local alias, and vite only substitutes that name written out in full, so the
expression survives into the bundle, finds no env at run time and falls back to
`/` — right in dev and wrong on a project site, where the phonemizer would be
fetched from `/vendor/` on a page served at `/vorlaut-diy-talker/` and the first sentence
would fail on a 404 that no test sees, because e2e stands the phonemizer chunk
in and never loads the real files. `src/backend/local.ts` writes it out.
mitreden hit the same edge and passes it too; the line can go when the fix lands
in the package.

## Refreshing any of them

```bash
npm install @lautstark/stimmquelle@github:Lautstark/stimmquelle#v2.5.1
npm test
```

`npm install` here and not `npm ci`, and this is the one place that is true:
moving a pin is exactly the deliberate act the section above says `npm install`
is for. It resolves the new tag, writes the new commit into the lockfile and
installs it. Everyone else picks that up from the lockfile with `npm ci`, and
until they do, the check in front of the suites is what tells them.

A release tag rather than a sha, so that `pins.js` can compare it against what
the repository has published. Read the package's own `CHANGELOG.md` first —
stimmquelle's says which edits a consumer needs, and it means it: 2.0.0 needed
exactly one edit here, and 2.0.1's entry names the `tsconfig` workaround
consumers had built and says to delete it, which this repository did.

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
