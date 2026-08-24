/* Reading a .obz back off disk, for the two specs that write one.
 *
 * A copy of neither: tests/unit/obz.ts does the same job for the unit suite
 * and cannot be shared, because that one reads packages this process built in
 * memory and this one reads bytes a browser downloaded. What is here is the
 * zip half, which is the part with an actual format in it.
 */
import { expect } from "@playwright/test";
import { inflateRawSync } from "node:zlib";
import type { AppPackage, PackageBoard, PackageManifest }
  from "../src/data/app_package.js";

export interface Member { name: string; data: Uint8Array; flags: number }

export function unzip(bytes: Uint8Array): Map<string, Member> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  expect(end, "no end-of-central-directory record").toBeGreaterThan(-1);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, Member>();

  for (let n = 0; n < count; n++) {
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.slice(start, start + size);
    out.set(name, { name, flags, data: method === 0 ? raw : new Uint8Array(inflateRawSync(raw)) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

export function readPackage(bytes: Uint8Array): { pkg: AppPackage; members: Map<string, Member> } {
  const members = unzip(bytes);
  const parse = (name: string) =>
    JSON.parse(new TextDecoder().decode(members.get(name)!.data));
  const manifest = parse("manifest.json") as PackageManifest;
  const boards = Object.values(manifest.paths.boards).map((path) => parse(path) as PackageBoard);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, member] of members) {
    if (name === "manifest.json" || name.endsWith(".obf")) continue;
    files.set(name, new Uint8Array(member.data));
  }
  return { pkg: { manifest, boards, files }, members };
}

