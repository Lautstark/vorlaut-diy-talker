import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../../src/data/store.js";
// From the module that owns it. data/store.ts calls touched(); this is the
// other end of the same wire, and the two being separate files is the point -
// see the head of data/changed.ts.
import { onChanged } from "../../src/data/changed.js";
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
    heard = 0;
    stop();
    stop = onChanged(() => { heard++; });
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

  /* Two deliberate silences used to be tested here, so that "helpfully" wiring
   * them up later had to argue with something. Both were about the build: a
   * data/ store that a build emptied and refilled, where announcing would have
   * rewritten the backup file once per artefact to say nothing new, and
   * recordBuild(), which stamped which layout a build had run against.
   *
   * The build is not in this page any more (adr/0011) and neither of them
   * exists. What is left announces, all of it, which is the simpler rule and
   * is now the true one: every store here holds content, and content is what
   * the standing backup is for.
   */

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
