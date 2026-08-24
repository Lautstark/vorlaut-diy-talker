import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../../src/data/store.js";
import type { Layout } from "../../src/core/types.js";

/* Several boards in one browser: making them, switching, copying, deleting.
 *
 * Ordinary bookkeeping, mostly, and it would go wrong loudly. The one that
 * would not is identity: ids are minted here and never derived from a name or
 * a position, so nothing in this file can hand two Sammlungen the same one.
 * exchange/SPEC.md §8 is what that eventually feeds.
 */

const board = (name: string): Layout => ({
  sleep_timeout_seconds: 600,
  sets: [{
    name, symbol: "", color: "#3B5BDB", active: true,
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  }],
});

/** Back to no boards at all, which is what a browser that has never opened
 *  this page has. deleteCollection() is the only way there and is also under test,
 *  so a failure in it shows up as the next test starting from the wrong
 *  place - which is why each test below asserts the list it expects. */
async function empty(): Promise<void> {
  for (const one of (await store.readCollections()).collections) await store.deleteCollection(one.id);
}

beforeEach(empty);

describe("a browser with several Sammlungen in it", () => {
  it("starts with none, and the first write makes one", async () => {
    expect((await store.readCollections()).collections).toHaveLength(0);

    // This is the shape of a first visit: loadLayout() finds nothing and
    // writes the editor's blank board, and the board it lands in has to exist
    // by the time that write returns.
    await store.writeLayout(board("First"), null);

    const list = await store.readCollections();
    expect(list.collections).toHaveLength(1);
    expect(list.current).toBe(list.collections[0]!.id);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("First");
  });

  it("keeps three apart, and opens the one it was told to", async () => {
    const kitchen = await store.createCollection("Kitchen", board("Kitchen set"));
    const nursery = await store.createCollection("Nursery", board("Nursery set"));
    const garden = await store.createCollection("Garden", board("Garden set"));

    const list = await store.readCollections();
    // Membership, not order - the order is last-edited-first and has a test of
    // its own below. Asserting it here would be asserting the clock: three
    // creations inside one millisecond sort by nothing.
    expect(list.collections.map((one) => one.name).sort())
      .toEqual(["Garden", "Kitchen", "Nursery"]);
    // The last one made is the one open: making one is done in order to edit
    // it.
    expect(list.current).toBe(garden);

    await store.useCollection(kitchen);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Kitchen set");
    await store.useCollection(nursery);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Nursery set");
  });

  it("writes to the board that is open and to no other", async () => {
    const one = await store.createCollection("One", board("Untouched"));
    await store.createCollection("Two", board("Two"));

    // "Two" is open. Writing here must not reach "One".
    await store.writeLayout(board("Edited"), null);

    expect((await store.readLayoutOf(one))?.sets[0]?.name).toBe("Untouched");
  });

  /* Every Sammlung's id is its own. Nothing here derives one from a name or a
   * position, so nothing here can hand two of them the same one - which is the
   * property exchange/SPEC.md §8 eventually rests on. */
  it("gives every Sammlung an id of its own", async () => {
    await store.createCollection("Kitchen", board("Kitchen set"));
    await store.createCollection("Kitchen", board("Also Kitchen"));

    const list = await store.readCollections();
    expect(list.collections).toHaveLength(2);
    expect(new Set(list.collections.map((one) => one.id)).size).toBe(2);
    // Same name, different Sammlungen: the name is not the identity.
    expect(list.collections[0]!.name).toBe(list.collections[1]!.name);
  });

  it("renaming changes the name and nothing else", async () => {
    const id = await store.createCollection("Kitchen", board("Kitchen set"));
    await store.renameCollection(id, "The kitchen one");

    const list = await store.readCollections();
    expect(list.collections[0]!.id).toBe(id);
    expect(list.collections[0]!.name).toBe("The kitchen one");
    expect((await store.readLayoutOf(id))?.sets[0]?.name).toBe("Kitchen set");
  });

  it("deleting takes the layout with it", async () => {
    const id = await store.createCollection("Kitchen", board("Kitchen set"));
    await store.deleteCollection(id);

    expect((await store.readCollections()).collections).toHaveLength(0);
    expect(await store.readLayoutOf(id)).toBeNull();
  });

  /* Never a page with no board on it while there is still a board to show. */
  it("deleting the open one opens the one that took its place", async () => {
    const first = await store.createCollection("First", board("First"));
    const second = await store.createCollection("Second", board("Second"));
    await store.useCollection(first);
    await store.deleteCollection(first);

    expect((await store.readCollections()).current).toBe(second);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Second");
  });

  it("deleting one that is not open leaves the open one open", async () => {
    const first = await store.createCollection("First", board("First"));
    const second = await store.createCollection("Second", board("Second"));
    await store.deleteCollection(first);

    expect((await store.readCollections()).current).toBe(second);
  });

  /* The last one out leaves an empty list rather than an empty board. What
   * happens next is loadLayout()'s answer - it seeds one, the same as a first
   * visit - and that is a better answer than a page with nothing on it. */
  it("deleting the last one leaves nothing, for the seed to fill", async () => {
    const only = await store.createCollection("Only", board("Only"));
    await store.deleteCollection(only);

    const list = await store.readCollections();
    expect(list.collections).toHaveLength(0);
    expect(list.current).toBeNull();
    expect((await store.readLayout()).layout).toBeNull();
  });

  /* The order the sidebar shows, which is the one thing about the list that is
   * a decision rather than bookkeeping. conventions.md §1.4: last edited first,
   * because what a list of Sammlungen is for is getting back to the one you
   * were in, and creation order reliably puts that at the bottom. */
  it("puts the one last written at the top", async () => {
    /* No waiting between these, deliberately. The stamp is strictly increasing
     * rather than a bare Date.now(), so three creations inside one millisecond
     * still have an order - and this test is what says so. It used to sleep
     * 2ms between each, which made it pass and left the ordering undefined
     * for anything faster than a person. */
    await store.createCollection("First", board("First"));
    const second = await store.createCollection("Second", board("Second"));
    const third = await store.createCollection("Third", board("Third"));

    // Writing to it is what moves it, not opening it: opening is not an edit.
    await store.useCollection(second);
    await store.writeLayout(board("Second, edited"), null);

    const list = await store.readCollections();
    expect(list.collections[0]!.id).toBe(second);
    // And the one before it stays where it was relative to the rest.
    expect(list.collections.map((one) => one.name)).toContain("Third");
    expect(list.collections.findIndex((one) => one.id === third))
      .toBeLessThan(list.collections.findIndex((one) => one.name === "First"));
  });

  /* Two tabs are two writers, and that was true of one Sammlung before it was
   * true of several. What is worth pinning here is that the stamp is per
   * board: a write to this board must not be refused because a different one
   * moved. */
  it("still refuses a write against a stamp that has moved", async () => {
    await store.createCollection("Kitchen", board("Kitchen set"));
    const held = await store.readLayout();
    await store.writeLayout(board("Somebody else"), held.version);

    const late = await store.writeLayout(board("This tab"), held.version);
    expect(late.conflict).toBe(true);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Somebody else");
  });

  it("does not refuse a write because a different one moved", async () => {
    const first = await store.createCollection("First", board("First"));
    const second = await store.createCollection("Second", board("Second"));

    await store.useCollection(first);
    const held = await store.readLayout();
    // Somebody writes to the other one in the meantime. By id rather than by
    // position: the list is ordered by what was written last, so an index into
    // it means something different after every write.
    await store.useCollection(second);
    await store.writeLayout(board("Second, edited"), null);
    await store.useCollection(first);

    const result = await store.writeLayout(board("First, edited"), held.version);
    expect(result.conflict).toBeFalsy();
  });
});
