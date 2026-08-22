/* The page opens, in a real browser, and a board is on it.
 *
 *     node tests/browser/page.test.mjs                # ui.html, off the clone
 *     node tests/browser/page.test.mjs dist index.html  # what Pages will serve
 *
 * This exists because of what happened without it. Deleting the Python half
 * left the page with a bootstrap block nobody filled in any more, seven
 * absolute paths nothing served, and a seam still importing routes that were
 * gone. Every check in this repository stayed green, because not one of them
 * opened the page: they read files, compared bytes and walked imports, and all
 * of that was still true of a page that rendered nothing at all.
 *
 * So this one is deliberately shallow and deliberately end to end. It serves
 * the directory, opens it in headless Chrome, and asks the three questions the
 * suite could not:
 *
 *   - did anything go wrong out loud - an exception, a console error, a
 *     subresource that 404ed;
 *   - is a board on the screen - the set tile and its four keys, which only
 *     appear if the module tree loaded, boot.js gave the texts, and the store
 *     seeded a first layout;
 *   - did it ask a server for anything - zero /api/ requests, because there is
 *     nothing there to ask.
 *
 * Chrome is driven over the DevTools protocol from plain node, with nothing
 * installed. That is the same rule the rest of tests/browser/ follows and it
 * is worth the extra hundred lines here: a package.json for one test would be
 * the first dependency this front end has, and the front end not having one is
 * the point of it being native modules.
 *
 * Skipped, loudly, where no Chrome can be found - CI checks that separately,
 * the same way it checks node and g++ really were there.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SITE = resolve(ROOT, process.argv[2] || ".");
const PAGE = process.argv[3] || "ui.html";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  if (!ok) failures.push(name);
};

/* --- Chrome ---------------------------------------------------------------- */

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chrome = CANDIDATES.find((path) => existsSync(path));
if (!chrome) {
  console.log("  skipped: no Chrome or Chromium found, so the page was not "
            + "opened. Nothing else in this repository opens it either - set "
            + "CHROME to a binary to run this.");
  console.log("\n  All good.");
  process.exit(0);
}

/* --- A static server, which is all Pages is -------------------------------- */

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".wav": "audio/wav", ".webmanifest": "application/manifest+json",
};

/* Served under a prefix, because a GitHub project site is served from
 * /<repo>/ and never from the root. That is not a detail: "/static/ui.css" is
 * a 404 there and is not one here, so a server mounted at the root would have
 * called the absolute paths fine right up until they were published. */
const PREFIX = "/vorlaut";

const served = [];
const server = createServer(async (request, response) => {
  const asked = decodeURIComponent(new URL(request.url, "http://x").pathname);
  if (asked !== PREFIX && !asked.startsWith(PREFIX + "/")) {
    served.push({ path: asked, status: 404 });
    response.writeHead(404).end("not here - this site is served from " + PREFIX + "/");
    return;
  }
  const path = asked.slice(PREFIX.length) || "/";
  /* Normalised and confined to SITE: a path with .. in it is a bug in the
   * page, not something to serve. */
  const full = join(SITE, normalize(path));
  if (!full.startsWith(SITE + sep) && full !== SITE) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(full);
    served.push({ path: asked, status: 200 });
    response.writeHead(200, { "Content-Type": TYPES[extname(full)] || "application/octet-stream" });
    response.end(body);
  } catch {
    served.push({ path: asked, status: 404 });
    response.writeHead(404).end("not here");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}${PREFIX}`;

/* --- Driving it ------------------------------------------------------------ */

const profile = await mkdtemp(join(tmpdir(), "vorlaut-page-"));
const browser = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  "--disable-dev-shm-usage", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

/** Chrome writes the port it chose to stderr, before it is ready for it. */
function endpoint() {
  return new Promise((keep, drop) => {
    const late = setTimeout(() => drop(new Error("Chrome never said it was listening")), 30000);
    let seen = "";
    browser.stderr.on("data", (chunk) => {
      seen += chunk;
      const found = seen.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) { clearTimeout(late); keep(found[1]); }
    });
    browser.on("exit", (code) => {
      clearTimeout(late);
      drop(new Error(`Chrome exited with ${code}\n${seen}`));
    });
  });
}

let next = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const logErrors = [];

const socket = new WebSocket(await endpoint());
await new Promise((open, fail) => {
  socket.addEventListener("open", open, { once: true });
  socket.addEventListener("error", fail, { once: true });
});

let session = null;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (waiting) {
      message.error ? waiting.fail(new Error(JSON.stringify(message.error)))
                    : waiting.keep(message.result);
    }
    return;
  }
  const p = message.params || {};
  if (message.method === "Runtime.exceptionThrown") {
    const d = p.exceptionDetails || {};
    exceptions.push(`${d.text || ""} ${(d.exception || {}).description || ""}`.trim());
  } else if (message.method === "Runtime.consoleAPICalled" && p.type === "error") {
    consoleErrors.push((p.args || []).map((a) => a.description || a.value).join(" "));
  } else if (message.method === "Log.entryAdded" && (p.entry || {}).level === "error") {
    logErrors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ""}`.trim());
  }
});

function send(method, params = {}, useSession = true) {
  const id = ++next;
  const frame = { id, method, params };
  if (useSession && session) frame.sessionId = session;
  socket.send(JSON.stringify(frame));
  return new Promise((keep, fail) => pending.set(id, { keep, fail }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" }, false);
({ sessionId: session } = await send(
  "Target.attachToTarget", { targetId, flatten: true }, false));

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

const url = `${origin}/${PAGE}`;
await send("Page.navigate", { url });

/** Polls in the page until the board is there, rather than sleeping a fixed
 *  number of seconds: the seeded layout arrives from IndexedDB, and how long
 *  that takes is not something to guess at from out here. */
async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

const board = await evaluate(`(async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const tiles = document.querySelectorAll("#device .tile").length;
    if (tiles) return { tiles, tabs: document.querySelectorAll("#tabs .tab").length };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { tiles: 0, tabs: document.querySelectorAll("#tabs .tab").length };
})()`);

/* --- What it has to be true of --------------------------------------------- */

check("nothing threw while the page loaded", !exceptions.length,
      exceptions.join(" | "));
check("nothing was logged as an error", !consoleErrors.length,
      consoleErrors.join(" | "));
/* A missing stylesheet, icon or manifest arrives here rather than as an
 * exception, and is exactly the failure absolute paths caused. */
check("every file the page named was there", !logErrors.length,
      logErrors.join(" | "));

const notFound = served.filter((r) => r.status === 404).map((r) => r.path);
check("the server was not asked for anything it does not have", !notFound.length,
      notFound.join(", "));

/* The set tile and its four keys. They only appear if the module tree loaded,
 * boot.js handed over the texts, and the store seeded a first layout - which
 * is the whole page in one assertion. */
check("a board is on the screen", board.tiles === 5,
      `${board.tiles} tile(s) on the device, ${board.tabs} tab(s)`);

const api = served.filter((r) => r.path.includes("/api/")).map((r) => r.path);
check("it asked no server for anything", !api.length, api.join(", "));

await rm(profile, { recursive: true, force: true }).catch(() => {});
browser.kill();
server.close();

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\n  ${PAGE} opened from ${process.argv[2] || "the clone"}, `
          + `${served.length} file(s) served, none of them a route.`);
console.log("\n  All good.");
process.exit(0);
