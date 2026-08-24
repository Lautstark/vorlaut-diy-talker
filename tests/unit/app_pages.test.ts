import { describe, expect, it } from "vitest";
import {
  addPage, blankButton, blankPage, buttonAt, deletePage, inboundTo, outside,
  pageById, reachable, resize, unreachable,
} from "../../src/editor-app/pages.js";
import type { AppButton, AppLayout } from "../../src/core/types.js";

/* The page graph, and the four things that can happen to it.
 *
 * This file exists because of one decision: what becomes of a button that led
 * to a page somebody has just deleted. Three answers were rejected on the way
 * to the one below, and each of them is a state a tablet in somebody's kitchen
 * would have shown - a button that looks live and does nothing, a page that
 * cannot be deleted for a reason nothing explains, or work on a *different*
 * page destroyed as a side effect. None of those is loud. A dangling
 * `load_board` in particular passes every other check in this repository: the
 * layout saves, the package builds, the zip opens, and the failure is a child
 * pressing a button that ignores them.
 *
 * So the rules are asserted here, over plain objects, with no document
 * anywhere near them. src/editor-app/pages.ts is written to be testable this
 * way for exactly that reason.
 */

const button = (over: Partial<AppButton> = {}): AppButton => ({
  ...blankButton(0, 0), id: "b", ...over,
});

/** Two pages, the second reached from a button on the first. */
function twoPages(): AppLayout {
  const home = blankPage("#3B5BDB", "Start");
  const food = blankPage("#2F9E44", "Essen");
  home.buttons.push(button({
    id: "to-food", row: 0, col: 1, label: "Essen", wordClass: "category",
    symbol: "arasaac-2462.png", act: { kind: "goto", page: food.id },
  }));
  food.buttons.push(button({ id: "apple", row: 0, col: 0, label: "Apfel" }));
  return {
    target: "app", language: "de",
    grid: { rows: 3, columns: 5 },
    pages: [home, food],
    home: home.id,
  };
}

describe("what leads where", () => {
  it("finds every button that points at a page, and only from elsewhere", () => {
    const layout = twoPages();
    const food = layout.pages[1]!;
    expect(inboundTo(layout, food.id).map((one) => one.id)).toEqual(["to-food"]);
    // A page does not count as leading to itself. A `goto` pointing at the page
    // it sits on is a real thing somebody can author - the act picker seeds one
    // - and counting it in the delete question would make the number say that
    // something elsewhere depends on this page when nothing does.
    food.buttons.push(button({ id: "self", act: { kind: "goto", page: food.id } }));
    expect(inboundTo(layout, food.id).map((one) => one.id)).toEqual(["to-food"]);
  });

  it("walks from home, and a `:home` button is not an edge", () => {
    const layout = twoPages();
    expect([...reachable(layout)].length).toBe(2);
    // :home leads to where the walk started, so it can never make anything
    // reachable that was not. A page holding only one is still unreachable.
    const attic = addPage(layout, "#000000", "Dachboden");
    attic.buttons.push(button({ id: "back", act: { kind: "home" } }));
    expect(unreachable(layout).map((one) => one.name)).toEqual(["Dachboden"]);
  });

  it("reports an unreachable page rather than refusing to have one", () => {
    const layout = twoPages();
    const made = addPage(layout, "#000000");
    // Nothing links to it, and that is the ordinary state for the five seconds
    // between making a page and making the button that leads to it. It is
    // still in the Sammlung, and pageById still finds it.
    expect(unreachable(layout).map((one) => one.id)).toEqual([made.id]);
    expect(pageById(layout, made.id)).toBe(made);
  });
});

describe("deleting a page others point at", () => {
  it("keeps the button, and takes only its edge", () => {
    const layout = twoPages();
    const food = layout.pages[1]!;
    const pointer = layout.pages[0]!.buttons[0]!;

    expect(deletePage(layout, food.id, "#111111")).toBe(1);

    // Everything the button was authored with survives. This is the whole rule:
    // a button reading "Essen" with a food symbol on it is still worth having
    // when the Essen page goes, and the person deleting the page is the one who
    // knows what belongs there instead.
    expect(pointer.label).toBe("Essen");
    expect(pointer.symbol).toBe("arasaac-2462.png");
    expect(pointer.wordClass).toBe("category");
    expect([pointer.row, pointer.col]).toEqual([0, 1]);
    // Only the target is gone, and it falls back to the default rather than to
    // nothing: a `goto` with no page would export as a dangling load_board.
    expect(pointer.act).toEqual({ kind: "append" });
  });

  it("does not touch the buttons that were on it - it takes them with it", () => {
    const layout = twoPages();
    const food = layout.pages[1]!;
    deletePage(layout, food.id, "#111111");
    expect(layout.pages.map((one) => one.name)).toEqual(["Start"]);
  });

  it("moves home when home is what went", () => {
    const layout = twoPages();
    const home = layout.pages[0]!;
    deletePage(layout, home.id, "#111111");
    // Allowed, rather than refused: refusing would leave a page nothing on
    // screen explains as undeletable. Home lands on the first page left.
    expect(layout.home).toBe(layout.pages[0]!.id);
    expect(layout.pages[0]!.name).toBe("Essen");
  });

  it("leaves an empty page behind when the last one goes", () => {
    const layout = twoPages();
    deletePage(layout, layout.pages[1]!.id, "#111111");
    deletePage(layout, layout.pages[0]!.id, "#111111");
    // conventions.md §1.9 one floor down: a button always belongs to a page, so
    // a page always exists. The alternative is a Sammlung with nowhere to put
    // anything and an empty state that has to teach two things at once.
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.buttons).toEqual([]);
    expect(layout.home).toBe(layout.pages[0]!.id);
  });

  it("repairs a home that names no page at all", () => {
    const layout = twoPages();
    layout.home = "a page that is not here";
    deletePage(layout, layout.pages[1]!.id, "#111111");
    // Not a case the editor can reach, and the one line that fixes the case it
    // can also fixes this - which matters because `home` becomes manifest.root,
    // and a root naming nothing is a package the viewer rejects whole.
    expect(pageById(layout, layout.home)).toBeTruthy();
  });

  it("does nothing at all for a page that is not there", () => {
    const layout = twoPages();
    expect(deletePage(layout, "nobody", "#111111")).toBe(0);
    expect(layout.pages).toHaveLength(2);
  });
});

describe("the grid", () => {
  it("grows without moving anything", () => {
    const layout = twoPages();
    expect(outside(layout, 6, 11)).toEqual([]);
    resize(layout, 6, 11);
    // The point of buttons carrying their own coordinates: 3x5 to 6x11 is a
    // bounds change, not a re-index, so nothing has to be rewritten and
    // nothing can be lost on the way.
    expect(buttonAt(layout.pages[0]!, 0, 1)!.label).toBe("Essen");
    expect(buttonAt(layout.pages[1]!, 0, 0)!.label).toBe("Apfel");
  });

  it("counts what a smaller grid would lose, across every page", () => {
    const layout = twoPages();
    layout.pages[0]!.buttons.push(button({ id: "far", row: 2, col: 4 }));
    layout.pages[1]!.buttons.push(button({ id: "far2", row: 2, col: 0 }));
    // Across all of them, because the size is one decision for the whole
    // Sammlung and the losses may be on a page nobody is looking at.
    expect(outside(layout, 2, 5).map((one) => one.id)).toEqual(["far", "far2"]);
    expect(outside(layout, 3, 5)).toEqual([]);
  });

  it("drops what falls outside, and clamps to what the grid may be", () => {
    const layout = twoPages();
    layout.pages[0]!.buttons.push(button({ id: "far", row: 2, col: 4 }));
    resize(layout, 1, 5);
    expect(layout.grid).toEqual({ rows: 1, columns: 5 });
    expect(layout.pages[0]!.buttons.map((one) => one.id)).toEqual(["to-food"]);
    // Past the bound rather than up to it: the numbers come from a form field
    // somebody can type anything into.
    resize(layout, 99, 99);
    expect(layout.grid).toEqual({ rows: 6, columns: 11 });
  });
});

describe("what a page and a button start as", () => {
  it("mints an id that is not derived from anything editable", () => {
    const one = blankPage("#3B5BDB", "Essen");
    const two = blankPage("#3B5BDB", "Essen");
    // Same name, same colour, different pages. Buttons point at these values,
    // so an id derived from a name would break every edge on a rename.
    expect(one.id).not.toBe(two.id);
  });

  it("starts a button appending, with nothing filled in", () => {
    const one = blankButton(2, 3);
    // The default and the common case, so that putting a button somewhere is
    // one press and then typing rather than a form to fill in first.
    expect(one.act).toEqual({ kind: "append" });
    expect([one.row, one.col]).toEqual([2, 3]);
    expect(one.label).toBe("");
    expect(one.wordClass).toBe("");
  });
});
