import { defineConfig } from "vitest/config";

/* The checks that are only JavaScript live here.
 *
 * They import the modules under loader/ directly, which is the reason vitest
 * owns them rather than plain node: the modules are TypeScript and node cannot
 * run them without a build in between. Putting a build between a test and the
 * thing it tests is how a frozen reference stops measuring the source.
 *
 * What is NOT here is anything that compiles the firmware's own C++ readers
 * and replays the browser's bytes into them - those stay in tests/run.py, and
 * that is now the whole of what it is for. See tests/run.py's docstring.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    /* No setupFiles. There was one - fake-indexeddb, so that the editor's
     * data/store.ts ran against a real database rather than a mock - and it
     * went with the editor. Nothing left here touches IndexedDB: these five
     * files read device/fixtures/ off the disk and call into loader/. */
  },
});
