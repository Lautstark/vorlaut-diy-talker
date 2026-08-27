# A Sammlung's own settings, and where they live

**Status: decided and built, 2026-08-25; amended 2026-08-26.** This was a
proposal; it was read, four of its answers were changed, and the result is in
the page. The fifth question it raised — whether the Device panel still earns
its place — was answered the same day, and it does not; see
[amendment 4](#4-the-connect-button-it-no-longer-earns-a-panel--and-the-panel-is-gone).
The one question this document left open rather than answered — where the
tablet's grid card goes — was closed on 2026-08-26 in favour of the first of
the two readings it offered: see
[amendment 5](#5-the-grid-card-became-a-panel-after-all). What follows is the
decision, with the proposal's reasoning kept where it still holds and struck
through in words where it does not — a document that goes on describing a
design nobody built is worse than no document.

Written alongside the fix that split the page's language from the Sammlung's —
see [languages.md](languages.md).

## The problem

`chooseVoice()` in [`src/shell/voices.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/shell/voices.ts) is two
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
| ARASAAC / METACOM | the active source, the folder, the rendering | settings + a folder handle | this installation — but see [the symbol source](#the-symbol-source-was-the-same-question) |
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
apply, no Save, no Cancel — a language and a voice destroy nothing. ~~That is
the whole rule of the sheet;~~ that is the rule of every panel on the sheet but
one, and the exception arrived with the grid — see
[amendment 5](#5-the-grid-card-became-a-panel-after-all).

* **A talker Sammlung's sheet** — the language its device shows its own menu
  in, and the voice.
* **A tablet Sammlung's sheet** — the grid and the voice. The grid arrived in
  it a day later; see [amendment 1](#1-the-sammlungs-language-is-diy-only) for
  why the language is not there and
  [amendment 5](#5-the-grid-card-became-a-panel-after-all) for why the grid is.

Each target's sheet is the same two questions in the same order: the one panel
only this kind of Sammlung has an answer for, then the voice, which both have.
The first one there is the one open on arrival.

Einstellungen now says one thing only: what this installation and this browser
are set to — and after amendment 4 was answered, it holds nothing about a cable
either.

## The amendments

### 1. The Sammlung's language is DIY-only

The proposal argued tablets need it too, citing `localeFor()` in
[`src/data/app_package.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/app_package.ts). That reads the other
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
[`src/shell/collections.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/shell/collections.ts) gained a
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

### 4. The connect button: it no longer earns a panel — and the panel is gone

The proposal kept it in Einstellungen as what remains of the Device panel,
renamed to say so. Asked properly, the answer is weaker than that.

* `src/editor-diy/release.ts` already offered a
  connect button *inside the release dialog* at the step where it finds it has
  no port — with the words about what is about to be written already read.
* [`loader/src/device.ts`](../loader/src/device.ts) opens with "One
  explicit connect the first time, and silent reconnect for ever after" via
  `getPorts()`.
* The build-to-a-folder act needs no port at all, and it has moved out.

So the Einstellungen button's only remaining job is granting **ahead of time**,
for a flow that grants on demand and explains itself better when it does.

This was raised as a proposal rather than built, because it is a fifth decision
about what Einstellungen is for. **It was answered on 2026-08-25: the panel
goes.** Einstellungen now carries nothing about a cable at all.

The one thing that went with it: choosing a *different* port while a granted
one still enumerates — a talker swapped for a second one, or a port granted for
something that is not a talker at all. Named rather than pretended away, and
the recovery is one press rather than a page reload:

1. the transfer runs against the stale port, `findTalker()` opens it, gets no
   `hello`, and throws `cable_no_device`;
2. `release.ts` sets `askAgain`, and `err.cable_no_device` already tells the
   reader in as many words — "the next press will ask for the port again";
3. the next press is back at the step with the chooser on it.

So it costs an attempt, and the sheet says why while it is costing it. That is
better than a panel somebody has to know to visit: the failure is the moment
the question becomes worth asking. `e2e/loader.spec.ts` pins the whole loop,
sentence included — on the loader page rather than in a sheet, since
[adr/0011](../adr/0011-editor-exports-the-talker-repository-sends.md), and the paragraph below
about what an attempt costs went with the build it was about.

**What that attempt costs is a build, and it is not free.** `run()` builds and
then sends, so the press that discovers a dead port has already paid for every
synthesis in it — one wasted build, then the chooser, then a second. The panel
was the way to skip that for somebody who knew to look, so removing it makes
this the only path rather than the usual one.

This amendment proposed the fix and left it unbuilt: probing at the top of
`run()`, as open, hello, **close**, build, open again — holding the cable open
across the build being ruled out already, since the device ends a session after
`CABLE_QUIET_MS` — four seconds — of browser silence.

**That was taken up on 2026-08-25 and the answer is no.** The second greeting
on the good path is not the small price this paragraph assumed. `hello` makes
the device put *Kabel* on all five displays and stop answering keys, and
closing the port does not take it back — it waits out its four seconds, then
delays 1500 ms before redrawing. A probe on every press is roughly five and a
half seconds of a dead talker each time, to save one build on the rare press
where the port was wrong. [cable.md](cable.md) carries the reasoning and what
would make it cheap, which is a firmware change rather than a page one. So the
cost recorded above stands, and `askAgain` remains the way back.

What was left of the module is the build, so it is named for it:
`src/editor-diy/device_panel.ts` → `folder_build.ts`. Two things went with the
panel because they had exactly one user each — `onPaintPanels()` in
`shell/settings.ts`, the hook that let a panel wired outside that file join a
language switch, and `onDevices()` in `editor-diy/device.ts`, which told a
panel the port list had moved. Nothing is on screen waiting to be told any
more. Both are four lines to bring back and the reason each existed is recorded
where it stood.

### 5. The grid card became a panel after all

The proposal offered "either as a panel in the same sheet, or left as its own
entry" and did not choose. It was built as its own entry, and the reasoning is
[below](#the-grid-card-stayed-its-own-entry) with the rest of what stands,
because at the time it did. **On 2026-08-26 it was reversed:** the grid is a
panel of the Sammlung's sheet, `ui.app_grid` is no longer an entry in the `⋯`,
and a tablet's menu is now its settings and its delete.

What settled it is the thing neither reading had said out loud. Both entries
answered *what is this Sammlung set to* — one of them for the grid, one for
everything else — and they sat one line apart in the same menu. A person
looking for the size of a page has no way to know which of the two doors is
the one, and the cost of guessing wrong is a whole sheet opened and closed.
Two doors to one question is worse than one door with two rules behind it.

The two reasons the entry was kept, answered:

* **"The card is not live-apply and cannot be, and folding it into a sheet
  whose whole rule is *everything here applies when you touch it* would put
  the one exception inside the rule."** It would, and that is the right place
  for it. The settings sheet at the foot of the sidebar has carried exactly
  this exception since it was built: an Azure key must not be written on every
  keystroke, so its Save is *inside its panel*, and the sheet has none. The
  grid takes the same shape — its button is the last thing in its panel, it
  names the act rather than saying "Save", and it turns destructive exactly
  when the press would be. Nothing about the two live panels changed, and
  neither of them grew a button. The exception is legible because it is
  written where it applies; a Save on the dialog is what would have made the
  voice and the language lie about when they take effect.
* **"It is `editor-app`'s, and a tablet Sammlung's `⋯` reads honestly either
  way."** Honestly, but not accurately: the grid was the one entry in a menu
  of acts that was a setting, which is the stretch
  [§3.6 needs a sentence](#36-needs-a-sentence) was written about. The layer
  objection underneath it is real and is answered the same way the menu itself
  already answered it — the editor hands the panel in.
  `collectionSheetPanel()` in [`src/shell/voices.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/shell/voices.ts)
  is `collectionMenuExtras()` one floor along: the shell owns an empty
  `<details>` in the sheet's markup, hands the editor its body and a way to
  write its heading, and hides it when no editor registered one. So the shell
  still cannot count what falls outside a smaller grid, which is
  `editor-app/pages.ts`'s work and stayed there.

Three things came out of the move and are worth knowing:

* **The heading states the size the Sammlung *is* at**, which is what §3.5
  asks of a panel — and deliberately not the size that is pending. Which size
  is picked is said where it is picked, by the pressed option; what pressing
  would cost is said by the notice between them.
* **There is no Cancel.** The card had one because it was a dialog. What is
  pending lives in the panel's closure and nowhere else, so closing the sheet
  is how it is declined, and the ✕ is the only way out any of these panels
  has.
* **Applying does not close the sheet.** A panel that took effect is not a
  reason to leave one — the Azure key's Save does not close Einstellungen
  either — so the panel is redrawn against what it has just written: the
  heading takes the new size, and the sentence that counted what would go has
  nothing left to count.

`e2e/editor_app.spec.ts` moved with it and is the test that matters here: the
grid still grows in silence, still asks before it shrinks, and the sheet still
has no Save.

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
   asks before it acts, ~~and is not in this sheet~~ and is in this sheet now
   with its question intact and its button inside its own panel; see
   [amendment 5](#5-the-grid-card-became-a-panel-after-all). The sheet itself
   still has no Save and no Cancel.
4. **`collectionMenuExtras()` is the mechanism**, ~~already carrying the
   tablet's grid card, and now~~ carrying the talker's build. The tablet's grid
   went through it too until amendment 5 gave the sheet a hand-over of its own;
   what is left in the menu is acts, which is what the menu is for, and
   `editor-diy/folder_build.ts` was its one caller.

### The grid card stayed its own entry

**Superseded on 2026-08-26 by
[amendment 5](#5-the-grid-card-became-a-panel-after-all), which answers both
bullets.** Kept because the reasoning is what the reversal had to argue
against, and a decision whose first answer has been deleted is one somebody
makes again.

The proposal offered "either as a panel in the same sheet, or left as its own
entry", and the amendments read as the first. It ~~is~~ was the second, for two
reasons worth recording rather than discovering again:

* The card is not live-apply and cannot be. Shrinking a grid throws buttons
  away, so it has a footer button that turns destructive and names what it
  costs. Folding that into a sheet whose whole rule is "everything here applies
  when you touch it" would put the one exception inside the rule.
* It is `editor-app`'s, and a tablet Sammlung's ⋯ reads honestly either way:
  the grid card, then this Sammlung's settings, then the delete.

~~So a tablet Sammlung's settings are the voice *and* the grid card, at the
level of the menu rather than of one sheet.~~ They are the voice and the grid,
in one sheet, and the menu is acts and the delete.

## The symbol source was the same question

Found afterwards, in the same shape and with a licence behind it rather than a
preference: **which symbol collection the picture column searches** was read off
`symbols.activeSource()`, a setting of this browser. exchange/SPEC.md §5.1 makes
one symbol source per package a rule of the format — a METACOM symbol stays a
`metacom:` reference into somebody's own licensed folder, and the package's
`redistributable` flag turns on which collection it drew from. So the answer
changes with the selection, which by this document's own test makes it not the
app's.

It is now the Sammlung's, and it is **derived rather than chosen**: the same
`symbolSource(layout)` the export reads, off the buttons. That is why there is
no panel for it in the Sammlung's own sheet and should not be — a toggle would
invite flipping it, and flipping it means replacing every symbol on the board.
That is a deliberate act, not a preference, and nobody has asked for one. The
METACOM *rendering* stays a machine-wide default for the same reason from the
other end: a pick already stores `metacom:PNG_ohne_Rahmen/ja`, so each button
records its own and `preferredRendering` is only the default for the next pick.

Three consequences worth naming:

* A Sammlung with no symbols yet, or with nothing but uploaded pictures, reads
  as `"none"` and defers to the machine setting. `"none"` is the value that says
  no attribution is owed, not a source to be locked to.
* When the Sammlung needs METACOM and the folder is not connected in this
  browser — the ordinary state on Chromium after a restart — the column says so
  (`ui.metacom_needed`) instead of quietly answering out of ARASAAC. Silently
  serving the other collection is exactly how the mixed board got built.
* The refusal at export moved to the head of the run. See
  [exchange.md](exchange.md#pictures).

## What the family still has to say

### §3.6 needs a sentence

**§3.6 says the `⋯` holds what *acts* on a Sammlung** — export, then delete.
After this it also holds that Sammlung's own settings, and the tablet's grid
card had already stretched it without the document noticing. Amendment 5 took
the grid card back out — so what needs the sentence is one entry rather than
two, and the sentence is the same one.

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
