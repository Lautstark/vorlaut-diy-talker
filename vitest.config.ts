import { defineConfig } from "vitest/config";

/* The checks that are only JavaScript live here.
 *
 * They import the modules under src/ directly, which is the reason vitest owns
 * them rather than plain node: the modules are TypeScript now and node cannot
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
  },
});
