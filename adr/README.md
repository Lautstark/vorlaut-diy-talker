# Decisions

Decisions that will otherwise be "tidied up" later.

Every file here exists because the decision it records **looks like an oversight
from the outside.** A duplicated namespace, an app that cannot edit, a
repository with three toolchains in it, an audio pipeline that keeps a file
nobody ships — each of those invites a cleanup, and each cleanup would undo
something that was decided on purpose. The last section of most of these files
says what the cleanup will look like when it is proposed.

| | |
|---|---|
| [0001](0001-two-ext-namespaces.md) | `ext_lautstark_*` and `ext_vorlaut_*` stay separate |
| [0002](0002-no-server-no-accounts.md) | No server and no accounts, anywhere in the toolchain |
| [0003](0003-packages-bake-pixels.md) | App packages bake pixels and audio; the app resolves nothing |
| [0004](0004-android-app-is-a-viewer.md) | The Android app is a viewer, and does not edit |
| [0005](0005-obf-obz-exchange-format.md) | OBF/OBZ is the exchange format, extended with `ext_lautstark_*` |
| [0006](0006-builder-and-hardware-one-repo.md) | The builder and the hardware stay in one repository |
| [0007](0007-reimport-replaces-package-atomically.md) | Re-import replaces a whole package, atomically |
| [0008](0008-audio-masters-derived-artefacts.md) | One master per utterance; everything else is derived |
| [0009](0009-device-interface-fixtures.md) | The device interface has fixtures of its own, owned by neither half |
| [0010](0010-device-shaped-obz-export.md) | The device build has an `.obz` export of its own, and it is a third door |
| [0011](0011-editor-exports-the-talker-repository-sends.md) | The editor exports a file; the talker's repository compiles it and sends it |
| [0012](0012-the-repository-splits-editor-leaves.md) | This repository splits into three, and the editor is the half that leaves |
| [0013](0013-the-device-preview-moves-to-the-loader-page.md) | The device preview moves to the loader page, and stops being a prediction |

## The shape

Numbered, four digits, never reused and never renumbered. A superseded decision
keeps its number and gains a status line saying what replaced it, because the
things that link to it — `SPEC.md`, a fixture's prose, another ADR — are worth
more than a tidy sequence.

```markdown
# ADR 0009 — A sentence, in the present tense, that states the decision

**Status:** accepted · **Date:** YYYY-MM-DD · **Applies to:** …

## Context     What was true, and what the alternatives were.
## Decision    What was decided, in enough detail to implement.
## Why         The reasoning, one bolded claim per paragraph.
## Consequences  What this costs, including what it makes impossible.
```

`## Not to be "fixed" later` is optional and usually earns its place: it names
the specific cleanup this decision will attract, and what somebody proposing it
would have to establish first.

**These live at the top of the repository rather than under `exchange/`**
because several of them decide things wider than the exchange format —
0002 and 0006 are about every Lautstark project and about this repository as a
whole. 0001 was written when the folder was still `exchange/adr/`; only its
location changed.
