/** One step per version, in order, the way a migration is supposed to look.
 *
 * ## What this is
 *
 * `upgradeneeded` hands over `oldVersion`, `newVersion` and a transaction that
 * commits everything in it or nothing. That is the whole mechanism, and using
 * it means what it means everywhere else: **an ordered list of deltas, each
 * doing one thing, replayed from wherever a database happens to be.** idb's own
 * README, MDN, and every schema tool with migrations in it - Rails, Django,
 * Flyway, Alembic - describe the same arrangement. This is that list.
 *
 * The first version of this file did something else: it dumped every store,
 * recognised the *shape* of what came out, and rewrote the whole database
 * through the current schema. It worked, and it was wrong twice over. It
 * dispatched on a guess when IndexedDB had already handed over the version
 * number, and it did O(the whole database) of work for changes that are
 * usually O(one store) - version 4, the one that cost somebody every board she
 * had, is `deleteObjectStore("data")` and nothing else. A migration that never
 * reads a layout cannot lose one.
 *
 * ## The rule every step lives under
 *
 * > **Nothing in a step may `await` anything that is not a request on `tx`.**
 *
 * A transaction stays open only while requests are outstanding on it, so one
 * await on a `crypto.subtle` digest, a `btoa`, a folder write or a question put
 * to a person commits it underneath the step - and a half-applied migration is
 * the failure this whole arrangement exists to make impossible. The head of
 * store.ts documents that trap in general; here it is load-bearing.
 *
 * What it rules out, concretely: a step may **move** a layout, and may not
 * **rewrite** one. The stored `text` and the `version` hash over it are a
 * matched pair, re-deriving the hash is a `crypto.subtle` call, and there is
 * nowhere in here to make one. A future change to what is *inside* a layout
 * therefore cannot be done as a step - it has to come back to adr/0015 rather
 * than around it.
 *
 * ## Preconditions, and why they are not the old shape-sniffing
 *
 * Each step says which stores it expects to find. That is an assertion, not a
 * dispatch: the version number decides *which* steps run, and the precondition
 * only refuses a database that is not what its version claims to be. A step
 * that ran anyway would write into stores it had not understood, silently,
 * which is worse than the stop.
 *
 * ## Adding one
 *
 * Bump DB_VERSION in store.ts, add the step whose `to` is the new number, and
 * that is the whole of it. Forget it and nothing is lost: plan() below refuses
 * a version it has no step for, store.ts aborts the upgrade, and the browser
 * keeps its version and its records while the page says so. That failure is
 * designed rather than tolerated - it is the difference between a bug found in
 * the minute after it is made and a wipe nobody sees until somebody writes in.
 */

import type { IDBPDatabase, IDBPTransaction } from "idb";

/** A database and a transaction whose stores are not the current schema's.
 *
 * Deliberately typeless. A step works on the shape of a version that has been
 * left behind - `content`, `data`, whatever a later one drops - and none of
 * those are in the schema `store.ts` declares. idb documents this cast for
 * exactly this case. What that costs is that the compiler cannot check a step,
 * which is why every one of them is covered by a test that seeds the version
 * it starts from. */
export type OldDB = IDBPDatabase<unknown>;
export type OldTx = IDBPTransaction<unknown, string[], "versionchange">;

/** Thrown when there is no step for a version this database has to cross.
 *
 *  A code rather than a sentence: this module has no language, and the caller
 *  has the table. What it means at the call site is *do not touch this
 *  database.* */
export const MISSING_STEP = "store:no-migration";

/** Thrown when a step is asked to run against a database that is not the shape
 *  its version says it is. Same meaning, same answer. */
export const WRONG_SHAPE = "store:wrong-shape";

export interface Step {
  /** The version this step produces. */
  to: number;
  /** Stores that must already be there. See "Preconditions" above. */
  expects: readonly string[];
  /** Everything this step does, entirely in requests on `tx`. */
  run(db: OldDB, tx: OldTx): Promise<void>;
}

/** The layout as every version of this database has stored it: the bytes, and
 *  the stamp over those bytes. A step moves this pair and never opens it. */
interface StoredLayout {
  text: string;
  version: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asLayout = (value: unknown): StoredLayout | null =>
  isRecord(value) && typeof value["text"] === "string"
    && typeof value["version"] === "string"
    ? { text: value["text"], version: value["version"] } : null;

export const STEPS: readonly Step[] = [
  {
    /* 1 -> 2: the one layout there was becomes a list of one.
     *
     * Version 1 held it under `layout`, with nothing naming it. Version 2 held
     * a registry under `collections` and a layout per `layout:<id>` beside it,
     * all still inside `content`. So this mints the identity that shape needs
     * and moves one record; the name stays empty, which app.ts's
     * nameIfUnnamed() is what answers, as it does for every Sammlung that
     * arrives without one. */
    to: 2,
    expects: ["content"],
    async run(_db, tx) {
      const content = tx.objectStore("content");
      const layout = asLayout(await content.get("layout"));
      // A version 1 database that was never written to. Nothing to move, and
      // the registry version 2 would have made on its own arrives with the
      // first save.
      if (!layout) return;

      const id = crypto.randomUUID();
      await content.put(layout, `layout:${id}`);
      await content.delete("layout");
      await content.put({ collections: [{ id, name: "" }], current: id }, "collections");
    },
  },
  {
    /* 2 -> 3: out of one keyed store, into a store per kind.
     *
     * This is the only step that moves records in bulk, and it is the one the
     * store-per-kind change was for: `collections` one row per Sammlung with
     * the `updatedAt` index the sidebar reads, `layouts` one record per layout,
     * the marks and the settings in stores of their own. `content` goes at the
     * end, once everything has been read out of it. */
    to: 3,
    expects: ["content"],
    async run(db, tx) {
      db.createObjectStore("collections", { keyPath: "id" })
        .createIndex("updatedAt", "updatedAt");
      db.createObjectStore("layouts", { keyPath: "id" });
      db.createObjectStore("marks");
      db.createObjectStore("settings");

      const content = tx.objectStore("content");
      const collections = tx.objectStore("collections");
      const layouts = tx.objectStore("layouts");

      const registry = await content.get("collections");
      const listed = isRecord(registry) && Array.isArray(registry["collections"])
        ? registry["collections"] : [];

      /* The stamps this shape never had.
       *
       * Version 2's registry was an array in insertion order and carried no
       * `updatedAt` at all - the index on it is what version 3 added. The
       * sidebar draws last-written first, so counting *down* from now keeps
       * the order the person was looking at rather than inverting it. */
      const now = Date.now();
      let at = 0;
      for (const row of listed) {
        if (!isRecord(row) || typeof row["id"] !== "string") continue;
        const id = row["id"];
        const layout = asLayout(await content.get(`layout:${id}`));
        // A row with nothing behind it is a sidebar entry that opens onto
        // nothing. Version 3 cannot make one; version 2 could.
        if (!layout) continue;
        await collections.put({
          id,
          name: typeof row["name"] === "string" ? row["name"] : "",
          updatedAt: now - at,
        });
        await layouts.put({ id, ...layout });
        at++;
      }

      const marks = tx.objectStore("marks");
      const current = isRecord(registry) && typeof registry["current"] === "string"
        ? registry["current"] : null;
      await marks.put(current, "current");
      const built = await content.get("built");
      if (built !== undefined) await marks.put(built, "built");

      const settings = await content.get("settings");
      if (settings !== undefined) await tx.objectStore("settings").put(settings, "settings");

      db.deleteObjectStore("content");
    },
  },
  {
    /* 3 -> 4: the build's store leaves, and nothing else is touched.
     *
     * This is the whole of the change that cost somebody every board she had.
     * adr/0011 took the build out of the editor, `data` held what a build made
     * for the cable, and a store nothing writes is a megabyte of tiles for a
     * device this page can no longer reach - invisible to everything and freed
     * by nothing. One statement, and not one layout is read on the way past. */
    to: 4,
    expects: ["collections", "layouts"],
    async run(db) {
      if (db.objectStoreNames.contains("data")) db.deleteObjectStore("data");
    },
  },
];

/** The steps between where this database is and where it has to be.
 *
 * Refuses rather than skipping. A gap in the list means somebody bumped
 * DB_VERSION without saying what changed, and the two answers to that are
 * *stop* and *carry on into a shape nobody has described*. Only one of them is
 * survivable for the person whose boards are in there.
 *
 * `steps` is a parameter so the refusal can be tested for the gap it is about,
 * rather than only for the gaps this repository happens not to have. */
export function plan(from: number, to: number,
                     steps: readonly Step[] = STEPS): Step[] {
  const wanted: Step[] = [];
  for (let version = from + 1; version <= to; version++) {
    const step = steps.find((one) => one.to === version);
    if (!step) throw new Error(MISSING_STEP);
    wanted.push(step);
  }
  return wanted;
}

/** Runs the plan, checking each step's preconditions on the way in. */
export async function migrate(db: OldDB, tx: OldTx, from: number, to: number,
                              steps: readonly Step[] = STEPS): Promise<void> {
  for (const step of plan(from, to, steps)) {
    for (const name of step.expects) {
      if (!db.objectStoreNames.contains(name)) throw new Error(WRONG_SHAPE);
    }
    await step.run(db, tx);
  }
}

/** Whether an error is one of this module's two refusals, wherever it
 *  surfaced. Both mean the same thing to a caller: the database was left
 *  alone, and somebody has to be told. */
export const isRefusal = (error: unknown): boolean =>
  error instanceof Error
  && (error.message === MISSING_STEP || error.message === WRONG_SHAPE);
