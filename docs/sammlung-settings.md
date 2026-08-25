# Proposal: a Sammlung's own settings, and where they live

**Status: a proposal. Nothing here is built.** Written 2026-08-25, alongside
the fix that split the page's language from the Sammlung's — see
[languages.md](languages.md). It moves things between two surfaces the family
has rules about, so it is written down rather than done.

## The question

A Sammlung's own settings — the language its device shows its menu in, and
which talker it goes to — should be reachable from that Sammlung's `⋯` rather
than from the page-wide Einstellungen.

## What is in the settings sheet today, by scope

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

Three things in that column are the Sammlung's, and one of them is not a
setting at all.

## What I propose

1. **Move the Sammlung's language and the voice** out of Einstellungen. Both
   are `layout.json` fields, both travel in an export, and both are different
   from one Sammlung to the next.
2. **Move the build-to-a-folder button into the `⋯` itself**, beside the two
   exports rather than into any settings surface. It is an act on one
   particular Sammlung, which is what §3.6 says the menu holds — and the panel
   comment already argues it is a third kind of export, distinct from the `.obz`
   and from a Sicherung.
3. **Leave the connect button in Einstellungen**, as what remains of the Device panel,
   renamed to say so. A granted port is this browser's, held once, and used by
   whichever Sammlung is released next; it is not a property of any of them.
4. **Leave everything else where it is.** Einstellungen then says one thing
   only: what this installation and this browser are set to.

## What the surface looks like

One entry in the `⋯`, below the exports and above the delete, opening a sheet
built the way §3.5 says: a column of folded panels, one open at a time, each
stating its state in its heading.

**The mechanism already exists, and so does the precedent.** `editor-app`
registers a Sammlung-wide entry through `collectionMenuExtras()` — `ui.app_grid`,
the card holding the grid size, the first column and a word class's colour. A
tablet Sammlung has had settings behind its `⋯` for as long as that card has
existed. The shell does not need to know what is in the sheet; the editor on
screen says.

Live-apply and no Save, as on the settings sheet — except where a change
destroys something. The grid card asks before shrinking because buttons are
lost; a language and a voice lose nothing and should not ask.

## Does a tablet Sammlung have one?

**Yes, and this is where I would push back on the ask.** For an app package,
`layout.language` *is* the `locale`, and `localeFor()` in
[`src/data/app_package.ts`](../src/data/app_package.ts) is explicit that
`locale` — not the stored voice name — is what actually picks a voice on
Android. A DIY-only surface would leave that field permanently at whatever the
page's language happened to be when the Sammlung was made, with nowhere to
correct it.

So both targets have one, holding what applies to each:

* **DIY** — the language of the device's menu, the voice.
* **Tablet** — the language, the voice, and what the grid card already holds
  (either as a panel in the same sheet, or left as its own entry).

## What needs the family's word before any of this is built

1. **§3.6 says the `⋯` holds what *acts* on the Sammlung** — export, then
   delete. A settings surface is not an act, and the tablet's grid entry has
   already stretched this without the document noticing. Either §3.6 gains a
   sentence about a Sammlung's own settings living there too, or this drifts
   the way §3.2 warns about.
2. **§3.2 comes out stronger, not weaker.** The rule is arbitrary by its own
   admission, and mitreden's objection to the foot of the sidebar is that a
   setting down at the list suggests it changes something about the list.
   Today it does: the sheet at the foot of the list holds the open Sammlung's
   voice and its device language. After this it holds nothing of the kind, and
   the objection stops applying. That is worth recording as an argument *for*
   §3.2 rather than as a cost of this change.
3. **§3.5 carries over unchanged** to the new sheet. The panel is the component
   vorlaut contributed to the shared layer; a second sheet in the same product
   hand-rolling something else would be the exact failure §3.6 describes.

## The cost somebody should weigh: the voice

Moving the voice separates the chooser from the two things that stock it. The
Azure key and the offer to fetch the offline voices are installation-scoped and
stay in Einstellungen, and `saveAzure()` deliberately keeps its sheet open so
that the refreshed list is on the screen the question was asked from. That
stops working when the list is in another sheet.

Three ways out: move it and accept the round trip; leave the voice behind and
accept that one Sammlung-scoped setting sits among the installation's; or move
the Azure panel too, which breaks the rule this whole proposal rests on.

**My recommendation is the first.** What this Sammlung sounds like is changed
per Sammlung and often; an Azure key is set once, if ever. The rare errand is
the one that should cost a second sheet.
