/* Every module under static/ has to be one the page actually loads.
 *
 *     node tests/browser/reachable.test.mjs
 *
 * ui.html names main.js and nothing else; everything else arrives because
 * something imports it. A file nothing imports is dead code that looks exactly
 * like working code - and, the other way round, a typo in an import path is a
 * module that silently never loads, which the browser shows as a button that
 * does nothing.
 *
 * This walk used to live in tests/test_ui_texts.py and went with app.py, along
 * with the two lists of modules that were written but not yet wired up. Those
 * lists are empty now: the page reaches backend/local.js, so it reaches
 * store.js, tiles.js, obf.js and layout_format.js behind it, and every entry
 * they were holding a place for came off at once.
 *
 * It walks the import map as well as relative paths, because the page does.
 * "vorlaut:backend" is how backend.js reaches an implementation without naming
 * one; read as a bare name and skipped, the module behind it would look
 * unreachable and the fix would be an exemption that hides the next real one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, posix } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const STATIC = join(ROOT, "static");
const PAGE = join(ROOT, "ui.html");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  if (!ok) failures.push(name);
};

/* Code that is not ours. static/vendor/ holds built copies of packages with
 * their provenance in a VENDORED.md beside them; they are reached by an import
 * map entry rather than by a path, and a bundled chunk importing its own
 * sibling is not something this walk should have an opinion about. */
const VENDOR = "vendor";

/** Every module under static/, however deep, as a path under static/. */
function scripts(dir = STATIC) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== VENDOR) out.push(...scripts(full));
    } else if (entry.endsWith(".js")) {
      out.push(relative(STATIC, full).split(/[\\/]/).join("/"));
    }
  }
  return out.sort();
}

/** What ui.html maps a bare specifier to, as a path under static/.
 *
 * Only entries pointing into static/ are kept: a map may name a CDN or a
 * package that is not here, and neither is a module this file can find. */
function importMap() {
  const page = readFileSync(PAGE, "utf8");
  const block = page.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!block) return null;
  const imports = JSON.parse(block[1]).imports || {};
  const out = new Map();
  for (const [name, target] of Object.entries(imports)) {
    if (target.startsWith("./static/")) out.set(name, target.slice("./static/".length));
  }
  return out;
}

/** What ui.html loads directly - the entry point the walk starts from. */
function entryPoints() {
  const page = readFileSync(PAGE, "utf8");
  return [...page.matchAll(/<script type="module" src="\.\/static\/([^"]+)"/g)]
    .map((m) => m[1]);
}

const MAP = importMap();
check("ui.html has an import map", MAP !== null);
const entries = entryPoints();
check("ui.html loads a module of its own", entries.length > 0, entries.join(", "));

const modules = scripts();
/* A run that found no modules would otherwise read exactly like a run that
 * found nothing wrong - which is the failure this whole file is about. */
check("there are modules to walk", modules.length > 2,
      `${modules.length} under static/`);

if (!MAP || !entries.length || modules.length <= 2) {
  console.log(`\n  ${failures.length} problem(s): ${failures.join(", ")}`);
  process.exit(1);
}

const missing = [];

/** The modules one file names, as paths under static/.
 *
 * Resolved against the importing file rather than taken as a name: "./dom.js"
 * in static/backend/local.js is static/backend/dom.js if one is there, and in
 * a flat reading it would have been the top-level dom.js - which exists, and
 * is a different file. */
function importsOf(name) {
  const full = join(STATIC, name);
  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const [, target] of text.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
    let resolved;
    if (target.startsWith(".")) {
      resolved = posix.normalize(posix.join(posix.dirname(name), target));
      if (resolved.startsWith("..")) {
        missing.push(`${name} imports ${target}, which is outside static/`);
        continue;
      }
    } else if (MAP.has(target)) {
      resolved = MAP.get(target);
    } else {
      /* A bare name with no entry into static/: a package mapped to a CDN, or
       * a typo that will 404 in a browser. Not this check's business either
       * way - it is about the files in static/. */
      continue;
    }
    out.push(resolved);
  }
  return out;
}

/* A walk from the page's entry point, not a census of who imports whom. The
 * two differ the moment a module exists that is written but not yet chosen:
 * such a module's own imports would make everything under it look like part of
 * the page. The line this prints says "reached from ui.html", which has to
 * stay true or it quietly stops meaning anything. */
const reached = new Set();
const queue = [...entries];
while (queue.length) {
  const name = queue.pop();
  if (reached.has(name)) continue;
  reached.add(name);
  queue.push(...importsOf(name));
}

/* Every import is still checked for pointing at a real file, including from
 * modules the page never reaches - a broken import in one of those is a module
 * that will not load on the day it is wired up. */
const named = new Set(reached);
for (const name of modules) for (const target of importsOf(name)) named.add(target);
for (const name of [...named].sort()) {
  let ok = false;
  try {
    ok = statSync(join(STATIC, name)).isFile();
  } catch { /* not there */ }
  if (!ok) missing.push(`something imports ${name}, which is not in static/`);
}

const orphans = modules.filter((name) => !reached.has(name));
check("nothing sits in static/ that the page never loads", !orphans.length,
      orphans.length ? orphans.join(", ")
                     : `${modules.length} modules, all reached from ui.html`);

check("every import points at a file that is there", !missing.length,
      missing.join("; ") || `${named.size} import target(s)`);

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\n  All good.");
