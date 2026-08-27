// The bytes of a file, as the package data/device_package.ts reads.
//
// Two steps that are easy to run together and must not be: the archive is
// opened here, and what is inside it is judged there. readDevicePackage() is
// deliberately given an already-unzipped package - "so that this file needs no
// zip reader", as its own note says - and this is the half that has one.
//
// Nothing here decides whether a package is good. It decides whether there is
// a package at all: an archive with a manifest, a manifest that names boards,
// and boards that parse as JSON. Everything past that is readDevicePackage()'s
// refusals and validate.ts's warnings, and keeping the three apart is what
// lets each of them say something specific instead of "this file is broken".
import type { DeviceBoard, DeviceManifest, DevicePackage }
  from "./device_package.js";
import { NotAPackage, unzip } from "./unzip.js";

const MANIFEST = "manifest.json";

function parse(members: Map<string, Uint8Array>, name: string): unknown {
  const bytes = members.get(name);
  if (!bytes) throw new NotAPackage(`${name} is named by this package and is not in it`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new NotAPackage(`${name} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * A file somebody chose, as a package - or NotAPackage saying why not.
 *
 * The manifest is believed rather than worked around, and that is the one
 * place this differs from the editor's importer. obf.ts falls back to "every
 * .obf in the archive" when a manifest names nothing usable, because a
 * hand-written manifest is usually the half that is wrong and the boards are
 * still all there. Here the manifest's own order is what readDevicePackage()
 * walks the ring against, so guessing at it would mean guessing at the order
 * the device cycles its sets in - and a talker whose pages are in an order
 * nobody chose is exactly the "parses and is wrong" outcome that file refuses.
 */
export async function readPackageFile(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<DevicePackage> {
  const members = await unzip(bytes);
  if (!members.has(MANIFEST)) {
    throw new NotAPackage(
      "there is no manifest.json in it, so this is a zip but not a package");
  }
  const manifest = parse(members, MANIFEST) as DeviceManifest;
  const paths = Object.values(manifest?.paths?.boards ?? {});
  if (!paths.length) throw new NotAPackage("its manifest names no boards");

  const boards = paths.map((path) => parse(members, path) as DeviceBoard);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, data] of members) {
    if (name === MANIFEST || name.endsWith(".obf") || name.endsWith("/")) continue;
    files.set(name, data);
  }
  return { manifest, boards, files };
}
