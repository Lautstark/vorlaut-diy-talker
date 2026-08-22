# Languages: the product, the code, the commit log

Which language a thing is in depends on who reads it. The product speaks the
language of whoever uses it; everything read while developing is English.

## The product: German and English

The **product** comes in German and English — the interface, the build log and
the labels on the device. It is switched at the top right of the interface and
stored as `"language"` in `layout.json`.

It is deliberately **one** setting for everything. A talker whose menu says
`back` while the computer next to it says `zurück` would be one more thing to
keep in step.

The **content** is untouched by it: set names, the words on the keys and
everything spoken are whatever somebody typed. Switching the interface to
English leaves a German set German. The voice is chosen separately and can
speak a different language than the menu.

The texts live as one table per language in [`static/boot_data.js`](../static/boot_data.js) for the
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
