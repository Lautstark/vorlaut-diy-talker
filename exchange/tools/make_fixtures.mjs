#!/usr/bin/env node
// Builds the conformance fixtures in ../fixtures.
//
// This is fixture tooling, not an implementation of the spec: it writes the
// .obz files and, from the same literals, the .expected.json beside each one.
// One source per fixture is the point - an expectation written separately from
// the package it describes drifts from it, and a drifted expectation passes
// whatever the importer does.
//
// Nothing here reads a .obz back. A generator that parsed its own output would
// be the mistake docs/frozen-references.md records under "a test that can only
// compare a thing against itself".
//
// Needs: node, and ffmpeg with libopus on PATH. Frozen from ffmpeg 9.0.1.

import { crc32 } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "fixtures");
const ASSETS = join(HERE, "..", "assets");
const SPEC_VERSION = "1.1.0";

/** German fixture content, kept in fixtures/source/ so this file stays English
 *  like the rest of the code. See the note in that file. */
const de = JSON.parse(readFileSync(join(OUT, "source", "labels.de.json"), "utf8"));

// --- Reproducibility ---------------------------------------------------------
//
// Every byte this writes must be the same on every machine, or a regeneration
// is a diff nobody can read and the CI check that regenerates is worthless.
//
// zlib is the problem. Its output is a property of the zlib build, not of the
// input, so deflating with node's zlib would move the bytes whenever node moved.
// So nothing here is really compressed: the deflate streams below are made of
// *stored* blocks, which is valid method-8 data that any inflater accepts and
// that this file can produce identically forever.
//
// The files are a few kilobytes. Compression was never the point - exercising
// an importer's method-8 path was, and stored blocks do that.

/** A raw deflate stream (RFC 1951) of stored blocks. */
function deflateStored(data) {
  const MAX = 0xffff;
  if (data.length === 0) {
    const only = Buffer.alloc(5);
    only[0] = 1;                              // BFINAL=1, BTYPE=00
    only.writeUInt16LE(0, 1);
    only.writeUInt16LE(0xffff, 3);
    return only;
  }
  const blocks = [];
  for (let at = 0; at < data.length; at += MAX) {
    const piece = data.subarray(at, Math.min(at + MAX, data.length));
    const head = Buffer.alloc(5);
    head[0] = at + MAX >= data.length ? 1 : 0;
    head.writeUInt16LE(piece.length, 1);
    head.writeUInt16LE(~piece.length & 0xffff, 3);
    blocks.push(head, piece);
  }
  return Buffer.concat(blocks);
}

// --- Assets ------------------------------------------------------------------
//
// Rendered once by make_assets.mjs and committed. Opus bytes depend on the
// libopus build and PNG's IDAT on the zlib build, so these are the two things
// this generator cannot reproduce and therefore does not try to.
// Synthetic tones, not speech. These fixtures check the container, the sample
// rate and the fallback rules; whether a voice sounds right is nothing a fixture
// can answer and docs/frozen-references.md already says so about piper.

// Rendered once by make_assets.mjs and committed, because Opus bytes depend on
// the libopus build and would otherwise be the one thing that stops this
// generator being reproducible.
const asset = (name) => readFileSync(join(ASSETS, name));

const CLIP_A = asset("clip-a.opus");
const CLIP_B = asset("clip-b.opus");
const CLIP_WAV = asset("clip-legacy-16k.wav");

const BLUE = asset("disc-blue-512.png");
const GREEN = asset("disc-green-512.png");
const ORANGE = asset("disc-orange-512.png");
const GREY = asset("disc-grey-512.png");
const VIOLET = asset("disc-violet-512.png");
const RED_2048 = asset("disc-red-2048.png");
const VIOLET_2048 = asset("disc-violet-2048.png");

// --- Zip ---------------------------------------------------------------------
// Written by hand for the same reason src/data/obf.ts writes one by hand: the
// malformed fixture needs a container that is wrong in a chosen way, and a zip
// library will not produce one on request.

const DOS_TIME = (12 << 11) | (0 << 5);                    // 12:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (8 << 5) | 24;     // 2026-08-24

function zipBytes(members, corrupt) {
  const parts = [], central = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, "utf8");
    const data = Buffer.isBuffer(member.data) ? member.data : Buffer.from(member.data);
    const sum = crc32(data) >>> 0;
    // manifest.json is stored and everything else is deflated, so that both
    // methods an importer must handle appear in every package.
    const method = member.name === MANIFEST ? 0 : 8;
    const body = method === 0 ? data : deflateStored(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);          // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  const out = Buffer.concat([Buffer.concat(parts), directory, end]);
  return corrupt ? corrupt(out, offset) : out;
}

const MANIFEST = "manifest.json";

const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");

// --- Fixture writing ---------------------------------------------------------

const index = [];

/** Refuses to write a fixture whose expectation disagrees with its package.
 *
 * fixture() takes `members` and `expected` as two sibling literals. That is
 * what makes an expectation readable next to the package it describes, and it
 * is also what lets the two drift: nothing derives one from the other, so a
 * board can grow a button that the expectation never hears about.
 *
 * Byte-reproducibility cannot catch that. Both halves regenerate from the same
 * source, so a wrong pair regenerates consistently wrong forever, and
 * tests/test_exchange_fixtures.py goes green on it. This is the check that can
 * - and it has already earned its place: board `essen` in multipage carried
 * three columns and an expectation describing two.
 *
 * `deliberate` names the violations a fixture is *about*. A fixture testing a
 * missing sound has to contain a missing sound; naming it is how that stays a
 * decision rather than an oversight nobody notices.
 */
function coherent(name, members, expected, deliberate) {
  const allowed = new Set(deliberate);
  const problems = [];
  // A waiver has to be *exercised*, not merely declared: `waived` records the
  // kinds that actually suppressed something, so a waiver left behind after the
  // violation it covered is gone becomes an error rather than dead decoration.
  const waived = new Set();
  const fail = (kind, detail) => {
    if (allowed.has(kind)) { waived.add(kind); return; }
    problems.push(`[${kind}] ${detail}`);
  };

  // Archive member names, compared the way SPEC.md 2 requires: NFC on both
  // sides. The NFD fixture stores one name decomposed on purpose.
  const present = new Set(members.map((m) => m.name.normalize("NFC")));
  const has = (path) => present.has(String(path ?? "").normalize("NFC"));

  const read = (path) => {
    const found = members.find((m) => m.name === path);
    return found ? JSON.parse(found.data.toString("utf8")) : null;
  };

  const manifest = read(MANIFEST);
  if (!manifest) { problems.push("[manifest] no manifest.json among the members"); return problems; }

  const boardPaths = manifest.paths?.boards ?? {};
  const boards = new Map();
  for (const [id, path] of Object.entries(boardPaths)) {
    if (!has(path)) { fail("board-unresolved", `paths.boards[${id}] -> ${path}`); continue; }
    const board = read(path);
    if (board) boards.set(id, board);
  }
  if (!Object.values(boardPaths).includes(manifest.root)) {
    fail("root-unresolved", `root ${manifest.root} is not a value in paths.boards`);
  }
  for (const [id, path] of Object.entries(manifest.paths?.images ?? {})) {
    if (!has(path)) fail("image-unresolved", `paths.images[${id}] -> ${path}`);
  }
  for (const [id, path] of Object.entries(manifest.paths?.sounds ?? {})) {
    if (!has(path)) fail("sound-unresolved", `paths.sounds[${id}] -> ${path}`);
  }

  // --- inside each board ----------------------------------------------------
  const placed = new Map();          // board id -> button ids, grid row-major
  for (const [id, board] of boards) {
    const buttons = new Map((board.buttons ?? []).map((b) => [b.id, b]));
    const images = new Map((board.images ?? []).map((i) => [i.id, i]));
    const sounds = new Map((board.sounds ?? []).map((snd) => [snd.id, snd]));
    const grid = board.grid ?? {};
    const order = grid.order ?? [];

    if (order.length !== grid.rows) {
      fail("grid-shape", `${id}: rows says ${grid.rows}, order has ${order.length}`);
    }
    for (const row of order) {
      if (row.length !== grid.columns) {
        fail("grid-shape", `${id}: columns says ${grid.columns}, a row has ${row.length}`);
      }
    }

    const inOrder = order.flat().filter((cell) => cell !== null && cell !== undefined);
    placed.set(id, inOrder);
    for (const cell of inOrder) {
      if (!buttons.has(cell)) fail("grid-ids", `${id}: order names ${cell}, which is not in buttons[]`);
    }
    for (const button of buttons.keys()) {
      if (!inOrder.includes(button)) fail("button-unplaced", `${id}: button ${button} is in no grid cell`);
    }

    for (const button of buttons.values()) {
      if (button.image_id !== undefined) {
        const entry = images.get(button.image_id);
        if (!entry) fail("image-unresolved", `${id}/${button.id}: image_id ${button.image_id} not in images[]`);
        else if (!has(entry.path)) fail("image-unresolved", `${id}/${button.id}: ${entry.path} is not in the archive`);
      }
      if (button.sound_id !== undefined) {
        const entry = sounds.get(button.sound_id);
        if (!entry) fail("sound-unresolved", `${id}/${button.id}: sound_id ${button.sound_id} not in sounds[]`);
        else if (!has(entry.path)) fail("sound-unresolved", `${id}/${button.id}: ${entry.path} is not in the archive`);
      }
      const target = button.load_board;
      if (target) {
        if (!boards.has(target.id)) fail("load-board", `${id}/${button.id}: load_board ${target.id} is not a board`);
        else if (!has(target.path)) fail("load-board", `${id}/${button.id}: load_board path ${target.path} is not in the archive`);
      }
    }
  }

  // --- the expectation against the package ----------------------------------
  if (expected.outcome === "accepted") {
    const rootId = Object.entries(boardPaths).find(([, path]) => path === manifest.root)?.[0];
    if (expected.package?.root_board !== undefined && expected.package.root_board !== rootId) {
      fail("expected-package", `root_board says ${expected.package.root_board}, manifest.root resolves to ${rootId}`);
    }
    const pairs = [
      ["id", "ext_lautstark_package_id"],
      ["name", "ext_lautstark_package_name"],
      ["modified", "ext_lautstark_modified"],
      ["symbol_source", "ext_lautstark_symbol_source"],
      ["redistributable", "ext_lautstark_redistributable"],
      ["tts_voice", "ext_lautstark_tts_voice"],
      ["first_column_gap", "ext_lautstark_first_column_gap"],
    ];
    // SPEC.md 4.1 gives first_column_gap a default, so an expectation may state
    // `false` where the manifest says nothing at all - which is the assertion
    // that pins the default rather than the field. Written as a table so that
    // the next defaulted field is a line here and not a special case.
    const DEFAULTS = { ext_lautstark_first_column_gap: false };
    for (const [field, key] of pairs) {
      const said = expected.package?.[field];
      const wrote = manifest[key] ?? DEFAULTS[key];
      if (said !== undefined && said !== wrote) {
        fail("expected-package", `package.${field} says ${JSON.stringify(said)}, manifest ${key} is ${JSON.stringify(wrote)}`);
      }
    }

    const describedBoards = new Set((expected.boards ?? []).map((b) => b.id));
    for (const id of boards.keys()) {
      if (!describedBoards.has(id)) fail("expected-boards", `board ${id} is in the package and not in expected.boards`);
    }
    for (const id of describedBoards) {
      if (!boards.has(id)) fail("expected-boards", `expected.boards names ${id}, which is not in the package`);
    }
    for (const described of expected.boards ?? []) {
      const board = boards.get(described.id);
      if (!board) continue;
      for (const field of ["rows", "columns"]) {
        if (described[field] !== undefined && described[field] !== board.grid?.[field]) {
          fail("expected-boards", `${described.id}: expected ${field} ${described[field]}, package says ${board.grid?.[field]}`);
        }
      }
      if (described.name !== undefined && described.name !== board.name) {
        fail("expected-boards", `${described.id}: expected name ${JSON.stringify(described.name)}, package says ${JSON.stringify(board.name)}`);
      }
    }

    const describedButtons = new Set((expected.buttons ?? []).map((b) => `${b.board}/${b.id}`));
    for (const [id, inOrder] of placed) {
      for (const button of inOrder) {
        if (!describedButtons.has(`${id}/${button}`)) {
          fail("expected-buttons", `${id}/${button} is rendered by the package and absent from expected.buttons`);
        }
      }
    }
    for (const described of expected.buttons ?? []) {
      const inOrder = placed.get(described.board);
      if (!inOrder) { fail("expected-buttons", `expected.buttons names board ${described.board}, which is not in the package`); continue; }
      if (!inOrder.includes(described.id)) {
        fail("expected-buttons", `expected.buttons names ${described.board}/${described.id}, which no grid cell holds`);
        continue;
      }
      const button = (boards.get(described.board).buttons ?? []).find((b) => b.id === described.id);
      for (const field of ["label", "vocalization"]) {
        if (described[field] !== undefined && button?.[field] !== undefined
            && described[field] !== button[field]) {
          fail("expected-buttons", `${described.board}/${described.id}: expected ${field} ${JSON.stringify(described[field])}, package says ${JSON.stringify(button[field])}`);
        }
      }
    }

    // SPEC.md 9.5: warnings come in one order and only one.
    const canonical = warningOrder(expected.warnings ?? [], rootId, boards, placed);
    const given = (expected.warnings ?? []).map(warningKey);
    if (JSON.stringify(canonical.map(warningKey)) !== JSON.stringify(given)) {
      fail("warning-order",
           `warnings are not in the order SPEC.md 9.5 requires\n      given:     ${given.join(" | ")}\n      canonical: ${canonical.map(warningKey).join(" | ")}`);
    }
  }

  for (const kind of allowed) {
    if (!waived.has(kind)) {
      problems.push(`[stale-waiver] ${name} waives ${kind}, and nothing in it violates ${kind}`);
    }
  }
  return problems;
}

const warningKey = (w) => `${w.board ?? "-"}/${w.button ?? "-"}:${w.code}`;

/** SPEC.md 9.5's order: package-scoped first, then the root board, then the
 *  rest by code point; within a board, board-scoped first and then buttons in
 *  grid row-major order; ties broken by code. */
function warningOrder(warnings, rootId, boards, placed) {
  const boardRank = new Map();
  const rest = [...boards.keys()].filter((id) => id !== rootId).sort();
  [rootId, ...rest].forEach((id, at) => boardRank.set(id, at));
  return [...warnings].sort((one, two) => rank(one) - rank(two) || (one.code < two.code ? -1 : one.code > two.code ? 1 : 0));

  function rank(w) {
    if (w.board === null || w.board === undefined) return -1e9;
    const board = (boardRank.get(w.board) ?? 1e6) * 1000;
    if (w.button === null || w.button === undefined) return board;
    const at = (placed.get(w.board) ?? []).indexOf(w.button);
    return board + (at < 0 ? 999 : at + 1);
  }
}

function fixture({ name, summary, members, corrupt, expected, deliberate = [] }) {
  const problems = coherent(name, members, expected, deliberate);
  if (problems.length) {
    throw new Error(`${name}: package and expectation disagree\n    ` + problems.join("\n    "));
  }
  const bytes = zipBytes(members, corrupt);
  writeFileSync(join(OUT, `${name}.obz`), bytes);
  writeFileSync(join(OUT, `${name}.expected.json`),
                json({ fixture: name, file: `${name}.obz`,
                       spec_version: SPEC_VERSION, summary, ...expected }));
  index.push({ fixture: name, file: `${name}.obz`,
               expected: `${name}.expected.json`,
               outcome: expected.outcome, summary });
}

/** The manifest every well-formed fixture starts from. */
function manifest({ id, modified, packageName, root, boards, images = {}, sounds = {},
                    symbolSource = "arasaac", redistributable = true, voice = "en_GB-alba-medium",
                    firstColumnGap = false, extra = {} }) {
  return {
    format: "open-board-0.1",
    root,
    paths: { boards, images, sounds },
    ext_lautstark_spec_version: SPEC_VERSION,
    ext_lautstark_package_id: id,
    ext_lautstark_package_name: packageName,
    ext_lautstark_modified: modified,
    ext_lautstark_symbol_source: symbolSource,
    ext_lautstark_redistributable: redistributable,
    ext_lautstark_tts_voice: voice,
    // SPEC.md 4.1: optional and false by default, so it is written only where a
    // package asks for the gap. Every other fixture leaves it out, which is what
    // makes minimal's `first_column_gap: false` an assertion about the default.
    ...(firstColumnGap ? { ext_lautstark_first_column_gap: true } : {}),
    ...extra,
  };
}

// =============================================================================
// 1. minimal - one board, one button, everything present and in range.
// =============================================================================

{
  const image = BLUE;
  const sound = CLIP_A;
  fixture({
    name: "minimal",
    summary: "One board, one button, one baked image, one baked Opus clip.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000001",
          modified: "2026-08-24T09:00:00Z",
          packageName: "Hello",
          root: "boards/hello.obf",
          boards: { hallo: "boards/hello.obf" },
          images: { "img-hello": "images/hello.png" },
          sounds: { "snd-hello": "sounds/hello.opus" },
        })) },
      { name: "boards/hello.obf", data: json({
          format: "open-board-0.1",
          id: "hallo",
          locale: "en",
          name: "Hello",
          buttons: [{ id: "b1", label: "Hello", vocalization: "Hello",
                      image_id: "img-hello", sound_id: "snd-hello",
                      background_color: "rgb(255, 255, 255)",
                      border_color: "rgb(59, 91, 219)" }],
          grid: { rows: 1, columns: 1, order: [["b1"]] },
          images: [{ id: "img-hello", path: "images/hello.png",
                     width: 512, height: 512, content_type: "image/png" }],
          sounds: [{ id: "snd-hello", path: "sounds/hello.opus",
                     content_type: "audio/ogg", duration: 0.6 }],
          ext_lautstark_board_color: "#3B5BDB",
        }) },
      { name: "images/hello.png", data: image },
      { name: "sounds/hello.opus", data: sound },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000001", name: "Hello",
                 modified: "2026-08-24T09:00:00Z", symbol_source: "arasaac",
                 redistributable: true, tts_voice: "en_GB-alba-medium",
                 root_board: "hallo", first_column_gap: false },
      boards: [{ id: "hallo", name: "Hello", locale: "en", rows: 1, columns: 1,
                 color: "#3B5BDB" }],
      buttons: [{ board: "hallo", id: "b1", label: "Hello", vocalization: "Hello",
                  on_activate: "append", image: "images/hello.png",
                  audio: "sounds/hello.opus", state: "normal" }],
      warnings: [],
      notes: [
        "The smallest package an importer must accept. If this one fails, nothing else in the set is worth running.",
        "The button carries no action, so it appends its vocalization to the message bar - the default and the common case.",
        "first_column_gap is false and the manifest does not carry the field at all. That is the assertion: SPEC.md 4.1 gives it a default, and an importer that reads a missing hint as anything but false separates a column nobody asked to separate.",
      ],
    },
  });
}

// =============================================================================
// 2. multipage - load_board navigation and :home.
// =============================================================================

{
  const green = GREEN;
  const orange = ORANGE;
  const grey = GREY;
  fixture({
    name: "multipage",
    summary: "Three boards: a root with two load_board buttons, and :home back from each.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000002",
          modified: "2026-08-24T09:05:00Z",
          packageName: "Home",
          root: "boards/start.obf",
          boards: { start: "boards/start.obf", essen: "boards/food.obf",
                    spielen: "boards/play.obf" },
          images: { "img-food": "images/food.png", "img-play": "images/play.png",
                    "img-back": "images/back.png", "img-cafe": "images/café.png" },
          sounds: {},
        })) },
      { name: "boards/start.obf", data: json({
          format: "open-board-0.1", id: "start", locale: "en", name: "Start",
          buttons: [
            { id: "s1", label: "Food", image_id: "img-food",
              load_board: { id: "essen", name: "Food", path: "boards/food.obf" } },
            { id: "s2", label: "Play", image_id: "img-play",
              load_board: { id: "spielen", name: "Play", path: "boards/play.obf" } },
          ],
          grid: { rows: 1, columns: 2, order: [["s1", "s2"]] },
          images: [
            { id: "img-food", path: "images/food.png", width: 512, height: 512, content_type: "image/png" },
            { id: "img-play", path: "images/play.png", width: 512, height: 512, content_type: "image/png" },
          ],
          ext_lautstark_board_color: "#3B5BDB",
        }) },
      { name: "boards/food.obf", data: json({
          format: "open-board-0.1", id: "essen", locale: "en", name: "Food",
          buttons: [
            { id: "e1", label: "Apple", vocalization: "Apple" },
            // Non-ASCII, and deliberately not German - the language check in
            // tests/ forbids umlauts outside the translation tables, and an
            // importer still has to survive a label and an archive member that
            // are not plain ASCII.
            { id: "e3", label: "Café", vocalization: "Café", image_id: "img-cafe" },
            { id: "e2", label: "Back", image_id: "img-back", action: ":home" },
          ],
          grid: { rows: 1, columns: 3, order: [["e1", "e3", "e2"]] },
          images: [
            { id: "img-back", path: "images/back.png", width: 512, height: 512, content_type: "image/png" },
            { id: "img-cafe", path: "images/café.png", width: 512, height: 512, content_type: "image/png" },
          ],
          ext_lautstark_board_color: "#2F9E44",
        }) },
      { name: "boards/play.obf", data: json({
          format: "open-board-0.1", id: "spielen", locale: "en", name: "Play",
          buttons: [
            { id: "p1", label: "Ball", vocalization: "Ball" },
            { id: "p2", label: "Back", image_id: "img-back", action: ":home" },
          ],
          grid: { rows: 1, columns: 2, order: [["p1", "p2"]] },
          images: [{ id: "img-back", path: "images/back.png", width: 512, height: 512, content_type: "image/png" }],
          ext_lautstark_board_color: "#E8590C",
        }) },
      { name: "images/food.png", data: green },
      { name: "images/play.png", data: orange },
      { name: "images/back.png", data: grey },
      { name: "images/café.png", data: VIOLET },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000002", name: "Home",
                 modified: "2026-08-24T09:05:00Z", symbol_source: "arasaac",
                 redistributable: true, root_board: "start" },
      boards: [
        { id: "start", name: "Start", rows: 1, columns: 2, color: "#3B5BDB" },
        { id: "essen", name: "Food", rows: 1, columns: 3, color: "#2F9E44" },
        { id: "spielen", name: "Play", rows: 1, columns: 2, color: "#E8590C" },
      ],
      buttons: [
        { board: "start", id: "s1", label: "Food", on_activate: "navigate:essen", state: "normal" },
        { board: "start", id: "s2", label: "Play", on_activate: "navigate:spielen", state: "normal" },
        { board: "essen", id: "e1", label: "Apple", on_activate: "append", audio: "tts", state: "normal" },
        { board: "essen", id: "e3", label: "Café", vocalization: "Café", on_activate: "append",
          image: "images/café.png", audio: "tts", state: "normal" },
        { board: "essen", id: "e2", label: "Back", on_activate: "home", state: "normal" },
        { board: "spielen", id: "p1", label: "Ball", on_activate: "append", audio: "tts", state: "normal" },
        { board: "spielen", id: "p2", label: "Back", on_activate: "home", state: "normal" },
      ],
      warnings: [],
      notes: [
        "Button e3 and its image images/café.png carry non-ASCII text. The archive sets general purpose flag bit 11, and an importer that decodes member names as CP437 or the platform default will fail to find that image - a real bug on a format whose users do not write in ASCII.",
        "images/back.png is referenced by two boards under the same image id. One file, decoded once; an importer that copies it per board wastes memory but is still conformant.",
        "A load_board button navigates and must not append anything to the message bar.",
        ":home returns to the root board named by manifest.root, not to whichever board was visited first.",
      ],
    },
  });
}

// =============================================================================
// 2b. nfd-normalization - the archive says NFD, the document says NFC.
// =============================================================================

{
  // The same nine characters either way. macOS filesystems hand out the second
  // form, so a builder that names a member from a file on disk writes NFD while
  // its own board document, built from a string literal, says NFC.
  const NFC_PATH = "images/café.png";
  const NFD_PATH = NFC_PATH.normalize("NFD");
  if (NFC_PATH === NFD_PATH) throw new Error("NFC and NFD are equal - fixture is pointless");

  fixture({
    name: "nfd-normalization",
    summary: "Archive member name is NFD; the manifest and board refer to it in NFC. The importer must still find the image.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000009",
          modified: "2026-08-24T09:37:00Z",
          packageName: "Normalisation",
          root: "boards/nfd.obf",
          boards: { nfd: "boards/nfd.obf" },
          images: { "img-cafe": NFC_PATH },        // NFC
          sounds: {},
        })) },
      { name: "boards/nfd.obf", data: json({
          format: "open-board-0.1", id: "nfd", locale: "en", name: "Normalisation",
          buttons: [{ id: "n1", label: "Café", vocalization: "Café", image_id: "img-cafe" }],
          grid: { rows: 1, columns: 1, order: [["n1"]] },
          images: [{ id: "img-cafe", path: NFC_PATH,   // NFC
                     width: 512, height: 512, content_type: "image/png" }],
        }) },
      { name: NFD_PATH, data: VIOLET },              // NFD - the whole point
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000009", name: "Normalisation",
                 modified: "2026-08-24T09:37:00Z", root_board: "nfd" },
      boards: [{ id: "nfd", name: "Normalisation", rows: 1, columns: 1 }],
      buttons: [
        { board: "nfd", id: "n1", label: "Café", vocalization: "Café",
          on_activate: "append", image: "images/café.png", audio: "tts",
          state: "normal",
          reason: "found by normalising both sides to NFC before comparing" },
      ],
      warnings: [
        { code: "path_normalization", board: null, button: null,
          detail: "archive member name is NFD; SPEC.md 2 requires NFC" },
      ],
      notes: [
        "This package is malformed - SPEC.md 2 says member names MUST be NFC - and it must import anyway. The MUST binds builders; the importer's job is to survive one that got it wrong, because the builder that gets it wrong is any builder running on macOS.",
        "An importer that compares archive names byte for byte reports image_missing here and marks the button degraded. That is the failure this fixture exists to catch, and it is invisible on Linux, where the same builder would have written NFC and everything would have worked.",
        "The warning is package-scoped: board and button are null. Nothing about the rendered button is wrong, so nothing is degraded - but the package still has a defect somebody should fix upstream, and SPEC.md 9.4 is where warnings that do not degrade are listed.",
        "The expected image path is given in NFC. An importer may store either form internally; what it must not do is fail the lookup.",
      ],
    },
  });
}

// =============================================================================
// 3. message-bar - the mandatory action set, plus speak-immediately.
// =============================================================================

{
  fixture({
    name: "message-bar",
    summary: "Append, :speak, :clear, :backspace, and one ext_lautstark_speak_immediately button. German content, umlauts and eszett included.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000003",
          modified: "2026-08-24T09:10:00Z",
          packageName: de.package_name,
          root: "boards/bar.obf",
          boards: { bar: "boards/bar.obf" },
          images: {}, sounds: { "snd-ouch": "sounds/ouch.opus" },
          voice: de.voice,
        })) },
      { name: "boards/bar.obf", data: json({
          format: "open-board-0.1", id: "bar", locale: "de", name: de.board_name,
          buttons: [
            { id: "w1", label: de.word_i, vocalization: de.word_i },
            { id: "w2", label: de.word_want, vocalization: de.word_want },
            { id: "w3", label: de.apple_label, vocalization: de.apple_spoken },
            { id: "w4", label: de.football, vocalization: de.football },
            { id: "a1", label: de.speak, action: ":speak" },
            { id: "a2", label: de.clear, action: ":clear" },
            { id: "a3", label: de.backspace, action: ":backspace" },
            { id: "x1", label: de.ouch, vocalization: de.ouch, sound_id: "snd-ouch",
              ext_lautstark_speak_immediately: true },
          ],
          grid: { rows: 2, columns: 4,
                  order: [["w1", "w2", "w3", "w4"], ["a1", "a2", "a3", "x1"]] },
          sounds: [{ id: "snd-ouch", path: "sounds/ouch.opus",
                     content_type: "audio/ogg", duration: 0.4 }],
        }) },
      { name: "sounds/ouch.opus", data: CLIP_B },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000003", name: de.package_name,
                 modified: "2026-08-24T09:10:00Z", tts_voice: de.voice,
                 root_board: "bar" },
      boards: [{ id: "bar", name: de.board_name, locale: "de", rows: 2, columns: 4 }],
      buttons: [
        { board: "bar", id: "w1", label: de.word_i, vocalization: de.word_i, on_activate: "append", audio: "tts", state: "normal" },
        { board: "bar", id: "w2", label: de.word_want, vocalization: de.word_want, on_activate: "append", audio: "tts", state: "normal" },
        { board: "bar", id: "w3", label: de.apple_label, vocalization: de.apple_spoken, on_activate: "append", audio: "tts", state: "normal" },
        { board: "bar", id: "w4", label: de.football, vocalization: de.football, on_activate: "append", audio: "tts", state: "normal" },
        { board: "bar", id: "a1", label: de.speak, on_activate: "speak_bar", state: "normal" },
        { board: "bar", id: "a2", label: de.clear, on_activate: "clear", state: "normal" },
        { board: "bar", id: "a3", label: de.backspace, on_activate: "backspace", state: "normal" },
        { board: "bar", id: "x1", label: de.ouch, vocalization: de.ouch,
          on_activate: "speak_immediately", audio: "sounds/ouch.opus", state: "normal" },
      ],
      warnings: [],
      scenario: [
        { step: "activate w1", bar: [de.word_i] },
        { step: "activate w2", bar: [de.word_i, de.word_want] },
        { step: "activate w3", bar: [de.word_i, de.word_want, de.apple_spoken] },
        { step: "activate a1", bar: [de.word_i, de.word_want, de.apple_spoken],
          spoken: de.sentence_spoken,
          note: "The bar is spoken and left standing. :speak does not clear." },
        { step: "activate a3", bar: [de.word_i, de.word_want],
          note: ":backspace removes one whole entry, not one character. w3 contributed its whole vocalization as one entry and it leaves as one." },
        { step: "activate x1", bar: [de.word_i, de.word_want], spoken: de.ouch,
          note: "speak_immediately speaks and changes nothing in the bar." },
        { step: "activate a2", bar: [], note: ":clear empties the bar and speaks nothing." },
        { step: "activate w4", bar: [de.football],
          note: "Eszett through the whole path: archive, board document, bar entry and the string handed to TTS." },
      ],
      notes: [
        "The content here is German because the boards that ship are German. Umlauts appear in three labels and an eszett in a fourth, so an importer that mangles UTF-8 somewhere between the zip and the bar fails this fixture rather than passing on ASCII and breaking in the field.",
        "w3 shows why the bar holds entries rather than words: the label is one word and the vocalization is two, and :backspace has to undo the whole button press.",
        "An entry shows its vocalization, not its label. w3's label is one word and its vocalization is a phrase, and it is the phrase that lands in the bar. The bar is a preview of the sentence, so it has to read as that sentence rather than as the row of keys that built it.",
      ],
    },
  });
}

// =============================================================================
// 4. unknown-action - must be visibly disabled, never a silent no-op.
// =============================================================================

{
  fixture({
    name: "unknown-action",
    summary: "Three buttons with actions outside the mandatory set, including a v1-out-of-scope spelling button.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000004",
          modified: "2026-08-24T09:15:00Z",
          packageName: "Foreign actions",
          root: "boards/foreign.obf",
          boards: { foreign: "boards/foreign.obf" }, images: {}, sounds: {},
        })) },
      { name: "boards/foreign.obf", data: json({
          format: "open-board-0.1", id: "foreign", locale: "en", name: "Foreign actions",
          buttons: [
            { id: "ok", label: "Hello", vocalization: "Hello" },
            { id: "u1", label: "A", action: "+a" },
            { id: "u2", label: "Undo", action: ":undo" },
            { id: "u3", label: "Two", actions: [":clear", ":quatsch"] },
          ],
          grid: { rows: 2, columns: 2, order: [["ok", "u1"], ["u2", "u3"]] },
        }) },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000004", name: "Foreign actions",
                 modified: "2026-08-24T09:15:00Z", root_board: "foreign" },
      boards: [{ id: "foreign", name: "Foreign actions", rows: 2, columns: 2 }],
      buttons: [
        { board: "foreign", id: "ok", label: "Hello", on_activate: "append", audio: "tts", state: "normal" },
        { board: "foreign", id: "u1", label: "A", on_activate: "disabled", state: "disabled",
          reason: "spelling actions (+text) are out of scope in v1" },
        { board: "foreign", id: "u2", label: "Undo", on_activate: "disabled", state: "disabled",
          reason: ":undo is not in the mandatory action set" },
        { board: "foreign", id: "u3", label: "Two", on_activate: "disabled", state: "disabled",
          reason: "one unimplemented action in actions[] disables the whole button; :clear must not run on its own" },
      ],
      warnings: [
        { code: "action_unsupported", board: "foreign", button: "u1", detail: "+a" },
        { code: "action_unsupported", board: "foreign", button: "u2", detail: ":undo" },
        { code: "action_unsupported", board: "foreign", button: "u3", detail: ":quatsch" },
      ],
      notes: [
        "A disabled button must be visibly disabled. A button that looks live and does nothing is worse than a missing button: a child presses it and learns the device ignores them.",
        "u3 is the case worth arguing about. Running the actions an importer does understand and skipping the rest would half-execute a sequence the builder meant as one - so the whole button is refused.",
        "The board is still accepted. Unimplemented actions are a button-level fault, never a package-level one.",
      ],
    },
  });
}

// =============================================================================
// 5. missing-audio - the two distinct cases, which must not be conflated.
// =============================================================================

{
  fixture({
    name: "missing-audio",
    summary: "One button with no sound at all, one whose sound file is absent from the zip, one WAV in the tolerated format.",
    // The absent sound is the fixture. Naming it here keeps it a decision.
    deliberate: ["sound-unresolved"],
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000005",
          modified: "2026-08-24T09:20:00Z",
          packageName: "No sound",
          root: "boards/sound.obf",
          boards: { sound: "boards/sound.obf" },
          images: {},
          // The manifest names a sound the zip does not contain. That is the point.
          sounds: { "snd-absent": "sounds/absent.opus", "snd-legacy": "sounds/legacy.wav" },
        })) },
      { name: "boards/sound.obf", data: json({
          format: "open-board-0.1", id: "sound", locale: "en", name: "No sound",
          buttons: [
            { id: "t1", label: "Thirsty", vocalization: "I am thirsty" },
            { id: "t2", label: "Hungry", vocalization: "I am hungry", sound_id: "snd-absent" },
            { id: "t3", label: "Tired", vocalization: "I am tired", sound_id: "snd-legacy" },
          ],
          grid: { rows: 1, columns: 3, order: [["t1", "t2", "t3"]] },
          sounds: [
            { id: "snd-absent", path: "sounds/absent.opus", content_type: "audio/ogg", duration: 1.0 },
            { id: "snd-legacy", path: "sounds/legacy.wav", content_type: "audio/wav", duration: 0.6 },
          ],
        }) },
      { name: "sounds/legacy.wav", data: CLIP_WAV },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000005", name: "No sound",
                 modified: "2026-08-24T09:20:00Z", root_board: "sound" },
      boards: [{ id: "sound", name: "No sound", rows: 1, columns: 3 }],
      buttons: [
        { board: "sound", id: "t1", label: "Thirsty", vocalization: "I am thirsty",
          on_activate: "append", audio: "tts", state: "normal",
          reason: "no sound_id: TTS is the designed path, not a degradation" },
        { board: "sound", id: "t2", label: "Hungry", vocalization: "I am hungry",
          on_activate: "append", audio: "tts", state: "degraded",
          reason: "sound_id names a file the package does not contain" },
        { board: "sound", id: "t3", label: "Tired", vocalization: "I am tired",
          on_activate: "append", audio: "sounds/legacy.wav", state: "normal",
          reason: "16 kHz mono PCM WAV is tolerated on import" },
      ],
      warnings: [
        { code: "sound_missing", board: "sound", button: "t2", detail: "sounds/absent.opus" },
      ],
      notes: [
        "t1 and t2 both fall back to TTS and they are not the same thing. t1 is a board built without recorded audio and nothing is wrong with it; t2 is a broken package. Only t2 is marked degraded and only t2 warns.",
        "An importer that marks t1 degraded fails this fixture: it would put a caregiver-visible fault marker on every button of every TTS-only board.",
        "TTS uses the vocalization, falling back to the label. It uses ext_lautstark_tts_voice as a hint and the platform default if that voice is unavailable.",
      ],
    },
  });
}

// =============================================================================
// 6. unknown-ext - unknown extensions are ignored, including the talker's.
// =============================================================================

{
  fixture({
    name: "unknown-ext",
    summary: "Unknown ext_lautstark_*, the talker's ext_vorlaut_*, a foreign vendor's fields, and unknown plain OBF fields.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000006",
          modified: "2026-08-24T09:25:00Z",
          packageName: "Foreign fields",
          root: "boards/fields.obf",
          boards: { fields: "boards/fields.obf" },
          images: {}, sounds: {},
          extra: {
            ext_lautstark_never_exists: { deep: [1, 2, 3] },
            ext_vorlaut_sleep_timeout_seconds: 300,
            ext_someoneelse_tracking_id: "abc-123",
          },
        })) },
      { name: "boards/fields.obf", data: json({
          format: "open-board-0.1", id: "fields", locale: "en", name: "Foreign fields",
          description_html: "<p>Ignored.</p>",
          buttons: [
            { id: "f1", label: "Hello", vocalization: "Hello",
              ext_lautstark_comes_later: true,
              ext_vorlaut_color: "#3B5BDB",
              ext_someoneelse_weight: 0.5,
              wibble: "a field no version of OBF has ever defined" },
          ],
          grid: { rows: 1, columns: 1, order: [["f1"]] },
          // Deliberately not the colour beside it: an importer that reads the
          // talker's field instead of the app's produces #FF6B35 and fails,
          // rather than passing because both happened to say the same thing.
          ext_vorlaut_color: "#FF6B35",
          ext_lautstark_board_color: "#3B5BDB",
        }) },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000006", name: "Foreign fields",
                 modified: "2026-08-24T09:25:00Z", root_board: "fields" },
      boards: [{ id: "fields", name: "Foreign fields", rows: 1, columns: 1, color: "#3B5BDB" }],
      buttons: [
        { board: "fields", id: "f1", label: "Hello", vocalization: "Hello",
          on_activate: "append", audio: "tts", state: "normal" },
      ],
      warnings: [],
      ignored: [
        "manifest.ext_lautstark_never_exists",
        "manifest.ext_vorlaut_sleep_timeout_seconds",
        "manifest.ext_someoneelse_tracking_id",
        "boards/fields.obf#description_html",
        "boards/fields.obf#ext_vorlaut_color",
        "button f1#ext_lautstark_comes_later",
        "button f1#ext_vorlaut_color",
        "button f1#ext_someoneelse_weight",
        "button f1#wibble",
      ],
      notes: [
        "No warning is produced for any of these. An unknown field is the format working as designed; warning about it would fill the caregiver-facing warning list with noise and train people to ignore it.",
        "ext_vorlaut_* gets no special handling. It is the talker's namespace and an app importer must treat it exactly like any other vendor's - see adr/0001. In particular ext_vorlaut_color must not be read as a colour, even though it looks like one and holds a plausible value - it appears twice here, once on a button and once on the board, which are the two places the talker's export puts it.",
        "The board carries ext_vorlaut_color and ext_lautstark_board_color at once, holding different colours. That is the pair that catches an importer reading the wrong namespace: the expected board colour is the lautstark one, so reading the vorlaut one gives #FF6B35 and fails rather than agreeing by coincidence.",
        "This fixture is the one that catches an importer written with a strict schema validator bolted on.",
      ],
    },
  });
}

// =============================================================================
// 7. malformed-zip - a package-level fault.
// =============================================================================

{
  fixture({
    name: "malformed-zip",
    summary: "A structurally valid package whose central directory signature has been overwritten.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000007",
          modified: "2026-08-24T09:30:00Z",
          packageName: "Broken",
          root: "boards/broken.obf",
          boards: { broken: "boards/broken.obf" }, images: {}, sounds: {},
        })) },
      { name: "boards/broken.obf", data: json({
          format: "open-board-0.1", id: "broken", locale: "en", name: "Broken",
          buttons: [{ id: "k1", label: "Hello", vocalization: "Hello" }],
          grid: { rows: 1, columns: 1, order: [["k1"]] },
        }) },
    ],
    // Everything above is correct; only the container is broken, and in one
    // chosen place. A reader that scans for local file headers instead of
    // reading the directory would still find both members - which is exactly
    // the salvaging behaviour this fixture exists to forbid.
    corrupt: (bytes, directoryAt) => {
      const out = Buffer.from(bytes);
      out.writeUInt32LE(0x0badf00d, directoryAt);
      return out;
    },
    expected: {
      outcome: "rejected",
      rejection: { code: "package_unreadable",
                   detail: "central directory signature not found" },
      package: null,
      boards: [],
      buttons: [],
      warnings: [],
      notes: [
        "Nothing is imported and nothing already on the device is touched. A partial import that leaves half a vocabulary in place is the failure mode this rule exists to prevent.",
        "The importer must refuse rather than salvage, even though the local file headers in this file are intact and readable. A package that cannot be verified whole cannot be trusted in part.",
        "The rejection must be reported to the person importing, with the package named. It does not go to the persistent warning list - nothing was imported, so there is no imported thing to attach a warning to.",
      ],
    },
  });
}

// =============================================================================
// 8. oversized-image - a button-level fault.
// =============================================================================

{
  fixture({
    name: "oversized-image",
    summary: "One image at 2048x2048 (over the 1024 cap), one at 512, and one whose declared size lies.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-000000000008",
          modified: "2026-08-24T09:35:00Z",
          packageName: "Too big",
          root: "boards/big.obf",
          boards: { big: "boards/big.obf" },
          images: { "img-big": "images/big.png", "img-small": "images/small.png",
                    "img-lies": "images/lies.png" },
          sounds: {},
        })) },
      { name: "boards/big.obf", data: json({
          format: "open-board-0.1", id: "big", locale: "en", name: "Too big",
          buttons: [
            { id: "g1", label: "Big", vocalization: "Big", image_id: "img-big" },
            { id: "g2", label: "Small", vocalization: "Small", image_id: "img-small" },
            { id: "g3", label: "Lies", vocalization: "Lies", image_id: "img-lies" },
          ],
          grid: { rows: 1, columns: 3, order: [["g1", "g2", "g3"]] },
          images: [
            { id: "img-big", path: "images/big.png", width: 2048, height: 2048, content_type: "image/png" },
            { id: "img-small", path: "images/small.png", width: 512, height: 512, content_type: "image/png" },
            // Declares 512 and is 2048. The declaration is not the truth.
            { id: "img-lies", path: "images/lies.png", width: 512, height: 512, content_type: "image/png" },
          ],
        }) },
      { name: "images/big.png", data: RED_2048 },
      { name: "images/small.png", data: GREEN },
      { name: "images/lies.png", data: VIOLET_2048 },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-000000000008", name: "Too big",
                 modified: "2026-08-24T09:35:00Z", root_board: "big" },
      boards: [{ id: "big", name: "Too big", rows: 1, columns: 3 }],
      buttons: [
        { board: "big", id: "g1", label: "Big", on_activate: "append", audio: "tts",
          image: null, state: "degraded",
          reason: "2048x2048 exceeds the 1024x1024 cap" },
        { board: "big", id: "g2", label: "Small", on_activate: "append", audio: "tts",
          image: "images/small.png", state: "normal" },
        { board: "big", id: "g3", label: "Lies", on_activate: "append", audio: "tts",
          image: null, state: "degraded",
          reason: "declared 512x512, decoded 2048x2048; the decoded size is what counts" },
      ],
      warnings: [
        { code: "image_oversized", board: "big", button: "g1", detail: "2048x2048 exceeds 1024x1024" },
        { code: "image_oversized", board: "big", button: "g3", detail: "2048x2048 exceeds 1024x1024, declared 512x512" },
      ],
      notes: [
        "The oversized image is refused, not downscaled. Downscaling would make the cap advisory, and the cap exists to bound decoded bitmap memory - which is spent at decode time, before any downscale could help.",
        "The button still renders: label, colour, and its action all work. Only the picture is gone. A child who knows where a button sits can still use it.",
        "g3 is the fixture's real content. An importer must measure the decoded image and must not trust images[].width and height. Trusting the declaration makes the cap trivially bypassable by a builder that writes the wrong number, and OBF gives no guarantee those fields are correct.",
        "An importer must bound the decode itself, not decode fully and then measure - reading the PNG header is enough to decide. Decoding a deliberately huge image to find out it is too big is how this cap gets turned into the crash it was meant to prevent.",
      ],
    },
  });
}

// =============================================================================
// 9. identity - a trio. Same name and different ids must stay apart; the same
//    id with a newer timestamp must replace.
// =============================================================================

const ID_A = "1f0a5c2e-0000-4000-8000-00000000000a";
const ID_B = "1f0a5c2e-0000-4000-8000-00000000000b";

function identityPackage({ id, modified, label, vocalization }) {
  return [
    { name: "manifest.json", data: json(manifest({
        id, modified,
        packageName: "Nursery",          // deliberately the same in all three
        root: "boards/nursery.obf",
        boards: { nursery: "boards/nursery.obf" }, images: {}, sounds: {},
      })) },
    { name: "boards/nursery.obf", data: json({
        format: "open-board-0.1", id: "nursery", locale: "en", name: "Nursery",
        buttons: [{ id: "k1", label, vocalization }],
        grid: { rows: 1, columns: 1, order: [["k1"]] },
      }) },
  ];
}

fixture({
  name: "identity-a",
  summary: "Package A: name 'Nursery', id ...000a.",
  members: identityPackage({ id: ID_A, modified: "2026-08-24T09:40:00Z",
                             label: "Painting", vocalization: "I want to paint" }),
  expected: {
    outcome: "accepted",
    package: { id: ID_A, name: "Nursery", modified: "2026-08-24T09:40:00Z",
               root_board: "nursery" },
    boards: [{ id: "nursery", name: "Nursery", rows: 1, columns: 1 }],
    buttons: [{ board: "nursery", id: "k1", label: "Painting",
                vocalization: "I want to paint", on_activate: "append",
                audio: "tts", state: "normal" }],
    warnings: [],
    notes: ["Import this one first. identity-b and identity-a-v2 are only meaningful against it."],
  },
});

fixture({
  name: "identity-b",
  summary: "Package B: the same name as A, a different id. Must not replace A.",
  members: identityPackage({ id: ID_B, modified: "2026-08-24T09:41:00Z",
                             label: "Singing", vocalization: "I want to sing" }),
  expected: {
    outcome: "accepted",
    package: { id: ID_B, name: "Nursery", modified: "2026-08-24T09:41:00Z",
               root_board: "nursery" },
    boards: [{ id: "nursery", name: "Nursery", rows: 1, columns: 1 }],
    buttons: [{ board: "nursery", id: "k1", label: "Singing",
                vocalization: "I want to sing", on_activate: "append",
                audio: "tts", state: "normal" }],
    warnings: [],
    after_importing: { fixtures: ["identity-a", "identity-b"],
                       packages_on_device: [ID_A, ID_B],
                       note: "Two packages, both named Nursery. The app must show both and distinguish them by something other than the name." },
    notes: [
      "This is the duplicate-then-edit case. Somebody copied A, changed a button and passed it on; the copy minted a fresh id, so it is a different vocabulary that happens to share a name.",
      "An importer keyed on the package name would overwrite A here and destroy a vocabulary somebody depends on. That is the whole reason identity is an id and not a name.",
      "The board id inside both packages is 'kiga' in both. Board ids are scoped to their package and are not device-unique; an importer that keys stored boards on the board id alone also fails this fixture.",
    ],
  },
});

fixture({
  name: "identity-a-v2",
  summary: "The same id as identity-a with a later modified timestamp. Must replace A, not sit beside it.",
  members: identityPackage({ id: ID_A, modified: "2026-08-25T11:00:00Z",
                             label: "Painting", vocalization: "I would like to paint" }),
  expected: {
    outcome: "accepted",
    package: { id: ID_A, name: "Nursery", modified: "2026-08-25T11:00:00Z",
               root_board: "nursery" },
    boards: [{ id: "nursery", name: "Nursery", rows: 1, columns: 1 }],
    buttons: [{ board: "nursery", id: "k1", label: "Painting",
                vocalization: "I would like to paint", on_activate: "append",
                audio: "tts", state: "normal" }],
    warnings: [],
    after_importing: { fixtures: ["identity-a", "identity-b", "identity-a-v2"],
                       packages_on_device: [ID_A, ID_B],
                       note: "Still two packages. A was replaced in place; B was untouched." },
    reimport: {
      matches: "identity-a",
      resolution: "replace",
      detail: "Same ext_lautstark_package_id, strictly later ext_lautstark_modified.",
      stale_content_removed: true,
      note: "The old vocalization 'I want to paint' must be gone. An importer that merges instead of replacing leaves buttons the builder deleted.",
    },
    notes: [
      "Replacement is all-or-nothing and must not leave the device without a vocabulary if it fails midway.",
      "If the incoming modified is equal to or earlier than the stored one, the app must not silently replace. It may skip, or ask - that is a UI decision the spec leaves open - but it must not treat an older package as an update.",
    ],
  },
});

// =============================================================================
// 10. warning-order - the sequence of SPEC.md 9.5, built so that the plausible
//     wrong answers give a different one.
// =============================================================================

{
  // Board ids chosen so that sorting them all together puts "aaa" before the
  // root, and grid order chosen so that reading order is not id order. An
  // importer that sorts by board id, or that walks buttons[] instead of the
  // grid, produces a different list and fails here.
  const NFD_IMAGE = "images/café.png".normalize("NFD");

  fixture({
    name: "warning-order",
    summary: "Six warnings across three boards, in the one order SPEC.md 9.5 allows.",
    deliberate: ["sound-unresolved"],
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-00000000000c",
          modified: "2026-08-24T12:00:00Z",
          packageName: "Warning order",
          root: "boards/start.obf",
          boards: { start: "boards/start.obf", aaa: "boards/aaa.obf", zzz: "boards/zzz.obf" },
          images: { "img-big": "images/big.png", "img-cafe": "images/café.png" },
          sounds: { "snd-absent": "sounds/absent.opus" },
        })) },
      { name: "boards/start.obf", data: json({
          format: "open-board-0.1", id: "start", locale: "en", name: "Start",
          buttons: [
            { id: "b1", label: "Undo", action: ":undo" },
            { id: "b2", label: "Quiet", vocalization: "Quiet", sound_id: "snd-absent" },
            { id: "b3", label: "Big", vocalization: "Big", image_id: "img-big" },
          ],
          // Reading order is b3, b1, b2 - deliberately not b1, b2, b3.
          grid: { rows: 1, columns: 3, order: [["b3", "b1", "b2"]] },
          images: [{ id: "img-big", path: "images/big.png", width: 2048, height: 2048, content_type: "image/png" }],
          sounds: [{ id: "snd-absent", path: "sounds/absent.opus", content_type: "audio/ogg", duration: 1.0 }],
        }) },
      { name: "boards/aaa.obf", data: json({
          format: "open-board-0.1", id: "aaa", locale: "en", name: "Aaa",
          buttons: [{ id: "a1", label: "Big", vocalization: "Big", image_id: "img-big" }],
          grid: { rows: 1, columns: 1, order: [["a1"]] },
          images: [{ id: "img-big", path: "images/big.png", width: 2048, height: 2048, content_type: "image/png" }],
        }) },
      { name: "boards/zzz.obf", data: json({
          format: "open-board-0.1", id: "zzz", locale: "en", name: "Zzz",
          buttons: [{ id: "z1", label: "Spell", action: "+a", image_id: "img-cafe" }],
          grid: { rows: 1, columns: 1, order: [["z1"]] },
          images: [{ id: "img-cafe", path: "images/café.png", width: 512, height: 512, content_type: "image/png" }],
        }) },
      { name: "images/big.png", data: RED_2048 },
      { name: NFD_IMAGE, data: VIOLET },     // NFD - the package-scoped warning
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-00000000000c", name: "Warning order",
                 modified: "2026-08-24T12:00:00Z", root_board: "start" },
      boards: [
        { id: "start", name: "Start", rows: 1, columns: 3 },
        { id: "aaa", name: "Aaa", rows: 1, columns: 1 },
        { id: "zzz", name: "Zzz", rows: 1, columns: 1 },
      ],
      buttons: [
        { board: "start", id: "b3", label: "Big", on_activate: "append", image: null, audio: "tts", state: "degraded" },
        { board: "start", id: "b1", label: "Undo", on_activate: "disabled", state: "disabled" },
        { board: "start", id: "b2", label: "Quiet", on_activate: "append", audio: "tts", state: "degraded" },
        { board: "aaa", id: "a1", label: "Big", on_activate: "append", image: null, audio: "tts", state: "degraded" },
        { board: "zzz", id: "z1", label: "Spell", on_activate: "disabled", image: "images/café.png", state: "disabled" },
      ],
      // This array is the assertion. Not a set - a sequence.
      warnings: [
        { code: "path_normalization", board: null, button: null,
          detail: "archive member name is NFD; SPEC.md 2 requires NFC" },
        { code: "image_oversized", board: "start", button: "b3", detail: "2048x2048 exceeds 1024x1024" },
        { code: "action_unsupported", board: "start", button: "b1", detail: ":undo" },
        { code: "sound_missing", board: "start", button: "b2", detail: "sounds/absent.opus" },
        { code: "image_oversized", board: "aaa", button: "a1", detail: "2048x2048 exceeds 1024x1024" },
        { code: "action_unsupported", board: "zzz", button: "z1", detail: "+a" },
      ],
      notes: [
        "The order is the whole fixture. Every warning here would also be produced by an importer that emits them in some other sequence, so an implementation that compares warnings as an unordered set passes while still shuffling a caregiver-facing list between imports.",
        "Three wrong answers this discriminates. Sorting board ids without putting the root first gives aaa, start, zzz. Walking buttons[] instead of grid.order gives b1, b2, b3 within the root board. Emitting package-scoped warnings last puts path_normalization at the end.",
        "The two image_oversized warnings share a code and a detail and differ only in which board they came from. They are not interchangeable: a caregiver reads this list to find out which page to fix.",
      ],
    },
  });
}

// =============================================================================
// 11. first-column-gap - the SPEC.md 4.1 layout hint, and what it marks.
// =============================================================================

{
  // Two boards whose first column holds the same two buttons. That repetition
  // is the persistence, and it needs nothing from the format: they are ordinary
  // buttons the builder wrote onto both boards. The manifest flag is only the
  // gap that tells a reader those two are the ones that stay put.
  //
  // Ids differ per board on purpose - SPEC.md 7.1 scopes a button id to its
  // board, and an importer must not pair p1 with q1 or conclude anything from
  // their labels matching.
  const columnOne = (prefix) => [
    { id: `${prefix}1`, label: "I", vocalization: "I" },
    { id: `${prefix}2`, label: "Speak", action: ":speak" },
  ];

  fixture({
    name: "first-column-gap",
    summary: "ext_lautstark_first_column_gap on a package whose leftmost column repeats across both boards.",
    members: [
      { name: "manifest.json", data: json(manifest({
          id: "1f0a5c2e-0000-4000-8000-00000000000d",
          modified: "2026-08-25T09:00:00Z",
          packageName: "Left column",
          root: "boards/start.obf",
          boards: { start: "boards/start.obf", food: "boards/food.obf" },
          images: {}, sounds: {},
          symbolSource: "none",
          firstColumnGap: true,
        })) },
      { name: "boards/start.obf", data: json({
          format: "open-board-0.1", id: "start", locale: "en", name: "Start",
          buttons: [
            ...columnOne("p"),
            { id: "s1", label: "want", vocalization: "want" },
            { id: "s2", label: "Food",
              load_board: { id: "food", name: "Food", path: "boards/food.obf" } },
            { id: "s3", label: "Clear", action: ":clear" },
            { id: "s4", label: "Undo", action: ":backspace" },
          ],
          grid: { rows: 2, columns: 3,
                  order: [["p1", "s1", "s2"], ["p2", "s3", "s4"]] },
        }) },
      { name: "boards/food.obf", data: json({
          format: "open-board-0.1", id: "food", locale: "en", name: "Food",
          buttons: [
            ...columnOne("q"),
            { id: "f1", label: "Apple", vocalization: "an apple" },
            { id: "f2", label: "Start", action: ":home" },
          ],
          grid: { rows: 2, columns: 3,
                  order: [["q1", "f1", "f2"], ["q2", null, null]] },
        }) },
    ],
    expected: {
      outcome: "accepted",
      package: { id: "1f0a5c2e-0000-4000-8000-00000000000d", name: "Left column",
                 modified: "2026-08-25T09:00:00Z", symbol_source: "none",
                 redistributable: true, root_board: "start",
                 first_column_gap: true },
      boards: [
        { id: "start", name: "Start", locale: "en", rows: 2, columns: 3 },
        { id: "food", name: "Food", locale: "en", rows: 2, columns: 3 },
      ],
      buttons: [
        { board: "start", id: "p1", label: "I", vocalization: "I", on_activate: "append", audio: "tts", state: "normal" },
        { board: "start", id: "s1", label: "want", vocalization: "want", on_activate: "append", audio: "tts", state: "normal" },
        { board: "start", id: "s2", label: "Food", on_activate: "navigate:food", state: "normal" },
        { board: "start", id: "p2", label: "Speak", on_activate: "speak_bar", state: "normal" },
        { board: "start", id: "s3", label: "Clear", on_activate: "clear", state: "normal" },
        { board: "start", id: "s4", label: "Undo", on_activate: "backspace", state: "normal" },
        { board: "food", id: "q1", label: "I", vocalization: "I", on_activate: "append", audio: "tts", state: "normal" },
        { board: "food", id: "f1", label: "Apple", vocalization: "an apple", on_activate: "append", audio: "tts", state: "normal" },
        { board: "food", id: "f2", label: "Start", on_activate: "home", state: "normal" },
        { board: "food", id: "q2", label: "Speak", on_activate: "speak_bar", state: "normal" },
      ],
      warnings: [],
      notes: [
        "The whole assertion about the hint is one boolean on the package: first_column_gap is true and every board in it is drawn with extra space after column 1. It is package-wide by design - a gap that came and went from page to page would move every other column as the user navigated, which is the opposite of what a fixed column is for.",
        "The flag changes no button, no grid and no id. An importer that ignores it produces this same model with the same warnings, renders a correct board with the wrong emphasis, and is still conformant at 1.0.0 - which is what makes this a minor version (SPEC.md 12).",
        "Nothing here says a button is persistent, because the format has no such field. The first column repeats because the builder wrote it onto both boards, and that is all persistence ever is in a package. Reading the gap as an instruction to carry column 1 over from the previous board would render this package right by accident and the next one wrong.",
        "Rendering is not covered by any fixture and is not covered by this one either - see the README. What is asserted is that the flag arrives on the model, in a package that also gives an importer something to draw it around.",
      ],
    },
  });
}

// --- Index and cleanup -------------------------------------------------------

writeFileSync(join(OUT, "index.json"),
              json({ spec_version: SPEC_VERSION,
                     generated_by: "exchange/tools/make_fixtures.mjs",
                     fixtures: index }));
console.log(`${index.length} fixtures written to ${OUT}`);
