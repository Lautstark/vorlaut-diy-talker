# Languages: the product, the code, the commit log

Which language a thing is in depends on who reads it. The product speaks the
language of whoever uses it; everything read while developing is English.

## The product: German and English

The **product** comes in German and English — the interface, the build log and
the labels on the device. That is **two** settings, and the difference is who
each one belongs to.

The **interface's** language belongs to this browser and to the person building
a board in it. It is the first panel of the settings sheet, and it is kept in
`localStorage` under `vorlaut.language`, beside the colour scheme and for the
same reason: both have to be readable before the first paint, and neither is a
property of anything that gets exported.

The **device's** language is the one the talker draws its own menu labels in.
It belongs to a Sammlung: it is stored as `"language"` in `layout.json`, it
travels with an export, and for a tablet package it is the `locale` that picks
a voice when the chosen one is not installed. It has its own panel in the
settings sheet, beside the Sammlung's other settings.

They were one setting until 2026-08-25, on the argument that a talker whose
menu says `back` while the computer next to it says `zurück` is one more thing
to keep in step. What that cost was larger: a carer working in German could not
give a child an English talker without turning their own interface English, and
opening a Sammlung silently re-languaged the interface around them.

The **content** is untouched by it: set names, the words on the keys and
everything spoken are whatever somebody typed. Switching the interface to
English leaves a German set German. The voice is chosen separately and can
speak a different language than the menu — a German voice on an English board
is somebody's arrangement, not a mistake to correct. Until somebody chooses
one, though, it is the **Sammlung's** language that picks it, never the
interface's: the shipped catalogue's own recommendation for that language,
marked in the sheet with a word saying nobody chose it.

The texts live as one table per language in [`src/core/boot_data.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/core/boot_data.ts) for the
computer and the interface, and in
[`firmware/vorlaut/texts.h`](../firmware/vorlaut/texts.h) for the device.
English is the default.

## What the display can draw

The built-in font is not Unicode but code page 437: `zurück` would have ended
up as `zur├╝ck` on the display. What can be drawn and what cannot is in
[firmware.md](firmware.md); a test checks every translation against the width
of a display.

## The code: English

**Code and documentation are English** — identifiers, comments, commit
messages, `docs/` and the command line.

The command line stays English even when the interface is set to German:
`build.py` passes messages on as keys, and whoever displays them decides the
language. The same error reads English in the terminal and German in the
browser.

So the split does not run by file but by who reads it: what somebody uses
comes in their language; what gets read while developing is English.

```bash
.venv/bin/python tests/test_language.py
```

checks that, and names the file and line for anything that got left behind.

## The older history does not follow that

`git log` is the first place anyone looks. 104 of the first 142 commits have
German subjects and bodies. That is drift, not a second rule: nothing ever
checked it, because `tests/test_language.py` reads files and a commit message
is not a file. It went unnoticed for long enough that people — and agents —
read the log, inferred the convention from it, and wrote the next commit in
German too.

So: the rule above is the rule. Take conventions from here, not from the log.
Rewriting 142 commits to match would cost more than it is worth, so the old
ones stay as they are and the line is drawn at the point this note appears.
