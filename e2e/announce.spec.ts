import { expect, test } from "@playwright/test";
import { openBoard, put } from "./diy.js";

/* That what the page reports is reported out loud.
 *
 * The status line in the header has always been on screen and has always been
 * correct; what it lacked was a role. Without one it is a span whose text
 * happens to change, and a screen reader has no reason to look at it - so
 * "saved", "released" and every failure this page reports were silent.
 *
 * None of that is visible in a screenshot, and no other test here would have
 * gone red for it, which is why it gets its own file. */

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test("the status line is a live region before it has anything to say", async ({ page }) => {
  const line = page.locator("#status");
  await expect(line).toHaveAttribute("role", "status");
  // Present and empty. A region that appears with its message is a region the
  // reader was not watching when it arrived.
  await expect(line).toHaveText("");
  expect(await line.evaluate((node) => getComputedStyle(node).display)).not.toBe("none");
});

test("what the page reports lands in that same element", async ({ page }) => {
  // Putting a sentence on a key is enough: the board saves itself and says so,
  // which is the most ordinary thing this page reports. It goes through the
  // sheet, because that is where a key is typed now.
  await put(page, 0, "Hallo");

  const line = page.locator("#status");
  await expect(line).not.toHaveText("");
  // Still the same element and still a live region: replacing the node rather
  // than its text is the other way to lose the announcement.
  await expect(line).toHaveAttribute("role", "status");
});
