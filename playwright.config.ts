import { devices } from "@playwright/test";
import { playwrightConfig } from "@lautstark/toolchain/playwright";

/* The check whose absence let a page that rendered nothing ship green.
 *
 * It runs against the built site rather than the dev server, and under the base
 * a GitHub project site really uses. Both matter and neither is fussiness: a
 * dev server resolves things Vite's output does not, and serving from the root
 * would let an absolute path pass here and 404 once published.
 */
const BASE = "/";

/* The port, overridable, because reuseExistingServer is a trap between two
 * checkouts of this repository.
 *
 * Two worktrees running their suites at once share this port, and the second
 * one does not fail: it finds a server already answering and quietly tests the
 * *other* worktree's build. Every spec that asserts something new fails, and
 * every failure points at the wrong file. E2E_PORT is how a second checkout
 * gets a port of its own. */
const PORT = Number(process.env.E2E_PORT || 8802);

/* The rest - the e2e directory, parallelism, forbidOnly, the reporter, the
 * trace, `vite preview` as the server - is @lautstark/toolchain's. What is passed
 * back over it is this page's own, and each is a fact rather than a taste: two
 * retries on CI; no pinned locale, because the loader picks its language out of
 * `navigator` and e2e/loader.spec.ts asserts that; the one project below; and the
 * BASE_PATH the server needs (the base is baked into the bundle at build time
 * and read from this same variable, so the server has to be told it too or it
 * serves the built page from the wrong root and every asset 404s). --host pins
 * 127.0.0.1: without it vite preview binds IPv6 loopback only, and Playwright's
 * baseURL - a literal address, not a name - never connects. */
export default playwrightConfig({
  port: PORT,
  host: "127.0.0.1",
  base: BASE,
  retries: process.env.CI ? 2 : 0,
  use: { locale: undefined },
  /* One, and it is a desktop. There were two until the split adr/0012 decided:
     the editor's mobile.spec.ts ran under a Pixel 7 because below 820px its
     sidebar is a layer over the work rather than a column beside it
     (conventions.md §3.1), and that arrangement had no coverage from a 1280px
     viewport. That spec is vorlaut-editor's now, and so is the sidebar.

     This page is opened with a talker and a USB-C cable in front of you, and
     WebSerial is desktop Chrome and Edge - there is no phone this page runs
     the whole of. A second project here would be a viewport with nothing in
     it. */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: { env: { BASE_PATH: BASE } },
});
