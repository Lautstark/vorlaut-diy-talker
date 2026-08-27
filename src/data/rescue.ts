/** Getting the data out of a database this code has refused to touch.
 *
 * data/migrations.ts is the ordinary path: an ordered step per version, run
 * inside the upgrade transaction. This is what is left when there is no step
 * for a version, or when a database is not the shape its version claims - both
 * of which abort the upgrade, so the browser is still holding everything it
 * had, and the page is looking at an open() that rejected.
 *
 * What a person is owed at that moment, before they agree to discard anything,
 * is the contents in a file. This makes that file.
 *
 * **It is not a Sicherung.** A Sicherung is a documented format with a reader
 * on the other side; this is a raw dump of records nothing in this repository
 * knows the shape of, which is exactly the situation it exists for. Anybody
 * restoring from it is reading it by hand, and the file says so in its own
 * `notice`. That is also why the settings record travels whole rather than
 * stripped: a Sicherung is written into a folder a sync client carries off the
 * machine, and this is a file a person asked for once, on a page that will not
 * start.
 *
 * The base64 below is why nothing in here may be called from inside the
 * upgrade transaction - awaiting anything that is not a request on that
 * transaction commits it underneath the caller. See data/migrations.ts.
 */

/** Every store in a database, as it was found. Keys and values separately,
 *  because half of these stores have no keyPath and the key is the name. */
export interface Dump {
  version: number;
  stores: Record<string, { keys: IDBValidKey[]; values: unknown[] }>;
}

export const RESCUE_FORMAT = "vorlaut-rescue";

const toBase64 = (bytes: ArrayBuffer): string => {
  // In chunks, for the reason data/backup.ts gives: fromCharCode(...) on a
  // large picture overflows the argument list at whatever size the browser
  // decides.
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let from = 0; from < view.length; from += 0x8000) {
    binary += String.fromCharCode(...view.subarray(from, from + 0x8000));
  }
  return btoa(binary);
};

/** Every record, with the bytes spelled out, ready for JSON.stringify.
 *
 * The notice is passed in for the reason data/backup.ts's is: this module has
 * no language, and the caller has the table. */
export function asFile(dump: Dump, notice: string): unknown {
  const stores: Record<string, { key: unknown; value: unknown }[]> = {};
  for (const [name, held] of Object.entries(dump.stores)) {
    stores[name] = held.keys.map((key, at) => {
      const value = held.values[at];
      return {
        key: typeof key === "string" || typeof key === "number" ? key : String(key),
        value: value instanceof ArrayBuffer ? { base64: toBase64(value) } : value,
      };
    });
  }
  return { format: RESCUE_FORMAT, version: dump.version,
           exportedAt: new Date().toISOString(), notice, stores };
}
