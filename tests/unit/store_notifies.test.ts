import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../../src/data/store.js";
import type { Layout, Settings } from "../../src/core/types.js";

/* Every write that changes what a Sicherung would contain must reach
 * onChanged, because that notifier is the only thing between an edit and the
 * standing backup.
 *
 * The guard is against a quiet failure: somebody adds a writer next year,
 * never having heard of the backup, and a child's talker stops being saved.
 * Nothing else would notice - it keeps working for everything that was
 * already wired. */

const board = (name: string): Layout =>
  ({ sets: [{ name, keys: [] }], voice: "" } as unknown as Layout);

describe("the change notifier", () => {
  let heard = 0;
  let stop = () => {};

  beforeEach(async () => {
    await store.empty("symbols");
    await store.empty("data");
    heard = 0;
    stop();
    stop = store.onChanged(() => { heard++; });
  });

  it("writeLayout() announces the write", async () => {
    await store.writeLayout(board("Kitchen"), null);
    expect(heard).toBe(1);
  });

  /* A conflict wrote nothing. Announcing one would back up the layout this tab
   * lost, which is the opposite of what a backup is for. */
  it("writeLayout() stays quiet when it lost a conflict and wrote nothing", async () => {
    await store.writeLayout(board("First"), null);
    heard = 0;
    const result = await store.writeLayout(board("Second"), "a-version-that-does-not-match");
    expect(result.conflict).toBe(true);
    expect(heard).toBe(0);
  });

  it("writeSettings() announces the write", async () => {
    await store.writeSettings({} as Settings);
    expect(heard).toBe(1);
  });

  it("a picture arriving in symbols/ announces", async () => {
    await store.putFile("symbols", "eins.png", new Uint8Array([1]).buffer);
    expect(heard).toBe(1);
  });

  it("a picture leaving symbols/ announces", async () => {
    await store.putFile("symbols", "eins.png", new Uint8Array([1]).buffer);
    heard = 0;
    await store.dropFile("symbols", "eins.png");
    expect(heard).toBe(1);
  });

  /* The deliberate silences, tested so that "helpfully" wiring them up later
   * has to argue with something.
   *
   * data/ is build output, which a build makes again out of the layout and the
   * symbols, so it is not in the backup. A build empties it and refills it -
   * announcing that would rewrite the file once per artefact to say nothing
   * new. recordBuild() only stamps which layout a build ran against. */
  it("data/ stays quiet, in and out, because it is build output", async () => {
    await store.putFile("data", "sets.bin", new Uint8Array([1]).buffer);
    await store.dropFile("data", "sets.bin");
    await store.empty("data");
    expect(heard).toBe(0);
  });

  it("recordBuild() stays quiet — it stamps a build, it does not change content", async () => {
    await store.recordBuild("abc123");
    expect(heard).toBe(0);
  });

  it("emptying symbols/ does announce, because that is content going away", async () => {
    await store.putFile("symbols", "eins.png", new Uint8Array([1]).buffer);
    heard = 0;
    await store.empty("symbols");
    expect(heard).toBe(1);
  });

  it("stops telling a listener that unsubscribed", async () => {
    stop();
    await store.writeLayout(board("Kitchen"), null);
    expect(heard).toBe(0);
  });
});
