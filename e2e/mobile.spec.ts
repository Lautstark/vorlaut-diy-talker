import { expect, test } from "@playwright/test";

/*
 * The phone. Only what is genuinely different there: below 820px the sidebar is
 * a layer over the work with a scrim, rather than a column beside it
 * (conventions.md §3.1). Everything else is the desktop suite's job.
 *
 * This page had a third answer until now - the column became a row across the
 * top, with the Sammlungen scrolling sideways under it. It worked, and it cost
 * the top of every phone screen: 234px of an 812px viewport was furniture
 * before the board began, where both siblings give the work the whole screen
 * and open the list on request.
 */

const boot = async (page: import("@playwright/test").Page) => {
  await page.goto("./");
  await page.waitForFunction(
    () => document.querySelectorAll("#collectionList .collections__item").length > 0,
  );
};

test.beforeEach(({ page }) => boot(page));

test("the sidebar is a drawer: opens over a scrim, closes by tapping it", async ({ page }) => {
  const sidebar = page.locator("#sidebar");
  await expect(sidebar).not.toBeInViewport();

  await page.click("#sidebarOpenBtn");
  await expect(sidebar).toBeInViewport();
  await expect(page.locator("#scrim")).toBeVisible();

  await page.locator("#scrim").click({ position: { x: 340, y: 500 } });
  await expect(sidebar).not.toBeInViewport();
});

test("the ✕ dismisses it too, so the scrim is not the only way out", async ({ page }) => {
  await page.click("#sidebarOpenBtn");
  await expect(page.locator("#sidebar")).toBeInViewport();
  await page.click("#sidebarClose");
  await expect(page.locator("#sidebar")).not.toBeInViewport();
});

test("opening a Sammlung closes the drawer", async ({ page }) => {
  await page.click("#sidebarOpenBtn");
  await page.click("#collectionList .collections__item");
  await expect(page.locator("#sidebar")).not.toBeInViewport();
});

test("nothing overflows the screen", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBe(0);
});

test("the work starts at the top of the screen, not below a list", async ({ page }) => {
  /* The whole point of the change. The row arrangement put the Sammlungen, the
     "new" button and Einstellungen above the board, so the thing being edited
     began a third of the way down a phone. */
  const head = await page.locator(".workhead").boundingBox();
  expect(head, "the work head has to be on screen").not.toBeNull();
  // Below the bar and nothing else: the bar is ~45px, so anything past ~120
  // means something is stacked above the work again.
  expect(head!.y).toBeLessThan(120);
});

test("a sidebar put away on a laptop still opens as a drawer here", async ({ page }) => {
  /* The choice is remembered (§1.3) and it is a desktop choice: there is no
     control at this width to undo it, so it must not follow the person onto the
     phone. Without the rule that undoes `body.collapsed` down here, the drawer
     is display:none, the ☰ does nothing, and the other Sammlungen cannot be
     reached at all.

     Put away through the control, at the width the control exists at, rather
     than by seeding the store - a seed written against the wrong key stops
     reaching anything and the test stays green asserting nothing. */
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click("#sidebarHide");
  await expect(page.locator("#sidebarShow")).toBeVisible();

  /* The write is asynchronous and the class changes before it lands, so the
     reload waits for the record rather than for the screen. Asked of the
     database, which is the thing the phone half then has to survive. */
  await page.waitForFunction(() => new Promise<boolean>((keep) => {
    const request = indexedDB.open("vorlaut");
    request.onerror = () => keep(false);
    request.onsuccess = () => {
      const database = request.result;
      const ask = database.transaction("settings").objectStore("settings").get("settings");
      ask.onsuccess = () => {
        database.close();
        keep((ask.result as { sidebarOpen?: boolean } | undefined)?.sidebarOpen === false);
      };
      ask.onerror = () => { database.close(); keep(false); };
    };
  }));

  await page.reload();
  await boot(page);
  await expect(page.locator("body")).toHaveClass(/collapsed/);

  await page.setViewportSize({ width: 412, height: 915 });
  await page.reload();
  await boot(page);

  const sidebar = page.locator("#sidebar");
  await expect(sidebar).not.toBeInViewport();
  await page.click("#sidebarOpenBtn");
  await expect(sidebar).toBeInViewport();
});
