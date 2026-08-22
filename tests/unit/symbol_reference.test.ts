/* What a METACOM pick stores, and what a stored reference resolves to.
 *
 * METACOM ships parallel rendering folders - PNG_mit_Rahmen, PNG_ohne_Rahmen,
 * and friends - holding identical file names. A reference that is only the
 * stem ("metacom:ja") therefore names four pictures at once, and resolution
 * answered with whichever folder the index walked first: you picked the third
 * "ja" and your key showed the first. Since then a pick stores the path under
 * the collection root ("metacom:PNG_ohne_Rahmen/ja") - the folders travel
 * with a METACOM distribution, so the reference survives copies of the same
 * version, and bildquelle degrades it to the stem anywhere else.
 *
 * The bare stem stays valid forever: it is what every board and every export
 * written before this held, and tests/test_symbol_frozen.py freezes that
 * mapping separately. This file covers the new half of the loop: what search
 * hands the picker to store, and what the stored shapes resolve back to.
 */

// Must be first: @lautstark/bildquelle persists its filename index through
// idb, and this environment is node, which has no indexedDB of its own.
import "fake-indexeddb/auto";

import { check } from "./harness.js";

const symbols = await import("../../src/data/symbols.js");
const { metacom } = await import("@lautstark/bildquelle");

/** A File as a directory picker would hand it over, path and all. */
function fileAt(path: string): File {
  const file = new File(["png-bytes"], path.split("/").pop() ?? path, { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

await symbols.readMetacomFiles([
  fileAt("METACOM_9/PNG_mit_Rahmen/ja.png"),
  fileAt("METACOM_9/PNG_ohne_Rahmen/ja.png"),
  fileAt("METACOM_9/PNG_mit_Rahmen/nein.png"),
]);

/* --- what a pick stores -------------------------------------------------- */

const ja = await symbols.search("ja", "metacom");

check("both renderings of one stem reach the dialog",
      ja.length === 2, JSON.stringify(ja.map((hit) => hit.ref)));

check("a pick stores the path under the root, not the stem",
      ja[0]?.ref === "metacom:PNG_mit_Rahmen/ja"
      && ja[1]?.ref === "metacom:PNG_ohne_Rahmen/ja",
      JSON.stringify(ja.map((hit) => hit.ref)));

check("twin captions say which folder, without touching the label",
      ja.every((hit) => hit.label === "ja")
      && ja[0]?.hint === "PNG mit Rahmen" && ja[1]?.hint === "PNG ohne Rahmen",
      JSON.stringify(ja.map((hit) => [hit.label, hit.hint])));

const nein = await symbols.search("nein", "metacom");

check("a label without a twin carries no hint",
      nein.length === 1 && nein[0].hint === undefined
      && nein[0].ref === "metacom:PNG_mit_Rahmen/nein",
      JSON.stringify(nein));

/* --- what a stored reference resolves to --------------------------------- */

// Through the same provider instance symbols.ts resolves with, so the paths
// asserted here are the ones metacomImageByName() turns into object URLs.

check("a folder-qualified reference finds its own rendering",
      metacom.idForName("PNG_ohne_Rahmen/ja") === "METACOM_9/PNG_ohne_Rahmen/ja.png"
      && metacom.idForName("PNG_mit_Rahmen/ja") === "METACOM_9/PNG_mit_Rahmen/ja.png");

check("a bare stem still resolves, first hit, as every old board expects",
      metacom.idForName("ja") === "METACOM_9/PNG_mit_Rahmen/ja.png");

check("a folder this copy does not have degrades to the stem",
      metacom.idForName("JPG_farbig/ja") === "METACOM_9/PNG_mit_Rahmen/ja.png");

check("both shapes come back as a picture, through the page's own funnel",
      Boolean(await symbols.metacomImageByName("ja"))
      && Boolean(await symbols.metacomImageByName("PNG_ohne_Rahmen/ja"))
      && (await symbols.metacomImageByName("PNG_ohne_Rahmen/nirgends")) === null);

/* --- the id shapes bildquelle produces ------------------------------------ */

// A picked directory handle indexes paths WITHOUT the root; only file lists
// and zips put it in front. readMetacomFiles can only fabricate the rootful
// shape, so the root-aware halves are checked as the pure functions they are:
// cutting the first segment blind off a handle id would cut the rendering
// folder itself and store the stem - the very loss this reference exists to
// prevent.

check("a handle-shaped id keeps its folder, because the root is not there",
      symbols.pickReference("PNG_ohne_Rahmen/ja.png", "METACOM 9") === "metacom:PNG_ohne_Rahmen/ja"
      && symbols.folderOf("PNG_ohne_Rahmen/ja.png", "METACOM 9") === "PNG ohne Rahmen");

check("a rootful id loses exactly the root",
      symbols.pickReference("METACOM_9/PNG_ohne_Rahmen/ja.png", "METACOM_9") === "metacom:PNG_ohne_Rahmen/ja"
      && symbols.folderOf("METACOM_9/PNG_ohne_Rahmen/ja.png", "METACOM_9") === "PNG ohne Rahmen");

check("a file straight under the root stays the bare stem, with nothing to hint",
      symbols.pickReference("METACOM_9/ja.png", "METACOM_9") === "metacom:ja"
      && symbols.folderOf("METACOM_9/ja.png", "METACOM_9") === "");
