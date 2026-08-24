# ADR 0003 — App packages bake pixels and audio; the app resolves nothing

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** SPEC.md 1.0.0

## Context

Open Board Format lets a button name its picture in four different ways: a
`url`, a `data_url`, a `path` into the archive, or a `symbol`/`filename` pair
naming an entry in some symbol set the reader is expected to own. All four are
legal OBF. A conforming reader is, in principle, expected to cope with the lot.

The reader here is an Android viewer on a tablet, in a room, possibly with no
network, definitely with no symbol library shipped inside it — and the person
holding it is a child who needs the button to have a picture on it now.

Three of those four mechanisms are promises that the picture exists somewhere
else. Only `path` is the picture.

The same question arrives for audio, with an extra turn: the builder can
synthesise speech in the browser, so a package could plausibly ship the *text*
and let the viewer speak it with Android's TTS.

## Decision

**Every image and every sound in a Lautstark Board Package is a file inside the
archive. The importer resolves no reference of any kind.**

- An image entry MUST carry `path`, and that path MUST resolve to a member of
  the archive.
- `url` and `data_url` MUST be ignored where present, with a warning
  (`image_reference_ignored`) — not followed.
- A `symbol`/`filename` pair with no usable `path` is a button-level fault: the
  button renders without a picture and is marked degraded.
- A package whose images live only at a URL or in an external symbol set **is
  not a Lautstark Board Package.** It is out of scope, not merely unsupported.
- Audio is likewise a file in the archive. Ogg Opus, written by the builder.
- The viewer makes no network requests, for images or for anything else.

## Why

**A reference is a picture that might not be there.** It might be a dead link, a
symbol set the tablet does not have, a server that is down, or a network that
does not exist in this room. Every one of those failures lands at the moment the
child presses the button, which is the worst possible moment for it. A baked
file cannot fail that way: if the package imported, the picture is there.

**The viewer would have to become a downloader.** Resolving a `url` means an
HTTP client, a cache, a retry policy, a timeout, a TLS trust decision, and a
permission in the manifest — in an app whose entire safety story is that it
talks to nothing. It also silently sends the tablet's address to whoever hosts
the symbol, which is precisely the leak the rest of this project spends effort
avoiding.

**Shipping a symbol library instead is worse.** ARASAAC alone is tens of
thousands of pictograms; bundling it would dwarf the app, and it still would not
answer METACOM, which cannot be bundled at all because it is licensed per
person.

**A vocabulary is not a lookup table.** Two builders that both write
`symbol: "arasaac:2462"` do not necessarily agree on which file that is, nor on
which revision of it. Baking the pixels records what the person who made the
board actually saw and approved. That matters more here than compactness: an
adult chose that picture for that child, and a resolver could quietly substitute
another.

**Audio is baked for the same reason plus one.** Android's TTS would speak the
text, but not in the voice the family chose, not at the timing they checked, and
not at all where the voice is missing on that device. The recording *is* the
content; the text is a label for it. §6 keeps the recording.

**The cost is size, and it is affordable.** Opus at 24 kbit/s puts a
1.5-second utterance at roughly 4.5 kB, and images are capped and deduplicated.
A vocabulary of hundreds of buttons is still a package one can send in a
message.

## Consequences

- Packages are self-contained: one file, no companion downloads, and it works on
  a tablet in aeroplane mode on the first try.
- Packages are larger than a reference-only `.obz`, which is the trade being
  made deliberately.
- The importer is small. There is no fetch layer, no cache, no offline mode to
  design, because there is nothing to be offline *from*.
- Baking METACOM pixels is a licensing act, and §5.2 constrains it narrowly:
  `ext_lautstark_symbol_source: "metacom"` forces
  `ext_lautstark_redistributable: false`, and the flag is stored with the
  package rather than checked and discarded. See also [ADR
  0005](0005-obf-obz-exchange-format.md).
- **On the builder side, the pixel-baking export MUST be a separate entry point
  from the talker export** — a different function, not a flag on the existing
  one. The talker's guarantee is that it never writes a symbol as pixels, and a
  guarantee enforced by an argument is one flag away from being untrue. SPEC.md
  §5.2 states this normatively; it is repeated here because the tempting
  refactor is to unify them.

## Not to be "fixed" later

`data_url` and `url` will look like free features: the field is already in the
OBF schema, the fetch is four lines, and a package that came from some other
tool will one day fail to show its pictures with the reason sitting right there
in the JSON. Adding the fetch would fix that one file and end the property that
every imported package renders completely, offline, forever.

If a reference-resolving importer is ever genuinely wanted, it is a different
product with a different threat model — not a relaxation of this one.
