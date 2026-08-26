import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KEY_CELL, cells, key, keySheet, label, openBoard, pick, press, query }
  from "./diy.js";

/* Cutting somebody's own picture down to a square before it is kept.
 *
 * The reason this is here rather than under tests/unit is that vitest runs on
 * node with no DOM, and every interesting thing shell/crop.ts does is a
 * measurement against a laid-out box: the picture is placed in percentages of
 * a column inside a dialog, and a drag converts screen pixels into source
 * pixels using a width that does not exist until the dialog opens.
 *
 * ## The fixture is readable
 *
 * fixtures/wide.png is 24x12 and striped: columns 0-5 red, 6-17 green, 18-23
 * blue. The largest centred square is exactly the green block, so which square
 * was kept can be read off one pixel rather than inferred from a size. That
 * matters here more than usual - a test that only asserted "12 by 12" would
 * pass just as happily on a crop taken from the wrong corner, or on a picture
 * squashed to fit rather than cut.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const RED = [214, 40, 40];
const GREEN = [40, 160, 60];

/** The hidden file input in the picture column, reached the way somebody
 *  reaches it: by pressing the button that opens the chooser. */
async function upload(page: Page, box: Locator, fixture: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    box.locator(".pick button", { hasText: label("ui.symbol_own") }).click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", fixture));
}

const crop = (box: Locator) => box.locator(".crop");

/* The crop adds no buttons of its own. Keeping the square is the foot's
 * Fertig, dropping it is the corner ✕ - both of which the sheet already had,
 * and both of which mean here exactly what they mean everywhere else in it. */
const keepCrop = (box: Locator) => press(box, "ui.done");
const dropCrop = (box: Locator) => box.locator(".head button").click();

/** One pixel out of a picture that is on screen, as [r, g, b].
 *
 * Read off the element rather than off the bytes on purpose: this is the
 * picture the child's key is actually drawing, at the end of the whole path -
 * canvas, PNG, IndexedDB, blob URL and back. */
async function pixelAt(image: Locator, x: number, y: number) {
  return image.evaluate((element: HTMLImageElement, [atX, atY]) => {
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas");
    context.drawImage(element, 0, 0);
    // Negative counts back from the far edge, so a test can name the last
    // column without first asking how many there are.
    const { data } = context.getImageData(
      atX < 0 ? element.naturalWidth + atX : atX,
      atY < 0 ? element.naturalHeight + atY : atY, 1, 1);
    return [data[0], data[1], data[2]];
  }, [x, y] as const);
}

/** The picture on the first speech key, once the sheet has been closed. */
function kept(page: Page): Locator {
  return cells(page).nth(KEY_CELL[0]).locator(".cell__pic");
}

test("a square picture is kept as it is, with nothing to answer", async ({ page }) => {
  /* The guard on the step itself. fixtures/symbol.png is 16x16, and a crop
   * over it would ask somebody to confirm a decision the picture has already
   * made - so it is not offered, and the file goes to the store exactly as it
   * did before any of this existed, original bytes and all.
   *
   * Asserted here rather than left to the upload tests in happy.spec.ts,
   * because what those assert is that a picture arrives. This asserts that
   * nothing stood between it and the store, which is a different sentence and
   * the one that breaks if the "already square" tolerance ever drifts. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "symbol.png");

  await expect(box.locator(".pick__preview img")).toBeVisible();
  await expect(crop(box)).toHaveCount(0);
  await press(box, "ui.done");

  await expect(kept(page)).toHaveJSProperty("naturalWidth", 16);
});

test("a wide picture takes the column over while its square is chosen",
     async ({ page }) => {
  /* The search, the results and what is owed for them go away for the
   * duration, and so do this column's own two buttons. It is not decoration: a
   * live grid of results under an open crop is a press that throws the crop
   * away without saying so.
   *
   * The row of buttons being empty is asserted too, and that is the point
   * rather than an accident of the markup. The crop had a confirming button
   * and then a cancelling one, and both went the same way: the foot already
   * says Fertig and the corner already says ✕, and a control repeating either
   * of them a few inches higher is a question about which is real. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");

  await expect(crop(box)).toBeVisible();
  await expect(query(box)).toBeHidden();
  await expect(pick(box).locator(".pick__credits")).toBeHidden();
  await expect(pick(box).locator(".pick__acts")).toBeHidden();
});

test("the square it opens on is the middle of the picture", async ({ page }) => {
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");
  await keepCrop(box);

  const image = kept(page);
  await expect(image).toBeVisible();
  // Square, and at the picture's own resolution: the short side is 12, which
  // is under the 512 the package asks for, and nothing here upscales.
  await expect(image).toHaveJSProperty("naturalWidth", 12);
  await expect(image).toHaveJSProperty("naturalHeight", 12);
  // Both edges green, which only the middle twelve columns are. A square taken
  // from either end would have red or blue in it; a picture squashed to fit
  // rather than cut would have all three.
  expect(await pixelAt(image, 0, 6)).toEqual(GREEN);
  expect(await pixelAt(image, -1, 6)).toEqual(GREEN);
});

test("the arrow keys move the square, and it stops at the edge",
     async ({ page }) => {
  /* The keyboard is the only way to move the square without a pointer, so it
   * is the half worth asserting: the drag it mirrors converts screen pixels
   * into source pixels through the same two lines.
   *
   * Twenty presses to travel six pixels, which is deliberately far too many.
   * What that buys is the clamp: the square cannot leave the picture, so the
   * last fourteen presses have to do nothing at all rather than walk a green
   * edge off into blank canvas. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");

  for (let nudge = 0; nudge < 20; nudge++) await crop(box).press("ArrowLeft");
  await keepCrop(box);

  const image = kept(page);
  await expect(image).toHaveJSProperty("naturalWidth", 12);
  // Hard against the left edge: the first six columns are the red stripe, and
  // the rest is the start of the green one.
  expect(await pixelAt(image, 0, 6)).toEqual(RED);
  expect(await pixelAt(image, -1, 6)).toEqual(GREEN);
});

test("dragging the picture moves what is kept, the other way", async ({ page }) => {
  /* The pointer, which the arrows above deliberately do not cover: the drag is
   * the one place a screen pixel has to be turned into a source pixel, and it
   * is measured against a box that does not exist until the dialog has been
   * laid out.
   *
   * The direction is the part worth an assertion rather than a comment.
   * Dragging the picture to the right shows more of its left side, so the
   * square being kept moves *left* - one sign in one line, and getting it
   * backwards is the kind of thing that looks fine in a still. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");

  const surface = crop(box);
  const at = await surface.boundingBox();
  if (!at) throw new Error("the crop has no box to drag in");
  const midY = at.y + at.height / 2;
  await page.mouse.move(at.x + at.width / 2, midY);
  await page.mouse.down();
  // Past the edge on purpose, so the clamp is doing the stopping rather than
  // the arithmetic happening to land there.
  await page.mouse.move(at.x + at.width, midY, { steps: 8 });
  await page.mouse.up();

  await keepCrop(box);

  const image = kept(page);
  await expect(image).toHaveJSProperty("naturalWidth", 12);
  expect(await pixelAt(image, 0, 6)).toEqual(RED);
  expect(await pixelAt(image, -1, 6)).toEqual(GREEN);
});

test("the slider takes a smaller square", async ({ page }) => {
  /* Zoom is a shrinking square rather than a growing picture, and it shrinks
   * about its own centre - a corner would send whatever had just been centred
   * sliding away, so the slider would undo every drag that preceded it.
   *
   * Both are visible in one number here: at twice in, the square is six source
   * pixels rather than twelve, and it is still wholly inside the green stripe
   * it was centred on. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");

  await box.locator(".crop__zoom").fill("200");
  await keepCrop(box);

  const image = kept(page);
  await expect(image).toHaveJSProperty("naturalWidth", 6);
  await expect(image).toHaveJSProperty("naturalHeight", 6);
  expect(await pixelAt(image, 0, 3)).toEqual(GREEN);
  expect(await pixelAt(image, -1, 3)).toEqual(GREEN);
});

test("the foot's Fertig keeps the square, rather than closing over it", async ({ page }) => {
  /* What somebody actually does. The square is adjusted, and then the eye goes
   * to the one primary button on the screen - which says Fertig and is three
   * inches away from the crop's own two.
   *
   * It used to drop the crop and close, and it was defensible on paper: nothing
   * had been written, so the key kept what it had and no way out of this sheet
   * had cost anything. From where somebody is sitting it was a picture chosen,
   * a picture adjusted, and then nothing at all.
   *
   * The other ways out are unchanged and still cost nothing - see the cancel
   * test above, and the corner ✕ below. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");
  await expect(crop(box)).toBeVisible();

  await keepCrop(box);

  const image = kept(page);
  await expect(image).toHaveJSProperty("naturalWidth", 12);
  expect(await pixelAt(image, 0, 6)).toEqual(GREEN);
});

test("the corner ✕ drops it, because that is what ✕ means", async ({ page }) => {
  /* The half that stays free, and the only way out that does not keep the
   * square now that the crop has no button of its own. Nothing has been
   * written by the time this runs - the store is not touched while a square is
   * being chosen - so the key is left exactly as it was found, which for a
   * fresh one is without a picture at all. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await upload(page, box, "wide.png");
  await expect(crop(box)).toBeVisible();

  await dropCrop(box);
  await expect(box).toBeHidden();
  await expect(kept(page)).toHaveCount(0);
});
