import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./harness.js";

/* The shell may not know what a five-key talker is.
 *
 * src/editor-diy/ is one device's editor: four keys to a set, five sets on the
 * hardware at once, a colour drawn round the displays, and a cable at the end
 * of it. Everything else under src/ is the shell - the boards, the storage,
 * the symbol picker, the voices, the settings, the design tokens, the import
 * and export - and it has to stand without any of that, because the second
 * editor is the whole point of the split and it is not written yet.
 *
 * An import is how that stops being true, and it stops being true quietly:
 * `import { render } from "../editor-diy/editor.js"` in the save loop compiles,
 * runs, and passes every other test in this repository. It was there, three
 * times over, before this file existed - save.ts, picker.ts and voices.ts each
 * reached for the board renderer - and each of those was one line that made
 * the shell unable to draw anything else.
 *
 * So the rule is one direction of one arrow, and the exceptions are named
 * rather than pattern-matched: exactly two modules may see both halves, and
 * they are the two that put the page together. If a third ever needs to, that
 * is a design decision and it should cost an edit here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "..", "src");

const EDITOR = "editor-diy/";

/** The composition root: main.ts mounts the templates of both halves, app.ts
 *  installs the editor into the shell's socket. Nothing else. */
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

check("there is an editor to keep out of the shell",
      all.some((name) => name.startsWith(EDITOR)),
      `${all.filter((n) => n.startsWith(EDITOR)).length} modules under src/${EDITOR}`);

/* A type-only import is still an import for this purpose, and deliberately so.
 * `import type { Editor }` from the shell would be the shell knowing the shape
 * of one particular editor, which is the thing being prevented - and the way
 * to share a shape is core/editor.ts, which both halves may name. */
const crossings: string[] = [];
for (const name of all) {
  if (name.startsWith(EDITOR) || ROOT.has(name)) continue;
  for (const target of importsOf(name)) {
    if (target.startsWith(EDITOR)) crossings.push(`${name} -> ${target}`);
  }
}

check("nothing outside the editor imports out of it, except the two that mount it",
      crossings.length === 0,
      crossings.length ? crossings.join(", ")
                       : `${all.length - 1} modules checked against src/${EDITOR}`);

/* The other direction is allowed and is not a mirror of the rule above: the
 * editor draws in the shell's page, saves through the shell's save loop and
 * opens the shell's symbol picker. What it must not do is reach *past* the
 * shell into another editor, which today would be itself and tomorrow would be
 * the interesting case. Cheap to state now, and the sort of thing nobody
 * thinks to add on the day it matters. */
const strays: string[] = [];
for (const name of all.filter((one) => one.startsWith(EDITOR))) {
  for (const target of importsOf(name)) {
    const at = target.indexOf("-diy/");
    if (at >= 0 && !target.startsWith(EDITOR)) strays.push(`${name} -> ${target}`);
  }
}
check("no editor reaches into another editor", strays.length === 0,
      strays.join(", ") || "one editor, importing nothing from any other");
