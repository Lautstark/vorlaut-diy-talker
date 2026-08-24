# ADR 0005 — OBF/OBZ is the exchange format, extended with `ext_lautstark_*`

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** SPEC.md 1.0.0

## Context

Something has to carry a board from the builder to the Android viewer. The
obvious cheap answer is a private format: the builder already has an internal
board model, and serialising it as JSON in a ZIP would have taken an afternoon
and fit exactly, with no fields left over and none missing.

The alternative is [Open Board Format][obf] 0.1 — `.obf` for one board, `.obz`
for a ZIP of boards plus their media. It is the only interchange format the AAC
world actually has. It is also, by our standards, loose: images may be
references, sounds are optional, grids are advisory, and it has no notion of a
*package* at all — it identifies boards.

[obf]: https://www.openboardformat.org/

Neither is a clean fit. A private format fits the code and nothing else; OBF
fits the world and not the code.

## Decision

**A Lautstark Board Package is a constrained profile of OBF 0.1, distributed as
`.obz`. Where the profile needs something OBF cannot say, it says it in a
`ext_lautstark_*` extension field — and nowhere else.**

- The container is a ZIP with the extension `.obz` and a `manifest.json`, per
  OBF.
- The profile is *narrower* than OBF, never wider: every constraint in SPEC.md
  either forbids something OBF permits or requires something OBF makes optional.
  A Lautstark Board Package is always a valid `.obz`.
- Exactly nine `ext_lautstark_*` fields exist in v1, seven of them in the
  manifest. Anything else beginning `ext_lautstark_` is not part of v1 and MUST
  be ignored.
- Every extension field has to earn its place by naming what OBF cannot express.
  SPEC.md §4 carries that justification per field, in the table, as a column.
- Twelve conformance fixtures ship with the specification and are **normative
  where they and the prose disagree.**

## Why

**A format the world already reads is worth an imperfect fit.** Someone else's
board can be opened here, and a board built here is not a hostage. That is not
hypothetical comfort: this is a project by one person for one child, and the
single most likely future is that it stops being maintained. A private format
would take every board built with it into the grave. An `.obz` outlives the
tool.

**Constraining beats inventing.** Every rule in the profile — pixels baked, one
symbol source, a duration cap, a decompression cap — is a rule we would have had
to invent and write down anyway. Writing them as restrictions on a known format
means each one is a sentence rather than a schema, and a reader who knows OBF
already knows most of the document.

**The gaps are real, few, and specific.** OBF genuinely cannot say: which
package this is (it identifies boards, not packages), when it was modified
(there is no timestamp anywhere), where the symbols came from, whether the
bytes may be passed on, or that a button should speak at once rather than
appending to the message bar. Those are the extensions. They are not
conveniences; each one is a thing the viewer cannot work without and OBF has no
word for.

**An extension namespace is the mechanism OBF offers.** `ext_*` is defined by
OBF precisely so that a profile can carry what it needs while remaining
readable by tools that do not know about it. Another reader of our packages
sees a valid `.obz` with some fields it ignores — which is exactly the intended
outcome.

**Fixtures over prose, where they disagree.** A specification meant to be
implemented in Kotlin by someone who is not in the room needs an oracle that
cannot be misread. Twelve archives with twelve expected results settle in bytes
what a paragraph can only assert. They are byte-reproducible on purpose:
deflate from stored blocks rather than zlib, images and audio as committed
assets, held in place by `tests/test_exchange_fixtures.py`.

## Consequences

- The viewer must handle OBF shapes that our builder never writes — `data_url`
  images, absent grids, unknown `ext_` fields — because a package can be
  hand-made or come from elsewhere. SPEC.md says what to do with each, and the
  fixtures cover them.
- Some OBF features are refused rather than half-supported: reference-only
  images ([ADR 0003](0003-packages-bake-pixels.md)), `+text` spelling buttons,
  `description_html`. Each is listed in SPEC.md §1 and §13 by name, so that it
  is *undefined on purpose* rather than merely undefined.
- `ext_lautstark_*` and `ext_vorlaut_*` are deliberately separate namespaces and
  are not to be unified. See [ADR 0001](0001-two-ext-namespaces.md).
- Adding a tenth extension field is a spec change with a version bump, not an
  implementation detail. The "anything else MUST be ignored" rule is what makes
  that safe.
- **The version is not tagged.** SPEC.md is 1.0.0 in status *draft, not
  ratified*, and no `exchange-v1.0.0` tag is cut until a real board has been
  built, exported and opened on a tablet. A specification ratified before
  anything implemented it is a specification ratified against nothing.

## Not to be "fixed" later

The pressure on this one runs in both directions, and both should be resisted.

Inward: some viewer feature will want a field, and `ext_lautstark_` will look
like a free-form bag to put it in. It is not. Nine fields, each with a written
reason it could not be said in OBF, and a tenth needs the same argument made in
public.

Outward: the profile's restrictions will look like gaps in OBF support, and
someone will widen them for compatibility with a tool we do not have. Being a
strict subset is the property that makes this format implementable by one person
in a language none of the rest of this repository is written in.
