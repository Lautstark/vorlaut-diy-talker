import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../../src/data/store.js";
import type { Layout } from "../../src/core/types.js";

/* Several boards in one browser: making them, switching, copying, deleting.
 *
 * The check this file exists for is the one in "a copy is its own board".
 * Everything else here is ordinary bookkeeping that would go wrong loudly; a
 * duplicate that inherits its original's id goes wrong quietly and then
 * destructively, and not here - on somebody's tablet, months later, when the
 * copy is exported and silently replaces the original it was made from.
 * exchange/SPEC.md §8 states the rule and says the same thing about it: it is
 * the one that gets forgotten.
 */

const board = (name: string): Layout => ({
  sleep_timeout_seconds: 600,
  sets: [{
    name, symbol: "", color: "#3B5BDB", active: true,
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  }],
});

/** Back to no boards at all, which is what a browser that has never opened
 *  this page has. deleteBoard() is the only way there and is also under test,
 *  so a failure in it shows up as the next test starting from the wrong
 *  place - which is why each test below asserts the list it expects. */
async function empty(): Promise<void> {
  for (const one of (await store.readBoards()).boards) await store.deleteBoard(one.id);
}

beforeEach(empty);

describe("a browser with several boards in it", () => {
  it("starts with none, and the first write makes one", async () => {
    expect((await store.readBoards()).boards).toHaveLength(0);

    // This is the shape of a first visit: loadLayout() finds nothing and
    // writes the editor's blank board, and the board it lands in has to exist
    // by the time that write returns.
    await store.writeLayout(board("First"), null);

    const list = await store.readBoards();
    expect(list.boards).toHaveLength(1);
    expect(list.current).toBe(list.boards[0]!.id);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("First");
  });

  it("keeps three boards apart, and opens the one it was told to", async () => {
    const kitchen = await store.createBoard("Kitchen", board("Kitchen set"));
    const nursery = await store.createBoard("Nursery", board("Nursery set"));
    const garden = await store.createBoard("Garden", board("Garden set"));

    const list = await store.readBoards();
    expect(list.boards.map((one) => one.name)).toEqual(["Kitchen", "Nursery", "Garden"]);
    // The last one made is the one open: making a board is done in order to
    // edit it.
    expect(list.current).toBe(garden);

    await store.useBoard(kitchen);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Kitchen set");
    await store.useBoard(nursery);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Nursery set");
  });

  it("writes to the board that is open and to no other", async () => {
    const one = await store.createBoard("One", board("Untouched"));
    await store.createBoard("Two", board("Two"));

    // "Two" is open. Writing here must not reach "One".
    await store.writeLayout(board("Edited"), null);

    expect((await store.readLayoutOf(one))?.sets[0]?.name).toBe("Untouched");
  });

  /* The rule that gets forgotten. A copy that kept the original's id would
   * overwrite it wherever the two meet again - on the viewer, in a re-import,
   * in anything that keys on identity rather than on the name a person typed. */
  it("a copy is its own board, with an id of its own", async () => {
    const original = await store.createBoard("Kitchen", board("Kitchen set"));
    const copy = await store.duplicateBoard(original, "Kitchen (copy)");

    expect(copy).not.toBe(original);
    const list = await store.readBoards();
    expect(new Set(list.boards.map((one) => one.id)).size).toBe(list.boards.length);

    // And it is a copy: the same content, under the other identity.
    expect((await store.readLayoutOf(copy))?.sets[0]?.name).toBe("Kitchen set");
  });

  it("editing a copy leaves the board it came from alone", async () => {
    const original = await store.createBoard("Kitchen", board("Kitchen set"));
    const copy = await store.duplicateBoard(original, "Kitchen (copy)");

    await store.useBoard(copy);
    await store.writeLayout(board("Changed"), null);

    expect((await store.readLayoutOf(original))?.sets[0]?.name).toBe("Kitchen set");
    expect((await store.readLayoutOf(copy))?.sets[0]?.name).toBe("Changed");
  });

  it("renaming changes the name and nothing else", async () => {
    const id = await store.createBoard("Kitchen", board("Kitchen set"));
    await store.renameBoard(id, "The kitchen one");

    const list = await store.readBoards();
    expect(list.boards[0]!.id).toBe(id);
    expect(list.boards[0]!.name).toBe("The kitchen one");
    expect((await store.readLayoutOf(id))?.sets[0]?.name).toBe("Kitchen set");
  });

  it("deleting takes the board's layout with it", async () => {
    const id = await store.createBoard("Kitchen", board("Kitchen set"));
    await store.deleteBoard(id);

    expect((await store.readBoards()).boards).toHaveLength(0);
    expect(await store.readLayoutOf(id)).toBeNull();
  });

  /* Never a page with no board on it while there is still a board to show. */
  it("deleting the open board opens the one that took its place", async () => {
    const first = await store.createBoard("First", board("First"));
    const second = await store.createBoard("Second", board("Second"));
    await store.useBoard(first);
    await store.deleteBoard(first);

    expect((await store.readBoards()).current).toBe(second);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Second");
  });

  it("deleting a board that is not open leaves the open one open", async () => {
    const first = await store.createBoard("First", board("First"));
    const second = await store.createBoard("Second", board("Second"));
    await store.deleteBoard(first);

    expect((await store.readBoards()).current).toBe(second);
  });

  /* The last one out leaves an empty list rather than an empty board. What
   * happens next is loadLayout()'s answer - it seeds one, the same as a first
   * visit - and that is a better answer than a page with nothing on it. */
  it("deleting the last board leaves nothing, for the seed to fill", async () => {
    const only = await store.createBoard("Only", board("Only"));
    await store.deleteBoard(only);

    const list = await store.readBoards();
    expect(list.boards).toHaveLength(0);
    expect(list.current).toBeNull();
    expect((await store.readLayout()).layout).toBeNull();
  });

  /* Two tabs are two writers, and that was true of one board before it was
   * true of several. What is worth pinning here is that the stamp is per
   * board: a write to this board must not be refused because a different one
   * moved. */
  it("still refuses a write against a stamp that has moved", async () => {
    await store.createBoard("Kitchen", board("Kitchen set"));
    const held = await store.readLayout();
    await store.writeLayout(board("Somebody else"), held.version);

    const late = await store.writeLayout(board("This tab"), held.version);
    expect(late.conflict).toBe(true);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Somebody else");
  });

  it("does not refuse a write because a different board moved", async () => {
    const first = await store.createBoard("First", board("First"));
    await store.createBoard("Second", board("Second"));

    await store.useBoard(first);
    const held = await store.readLayout();
    // Somebody writes to the other board in the meantime.
    const second = (await store.readBoards()).boards[1]!.id;
    await store.useBoard(second);
    await store.writeLayout(board("Second, edited"), null);
    await store.useBoard(first);

    const result = await store.writeLayout(board("First, edited"), held.version);
    expect(result.conflict).toBeFalsy();
  });
});
