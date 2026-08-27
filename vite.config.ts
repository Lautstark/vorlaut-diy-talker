import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/* A project site is served from /<repo>/, so the bundle needs that base.
 * For a user site (<user>.github.io) this would be "/".
 *
 * It is read from an environment variable rather than written here, because
 * the repository name is a fact about where it is published and not about the
 * code - the Pages workflow passes it. Locally it is "/", which is what
 * `npm run dev` and `npm run preview` serve from. */
const base = process.env.BASE_PATH ?? "/";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    /* One page, named rather than left to the default.
     *
     * It was two until the split: index.html was the editor and
     * loader/index.html was the page that takes an exported file to a talker.
     * The editor is vorlaut-editor's now (adr/0012) and this page moved up to
     * the root, because an input is emitted at its own path - naming
     * loader/index.html alone would go on publishing <base>loader/ for a site
     * that has nothing else in it.
     *
     * Kept explicit even though one entry point is also Vite's default, for
     * the trap the two-page arrangement taught: Vite's default input is
     * index.html alone, and a second entry point that is never named simply is
     * not built. The file sits in the repository, the page 404s on Pages, and
     * nothing anywhere says so. Whoever adds a second page here has to add it
     * below as well, and this comment is the only thing that will tell them.
     *
     * The base is the sharp edge and it is worth being exact about why it is
     * not one. Every path this page writes is absolute and rewritten by Vite
     * from `base` above - /icon.svg becomes /vorlaut-diy-talker/icon.svg. What
     * must not appear anywhere is a repository name written out by hand:
     * docs/repository-map.md lists three tracked places where the base already
     * is written out literally, and each of them is a place a rename breaks
     * silently. This is not a fourth.
     *
     * The module directory stays at loader/src/. It is the page's own name for
     * itself, loader/README.md is written under it, and moving the source
     * because the page moved would rewrite every import in the repository to
     * say nothing new. */
    rollupOptions: {
      input: {
        loader: resolve(here, "index.html"),
      },
    },
    /* Vite's default target is a floor of browsers from 2020, which does not
       have top-level await - main.ts uses it to mount the page's structure
       before importing the module that wires it. Raising it is honest rather
       than a workaround: this page needs WebSerial for the cable and the File
       System Access API to write a folder, so a 2020 browser was never going
       to run it and pretending otherwise only shrank what the source could
       say. */
    target: "es2022",
    // One page; a sourcemap is what makes a stack trace from a deployed copy
    // readable, and it costs a file nobody downloads unless they open the
    // tools.
    sourcemap: true,
  },
  server: { port: 8801 },
  preview: { port: 8801 },
});
