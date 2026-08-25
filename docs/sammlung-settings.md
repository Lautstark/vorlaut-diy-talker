# A Sammlung's own settings, and where they live

**Status: decided and built, 2026-08-25.** This was a proposal; it was read,
four of its answers were changed, and the result is in the page. What follows
is the decision, with the proposal's reasoning kept where it still holds and
struck through in words where it does not — a document that goes on describing
a design nobody built is worse than no document.

Written alongside the fix that split the page's language from the Sammlung's —
see [languages.md](languages.md).

## The problem

`chooseVoice()` in [`src/shell/voices.ts`](../src/shell/voices.ts) is two
lines: write `state.layout.voice`, save. That writes the **open Sammlung's**
`layout.json`, and the hint under the list says what it costs — every recording
spoken again on the next release. The control sat in the sheet at the foot of
the sidebar, where everything else is about this browser or this machine. Open
a different Sammlung, reopen Einstellungen, and the panel showed a different
answer, because it was reading a different file.

A settings panel whose value depends on which item in the list is selected is
not a setting of the app.

The family had already settled the shape and vorlaut was the outlier. In
mitreden, `settings.voice` is the voice the *next* sentence gets; each sentence
carries its own and keeps it (`src/db/backup.ts` — "the voice choice travels").
So mitreden's settings control is honestly a default applying forward.
vorlaut's was a live retroactive edit wearing the same clothes.

## What was in the settings sheet, by scope

| Panel | What it sets | Where it is kept | Whose it is |
| --- | --- | --- | --- |
| Language | the page's labels | `localStorage` | this browser |
| Appearance | the colour scheme | `localStorage` | this browser |
| Voice | `layout.voice` | `layout.json` | **this Sammlung** |
| Azure | the key and region | the installation's `.env` | this installation |
| ARASAAC / METACOM | the active source, the folder, the rendering | settings + a folder handle | this installation |
| Collection | importing a board | nothing — it is the way *in* | page-wide |
| Language of the collection | `layout.language` | `layout.json` | **this Sammlung** |
| Device, connect | a granted serial port | the browser's permission | this browser |
| Device, build and write | builds *this* Sammlung's files | nothing — it is an act | **this Sammlung** |
| Data | the Sicherung and its folder | `localStorage` + a handle | this browser |

Three things in that column were the Sammlung's, and one of them was not a
setting at all.

## What was built

One entry in the `⋯` beside the Sammlung's name, below the acts and above the
delete, opening a sheet built the way §3.5 says: folded panels, one open at a
time through `name="collection"`, each stating its state in its heading. Live
apply, no Save, no Cancel — a language and a voice destroy nothing.

* **A talker Sammlung's sheet** — the language its device shows its own menu
  in, and the voice.
* **A tablet Sammlung's sheet** — the voice. Its grid card is its own entry in
  the same menu; see [amendment 1](#1-the-sammlungs-language-is-diy-only) and
  [the note on the grid card](#the-grid-card-stayed-its-own-entry).

Einstellungen now says one thing only: what this installation and this browser
are set to.

## The four amendments

### 1. The Sammlung's language is DIY-only

The proposal argued tablets need it too, citing `localeFor()` in
[`src/data/app_package.ts`](../src/data/app_package.ts). That reads the other
way. `localeFor()` derives the locale from the **voice** first —
`azure:de-DE-KatjaNeural` → `de-DE` — and falls back to `layout.language` only
when the voice name carries no usable tag. Its own comment is explicit that the
voice is the better evidence, because somebody chose it for these sentences.
So a tablet Sammlung's language field is nearly vestigial, and a control with
nothing downstream of it is worse than an absent one.

`openCollectionSettings()` hides the panel outright on an app Sammlung rather
than drawing it disabled or explaining itself — the same answer the Device
panel and the backup folder give a browser that cannot do the thing.

### 2. The voice panel split rather than moved

The proposal weighed three ways out and recommended moving it whole, accepting
a round trip to Einstellungen after an Azure key change. There is a fourth, and
the reason matters: `voiceOffer` — the offer to fetch the offline voices — sat
*inside* `voicePanel`. Downloading a voice installs it for every Sammlung.
Moving the panel whole would have put an installation-scoped download, progress
and all, inside a per-child sheet — the same scope mismatch this work exists to
remove, reversed.

So it was cut where its content already splits:

* **the Sammlung's sheet** answers *which voice this one speaks in*, choosing
  from what is available;
* **Einstellungen** keeps *which voices this machine has* — the Azure key, the
  fetch, the offer, under a heading that says so (`ui.voices_here`) with the
  count as its state line.

The round-trip objection dissolves as a side effect, because the key and the
list it stocks never came apart. What is left of it is one sentence: when the
Sammlung's list is empty there is nothing to choose between, so the hint under
it names the door (`ui.voice_none_where`) instead of leaving somebody in front
of a search field with no voices behind it.

### 3. No "default voice/language" setting in Einstellungen

A deferred, invisible default is the same shape as the bug `920ae21` removed:
one control whose effect appears somewhere else, later, unseen. The question is
asked where it is decided instead — the create-a-Sammlung dialog in
[`src/shell/collections.ts`](../src/shell/collections.ts) gained a
device-language field for the talker, pre-filled from the page's language. That
dialog already asks the target and already asks grid size only for a tablet, so
a target-conditional question is the shape it already had.

The voice is deliberately **not** asked at creation: `950343f` gives it a
sensible automatic starting point, and the Sammlung's own sheet is where it
changes.

One thing fell out of building this. `.sizeask` carries `display: grid`, which
is an author rule and beats the user agent's `[hidden]` — so `sizes.hidden =
true` had never hidden anything, and the grid question had been sitting under
the talker choice offering to size a board with no grid. `.sizeask[hidden] {
display: none; }` is the fix, and the new e2e test asserts visibility rather
than the attribute, because the attribute was correct the whole time.

### 4. The connect button: it no longer earns a panel

The proposal kept it in Einstellungen as what remains of the Device panel,
renamed to say so. Asked properly, the answer is weaker than that.

* [`src/editor-diy/release.ts`](../src/editor-diy/release.ts) already offers a
  connect button *inside the release dialog* at the step where it finds it has
  no port — with the words about what is about to be written already read.
* [`src/editor-diy/device.ts`](../src/editor-diy/device.ts) opens with "One
  explicit connect the first time, and silent reconnect for ever after" via
  `getPorts()`.
* The build-to-a-folder act needs no port at all, and it has moved out.

So the Einstellungen button's only remaining job is granting **ahead of time**,
for a flow that grants on demand and explains itself better when it does.

**Proposed: remove the Device panel from Einstellungen.** Not done here — that
is a fifth decision about what Einstellungen is for, and it was not this
change's to make. The panel stays, minus its build half, with the question
written at the head of
[`src/editor-diy/device_panel.ts`](../src/editor-diy/device_panel.ts).

The one thing that would go with it: choosing a *different* port after a change
of cable. The transfer sheet never asks again once a port is granted, so
whoever answers this should decide where that lands — a "use a different port"
step inside the transfer sheet is the obvious home, and it would be better
placed there anyway, beside the transfer it is about.

## What the proposal got right and stands

1. **The build-to-a-folder button moved into the `⋯` itself**, beside the two
   exports, because it is an act on one Sammlung rather than a setting — and
   the panel comment already argued it is a third kind of export, distinct from
   the `.obz` and from a Sicherung. It reports through the page's status line
   now: the menu it was pressed in has closed by the time it has anything to
   say, so there is no heading left to write under.
2. **§3.5's folded panels**, one open at a time, each stating its state in its
   heading. The panel is the component vorlaut contributed to the shared layer;
   a second sheet in the same product hand-rolling something else would be the
   exact failure §3.6 describes.
3. **Live apply with no Save.** The one control on a Sammlung that destroys
   something — the tablet's grid, which throws buttons away when it shrinks —
   asks before it acts and is not in this sheet.
4. **`collectionMenuExtras()` is the mechanism**, already carrying the tablet's
   grid card, and now carrying the talker's build as well.

### The grid card stayed its own entry

The proposal offered "either as a panel in the same sheet, or left as its own
entry", and the amendments read as the first. It is the second, for two
reasons worth recording rather than discovering again:

* The card is not live-apply and cannot be. Shrinking a grid throws buttons
  away, so it has a footer button that turns destructive and names what it
  costs. Folding that into a sheet whose whole rule is "everything here applies
  when you touch it" would put the one exception inside the rule.
* It is `editor-app`'s, and a tablet Sammlung's ⋯ reads honestly either way:
  the grid card, then this Sammlung's settings, then the delete.

So a tablet Sammlung's settings are the voice *and* the grid card, at the level
of the menu rather than of one sheet.

## What the family still has to say

### §3.6 needs a sentence

**§3.6 says the `⋯` holds what *acts* on a Sammlung** — export, then delete.
After this it also holds that Sammlung's own settings, and the tablet's grid
card had already stretched it without the document noticing.

The sentence it needs, offered for whoever edits `~/Code/design` (its own
session, its own main — **this repository must not edit it**):

> The `⋯` beside a Sammlung's name holds what is true of that one Sammlung:
> what acts on it, and what it is set to. Both belong there for the same
> reason — a control in a list of five can never say which one it means, and
> beside the name there is no question.

### §3.2 comes out stronger, not weaker

The rule is arbitrary by its own admission, and mitreden's objection to the
foot of the sidebar is that a setting down at the list suggests it changes
something about the list. It used to: the sheet at the foot of the list held
the open Sammlung's voice and its device language. It no longer holds anything
of the kind, and the objection stops applying. That is worth recording as an
argument *for* §3.2 rather than as a cost of this change.

## Leftovers, named rather than done

* **The Einstellungen dialog is still `#voices`.** The id is from when the
  sheet was mostly a voice list. Renaming it touches every e2e spec that opens
  Einstellungen, which is the shape of a mechanical repo-wide edit — its own
  session on `main`, per CLAUDE.md rule 3, not a feature branch.
* **`ui.build_note` was removed**, having lost its reader when the build button
  became a menu entry. What it explained — that a folder full of build files is
  the way in that stays open when the cable is what is wrong — is in
  `buildToFolder()`'s comment and in [cable.md](cable.md).
