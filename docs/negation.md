# Negation: crossing out a symbol

**Status: proposal, nothing built. 2026-08-25.** Written to be argued with.
Four of its five answers are recommendations somebody else can overturn without
touching the fifth; the last section says which decisions are not this
repository's to make.

## The question

German AAC negates by crossing out the symbol being negated. The picture stays
and takes a red cross, rather than being swapped for a different picture.
[`bildhaft`](https://github.com/Lautstark/bildhaft) does this and vorlaut has no
equivalent, so a carer who wants a negated word on a key has nothing to reach
for.

The data layer already does its share.
[`bildquelle`](https://github.com/Lautstark/bildquelle) keeps the negation word
out of its stopword lists on purpose — its own test says so in as many words,
that pronouns, prepositions and negation are the most-pressed keys there are.
What is missing is somewhere in vorlaut to put a negation, and a way to draw it.

## Why this cannot be a copy of bildhaft's

bildhaft never bakes. `negationCross()` in its `src/ui/logo.ts` returns an
`<svg>` laid over the picture at display time, positioned by one CSS rule that
serves both a 68px chip and a 40mm print card, and coloured `--danger` on
screen and a literal `#d32f2f` on paper. It costs nothing and travels nowhere:
that export carries no pixels at all.

vorlaut draws a symbol in four places, and they are not one problem.

| | what it is | what a cross costs there |
|---|---|---|
| `symbolInto()` — [`backend/local.ts`](../src/backend/local.ts) | an `<img>` on screen: the sheet's preview, a tablet cell, a talker key | an overlay, exactly as bildhaft does it |
| `previewInto()` — same file | the talker's life-size 128x128 preview, which runs the real tile pipeline | free, and correct — it is the tile |
| `renderSymbol()` — [`data/tiles.ts`](../src/data/tiles.ts) | 116x116 RGB565 written to the device | composited into a bitmap |
| `bakeImage()` — [`data/app_assets.ts`](../src/data/app_assets.ts) | a PNG member of an app package | composited into a bitmap |

And there is a fifth surface that has no pixels at all, which turns out to
decide most of this document. **The talker's own `.obz` export bakes nothing.**
`layoutToDocument()` in [`data/obf.ts`](../src/data/obf.ts) builds
`files: {}` and every image is a `symbol: {set, filename}` pair;
`checkLicensing()` stands at the one door to `writeObz()` to keep it that way.
So on that path there are no pixels to draw a cross into, and there never will
be.

That is the fact worth having before reading the rest: vorlaut does not have
one baked output and one declared output. It has **a path that can only bake
and a path that can only declare, and they are the same product.**

## 1. Where the flag lives

**Recommended: `negated?: boolean`, on `Slot` and on `AppButton` in
[`core/types.ts`](../src/core/types.ts), with the symbol reference left
untouched.**

The same name and the same shape bildhaft chose, and the same reasoning applies
here for a reason of vorlaut's own: `Slot.symbol` and `AppButton.symbol` share a
vocabulary on purpose — the doc comment on `AppButton.symbol` says so, "same
vocabulary as Slot.symbol, because it is the same picker behind it" — and a
negation is a property of the field, not of the picture in it. Storing it beside
the reference means switching symbol source keeps it, clearing the picture and
choosing another keeps it, and nothing anywhere has to hold a second, crossed
copy of a symbol.

Optional rather than required, and absent counts as false. That is the same
migration story `firstColumnGap` and `wordColor` already have on `AppLayout`,
and it is what makes §6 below possible: **a layout that has never been negated
serialises to exactly the bytes it serialises to now.**

**The editor destroys nothing.** Ticking the box writes one boolean; unticking
it writes the other. The cross is drawn at tile-build and at export and at no
other time, so a negation is reversible for as long as the Sammlung exists.
That matters more here than it looks: the sheet's rule is live-apply with no
Save, and the one control in this product that destroys something — the tablet
grid — is deliberately outside that rule. A negation belongs inside it.

## 2. The format

This is the hard one, and the three options in the brief do not survive contact
with the table above, because **the two halves of vorlaut answer it
differently and neither of them is free to choose.**

### The talker: declare, because there is nothing else on offer

The talker's `.obz` carries references. There are no pixels in it to cross. Bake
is not a worse option there, it is not an option: writing one would mean
attaching image files to that export, which is precisely the invariant
`checkLicensing()` exists to hold, and which [ADR
0001](../adr/0001-two-ext-namespaces.md) and the symbols-by-reference rule are
both built on.

So the talker's export gets a field, and **the field costs no specification
change at all.** `exchange/SPEC.md` governs `ext_lautstark_*`. ADR 0001 keeps
`ext_vorlaut_*` out of it deliberately — that namespace is the talker's, an app
importer treats it as any other vendor's extension and ignores it, and the three
fields already in it (`ext_vorlaut_color`, `ext_vorlaut_sleep_timeout_seconds`,
`ext_vorlaut_voice`) were never in the specification either.

`ext_vorlaut_negated: true` on the button, written only where it is true. §12's
versioning rules do not apply, because §12 versions a document this field is
not in.

### The tablet: both, with the redundancy made honest by naming what the field is not

An app package bakes pixels — [ADR
0003](../adr/0003-packages-bake-pixels.md), and
[SPEC.md §5](../exchange/SPEC.md#5-images-and-symbols) is unconditional about
it. A crossed button whose PNG is not crossed is a button the child sees
uncrossed, in the one room where nobody can correct it. So the pixels have to
carry the cross regardless of what else is decided. That is not a choice
between the three options; it is the floor under all of them.

The question is only whether the *fact* travels beside the pixels, and the
recommendation is that it should: **`ext_lautstark_negated`, a button
extension, minor bump to 1.2.0.**

Bake-only loses something real. A package that comes back cannot be
un-negated, no reader can search for negated buttons, no reader can caption
one to a screen reader, and vorlaut-app's warning list — whose ordering is
normative — has no way to say anything about a button whose picture disagrees
with its word. Declare-only is not available, per the paragraph above.

**Whether the redundancy is honest or a trap is decided by what the field is
allowed to mean, and the SPEC already has the right precedent.**
`ext_lautstark_first_column_gap` is documented as a hint about *drawing*: an
importer that ignores it renders a correct board with the wrong emphasis. A
negation field must be documented as the opposite kind of thing — **a statement
about pixels that are already there**, never an instruction to draw. Get that
wrong and the trap is immediate and silent: a viewer that learns the field and
draws its own cross double-crosses every package a conforming builder wrote.

So the words the specification needs are not "draw a cross" but something
closer to:

> `ext_lautstark_negated` · boolean · no, default `false` · The button's word is
> negated, and **the image already carries the negation mark.** A builder that
> writes `true` MUST have baked the mark into the image (§5). An importer MUST
> NOT draw a negation mark of its own on the strength of this field, and MUST
> NOT treat its absence as a claim that the image is unmarked. What it is for is
> everything other than drawing: accessible labels, search, and reporting. A
> value that is not a boolean MUST be treated as absent.

Under that wording the two can never disagree in a way that reaches a screen,
because only one of them is ever drawn. The field is then exactly as
round-trippable as bake-only is not, and costs a v1.1.0 reader nothing: §10.3
already has it ignoring unknown fields, and the shipped
[`vorlaut-app`](https://github.com/Lautstark/vorlaut-app) renders the crossed
PNG correctly today, knowing nothing.

One thing this does not need and should not have: a matching field on the
*image* entry. The negation is a property of the button, and an image member is
shared by content hash between every button using it — which is the next
section's problem, and putting the flag on the shared thing would make two
buttons with the same picture unable to disagree.

## 3. The talker forces the device half, and that is the whole of it

`firmware/` draws the coloured border and blits the tile. There is no negation
concept in it, this proposal does not ask for one, and it should not: the
tile is already the one place where the device is told what to show, and a
firmware that composited a mark would need the mark, a colour, an inset and a
version bump on the wire to say which tiles had been drawn the old way.

So for the DIY device, baking is the only option available, and the good news
is that the machinery is already in [`data/tiles.ts`](../src/data/tiles.ts) and
already frozen against an outside opinion. `placeholder()` draws a grey cross —
two thick diagonals — through `wideLinePolygon()` and `fillPolygon()`, which
reproduce Pillow's hard-edged quadrilateral fill step for step, "checked
against it for every width and inset the placeholder might use". A negation
cross is that function with a different colour, inset and width, applied after
`compose()` and before `toRgb565Be()`.

Deliberately **not** a canvas stroke. The comment above `wideLinePolygon()`
gives the reason and it applies unchanged: a canvas would antialias both
diagonals, so every pixel along them would depend on the engine. Hard-edged is
what makes a tile reproducible, and reproducibility is what
[`tests/reference/tiles.lock.json`](../tests/reference/tiles.lock.json) is
worth.

Two numbers, offered rather than settled — whoever builds this should hold a
board at arm's length before fixing them:

* **inset** `Math.floor(size / 10)`, against the placeholder's `size / 4`. The
  placeholder's cross marks an empty field, so it sits small and central; a
  negation crosses the whole picture and has to reach its corners.
* **width** 8 at 116px, against the placeholder's 4. bildhaft's stroke is 7 in
  a 100-unit box, and the device's cross has to survive being looked at across
  a room by somebody who is not reading.

**Colour: a literal, and it will shift.** `--danger` is a theme token and it is
a different value per product and per scheme — mitreden's light red is
`#ad332c` and its dark one `#f17265`. A baked pixel has no theme to ask, which
is the same problem bildhaft's print stylesheet already solved by dropping to a
literal `#d32f2f` for paper. Take that literal. Note what RGB565 then does to
it: five bits of red, six of green, five of blue, so the display shows
`#d02c28`. Nobody will see the difference and everybody will argue about it, so
it is written down here instead.

## 4. What the shared thing actually is

`negationCross()` is private to bildhaft. Two products drawing one convention
argues for `@lautstark/design`, which is where shared marks belong;
`bildquelle` is the data layer, and a cross over a chosen symbol is not a
lookup.

**But a single shared export cannot serve both, and pretending otherwise is how
the wrong thing gets shared.** bildhaft appends an SVG node and lets CSS size
and colour it. vorlaut needs integer polygon corners filled into an
`Uint8ClampedArray` with Pillow's rounding, because anything else moves pixels
that are frozen. Those are not two callers of one function; they are two
renderings of one decision.

**Recommended: what moves into `@lautstark/design` is the specification, not
the drawing.** Concretely, one small module exporting the geometry and the
colour as data — the two endpoints in a unit box, the stroke width as a
fraction of it, the inset, and the literal red for surfaces that have no theme
— plus the prose saying what the mark means and that a mark is laid over a
symbol rather than replacing it. bildhaft keeps its SVG builder and reads its
numbers from there; vorlaut writes a `negationCross()` of its own next to
`placeholder()` and reads the same numbers.

That is a smaller shared surface than a function and a more useful one. What
would actually drift between two products is the *convention* — how thick, how
far into the corners, which red, and whether it is a cross rather than a
diagonal bar. Sharing the numbers pins all of that. Sharing a DOM function
would pin none of it for vorlaut, because vorlaut could not call it.

`@lautstark/design` already ships in this shape, incidentally: `./tokens/*` are
data, and `./dialog` and `./menu` are behaviour. This is a `./marks` entry
beside the tokens.

## 5. Where somebody turns it on

**Recommended: in the picture column of the sheet, in `pick__acts`, beside
"own picture" and "remove picture".**

[`shell/sheet.ts`](../src/shell/sheet.ts) already draws that row and its own
comment names the slot exactly — the remove button sits "next to the other
thing that is done to the picture as a whole". A negation is a third such
thing, and it is the only one of the three that is a state rather than an act,
so it wants a checkbox rather than a button.

This placement answers the brief's worry about unbalancing the right column,
by not touching it. The button sheet's rows were just restructured so the act
is asked first and the rows that depend on it follow; a negation depends on
nothing in that column and nothing there depends on it. Putting it on the left
also gets both editors at once, which is the point of that seam: the talker key
sheet has exactly one row and would have been unbalanced by a second.

Two details worth copying from bildhaft's picker, both for stated reasons:

* **Hidden when there is no picture**, the way "remove picture" already is —
  there is nothing to cross, and a permanently dead control reads as broken.
* **It does not settle the sheet.** Ticking it redraws the preview and leaves
  the sheet open. Nothing is written until the confirming press, like every
  other field.

The preview needs the cross drawn over it, as an overlay — the same CSS rule
bildhaft has, on `pick__preview`. That is one of the four surfaces in the table
and the cheapest.

### The spoken text is a second decision, and the recommendation is to leave it alone

A crossed symbol should presumably say the negated phrase, and it is tempting
to have the builder compose one. **Do not.** German negation is not a prefix:
the negation word and the article-negating word are different words, which one
applies depends on what is being negated, and in a finite clause the word moves
to the end. A builder that prepended a token would be wrong often, and wrong
silently, on a tablet in a room.

The format already has the right mechanism and needs no new one. §7.2's
`vocalization` is what a button says when that differs from what it shows, and
`AppButton.vocalization` is already in the model — so on a tablet the author
simply types the negated phrase, and everything downstream works today.

The talker is the case that actually needs saying out loud. A `Slot` has one
text field, which is both what it says and the only text there is; the tile
shows the picture alone. So a crossed talker key with an unchanged text speaks
the un-negated word while showing the negated picture, and nothing will warn
anybody. **The note under the checkbox should say so** — that the picture is
crossed and the spoken word is not, and where to change it. On the talker sheet
that field is right there in the one row; on the tablet sheet it is the row
called `spokenRow`, which the hint can name.

Prefilling either field is the alternative and it is worse. It collides head-on
with the rule both editors already keep — fill a field that is still empty,
never write over one somebody typed — because by the time somebody ticks this
box the field is precisely the one that is not empty.

## 6. What must not move

[`frozen-references.md`](frozen-references.md) governs five lock files, and its
rule is one-directional: changes to the thing being checked never invalidate
the lock, and refreezing to make a red test green leaves the browser compared
against itself. Two of the five are in range here —
`tests/reference/tiles.lock.json` and `tests/reference/obf.lock.json` — and
neither has an oracle left to regenerate from. **A button that is not negated
must render byte-identical afterwards.**

The proposed shape avoids the un-negated path in three specific places, and
they are worth listing because two of them are easy to miss.

1. **`renderSymbol()` takes the flag as an option and returns before it
   matters.** `renderSymbol(source)` with no negation runs the identical
   statements it runs today — `sourcePixels`, `fillColour`, `thumbnailSize`,
   `compose`, `toRgb565Be` — and the cross is one guarded call between the last
   two. `TILE_PIPELINE` therefore does not bump. That number's whole job is to
   say the rendering changed, and every tile is named after it, so bumping it
   would refetch every tile on every device to no purpose. It stays at 2, and
   the lock stays green for the recorded set, which is exactly what a lock can
   still answer.
2. **`normalizeLayout()` whitelists slot fields, and must keep doing so
   conditionally.** It rebuilds each slot as `{text, symbol}` today, which
   means a `negated` field arriving from a foreign document is dropped — and
   `obf.lock.json` pins that behaviour on the import side. Adding it as a
   conditional key, present only when true, leaves an un-negated slot with
   byte-identical keys in byte-identical order. Adding it unconditionally as
   `negated: false` would change the shape of every layout this product has
   ever normalised, and turn the lock red for a reason that has nothing to do
   with negation.
3. **`ext_vorlaut_negated` is written only where it is true**, for the same
   reason, on the export side of the same lock.

If any of the three is built the unconditional way and a lock turns red, that
is a design fault in this shape rather than a lock to regenerate.

### The thing that will actually bite whoever builds it

**Three caches are keyed by the symbol reference alone, and negation has to
join every key.**

* `storeTile()`'s `drawn` map in `backend/local.ts` keys on the reference, so
  the same symbol on a negated and an un-negated key would render once and both
  keys would get whichever was reached first.
* The bake loop for app packages has the same shape and the same bug, keyed on
  `references(layout)`.
* `references()` and `symbolPlaces()` in
  [`data/app_package.ts`](../src/data/app_package.ts) return bare strings. They
  have to carry the flag, or the two loops above have nothing to key on.

The file names are safe and pleasantly so: a tile is `t<hash of its own
bytes>.bin` and an image member is `images/<digest>.png`, both content
addressed, so a crossed picture gets a distinct name automatically once the
bytes differ. The dedup keys are the only place where negation can be lost, and
it would be lost silently — the wrong tile, on a real device, with every test
green.

## The other option: a key of its own

METACOM ships a negation symbol as an ordinary file, so vorlaut has an option
bildhaft does not: express negation as *a key of its own* rather than as a mark
on another key. It works today. Somebody picks that symbol, types the word, and
nothing in this document gets built — no compositing, no format change, nothing
frozen disturbed.

**On the tablet it is not an evasion, it is probably the better design, and the
argument is composition.** A tablet Sammlung has a sentence bar and a first
column that persists across pages. One negation key in that column negates
*any* word on any page, at the cost of one cell out of sixty-six. The crossed-
symbol approach needs a crossed twin of every word somebody might want to
negate, each spending its own cell. `bildquelle`'s own test calls negation one
of the most-pressed keys there are — that is an argument for giving it a key,
not for scattering it across other keys.

**On the five-key talker it does not work at all**, and this is the part worth
being precise about rather than hand-waving. A set has four content keys. One
of them is a quarter of the vocabulary somebody can reach without switching
sets, which is already the harder objection. But the fatal one is that the
talker has no sentence bar: pressing a negation key and then a word produces
two separate utterances, not one negated phrase. The key would say the
negation word out loud and stop. A crossed key says the whole negated phrase in
one press, which is a different act, and it is the act somebody actually wants.

So the two mechanisms are not competing answers to one question. They are
affordable in exactly the places they are good:

* **tablet** — a key of its own, in the first column, is the recommended
  authoring advice, and crossing out is the fallback for a phrase that has to
  arrive in one press;
* **talker** — crossing out is the only thing that composes, and the four-key
  set is why.

Which is an argument for building this, and also an argument for building it
without hurrying the tablet half.

### One caution, so this is not read as more settled than it is

**Amended 2026-08-25.** This section originally said the file could not be
verified from here, because no copy of the collection is checked in — it is
licensed per installation and referenced by name, which is the whole `metacom:`
invariant. That was too weak. `bildquelle`'s own `src/metacom.ts` states it
outright: the negation symbol is filed under `nichtkein` in `Kleine_Worte`, the
German negation pair run together because a filename cannot hold the slash
between them, and 1.6.4 exists to split it so that searching either half
reaches it. vorlaut is on 1.6.4. So the symbol is there.

What survives of the caution is narrower and still worth keeping: the same
tests record a copy that files its negation under a different lemma and carries
the negation word only as a compound prefix — the case a real picker hit when
it filled up with compounds. Under ARASAAC the question is different again.

**So the key-of-its-own option depends on the reader's own licensed folder, and
the crossed-symbol option does not.** That is still not a reason to prefer
crossing out, and the real argument against it is elsewhere: a negation symbol
on its own key says the negation, and cannot say which word is being negated.
On a tablet the sentence bar joins the two. On a four-key talker nothing does.

## What needs a decision from somebody else

Four, in the order they block anything.

1. **The `@lautstark/design` entry.** §4 proposes shared numbers rather than a
   shared function, which means `~/Code/design` gains a module and bildhaft
   later reads its constants from it instead of its own. That is that
   repository's session and its own `main`; **this repository must not edit
   it.** Nothing here is blocked on it — vorlaut can carry the numbers locally
   and adopt the shared ones when they exist — but doing it in that order means
   the convention is pinned in one product before it is pinned in two, which is
   how the numbers drift.

2. **The specification bump.** §2 proposes `ext_lautstark_negated` as a button
   extension at 1.2.0, with wording that forbids an importer drawing anything.
   Proposing a version bump is not making one, and
   [`exchange/SPEC.md`](../exchange/SPEC.md) is unchanged by this document. §13
   makes fixtures normative over prose, so the bump owes a fixture and an
   `.expected.json` before it means anything, and §12 makes it a minor because a
   1.1.0 importer ignoring the field renders a correctly crossed board.

3. **Whether the tablet gets the mark at all in the first pass.** The talker
   needs it and has no alternative. The tablet has a genuinely better answer
   available for most cases, and the tablet half is what carries the whole
   specification cost. Building the talker half alone is coherent, ships
   something useful, and leaves item 2 unspent. The counter-argument is that a
   feature present in one editor and absent in the other is the kind of
   asymmetry somebody has to be told about, and this product has two editors
   precisely so that each can answer its own device.

4. **`vorlaut-app`.** Nothing is asked of it — a crossed PNG renders correctly
   today with no change, which is the point of baking. If item 2 lands, the
   field becomes available to its warning list and its accessible labels, in
   its own session, in its own repository, whenever that is worth doing.
