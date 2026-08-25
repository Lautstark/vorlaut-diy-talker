import { expect, test } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/*
 * The two pages a German site has to carry, checked the way bildhaft checks
 * its own - which is where this file's shape comes from.
 *
 * Section 5 DDG and Article 13 GDPR are satisfied by these being reachable
 * from the page and carrying the required details. That is easy to break
 * without noticing: a renamed link, a footer tidied into a single "Legal", an
 * address lost in a refactor, or - here - one dialog holding three pages, so
 * that showing one without hiding the others puts the wrong prose under the
 * right heading. A broken one is a legal defect rather than a visual one, so
 * the deploy is gated on it like everything else in this folder.
 *
 * There are no German literals in the assertions below beyond the two link
 * labels, and that is not squeamishness about the language rule: the page
 * opens in whatever language the browser asks for and a runner picks its own,
 * so an assertion written in one language would pass on this machine and fail
 * on CI. What is asserted instead is what both tables have to say either way -
 * a name, an address, the parties the data actually reaches. The two labels
 * are the exception because they are the same word in both tables on purpose:
 * they are what the law names, not what we chose to call them.
 */

const table = TEXTS as Record<string, Record<string, string>>;

/** One label out of every language's table, as a pattern. */
const either = (key: string) =>
  new RegExp(`^(${LANGUAGES.map((l) => table[l][key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  // The board, so that what follows is running against a page that came up
  // rather than against an empty document that happens to have a footer.
  await expect(page.locator("#device .cell")).toHaveCount(6);
});

test("the three pages are reachable from the page itself", async ({ page }) => {
  const footer = page.locator(".footer");
  await expect(footer).toBeVisible();
  // No scrolling to a hidden area, no menu to open first: one click from here.
  await expect(footer.getByRole("button", { name: either("ui.legal_about") })).toBeVisible();
  await expect(footer.getByRole("button", { name: "Impressum", exact: true })).toBeVisible();
  await expect(footer.getByRole("button", { name: "Datenschutz", exact: true })).toBeVisible();
});

test("the Impressum names who runs the site and how to reach them", async ({ page }) => {
  // The label matters as much as the content: "Kontakt" would not count.
  await page.getByRole("button", { name: "Impressum", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Impressum" });
  await expect(dialog).toBeVisible();

  // Scoped to the section rather than to the dialog, because all three live in
  // one dialog: the address stands in the privacy notice too, so an assertion
  // against the whole dialog would pass with the wrong page showing.
  const body = dialog.locator("#impressumPage");
  await expect(body).toBeVisible();
  await expect(dialog.locator("#privacyPage")).toBeHidden();
  await expect(dialog.locator("#aboutPage")).toBeHidden();

  // Name and a postal address are the parts section 5 DDG will not do without.
  await expect(body).toContainText("Stefanie Grewenig");
  await expect(body).toContainText("Talheide 5");
  await expect(body).toContainText("21149 Hamburg");
  // Plus a way to reach that person directly.
  await expect(body.locator('a[href^="mailto:"]')).toBeVisible();
});

test("the privacy notice names everything that leaves the browser", async ({ page }) => {
  await page.getByRole("button", { name: "Datenschutz", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Datenschutz" });
  await expect(dialog).toBeVisible();
  const body = dialog.locator("#privacyPage");
  await expect(body).toBeVisible();
  await expect(dialog.locator("#impressumPage")).toBeHidden();

  // Every party a request actually reaches. Each of these is a real outbound
  // call in this app - see backend/local.ts for the first two and the symbol
  // package for ARASAAC - and one of them dropped from this list while the
  // call stayed is exactly the defect this test is for.
  await expect(body).toContainText("GitHub Pages");
  await expect(body).toContainText("ARASAAC");
  await expect(body).toContainText("jsDelivr");
  await expect(body).toContainText("huggingface.co");
  await expect(body).toContainText("Azure");
  // The one path on which what somebody typed leaves the machine.
  await expect(body).toContainText("Microsoft");
  // Written the same way in both tables, so it can be asserted flat.
  await expect(body).toContainText(/IP-Adresse|IP address/);
  // Local storage is consent-free only because it is declared as necessary.
  await expect(body).toContainText("TDDDG");
  await expect(body).toContainText("IndexedDB");
});

test("a page can be closed, and the next one opens in its place", async ({ page }) => {
  await page.getByRole("button", { name: "Impressum", exact: true }).click();
  await expect(page.locator("#impressumPage")).toBeVisible();

  await page.locator("#legalClose").click();
  await expect(page.locator("#legal")).toBeHidden();

  // The failure this catches: opening a second page without hiding the first,
  // which leaves two of them stacked under one heading.
  await page.getByRole("button", { name: "Datenschutz", exact: true }).click();
  await expect(page.locator("#privacyPage")).toBeVisible();
  await expect(page.locator("#impressumPage")).toBeHidden();
});
