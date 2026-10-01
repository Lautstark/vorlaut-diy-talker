import { vitestConfig } from "@lautstark/toolchain/vitest";

/* The node environment, the restored mocks and the unstubbed globals are
   @lautstark/toolchain's; this suite adds nothing of its own. */
export default vitestConfig();
