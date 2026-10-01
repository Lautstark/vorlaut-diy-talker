import { vitestConfig } from "@lautstark/toolchain/vitest";

/* The node environment, the restored mocks and the unstubbed globals are
   @lautstark/toolchain's. What this suite adds is where its tests are.

   tests/unit/ and nothing else, because vitest's own default takes every
   *.spec.ts it can find - and e2e/loader.spec.ts is Playwright's, which throws
   the moment test.use() runs outside its own runner. The include was here
   before the toolchain arrived and went with the rest of the old config, and
   `npm test` was red from that commit on. */
export default vitestConfig({ include: ["tests/unit/**/*.test.ts"] });
