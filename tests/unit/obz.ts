/* A .obz, read back into the shape the builder produced it from.
 *
 * This exists so that one checker can be pointed at two things: a package this
 * repository has just written, and the conformance fixtures under exchange/,
 * which are normative and were written by somebody else's program. A rule that
 * only ever sees its own output is a rule that agrees with itself.
 *
 * Test-only, and under tests/ rather than src/ for two reasons: nothing the
 * page does needs to read a package back - vorlaut writes app packages and the
 * Android viewer reads them - and tests/unit/reachable.test.ts holds every
 * module under src/ to being reachable from main.ts, which this would not be.
 *
 * The zip reading is the central directory, as exchange/SPEC.md §2 requires of
 * an importer: recovering members by scanning for local headers is what that
 * section forbids, and a reader that did it here would quietly accept packages
 * the viewer must reject.
 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import type { AppPackage, PackageBoard, PackageManifest } from "../../src/data/app_package.js";

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** The general purpose bit flag, so a test can assert bit 11 is set. */
  flags: number;
  method: number;
}

/** Every member of the archive, by name, read through the central directory. */
export function unzip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === END_SIGNATURE) { end = at; break; }
  }
  if (end < 0) throw new Error("no end-of-central-directory record: not a zip");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error("the central directory is unreadable");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.slice(at + 46, at + 46 + nameLength));

    // The local header again, because only it says how long its own name and
    // extra field are - the central copy may differ.
    const localNameLength = view.getUint16(offset + 26, true);
    const localExtraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + localNameLength + localExtraLength;
    const raw = bytes.slice(start, start + compressedSize);
    const data = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));

    out.set(name, { name, data, flags, method });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/**
 * The package as {manifest, boards, files} - what buildAppPackage() produces.
 *
 * Board documents are taken from paths.boards rather than from every member
 * ending in .obf, because §3 makes `paths` the authority on where a member
 * lives and a package may carry a board the manifest does not list.
 */
export function readPackage(bytes: Uint8Array): AppPackage {
  const members = unzip(bytes);
  const manifestEntry = members.get("manifest.json");
  if (!manifestEntry) throw new Error("no manifest.json at the archive root");
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as PackageManifest;

  const boards: PackageBoard[] = [];
  for (const path of Object.values(manifest.paths?.boards ?? {})) {
    const entry = members.get(path) ?? members.get(path.normalize("NFC"));
    if (!entry) continue;   // the checker's board-unresolved case says so
    boards.push(JSON.parse(new TextDecoder().decode(entry.data)) as PackageBoard);
  }

  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, entry] of members) {
    if (name === "manifest.json" || name.endsWith(".obf")) continue;
    files.set(name, new Uint8Array(entry.data));
  }
  return { manifest, boards, files };
}

export const readPackageFile = (path: string): AppPackage =>
  readPackage(new Uint8Array(readFileSync(path)));
