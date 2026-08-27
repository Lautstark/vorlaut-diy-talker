import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { piperVendor } from "@lautstark/stimmquelle/vite";

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
  /* Piper's runtime pieces, served from where the page is served.
   *
   * The four-file copy and the dev middleware that answers for them used to
   * stand here, with a long comment about arrival sizes and MIME types. Both
   * are stimmquelle's now: the same plugin ran in mitreden, and the traps it
   * had learned - checking a copy against its arrival size, walking
   * node_modules because onnxruntime-web publishes no `./dist/*` exports -
   * were the sort a second consumer rediscovers the hard way. `vendor/` is
   * still the directory, because piperRuntime() in backend/local.ts defaults
   * to the same name; the two are ends of one string. */
  plugins: [piperVendor()],
  build: {
    outDir: "dist",
    /* Two pages out of one build, and one deploy serves both.
     *
     * index.html is the editor; loader/index.html is the page that takes an
     * exported file to a talker - adr/0011, and loader/README.md. Named
     * explicitly rather than left to the default, because Vite's default input
     * is index.html alone and a second entry point that is never named simply
     * is not built: the file sits in the repository, the page 404s on Pages,
     * and nothing anywhere says so.
     *
     * The base is the sharp edge here and it is worth being exact about why it
     * is not one any more. Every path either page writes is absolute and
     * rewritten by Vite from `base` above - /icon.svg becomes
     * /vorlaut-diy-talker/icon.svg - and that includes the entry script this
     * file resolves for loader/index.html. What must not appear anywhere is a
     * repository name written out by hand: docs/repository-map.md lists three
     * tracked places where the base already is written out literally, and each
     * of them is a place a rename breaks silently. The link between the two
     * pages is the one new opportunity for a fourth, and it is spent on
     * import.meta.env.BASE_URL instead - see loader/README.md.
     *
     * The directory name in dist/ follows the source, so the published address
     * is <base>loader/ and `npm run dev` serves it at /loader/. One rule, both
     * places, nothing to keep in step. */
    rollupOptions: {
      input: {
        editor: resolve(here, "index.html"),
        loader: resolve(here, "loader/index.html"),
      },
    },
    /* Vite's default target is a floor of browsers from 2020, which does not
       have top-level await - main.ts uses it to mount the page's structure
       before importing the module that wires it. Raising it is honest rather
       than a workaround: this app needs IndexedDB, the File System Access API
       for a METACOM folder and WebSerial for the cable, so a 2020 browser was
       never going to run it and pretending otherwise only shrank what the
       source could say. */
    target: "es2022",
    // The board designer is one page; a sourcemap is what makes a stack trace
    // from a deployed copy readable, and it costs a file nobody downloads
    // unless they open the tools.
    sourcemap: true,
  },
  server: { port: 8801 },
  preview: { port: 8801 },
});
