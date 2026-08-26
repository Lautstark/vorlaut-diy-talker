import { describe, expect, it } from "vitest";
import {
  addPage, allButtons, blankButton, blankPage, buttonAt, deletePage, elsewhere,
  inboundTo, isShared, moveButton, moveShared, opens, outside, pageById,
  reachable, resize, route, shareFirstColumn, shared, sharedAt, sharedColumn,
  spreadFirstColumn, unreachable,
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
  const home = blankPage("Start");
  const food = blankPage("Essen");
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
    const attic = addPage(layout, "Dachboden");
    attic.buttons.push(button({ id: "back", act: { kind: "home" } }));
    expect(unreachable(layout).map((one) => one.name)).toEqual(["Dachboden"]);
  });

  it("reports an unreachable page rather than refusing to have one", () => {
    const layout = twoPages();
    const made = addPage(layout);
    // Nothing links to it, and that is the ordinary state for the five seconds
    // between making a page and making the button that leads to it. It is
    // still in the Sammlung, and pageById still finds it.
    expect(unreachable(layout).map((one) => one.id)).toEqual([made.id]);
    expect(pageById(layout, made.id)).toBe(made);
  });
});

/* The two the strip is drawn from.
 *
 * They are one pair of edges seen twice - a row is one step of a path and a
 * path is a run of rows - so they are asserted together, and the case that
 * matters most is the one they must agree on: the shared first column is an
 * edge for reachable() and is an edge for neither of these.
 */
describe("what the strip walks", () => {
  it("lists what a page's own buttons open, once each, in cell order", () => {
    const layout = twoPages();
    const home = layout.pages[0]!;
    const food = layout.pages[1]!;
    const drinks = addPage(layout, "Trinken");

    // Authored last, but sitting in an earlier cell: the row reads in the
    // order the buttons sit on the board, which is the only order somebody
    // looking at the page can predict.
    home.buttons.push(
      button({ id: "to-drinks", row: 0, col: 3,
               act: { kind: "goto", page: drinks.id } }),
      button({ id: "to-food-again", row: 0, col: 0,
               act: { kind: "goto", page: food.id } }));

    // "to-food-again" is at col 0 and "to-food" at col 1, so Essen comes
    // first - and it comes once, though two buttons lead to it.
    expect(opens(layout, home.id).map((one) => one.name))
      .toEqual(["Essen", "Trinken"]);

    // Neither a `:home` button nor a `goto` at the page it already sits on is
    // a way anywhere else, so neither is in the row.
    food.buttons.push(
      button({ id: "back", act: { kind: "home" } }),
      button({ id: "self", row: 2, col: 2,
               act: { kind: "goto", page: food.id } }));
    expect(opens(layout, food.id)).toEqual([]);
  });

  it("leaves the shared first column out, though it is an edge everywhere",
     () => {
       const layout = withColumns();
       const attic = addPage(layout, "Dachboden");
       shareFirstColumn(layout, layout.home);
       sharedColumn(layout)[0]!.act = { kind: "goto", page: attic.id };

       // reachable() counts it, and must: one `goto` in the column puts its
       // target one press from anywhere.
       expect(unreachable(layout)).toEqual([]);

       // The row does not, and must not: it would be the same tile on every
       // page forever, spending the row's fixed height on the one fact in it
       // that never changes. It is said once in the picker instead.
       for (const one of layout.pages) {
         expect(opens(layout, one.id).map((two) => two.name))
           .not.toContain("Dachboden");
       }
     });

  it("walks the shortest way from the start page, ending on the page asked for",
     () => {
       const layout = twoPages();
       const food = layout.pages[1]!;
       const fruit = addPage(layout, "Obst");
       food.buttons.push(button({ id: "to-fruit", row: 1, col: 0,
                                  act: { kind: "goto", page: fruit.id } }));

       expect(route(layout, fruit.id).map((one) => one.name))
         .toEqual(["Start", "Essen", "Obst"]);
       // The start page is its own whole path: it is where every walk begins.
       expect(route(layout, layout.home).map((one) => one.name))
         .toEqual(["Start"]);

       // A second, shorter way in. The graph is not a tree, so there is no
       // *the* path - and of the two truthful answers the shortest is the one
       // worth drawing, because it is the one somebody would press.
       layout.pages[0]!.buttons.push(
         button({ id: "straight-to-fruit", row: 2, col: 0,
                  act: { kind: "goto", page: fruit.id } }));
       expect(route(layout, fruit.id).map((one) => one.name))
         .toEqual(["Start", "Obst"]);
     });

  it("gives a page no run of buttons reaches a path of its own alone", () => {
    const layout = twoPages();
    const attic = addPage(layout, "Dachboden");
    // An orphan: the anchor and one crumb is as much as is true about it.
    expect(route(layout, attic.id).map((one) => one.name)).toEqual(["Dachboden"]);
    // And so is a page only the shared first column leads to. It is reachable
    // - the column is an edge from everywhere - but there is no way to it
    // through the rows, so there are no crumbs to draw between.
    layout.pages[0]!.buttons.push(button({ id: "col-attic", row: 0, col: 0 }));
    shareFirstColumn(layout, layout.home);
    sharedColumn(layout)[0]!.act = { kind: "goto", page: attic.id };
    expect(unreachable(layout)).toEqual([]);
    expect(route(layout, attic.id).map((one) => one.name)).toEqual(["Dachboden"]);

    // A page that is not there has no path at all, which is not the same as a
    // path of one: the strip has nothing to stand on.
    expect(route(layout, "nowhere")).toEqual([]);
  });
});

describe("deleting a page others point at", () => {
  it("keeps the button, and takes only its edge", () => {
    const layout = twoPages();
    const food = layout.pages[1]!;
    const pointer = layout.pages[0]!.buttons[0]!;

    expect(deletePage(layout, food.id)).toBe(1);

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
    deletePage(layout, food.id);
    expect(layout.pages.map((one) => one.name)).toEqual(["Start"]);
  });

  it("moves home when home is what went", () => {
    const layout = twoPages();
    const home = layout.pages[0]!;
    deletePage(layout, home.id);
    // Allowed, rather than refused: refusing would leave a page nothing on
    // screen explains as undeletable. Home lands on the first page left.
    expect(layout.home).toBe(layout.pages[0]!.id);
    expect(layout.pages[0]!.name).toBe("Essen");
  });

  it("leaves an empty page behind when the last one goes", () => {
    const layout = twoPages();
    deletePage(layout, layout.pages[1]!.id);
    deletePage(layout, layout.pages[0]!.id);
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
    deletePage(layout, layout.pages[1]!.id);
    // Not a case the editor can reach, and the one line that fixes the case it
    // can also fixes this - which matters because `home` becomes manifest.root,
    // and a root naming nothing is a package the viewer rejects whole.
    expect(pageById(layout, layout.home)).toBeTruthy();
  });

  it("does nothing at all for a page that is not there", () => {
    const layout = twoPages();
    expect(deletePage(layout, "nobody")).toBe(0);
    expect(layout.pages).toHaveLength(2);
  });
});

describe("moving a button", () => {
  it("trades places with whatever is already there", () => {
    const layout = twoPages();
    const page = layout.pages[0]!;
    page.buttons.push(button({ id: "other", row: 2, col: 2, label: "Mehr" }));
    const pointer = page.buttons.find((one) => one.id === "to-food")!;

    moveButton(page, "to-food", 2, 2);

    // Both named cells moved and nothing else did. Pushing a third button out
    // of the way would move something nobody touched; refusing would make a
    // full board impossible to rearrange.
    expect([pointer.row, pointer.col]).toEqual([2, 2]);
    const other = page.buttons.find((one) => one.id === "other")!;
    expect([other.row, other.col]).toEqual([0, 1]);
    expect(page.buttons).toHaveLength(2);
  });

  it("just moves when the cell is empty", () => {
    const layout = twoPages();
    const page = layout.pages[0]!;
    moveButton(page, "to-food", 1, 4);
    const pointer = page.buttons[0]!;
    expect([pointer.row, pointer.col]).toEqual([1, 4]);
    expect(page.buttons).toHaveLength(1);
  });

  it("does nothing when a button is dropped where it already is", () => {
    const layout = twoPages();
    const page = layout.pages[0]!;
    moveButton(page, "to-food", 0, 1);
    expect([page.buttons[0]!.row, page.buttons[0]!.col]).toEqual([0, 1]);
    expect(page.buttons).toHaveLength(1);
  });

  it("ignores a button that is not on the page", () => {
    const layout = twoPages();
    const page = layout.pages[0]!;
    moveButton(page, "nobody", 2, 2);
    expect([page.buttons[0]!.row, page.buttons[0]!.col]).toEqual([0, 1]);
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
    const one = blankPage("Essen");
    const two = blankPage("Essen");
    // Same name, different pages. Buttons point at these values, so an id
    // derived from a name would break every edge on a rename.
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

/* The first column, when it belongs to the Sammlung rather than to each page.
 *
 * The same reason the rest of this file exists, one column narrower. What is
 * expensive to get wrong here is not the drawing - a column that fails to
 * appear is a column somebody can see is missing - it is the counting and the
 * two edges: a button authored once and drawn on four pages must be met once
 * by everything that counts, and switching the column on takes one page's
 * column over the others, which is the only act in this model that throws work
 * away on a page nobody is looking at.
 */

/** twoPages(), with something in the first column of both. */
function withColumns(): AppLayout {
  const layout = twoPages();
  layout.pages[0]!.buttons.push(
    button({ id: "home-ich", row: 0, col: 0, label: "ich", wordClass: "pronoun" }),
    button({ id: "home-second", row: 1, col: 0, label: "Mehr" }));
  layout.pages[1]!.buttons.push(
    button({ id: "food-du", row: 0, col: 0, label: "du" }));
  return layout;
}

describe("switching the first column on", () => {
  it("counts what the other pages would lose before anything is taken", () => {
    const layout = withColumns();
    // "apple" is already at 0,0 of the food page from twoPages(), and "food-du"
    // was put on top of it: both are in a first column that is not the one
    // being kept, and both go. The number is what the card names.
    expect(elsewhere(layout, layout.home).map((one) => one.id))
      .toEqual(["apple", "food-du"]);
    // Nothing has happened yet. Asking is free - the card asks on every redraw.
    expect(shared(layout)).toBe(false);
    expect(layout.pages[1]!.buttons).toHaveLength(2);
  });

  it("moves the kept page's column rather than copying it", () => {
    const layout = withColumns();
    const ich = layout.pages[0]!.buttons.find((one) => one.id === "home-ich")!;

    const gone = shareFirstColumn(layout, layout.home);

    expect(gone.map((one) => one.id)).toEqual(["apple", "food-du"]);
    // The same objects, so a label, a symbol, a colour and an edge all survive
    // the switch. Copying would leave the page's originals behind as a second
    // store nothing draws, and that is the one that goes stale unseen.
    expect(sharedColumn(layout)[0]).toBe(ich);
    expect(sharedColumn(layout).map((one) => one.id))
      .toEqual(["home-ich", "home-second"]);
    // And out of every page, the kept one included: column zero now has one
    // owner, so a page holding a button there would be a second answer to what
    // is in that cell.
    for (const page of layout.pages) {
      expect(page.buttons.filter((one) => one.col === 0)).toEqual([]);
    }
  });

  it("is on with nothing in it when the page named has no column", () => {
    const layout = twoPages();
    // The start page has nothing at column zero, so there is nothing to take -
    // and switching it on anyway is the state somebody who wants to build the
    // column from scratch is asking for. An empty array is not the same as no
    // field: the column is the Sammlung's and there is nothing in it yet.
    expect(shareFirstColumn(layout, layout.home).map((one) => one.id))
      .toEqual(["apple"]);
    expect(shared(layout)).toBe(true);
    expect(sharedColumn(layout)).toEqual([]);
    expect(layout.firstColumn).toEqual([]);
  });
});

describe("switching the first column off", () => {
  it("writes it onto every page, so nothing is lost", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);

    spreadFirstColumn(layout);

    expect(shared(layout)).toBe(false);
    // The inverse of the export rather than of the switch: the package has
    // always written this column onto every board, and this writes it onto
    // every page. So there is nothing to ask about, which is why this half has
    // no question where the other half has one.
    for (const page of layout.pages) {
      expect(page.buttons.filter((one) => one.col === 0).map((one) => one.label))
        .toEqual(["ich", "Mehr"]);
    }
  });

  it("gives each page its own ids, because they are separate buttons now", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);
    spreadFirstColumn(layout);

    const ids = layout.pages.flatMap(
      (page) => page.buttons.filter((one) => one.col === 0).map((one) => one.id));
    // Four buttons, four ids. Two pages sharing one id would make "which one
    // did I just change" unanswerable, and moveButton() finds by id.
    expect(new Set(ids).size).toBe(ids.length);
    expect("firstColumn" in layout).toBe(false);
  });
});

describe("counting a column that is drawn on every page", () => {
  it("meets every button once, however many pages there are", () => {
    const layout = withColumns();
    const before = allButtons(layout).length;
    shareFirstColumn(layout, layout.home);
    // Two of the five went with the other page's column; the two that stayed
    // are now one column rather than one per page. What must not happen is the
    // count growing with the page count - see the Editor port's count().
    expect(allButtons(layout)).toHaveLength(before - 2);
    addPage(layout, "Dachboden");
    expect(allButtons(layout)).toHaveLength(before - 2);
  });

  it("counts the column once when a shorter grid would lose it", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);
    // "Mehr" sits at row 1 of a column drawn on both pages. One button is
    // going, not two, and the sentence the card shows says so.
    expect(outside(layout, 1, 5).map((one) => one.id)).toEqual(["home-second"]);
  });

  it("never loses the column to a narrower grid, because it is column zero", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);
    // Everything else goes and the column stays, which is the state a
    // one-column grid is: no grid is narrower than one column, so nothing in
    // here can fall out sideways.
    expect(outside(layout, 6, 1).map((one) => one.id)).toEqual(["to-food"]);
  });
});

describe("resizing with a shared first column", () => {
  it("trims the column by the same rule and in the same call", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);
    resize(layout, 1, 5);
    // A row that is gone is gone from every page at once, which is what the
    // column being one thing means.
    expect(sharedColumn(layout).map((one) => one.id)).toEqual(["home-ich"]);
    expect(layout.grid).toEqual({ rows: 1, columns: 5 });
  });

  it("leaves the column and nothing else at one column wide", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);
    resize(layout, 3, 1);
    // Not refused. It is not a state the four offered sizes reach, and every
    // page button it costs was already counted by outside() - so the question
    // that got here named the whole number.
    expect(sharedColumn(layout)).toHaveLength(2);
    for (const page of layout.pages) expect(page.buttons).toEqual([]);
  });
});

describe("a shared button that leads somewhere", () => {
  it("makes its target reachable from every page, so from home", () => {
    const layout = withColumns();
    const attic = addPage(layout, "Dachboden");
    expect(unreachable(layout).map((one) => one.name)).toEqual(["Dachboden"]);

    layout.pages[0]!.buttons.push(button({
      id: "col-attic", row: 2, col: 0, label: "Dachboden",
      act: { kind: "goto", page: attic.id },
    }));
    shareFirstColumn(layout, layout.home);

    // One `goto` in the column is a way in from anywhere, which is the whole
    // of what makes the column persistent - so the strip must stop marking
    // that page as one nothing leads to.
    expect(unreachable(layout)).toEqual([]);
    expect(reachable(layout).has(attic.id)).toBe(true);
  });

  it("counts as one inbound edge, not one per page", () => {
    const layout = withColumns();
    const food = layout.pages[1]!;
    layout.pages[0]!.buttons.push(button({
      id: "col-food", row: 2, col: 0, act: { kind: "goto", page: food.id },
    }));
    shareFirstColumn(layout, layout.home);

    // Two edges: the "to-food" button on the start page, and the column's -
    // once, because it was authored once and deleting the page has one edge to
    // take from it. It counts even though it is also drawn on the food page
    // itself: the rule that a page does not lead to itself is about a button
    // sitting on the page it points at, and this one sits on all of them.
    expect(inboundTo(layout, food.id).map((one) => one.id))
      .toEqual(["to-food", "col-food"]);

    expect(deletePage(layout, food.id)).toBe(2);
    expect(sharedColumn(layout).find((one) => one.id === "col-food")!.act)
      .toEqual({ kind: "append" });
  });
});

describe("moving inside the shared column", () => {
  it("trades places with whatever is at the row it lands on", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);

    moveShared(layout, "home-ich", 1);

    // moveButton()'s rule in one dimension: the column is one cell wide, so
    // there is nowhere sideways to go and the swap is the whole of it.
    expect(sharedAt(layout, 1)!.id).toBe("home-ich");
    expect(sharedAt(layout, 0)!.id).toBe("home-second");
    expect(sharedColumn(layout).every((one) => one.col === 0)).toBe(true);
  });

  it("just moves when the row is empty, and ignores what is not in it", () => {
    const layout = withColumns();
    shareFirstColumn(layout, layout.home);
    moveShared(layout, "home-ich", 2);
    expect(sharedAt(layout, 2)!.id).toBe("home-ich");
    expect(sharedAt(layout, 0)).toBeUndefined();
    // A page's button is not the column's, and asking the column to move it is
    // not how a button crosses between the two - nothing here does that.
    moveShared(layout, "to-food", 0);
    expect(sharedAt(layout, 0)).toBeUndefined();
    expect(isShared(layout, "to-food")).toBe(false);
    expect(isShared(layout, "home-ich")).toBe(true);
  });
});
