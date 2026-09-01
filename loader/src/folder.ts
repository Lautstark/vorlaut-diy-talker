// The build, written into a folder somebody can see.
//
// The cable is how content reaches a talker, and for as long as it is the only
// way, everything depends on it working the first time it meets hardware. This
// is the other end of that risk: the same files the cable would send, on the
// disk instead, where two other things can reach them.
//
//   - `tools/serialcheck.html` has a directory picker. It is the bench, it is
//     independent of this page, and it can push a folder at a device when the
//     page cannot.
//   - `mklittlefs` turns a directory into a file system image, which `esptool`
//     writes straight into the partition. That path needs no cable protocol at
//     all - it is the one that works when the wire itself is wrong.
//
// So this is not an export in the sense the Daten panel means it, and it is
// deliberately not part of the backup: a build is derived from the board and
// the symbols, and carrying it in a backup would be carrying something that
// can be made again. What cannot be made again by any other means is the
// *shape* - a folder that is byte for byte what the device's file system
// should hold - and that is what this writes.
//
// It does not remember the folder. The standing backup does, because it writes
// unattended and a folder it forgot is a backup that silently stopped. This
// runs when somebody asks it to, before a bench run or an image, so a picker
// each time costs one click and saves a stored handle whose permission can
// lapse without anybody noticing.
//
// Asking and writing are two functions, the way the cable's are, and for the
// same reason: a picker needs a user gesture that expires in about five
// seconds, so whatever is slow has to come after it.
import type { Build } from "./cable.js";
import { HASH_BYTES, LAYOUT_BIN } from "./layout_format.js";

/** Whether a folder can be chosen at all: Chromium on the desktop, and nowhere
 *  else. Safari and Firefox have no picker, and no browser on Android has one
 *  - the same ground @lautstark/sicherung covers for the backup. */
export function folderExportSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Names this build could have written, and the only ones a tidy-up will
 *  remove.
 *
 * The rule is the device's own naming rather than a list of what was written
 * last time, because there is no last time to consult - nothing here is
 * remembered between runs. A tile is `t` and a hash, a recording is `a` and a
 * hash, a collection is `c` and a hash, and `layout.bin` is the one fixed name
 * a collection used to go under. Anything else in the chosen folder belongs to
 * whoever put it there and is left alone: somebody who picks their Documents
 * folder by mistake should lose nothing.
 *
 * `layout.bin` is still here although nothing writes it, and that is the point:
 * this is what a tidy-up may REMOVE, and a folder written before 2026-08-31 has
 * one in it. Leaving it would put a second collection into an image built with
 * mklittlefs, holding whatever was exported last time.
 *
 * Built out of HASH_BYTES rather than written as a literal, so a change to the
 * hash length cannot leave this quietly matching nothing - which would show up
 * as an export that stops tidying up rather than as a failure.
 */
const HEX = `[0-9a-f]{${HASH_BYTES * 2}}`;
const OURS = new RegExp(`^(t${HEX}\\.bin|a${HEX}\\.wav|c${HEX}\\.bin)$`);

export function isBuildFile(name: string): boolean {
  return name === LAYOUT_BIN || OURS.test(name);
}

export type Exported = {
  /** The folder's own name, for saying which one it went into. */
  folder: string;
  written: number;
  /** Files from an earlier export that this build no longer has. */
  removed: number;
  bytes: number;
};

export type Exporting = {
  onFile?: (name: string, done: number, total: number) => void;
};

/**
 * Asks which folder. From a click, and from nothing else.
 *
 * Separate from the writing for the reason askForDevice() is separate from
 * sendToDevice(): a picker needs transient activation, which expires in about
 * five seconds, so anything slow has to happen *after* it rather than before.
 * The caller may need to run a build in between, and a build takes longer than
 * the activation lasts.
 *
 * Answers null when the dialog was dismissed, which is not a failure: it is
 * somebody changing their mind, and nothing should happen.
 */
export async function chooseBuildFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!folderExportSupported()) return null;
  try {
    return await window.showDirectoryPicker({
      mode: "readwrite", id: "vorlaut-build", startIn: "documents",
    });
  } catch {
    // Dismissed, or refused for want of a gesture. Neither is worth a message.
    return null;
  }
}

/**
 * Writes a compiled package into a folder that has already been chosen.
 *
 * Two refusals used to stand at the top of this: that there was a build at
 * all, and that it was a build of what was on the screen. Both were about the
 * `data` store, which is what a folder cannot show you afterwards - yesterday's
 * content looks exactly like today's on a disk. Neither is answerable here and
 * neither is needed: there is no screen to be stale against and no store to be
 * empty, only the file the person on this page chose a minute ago and watched
 * being compiled.
 */
export async function writeBuildTo(
  directory: FileSystemDirectoryHandle, build: Build, options: Exporting = {},
): Promise<Exported> {
  const { onFile = () => {} } = options;

  let written = 0;
  let bytes = 0;
  for (const [name, file] of build) {
    onFile(name, written + 1, build.size);
    const handle = await directory.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(file);
    } finally {
      // Closing is what commits the file. A write that threw must still close
      // its stream, or the folder keeps a lock and the next export cannot open
      // the same name.
      await stream.close();
    }
    written++;
    bytes += file.length;
  }

  // Now the ones this build did not produce. Collected first and removed
  // afterwards rather than deleted while iterating: a directory being walked
  // while its entries are removed is the sort of thing that works in one
  // browser and skips every second file in another.
  const stale: string[] = [];
  for await (const entry of directory.values()) {
    if (entry.kind !== "file") continue;
    if (!isBuildFile(entry.name) || build.has(entry.name)) continue;
    stale.push(entry.name);
  }
  for (const name of stale) await directory.removeEntry(name);

  return { folder: directory.name, written, removed: stale.length, bytes };
}
