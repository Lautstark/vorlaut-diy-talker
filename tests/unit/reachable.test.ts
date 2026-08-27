import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./harness.js";

/* No module may sit in src/ or loader/ without a page ever loading it.
 *
 * Each page's HTML names one module and nothing else; everything else arrives
 * because something imports it. A file nothing imports is dead code that looks
 * exactly like working code, and the bundler will not say so - it simply
 * leaves it out, which is silence rather than a complaint.
 *
 * The other half of what this used to check is gone, and good riddance: a typo
 * in an import path used to be a module that silently never loaded, and is now
 * a build that fails. This is what is left over once a bundler exists, and it
 * is smaller for it - no import map to follow, no vendored tree to skip.
 *
 * Two entry points now, and that is the whole of what adr/0011 cost this file.
 * They are walked together rather than one after the other, because the two
 * pages share modules - the label table, the package format - and a module
 * reached only from loader/src/main.ts is not an orphan of src/. Walking them
 * separately would report every shared file twice: once as reached, once as
 * dead.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/** Where the modules are, and which file each page starts from.
 *
 * vite.config.ts's rollupOptions.input is the same pair of facts in the same
 * order, and it is the one that decides whether a page is built at all. If a
 * third page is ever added there and not here, this test goes quiet about a
 * whole directory - which is the failure the list being short and visible is
 * meant to make obvious. */
const TREES = [
  { dir: "src", entry: "main.ts" },
  { dir: "loader/src", entry: "main.ts" },
];

/** Every module in either tree, however deep, as a path from the repository
 *  root - so that one walk can cross from one tree into the other. */
function modules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    const full = join(dir, entry);
    if (statSync(resolve(ROOT, full)).isDirectory()) out.push(...modules(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full.split(/[\\/]/).join("/"));
    }
  }
  return out.sort();
}

/** What one module imports, as paths from the root. Resolved against the
 *  importing file rather than taken as a name: "./dom.js" in src/backend/ is
 *  src/backend/dom.ts if one is there, and a flat reading would find the
 *  top-level one, which exists and is a different file. */
function importsOf(name: string): string[] {
  let text: string;
  try {
    text = readFileSync(resolve(ROOT, name), "utf8");
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

const all = TREES.flatMap((one) => modules(one.dir));
check("there are modules to walk", all.length > 2,
      `${all.length} under ${TREES.map((one) => one.dir).join(" and ")}`);

for (const one of TREES) {
  check(`${one.dir}/${one.entry} is there to walk from`,
        all.includes(`${one.dir}/${one.entry}`));
}

/* A walk from the entry point, not a census of who imports whom. The two differ
 * the moment a module exists that is written but not yet chosen: its own
 * imports would make everything under it look like part of the page. */
const reached = new Set<string>();
const queue = TREES.map((one) => `${one.dir}/${one.entry}`);
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
const TYPES_ONLY = new Set(["src/core/types.ts"]);

const orphans = all.filter((n) => !reached.has(n) && !TYPES_ONLY.has(n));
check("nothing sits in either tree that no page ever loads", orphans.length === 0,
      orphans.length ? orphans.join(", ")
                     : `${all.length} modules, all reached from ${TREES.length} entry points`);
