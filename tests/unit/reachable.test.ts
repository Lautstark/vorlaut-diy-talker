import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./harness.js";

/* No module may sit in src/ without the page ever loading it.
 *
 * index.html names main.ts and nothing else; everything else arrives because
 * something imports it. A file nothing imports is dead code that looks exactly
 * like working code, and the bundler will not say so - it simply leaves it out,
 * which is silence rather than a complaint.
 *
 * The other half of what this used to check is gone, and good riddance: a typo
 * in an import path used to be a module that silently never loaded, and is now
 * a build that fails. This is what is left over once a bundler exists, and it
 * is smaller for it - no import map to follow, no vendored tree to skip.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "..", "src");

/** Every module under src/, however deep, as a path under src/. */
function modules(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...modules(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(relative(SRC, full).split(/[\\/]/).join("/"));
    }
  }
  return out.sort();
}

/** What one module imports, as paths under src/. Resolved against the
 *  importing file rather than taken as a name: "./dom.js" in src/backend/ is
 *  src/backend/dom.ts if one is there, and a flat reading would find the
 *  top-level one, which exists and is a different file. */
function importsOf(name: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(SRC, name), "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    if (!spec.startsWith(".")) continue;           // a package, not our file
    const resolved = posix
      .normalize(posix.join(posix.dirname(name), spec))
      .replace(/\.js$/, ".ts");
    out.push(resolved);
  }
  return out;
}

const all = modules();
check("there are modules to walk", all.length > 2, `${all.length} under src/`);

/* A walk from the entry point, not a census of who imports whom. The two differ
 * the moment a module exists that is written but not yet chosen: its own
 * imports would make everything under it look like part of the page. */
const reached = new Set<string>();
const queue = ["main.ts"];
while (queue.length) {
  const name = queue.pop()!;
  if (reached.has(name)) continue;
  reached.add(name);
  queue.push(...importsOf(name));
}

/* types.ts and the ambient declarations are imported for their types alone, so
 * `verbatimModuleSyntax` erases those imports and the walk cannot see them.
 * They are not dead code - tsc fails without them - and this is the one place
 * a text-level walk cannot tell the difference. */
const TYPES_ONLY = new Set(["core/types.ts"]);

const orphans = all.filter((n) => !reached.has(n) && !TYPES_ONLY.has(n));
check("nothing sits in src/ that the page never loads", orphans.length === 0,
      orphans.length ? orphans.join(", ")
                     : `${all.length} modules, all reached from main.ts`);
