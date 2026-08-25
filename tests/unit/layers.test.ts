import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./harness.js";

/* The shell may not know what a five-key talker is, or what a page of a grid
 * is either.
 *
 * src/editor-diy/ is one device's editor: four keys to a set, five sets on the
 * hardware at once, and a cable at the end of it. src/editor-app/ is the other: pages of a grid, a sentence bar, a
 * colour per word class, and a package at the end of it. Everything else under
 * src/ is the shell - the Sammlungen, the storage, the symbol picker, the
 * voices, the settings, the design tokens, the import and export - and it has
 * to stand without any of that, because two editors is what the split was for.
 *
 * An import is how that stops being true, and it stops being true quietly:
 * `import { render } from "../editor-diy/editor.js"` in the save loop compiles,
 * runs, and passes every other test in this repository. It was there, three
 * times over, before this file existed - save.ts, picker.ts and voices.ts each
 * reached for the board renderer - and each of those was one line that made
 * the shell unable to draw anything else.
 *
 * So the rule is one direction of one arrow, and the exceptions are named
 * rather than pattern-matched: exactly two modules may see every editor, and
 * they are the two that put the page together. If a third ever needs to, that
 * is a design decision and it should cost an edit here.
 *
 * ## What this test does not prove, and cannot
 *
 * **It proves imports, and imports are not the only way to depend on
 * something.** An element id is a dependency the module graph cannot see. Five
 * of them were found when the second editor was written, and the worst was
 * core/save.ts reaching for `$("releaseBtn")` inside load() - a button only
 * editor-diy mounts, in a shell module, with $() throwing by design. This file
 * was green through all of it and would be green through the next one.
 *
 * The mitigation is not a cleverer test. It is that an editor's markup is
 * mounted with the editor and only while it is on screen (core/editor.ts's
 * showEditorFor), so a shell module reaching for another editor's element
 * throws on the first Sammlung that uses it rather than on some later one.
 * That turns an invisible coupling into a loud one, which is the most a
 * structure can do about a dependency written as a string.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "..", "src");

/** Every editor there is. A directory per target, and the names are the ones
 *  core/types.ts's Target holds with `editor-` in front - so a third one is a
 *  line here and nothing else. */
const EDITORS = ["editor-diy/", "editor-app/"];

/** Whether a path is inside any editor. */
const inEditor = (name: string): boolean =>
  EDITORS.some((one) => name.startsWith(one));

/** The composition root: main.ts mounts the shell, app.ts registers both
 *  editors and mounts whichever one a Sammlung needs. Nothing else. */
const ROOT = new Set(["main.ts", "app.ts"]);

/** Every module under src/, however deep, as a path under src/. */
function modules(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...modules(full));
    else if (entry.endsWith(".ts")) {
      out.push(relative(SRC, full).split(/[\\/]/).join("/"));
    }
  }
  return out.sort();
}

/** What one module imports, as paths under src/, resolved against the file
 *  doing the importing. The same reading reachable.test.ts does, and for the
 *  same reason: "./editor.js" means a different file in each directory that
 *  has one, and there are two. */
function importsOf(name: string): string[] {
  const text = readFileSync(join(SRC, name), "utf8");
  const out: string[] = [];
  for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    if (!spec.startsWith(".")) continue;           // a package, not our file
    out.push(posix
      .normalize(posix.join(posix.dirname(name), spec))
      .replace(/\.js$/, ".ts"));
  }
  return out;
}

const all = modules();

for (const one of EDITORS) {
  check(`there is an editor at src/${one} to keep out of the shell`,
        all.some((name) => name.startsWith(one)),
        `${all.filter((n) => n.startsWith(one)).length} modules under src/${one}`);
}

/* Two of them, and that is the assertion rather than a set-up detail. The
 * whole arrangement - the registry, the mount-on-arrival, the per-layout count
 * - is there to carry a second editor, and with one editor present every rule
 * below passes for the wrong reason. */
check("there is more than one, which is what the split is for",
      EDITORS.length > 1, `${EDITORS.length} editors`);

/* A type-only import is still an import for this purpose, and deliberately so.
 * `import type { Editor }` from the shell would be the shell knowing the shape
 * of one particular editor, which is the thing being prevented - and the way
 * to share a shape is core/editor.ts, which both halves may name. */
const crossings: string[] = [];
for (const name of all) {
  if (inEditor(name) || ROOT.has(name)) continue;
  for (const target of importsOf(name)) {
    if (inEditor(target)) crossings.push(`${name} -> ${target}`);
  }
}

check("nothing outside an editor imports out of one, except the two that mount them",
      crossings.length === 0,
      crossings.length ? crossings.join(", ")
                       : `${all.length - 1} modules checked against ${EDITORS.join(", ")}`);

/* The other direction is allowed and is not a mirror of the rule above: an
 * editor draws in the shell's page, saves through the shell's save loop and
 * opens the shell's symbol picker. What it must not do is reach *past* the
 * shell into another editor.
 *
 * This was written while there was one editor, when it could only ever have
 * caught a module importing out of itself. It is live now, and it is the rule
 * that stops the cheap version of a second editor: editor-app reusing
 * editor-diy's thumb, or its drag-and-drop, and thereby making one device's
 * ideas the other's. Anything genuinely shared belongs in the shell. */
const strays: string[] = [];
for (const name of all.filter(inEditor)) {
  const own = EDITORS.find((one) => name.startsWith(one))!;
  for (const target of importsOf(name)) {
    if (inEditor(target) && !target.startsWith(own)) strays.push(`${name} -> ${target}`);
  }
}
check("no editor reaches into another editor", strays.length === 0,
      strays.join(", ") || `${EDITORS.length} editors, importing nothing from each other`);
