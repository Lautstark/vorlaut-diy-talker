# The map: which repositories there are, and what passes between them

The reasoning for the layout of this project is all written down, and none of
it is in one place. Six documents each answer their own question and stop at
its edge; `README.md`'s *What it is made of* describes this repository's parts
and stops at this repository's edge. Nothing lets somebody see the shape.

This is the shape. Every claim here is a sentence and a link — the arguments
stay where they were made, because a summary that carries them drifts from them
within the week, and [`format-freeze.md` §9](format-freeze.md#9-prose-that-has-drifted-from-the-code)
is a list of exactly that happening.

---

## The rule that explains all of it

> A second **consumer** justifies extraction. A second **implementation**
> justifies a specification.

Two questions that sound like one and are not. *Used by more than one product*
is about **deployment**: it is why `design`, `bildquelle`, `sicherung` and
`stimmquelle` are four repositories of their own — another product needed them,
and it existed. *Has a second implementation that must agree* is about
**specification**: it is why [`exchange/SPEC.md`](../exchange/SPEC.md) and
[`device/`](../device/README.md) exist — two programs write and read the same
bytes, and neither of the two programs is the format.

The firmware meets the second test and fails the first. Nothing but this
builder writes `layout.bin` and nothing but this sketch reads it, so it has
never had a second consumer to leave for; but the format between them has two
implementations, and what that asks for is a written format with fixtures both
halves are held against, rather than a move. The distinction is in
[ADR 0006](../adr/0006-builder-and-hardware-one-repo.md)'s Why, and the working
out is [`obz-as-device-input.md` §12](obz-as-device-input.md).

Every boundary below is one of those two answers.

---

## The shape today

```mermaid
flowchart LR
  PKGS["design · bildquelle<br/>sicherung · stimmquelle<br/>four repositories, pinned by tag"]

  subgraph V["vorlaut — this repository"]
    SH["src/shell/<br/>boards, symbols, voices, settings"]
    DIY["src/editor-diy/<br/>four keys, five sets"]
    DEV["device/fixtures/<br/>owned by neither half"]
    FW["firmware/<br/>Arduino sketch, C++"]
    APP["src/editor-app/<br/>tablet boards"]
    EX["exchange/SPEC.md<br/>+ conformance fixtures"]
  end

  TALKER["the talker<br/>ESP32-S3, five ScreenKeys"]
  AAC["other AAC software"]
  VA["vorlaut-app<br/>Android viewer — reads, never writes"]

  PKGS --> SH
  SH --- DIY
  SH --- APP

  DIY -->|"layout.bin, tiles, WAVs<br/>down the USB-C cable"| TALKER
  DIY -->|".obz — symbols by reference, no pixels"| AAC
  APP -->|".obz app package — PNG and Opus baked in"| VA
  FW -->|"flashed once"| TALKER

  DEV -.-|held against it| DIY
  DEV -.-|held against it| FW
  EX -.-|normative for the writer| APP
  EX -.-|pinned by commit SHA| VA
```

**Nothing unbuilt is drawn.** The diagram is what exists and runs today. The
split is decided and not built, and it is prose under
[its own heading](#the-split-and-the-route-it-replaced), so that a reader skimming the picture
cannot come away with a shape nothing has yet.

**Why mermaid, and not a picture or a table.** These files are read on
github.com — that is where `README.md`'s relative links land — and GitHub
renders a fenced `mermaid` block into a diagram there, with no build step and
nothing to keep in sync. It is also text: it diffs in a commit and moves in the
same edit as the sentence beside it, which neither a committed SVG nor a second
PNG beside `wiring.png` would. The cost is a reader in a plain editor, who gets
the source instead of the picture — a dozen labelled nodes and edges, which is
a table that happens to name its arrows.

---

## Decided, and not built

The distinction that matters most on this page, so it is made before anything
else and repeated where each part is described. Since 2026-08-27 nothing on this
page is *proposed*: what is left of that column is a decision waiting to be
carried out, and two routes nobody is taking.

| | |
|---|---|
| **Decided** | The Android app is a separate repository and a viewer only ([ADR 0004](../adr/0004-android-app-is-a-viewer.md)). The four shared packages are separate repositories ([`packages.md`](packages.md)). The package format is the app's boundary, specified and fixtured ([ADR 0005](../adr/0005-obf-obz-exchange-format.md), [`exchange/SPEC.md`](../exchange/SPEC.md)). The builder and the firmware share this repository ([ADR 0006](../adr/0006-builder-and-hardware-one-repo.md)). The device interface has fixtures owned by neither half ([ADR 0009](../adr/0009-device-interface-fixtures.md)). The device build has an `.obz` export of its own ([ADR 0010](../adr/0010-device-shaped-obz-export.md)). The editor exports a file and stops, and the talker's own repository compiles it and sends it ([ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md)). This repository splits into three, and the **editor** is the half that leaves ([ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md)); [what the pieces are called](#the-three-names) was settled ahead of it. |
| **Decided, nothing built** | The split. [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) decided it on 2026-08-27; no file has moved, and [what it costs](#what-the-move-costs) is the checklist rather than a prediction. |
| **Not proposed by anybody** | ~~A device compiler shipped as a pinned package.~~ See [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md), and [`obz-as-device-input.md`](obz-as-device-input.md) for the route it replaced. ~~Splitting the **firmware** out~~ — the direction is the other one, and has been since the names were settled. |

---

## This repository

The board builder, the firmware, the enclosure, and the two formats that leave.
`README.md`'s *Working on it* has the module layout and the commands; what
matters for the map is that the browser side has **one shell and two authoring
halves**, and that they write to three different readers.

| | |
|---|---|
| [`src/shell/`](../src/shell/) | What any board builder needs, and neither editor owns: the list of boards, the symbol picker, the voices, the settings, import and export. |
| [`src/editor-diy/`](../src/editor-diy/) | The five-key talker, and only it — four slots to a set, five sets on the device, and the cable. |
| [`src/editor-app/`](../src/editor-app/) | The tablet boards the Android viewer renders — a grid, pages, a first column. |
| [`firmware/`](../firmware/) | The talker itself. C++, Arduino, ESP32-S3. |

What it writes, and who reads it:

| Artefact | Written by | Read by |
|---|---|---|
| `layout.bin`, the tiles and the 16 kHz WAVs | the build, pushed down the cable or into a folder | the firmware, on the device |
| An `.obz` board document, symbols **by reference** | [`src/data/obf.ts`](../src/data/obf.ts) | vorlaut itself, and other AAC software |
| An `.obz` app package, symbols and audio **baked in** | [`src/data/app_package.ts`](../src/data/app_package.ts) | `vorlaut-app` |
| An `.obz` device package, sources unresampled and the device's own WAVs | [`src/data/device_package.ts`](../src/data/device_package.ts) | the page that compiles it and sends it ([ADR 0010](../adr/0010-device-shaped-obz-export.md), [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md)) |
| A backup of everything, credentials and paths dropped | [`src/data/backup.ts`](../src/data/backup.ts), through `sicherung` | a folder the user picked, and whatever syncs it |

The three `.obz` doors are three functions that share no code path, and
[`exchange.md`](exchange.md) is why that is structural rather than tidy: the
first refuses to write a METACOM symbol as pixels at all, the other two each
take one narrow step past that under [`SPEC.md`](../exchange/SPEC.md) §5.2, and
one function behind an argument would put the licence guarantee one call site
away from being untrue.
[ADR 0010](../adr/0010-device-shaped-obz-export.md) is why the third one is a
door of its own rather than a flag on either of the first two.

## `vorlaut-app`

[`Lautstark/vorlaut-app`](https://github.com/Lautstark/vorlaut-app) — Kotlin,
Android, the first non-TypeScript repository in the organisation. It opens a
package, shows the boards and speaks when a button is pressed.

**It does not edit and it does not export**, and that is load-bearing rather
than unfinished. [ADR 0004](../adr/0004-android-app-is-a-viewer.md) has the
argument; three of its consequences are what shape everything else on this
page. A viewer that cannot write cannot corrupt, so an import replaces a
package wholesale ([ADR 0007](../adr/0007-reimport-replaces-package-atomically.md))
and storage is a table of packages rather than a document database. One
direction means the format needs no round-trip property, so an importer may
discard what it does not understand and `SPEC.md` says so. And a package that
may not be redistributed is structurally safe on that device, because there is
no export path to disable.

## The four shared packages

Not on npm. Git dependencies pinned by release tag in `package.json`, built
through each package's own `prepare` script. [`packages.md`](packages.md) is
the whole story, including what each one is asked for and the one open bump.

| | |
|---|---|
| [`design`](https://github.com/Lautstark/design) | Tokens, `components.css`, the shared dark-mode handling — and `pins.js`, which every product already has because every product already depends on this. |
| [`bildquelle`](https://github.com/Lautstark/bildquelle) | ARASAAC and the user's own licensed METACOM folder behind one interface, plus the German pipeline that turns a typed sentence into words worth looking up. |
| [`sicherung`](https://github.com/Lautstark/sicherung) | The standing backup: a folder picked once, written to from then on. |
| [`stimmquelle`](https://github.com/Lautstark/stimmquelle) | The recording chain and the voice catalogue, with `shippable()` as the licensing gate. |

Two checks face in opposite directions and are easy to confuse. `pins.js` looks
**outward** — has any of the four published a newer tag? — and warns, never
fails. [`tools/installcheck.mjs`](../tools/installcheck.mjs) looks **inward**,
and is the one that holds the pin, the lockfile and the disk together: it
compares the tag in `package.json`, the version and commit in
`package-lock.json`, the commit in `node_modules/.package-lock.json` and the
version in each installed package's own `package.json`, names any package where
those four disagree, and stops. It runs ahead of all three suites, because the
way a stale install surfaces otherwise is a failure somewhere else with
plausible numbers in it. [`packages.md`](packages.md#installing-them) has the
measurement behind `npm ci`, and what installcheck can and cannot see.

---

## The seams

### Between the editor and the app: a specification

[`exchange/SPEC.md`](../exchange/SPEC.md) plus the conformance fixtures beside
it, in [`exchange/`](../exchange/README.md). Two programs implement a written
document and neither one is the document. The fixtures live with the **writer**
and the reader pins them, which works because one party can always be made to
move: the viewer gets an update. It is pinned by commit SHA rather than a tag,
because `exchange-v1.2.0` is not cut and will not be until a real board reaches
a tablet — [`format-freeze.md` §5](format-freeze.md#5-the-android-viewers-pin-and-which-half-a-device-freeze-solves)
is where that pin is examined, including the one normative rule that landed
after it with no version to show for it.

### Between the editor and the firmware: a folder, and a third thing

Today the boundary is a directory in one repository — `loader/` on one side,
`firmware/` on the other — and the checks that hold them together compile the
sketch's own headers and replay the browser's actual bytes into the device's
actual reader. That is the argument in
[ADR 0006](../adr/0006-builder-and-hardware-one-repo.md) for why they have not
been separated, and [`device-interface.md`](device-interface.md#what-the-evidence-actually-says)
is the measurement that re-examined it and agreed.

**The split does not cut here, and that is why it can happen at all.** The
editor's own boundary with the device is a file and has been since
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md); the two
implementations of `layout.bin` are `loader/` and `firmware/`, and
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) leaves both of
them in this repository. The heading is the older shape and is kept because the
question is still asked in those words.

Beside them sits [`device/`](../device/README.md), which belongs to neither.
Here the `exchange/` arrangement could not carry over, and
[ADR 0009](../adr/0009-device-interface-fixtures.md) says why in one sentence:
**neither party can be made to move.** A talker on a shelf in a house nobody in
this repository knows about is fixed by a person with a cable or not at all, so
a format the writer owns and the reader merely pins would put the authority on
the side with nothing at stake. Both halves are held against a third thing
instead. There is no prose specification there yet, deliberately — the fixtures
are the specification until the format holds still, and
[`format-freeze.md`](format-freeze.md#the-short-answer) is the list of what is
still moving.

### The split, and the route it replaced

**Nothing in this section is proposed any more.** What is left is one decision
nobody has carried out yet, and beside it the route that was not taken — struck
through rather than deleted, because it is what the taken one had to beat.

~~[`obz-as-device-input.md`](obz-as-device-input.md) weighs making the editor's
only output an `.obz`, with a device-side compiler that turns it into
`layout.bin` and the tiles, shipped as a package pinned the way the four above
are pinned.~~ [`obz-as-device-input.md`](obz-as-device-input.md) established
that the premise holds — an `.obz` can carry everything the device build uses —
and that half of it stands. The package half does not.
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) replaced
it: **the editor exports a file and stops**, one action whatever kind of board
it is, and **the talker's own repository gains a page** that a person opens with
a talker in front of them — choose the file, validate it, compile it, connect,
send. There is no shared package and no cross-repo code dependency; the
boundary is the file format, full stop.

Three things follow, and it is worth keeping them apart:

- **The third export door** — a device-shaped `.obz` with the sources
  unresampled, negation as a flag and the device's own WAVs — was built on its
  own merits, independently of any split.
  [ADR 0010](../adr/0010-device-shaped-obz-export.md) records it. It is what
  makes the file boundary expressible at all.
- ~~**The compiler as a package** is the decision ADR 0006 refused. An ADR for it
  would **supersede** 0006 rather than amend it.~~ Still true of a package, and
  nobody is proposing one. ADR 0011 puts the compiler in the repository the
  firmware is already in, so both implementations of every device format stay on
  one side and 0006 is **amended** rather than superseded — its revisit
  condition 2 lost its premise rather than its force.
- ~~**Splitting this repository** waits on evidence, and ADR 0006 says what
  counts as evidence and what does not.~~ **Decided on 2026-08-27:**
  [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md). Which half
  moves was never the open part — it is the editor. What was open was
  *whether*, and the two reasons for waiting both dissolved: ADR 0006's
  condition 2 turned out to gate a package nobody is building, and
  [`format-freeze.md`](format-freeze.md#the-short-answer) now records the three
  items that had to land before a device freeze as landed. ADR 0012 claims no
  evidence it does not have — none of 0006's four conditions fired — and argues
  instead that ADR 0011 moved the seam off the thing 0006 protects. Nothing has
  moved yet; the section below stops being a prediction and becomes the
  checklist.

#### The three names

**The names were settled before the split was**, on purpose: cheap to settle
early, expensive to settle halfway through a move. They are unchanged by the
decision, and [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md)
adopts them as written.

| | |
|---|---|
| `vorlaut-diy-talker` | **This repository**, keeping its name, its history, its address and its `v*` tags. It becomes the device: [`firmware/`](../firmware/), [`case/`](../case/), [`device/`](../device/README.md), [`loader/`](../loader/README.md) — the page that compiles an exported file into what the talker reads and sends it down the cable — and `tests/run.py` with the Python beside it. |
| `vorlaut-editor` | New. The editor leaves — [`src/shell/`](../src/shell/), [`src/editor-diy/`](../src/editor-diy/), [`src/editor-app/`](../src/editor-app/), the three `.obz` doors, [`exchange/`](../exchange/README.md) and `tests/reference/`. |
| `vorlaut` | New. A GitHub Pages site explaining the three products — the Android app, the editor, the DIY talker — to a reader who is not a developer. |

**The three names are unchanged by
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) and by
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md), and one of them
stopped being vague.** *"Whatever compiles a package into what the
talker reads"* was a placeholder for something undecided when this table was
written; it is now a page, and it is being built here rather than waiting for a
split. Two consequences worth having in front of the names. This repository's
Pages deployment starts carrying two things rather than one — the editor and
the talker's page — so the split is not the moment a second site has to be
stood up, it is the moment the editor's build moves out and the talker's page
stays where it already was. And what leaves with the editor is three writer
functions rather than two: the talker document, the app package and the device
package ([ADR 0010](../adr/0010-device-shaped-obz-export.md)), all three of
them files and none of them a cable.

**The direction is the opposite of the one the rest of this page assumes.**
Every sentence above about the firmware moving into a repository of its own
describes the same split with the other half moving: the editor leaves, the
device stays. The repository is named for the talker, and the talker keeps it.

**The third name is not waiting for any of this.** `vorlaut` — the explainer
site — reads no format, writes no format, pins nothing and is pinned by
nothing. It could exist today, and none of what follows applies to it. The
three names are one decision and not one event, and reading them as one event
defers the only piece that is unblocked. ADR 0012 decides the other two and says
so again: `vorlaut` is not waiting for them either.

##### What the move costs

Worked out while it was cheap, and it stopped being hypothetical on 2026-08-27.
None of it is built. This is the checklist for the day, and each paragraph is a
thing to be answered rather than discovered —
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) points here for
exactly that.

**The history goes with the device, and the editor should get a rewritten copy
rather than an empty one.** The reasoning in this project is largely in its
commit messages, and the way anybody actually reaches it is `git blame` on the
line in front of them — a pointer to another repository is not something blame
can follow, and an editor starting empty answers "initial import" for every
line of `src/` for ever. The usual objection to `git filter-repo`, that it
rewrites ids other people have pinned, does not apply here: the rewrite is on
the **copy**. This repository is not touched, so every SHA already cited — the
Android viewer's pin among them — keeps resolving exactly where it did. Two
costs to state rather than discover. The same commit then exists twice under
two ids, and the device repository stays the one that is cited. And a
path-filtered commit keeps its whole message while keeping half its diff:
[ADR 0006](../adr/0006-builder-and-hardware-one-repo.md#consequences) calls the
mixed history mostly a feature, because the commit that changed the format is
next to the commit that changed the reader, and this is where that bill
arrives. The editor's history would be for reading, not for auditing.

**Pages moves, and the base path moves with it.**
[`pages.yml`](../.github/workflows/pages.yml) builds with
`BASE_PATH: /${{ github.event.repository.name }}/`, so the workflow follows a
rename for free — it is not where this bites. The base is also written out
**literally** in three tracked places, and those do not follow anything:
[`package.json`](../package.json)'s `test:e2e` and `build:pages`, and
[`playwright.config.ts`](../playwright.config.ts)'s `BASE`. Beside them,
[`src/backend/local.ts`](../src/backend/local.ts) passes `piperRuntime()`'s
`base` explicitly because the package cannot default it —
[`packages.md`](packages.md) has that whole edge, and both of its failure modes
are silent: a build with no base renders an empty body with no error at all,
and a wrong base fetches the phonemizer from a prefix that 404s on the first
spoken sentence, which e2e cannot see because it stands that chunk in. The
published address changes too, from
`https://lautstark.github.io/vorlaut-diy-talker/` to `/vorlaut-editor/`, and a
project site that changes repository leaves no redirect behind it. `README.md`
names the old one, and so does every bookmark a caregiver made. The explainer
site is the answer to that if it exists first — one address that outlives
whichever repository serves the editor. After
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) the bill
is smaller than that paragraph assumes, and it is worth knowing which half
pays: the **editor's** address moves, and the talker page's does not, because
the page is served from the repository that keeps the name. So the bookmark
that matters at a bench — the one somebody opens with a cable in their hand —
is the one that never changes.

**What answers at the Pages root once the editor has gone, and it is not the
loader.** [`vite.config.ts`](../vite.config.ts) names two entry points out of
one build — `index.html` at the root and `loader/index.html` at
`<base>loader/` — and the editor is the half that leaves, so on the day of the
move this repository has exactly one page and it is sitting in a subdirectory
with nothing above it. **Decided on 2026-08-27: the loader is not promoted. It
stays at `<base>loader/`, and a short static page takes the root.** Three
tracked sentences promise that address never moves — the paragraph above,
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md)'s second
consequence, and
[`split-crossings.md`](split-crossings.md#direction-three--the-crossings-that-are-not-imports),
which is the one that decides it. After the split
[`src/shell/packageExport.ts`](../src/shell/packageExport.ts)'s handoff link
stops being `new URL("loader/", BASE_URL)` and becomes
`https://lautstark.github.io/vorlaut-diy-talker/loader/` written out by hand in
the *other* repository, and the only thing that makes hard-coding it safe is
this page saying it does not move. Promoting the loader would make that promise
false on the day the literal is written, in the one crossing whose breakage a
carer sees rather than a test — and would buy a shorter address for it. One
published address moves in this move, and it is the editor's.

**The root has to answer with something, because it is the repository's own
address.** `https://lautstark.github.io/vorlaut-diy-talker/` is what
[`README.md`](../README.md) names and what GitHub's repository page links;
left empty it serves Pages' 404, and nothing here would fail. So: a page, and a
deliberately thin one — what this repository is in a few sentences, a link to
`loader/` for somebody holding a cable, a link to the editor at its new address,
and later a link to the explainer site. It stops there. The moment it starts
explaining the product it is competing with `vorlaut`, and it is the copy that
will go stale.

**What it costs, file by file, and the answer is nearly nothing.** The three
literal base paths need **no edit at all** — this repository keeps its name, so
[`package.json`](../package.json)'s `test:e2e` and `build:pages` and
[`playwright.config.ts`](../playwright.config.ts)'s `BASE` are as correct after
the move as before it, and against a literal whose failure modes are both silent
the safest edit is the one nobody makes. That is the largest single argument for
this answer over the other one. [`pages.yml`](../.github/workflows/pages.yml) is
untouched. `vite.config.ts` keeps two entry points and keeps its long comment,
because `index.html` is **replaced rather than removed**: `editor:` becomes
`home:` and the shape of the block stands. One clause of that comment does need
amending — the link between the two pages is the editor's and leaves with it.
What replaces it is a **relative** `href="loader/"` on the new page, which needs
no base at all: from `/vorlaut-diy-talker/` it resolves to
`/vorlaut-diy-talker/loader/` and under `npm run dev` to `/loader/`. Not a
fourth literal, and one mechanism fewer than the one it replaces. Its asset
paths stay **absolute** (`/icon.svg`), for the reason today's `index.html`
already gives in a comment: those are Vite's to rewrite from `base`, and `./`
would opt them out. Absolute assets beside a relative link look inconsistent and
are not, which is worth a comment on the day rather than a correction a month
later.

**The one thing this adds rather than moves.** A spec that opens the root,
asserts the body is not empty, and asserts the link resolves to `<base>loader/`
— the same assertion [`e2e/device_export.spec.ts`](../e2e/device_export.spec.ts)
already makes about the editor's handoff link, in a spec that leaves with the
editor. Only the first of the two silent failure modes above can reach this
page — a build with no base renders it empty, and it fetches no phonemizer to
fetch from the wrong prefix — but the first is the whole of what it is, and
without that spec it arrives with no coverage at all.

**What changes if the explainer site exists first: less than it looks.**
`vorlaut` is *"one address that outlives whichever repository serves the
editor"*, and it is a different address — it cannot answer for this one. What it
changes is the root page's contents, not its existence: the explaining sentences
go, a link goes in, and what is left is a signpost. Expect the proposal to delete
the page instead, and expect it to cite the explainer as the reason.

**Considered, and not taken: promote the loader and leave a redirect at
`loader/`.** It keeps the bookmark working and gives the page one canonical
address, and it costs the thing the directory is for.
[`loader/README.md`](../loader/README.md) put the directory at the top level,
beside `firmware/`, `case/` and `device/`, so that the eventual move would be *"a
move rather than an excavation"*; turning the source directory into a stub while
the page's source moves to the root is that excavation, performed on the day of
the move. A meta refresh is also still a page somebody maintains, and it
maintains nothing but an address. The same objection answers the plain promotion:
Pages leaves no redirect behind a path that moves either.

**This is a checklist item and not an ADR, and the line is worth stating.**
[`adr/README.md`](../adr/README.md) keeps the numbers for decisions that *"look
like an oversight from the outside"*; this one settles no boundary, no format and
no ownership, and ADR 0012 already decided both halves of it — the editor's build
moves out, the talker's page stays where it is. What was missing was the sentence
after that one, and a checklist somebody works through is where they meet it. If
the promotion is proposed more than once after the move, that is the moment it
earns a number.

**`v*` keeps meaning a firmware release, and that is the naming's clearest
win.** [ADR 0006](../adr/0006-builder-and-hardware-one-repo.md#consequences)
records `v*` as a firmware release, built and annotated by `release.yml`, and
warns that a second releasable thing here would need its own prefix rather than
its own meaning for `v*`. The device keeping this repository keeps
`release.yml`, the published tags and the notes as they stand: nothing is
re-prefixed, and no tag already out in the world changes meaning. The editor
arrives at an empty tag namespace and may spend `v*` on itself. The other
direction would have moved the release scheme out of the repository that
published the tags, which is the expensive half of that trade.

**`exchange/` goes with the editor, and its rule still reads correctly.**
[`exchange/README.md`](../exchange/README.md) puts the fixtures with the
**writer** and has the reader pin them, and says why it works: one party can
always be made to move, because the viewer gets an update. The writer is
[`src/data/app_package.ts`](../src/data/app_package.ts), which is the editor's,
and the reader is the Android app, which is nobody's here. Both halves of that
sentence survive the move unchanged, and the fixtures end up in the repository
whose code they describe — a small improvement on today. Two things to do on
the day rather than find out afterwards. That README's pinning instructions
name `Lautstark/vorlaut-diy-talker` as the submodule URL, and the viewer's pin
is a commit SHA into it; neither breaks, since this history is not rewritten,
but the pin **freezes** — the viewer cannot move forward without re-pointing at
`vorlaut-editor`, and against a filtered copy the new ids are not translations
of the old, so it is a fresh pin and not a bump. The cheapest moment is when
`exchange-v1.2.0` is finally cut, which is the thing that ends SHA-pinning
anyway
([`format-freeze.md` §5](format-freeze.md#5-the-android-viewers-pin-and-which-half-a-device-freeze-solves)).
The rule also does not stretch: should the device build ever read an `.obz`,
the device becomes a reader of a format whose fixtures live with the writer,
and the device is exactly the party
[ADR 0009](../adr/0009-device-interface-fixtures.md) says cannot be made to
move. That arrangement covers the app and does not cover the talker.

**`device/fixtures/` was the one thing the naming made worse, and it is
settled: the fixtures stay in `vorlaut-diy-talker`, and no fourth name is
needed.**
[`format-freeze.md` §6](format-freeze.md#6-testsreference-and-devicefixtures--the-boundary-is-real)
establishes that the two directories do not overlap and that `tests/reference/`
protects `src/` and goes with the editor. It also said `device/fixtures/`
"becomes the third repository", which was written when the third repository was
going to be the device format's; under these names the third one is the
explainer site, and there is no spare name. That sentence is now corrected in
place rather than reinterpreted.

~~The fixtures either sit in `vorlaut-diy-talker`, where one of the two halves
owns them and [ADR 0009](../adr/0009-device-interface-fixtures.md)'s whole point
is that neither should, or a fourth name is needed.~~ **That dilemma had a
premise that ADR 0011 removed**, and
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) adopts the answer.
ADR 0009's concern is an asymmetry with a specific shape: a format whose
fixtures live with the *writer* while the *reader* merely pins them puts the
authority on the side with nothing at stake, and the reader here is a talker on
a shelf that nobody can make move. After ADR 0011 the writer
([`loader/src/layout_format.ts`](../loader/src/layout_format.ts)) and the reader
([`firmware/`](../firmware/)) are **both** in `vorlaut-diy-talker`, and the
editor is not a party to the device format at all — it takes ten read-only names
out of `loader/`, calls `renderLayoutBin()` never, and writes no `layout.bin`.
So the fixtures sitting there does not put them with one of two halves; it puts
them with both, which is the arrangement they have today and the one ADR 0009
asked for. The ownership statement that matters is about a directory belonging
to neither `loader/` nor `firmware/`, and the split does not touch it, because
the split does not separate those two. A fourth repository would add a pin, a
tag and a version boundary to buy a property the directory already has.

`tests/reference/` still does not move as a unit. The locks divide the same way
and no more neatly:
`obf.lock.json` and `tts.lock.json` follow the converter and the recording
chain to the editor, `layout.lock.json` follows the writer it protects to the
device, and `tiles.lock.json` is awkward because the module under it is.
[`loader/src/tiles.ts`](../loader/src/tiles.ts) is not on one side — `renderSymbol()`
belongs to the device build, while `thumbnailSize()` is imported by
[`src/data/app_assets.ts`](../src/data/app_assets.ts) for the app package's
images, and the only reason that function is worth having is that it follows
Pillow's rounding step for step. Split the module and that rounding rule exists
twice with nothing holding the copies together, which is the failure
[`frozen-references.md`](frozen-references.md) exists to record.

**`tests/run.py` stays here whole, and that is the naming's other win.** It
compiles `firmware/vorlaut/*.h` and replays the browser's actual bytes into the
device's actual reader, and
[ADR 0006](../adr/0006-builder-and-hardware-one-repo.md)'s Why is that only one
repository can hold two implementations against each other. Under this
direction both implementations land in `vorlaut-diy-talker`: the C++ reader,
and the TypeScript writer, because the writer is the compiler and the compiler
goes with the device. That was a prediction when it was written and
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) makes it
a fact, before any repository moves: the compiler is the page, and the page is
the device's. `test_layout_frozen.py`, `test_cable_format.py`,
`test_texts.py`, `test_device_host.py` and `test_device_fixtures.py` all stay
beside the thing they compile. This was the reason the direction was chosen and
it is now the reason the split is safe:
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) claims no
evidence under ADR 0006's four conditions and does not need any, because the cut
does not run through what 0006 protects. The editor keeps `test_links.py` and
`test_language.py`, which are about a repository rather than about a format,
plus `test_exchange_fixtures.py`, which travels with `exchange/`. That is all
the Python it needs, and none of it needs a compiler: ADR 0006's
three-toolchain consequence unwinds for the editor and stands for the device.

**The seam the names describe is ~~not a directory yet~~ being made one, and
that is the whole of what changed.** "Whatever compiles a package into what the
talker reads" was `runBuild()`, at the foot of
[`src/backend/local.ts`](../src/backend/local.ts) — the same file that answers
the editor's questions, as its own opening comment says. The move is cheap
exactly when that boundary is a file format rather than a function call, and
the device-shaped `.obz` in the first bullet above is what makes it one: the
editor writes a package, the device's page compiles it, and the two are held
apart by fixtures instead of by an import.
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) is the
decision to do that, and it was done before the split rather than during it —
which is why [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) is a
directory moving out of a repository rather than a boundary invented under time
pressure. Still not a reason to hurry: a decided move with no date on it is what
this whole section is for.

---

## The wider family

A pointer rather than a chapter. Three other products in the same organisation
share the same four packages:
[`mitreden`](https://github.com/Lautstark/mitreden),
[`bildhaft`](https://github.com/Lautstark/bildhaft) and this one — which is
why a rule that exists twice is a rule that gets broken once, and why the
packages left in the first place. The shared conventions live in
[`conventions.md`](https://github.com/Lautstark/design/blob/main/docs/conventions.md)
in `Lautstark/design`, the same repository the tokens and `components.css` come
out of, and they are cited by paragraph rather than copied.

---

## Where the reasoning lives

Nothing above replaces these. Each one answers a question this page only names.

| | |
|---|---|
| [ADR 0004](../adr/0004-android-app-is-a-viewer.md) | Why the Android app imports and renders, and does not edit or export. |
| [ADR 0006](../adr/0006-builder-and-hardware-one-repo.md) | Why the builder and the firmware share a repository, and what would change that. |
| [ADR 0009](../adr/0009-device-interface-fixtures.md) | Why the device interface has fixtures of its own, owned by neither half. |
| [`device-interface.md`](device-interface.md) | What the interface actually consists of, measured. Its split question was asked with the direction reversed; read its status line first. |
| [ADR 0010](../adr/0010-device-shaped-obz-export.md) | Why the device build has an `.obz` export of its own, and why it is a third door. |
| [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) | Why the editor exports a file and stops, and why the page that sends it is the talker's. |
| [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) | Why this repository splits into three, why the editor is the half that leaves, and why 0006 is not superseded. |
| [`obz-as-device-input.md`](obz-as-device-input.md) | Whether the package could be the device build's input — yes — and what a compiler package would have cost. Half superseded; read its status line first. |
| [`format-freeze.md`](format-freeze.md) | What is still moving in the three formats, and what has to be true before a freeze. |
| [`exchange.md`](exchange.md) | The app package export: two doors rather than one, and why the licence makes that structural. |
| [`packages.md`](packages.md) | The four shared packages, how they are pinned, and what holds the pin honest. |
