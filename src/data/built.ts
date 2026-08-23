// What the last build produced, read back out of the store.
//
// The build writes into the `data` store and answers with nothing but its log,
// which is the arrangement builder.py had with data/ and the reason a megabyte
// never travels through a return value. Something else comes and reads it
// afterwards, by name, the way the device always has - and there are two
// somethings now: the cable sends it to a talker, the folder export writes it
// where mklittlefs and the bench can reach it.
//
// Both want exactly this and want it checked the same way, so it is written
// once and it lives here rather than beside the build. backend/local.ts is the
// build's orchestration and carries everything that implies - the symbol
// sources, the speech chain, the log's own language - and none of that has any
// business being loaded by a module whose whole job is to read three object
// stores. It is also what made this untestable without a DOM.
import * as store from "./store.js";
import { LAYOUT_BIN } from "./layout_format.js";
import { Trouble } from "../core/errors.js";

/** One file out of a build.
 *
 * The array is said to be backed by an ArrayBuffer rather than left as the
 * general Uint8Array, because it is: every one of them is built from what the
 * store handed back. Saying so is what lets the folder export pass the bytes
 * straight to a writable stream without a copy or a cast. */
export type BuiltFile = { bytes: Uint8Array<ArrayBuffer> };

/** Whether the build in the store is a build of what is on the screen.
 *
 * The mark is written by recordBuild() against the layout version the build
 * ran on, so this goes false the moment anybody types. A build that no longer
 * matches is not an error in itself - the page shows it as "a release is due" -
 * but it is one for anything that would carry it to a device.
 */
export async function buildIsCurrent(): Promise<boolean> {
  const held = await store.readLayout();
  return held.buildCurrent === "1";
}

/**
 * The whole of it, by name, as bytes.
 *
 * The sizes the store lists are checked against what actually comes back. A
 * length that disagrees means a build ran while this was reading, and half of
 * one build with half of another is a device that is wrong in a way nothing
 * afterwards would notice - so it stops instead of shipping a mixture.
 */
export async function builtFiles(): Promise<Map<string, BuiltFile>> {
  const listed = await store.listFiles("data");
  const made = new Map<string, BuiltFile>();
  for (const entry of listed) {
    const held = await store.getFile("data", entry.name);
    if (!held) throw new Trouble("build_moved");
    const bytes = new Uint8Array(held);
    if (bytes.length !== entry.size) throw new Trouble("build_moved");
    made.set(entry.name, { bytes });
  }
  // Without it there is no build, whatever else is lying in the store: it is
  // the table that says which file belongs to which key.
  if (!made.has(LAYOUT_BIN)) throw new Trouble("build_none");
  return made;
}
