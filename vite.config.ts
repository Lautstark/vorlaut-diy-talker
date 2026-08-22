import { defineConfig } from "vite";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/* A project site is served from /<repo>/, so the bundle needs that base.
 * For a user site (<user>.github.io) this would be "/".
 *
 * It is read from an environment variable rather than written here, because
 * the repository name is a fact about where it is published and not about the
 * code - the Pages workflow passes it. Locally it is "/", which is what
 * `npm run dev` and `npm run preview` serve from. */
const base = process.env.BASE_PATH ?? "/";

/* Piper's runtime pieces, served from where the page is served.
 *
 * usePiperRuntime() in backend/local.ts names one directory - vendor/ - and
 * stimmquelle asks it for everything the owned piper path runs on: the
 * phonemizer's wasm and its espeak data, and onnxruntime's binaries. One base
 * for both sets is the package's contract, and the two sets live in different
 * npm packages, so no CDN directory can be that base - this copy is what makes
 * one. The sources are packages npm has pinned; onnxruntime-web is pinned
 * exactly, because its module arrives from a CDN URL naming 1.18.0 and the
 * binaries beside the page must be the ones that module expects.
 *
 * Two of onnxruntime's four binaries, not all: the threaded pair is only ever
 * asked for on a cross-origin-isolated page, and GitHub Pages sends none of
 * the headers that make one. A missing file here means the first sentence
 * fails at run time with a fetch error nobody connects to a build, so it
 * stops the build instead. */
const VENDORED: [string, string][] = [
  ["@diffusionstudio/piper-wasm/build/piper_phonemize.wasm", "piper_phonemize.wasm"],
  ["@diffusionstudio/piper-wasm/build/piper_phonemize.data", "piper_phonemize.data"],
  ["onnxruntime-web/dist/ort-wasm-simd.wasm", "ort-wasm-simd.wasm"],
  ["onnxruntime-web/dist/ort-wasm.wasm", "ort-wasm.wasm"],
];

/* .wasm must be application/wasm or instantiateStreaming refuses it; the
 * espeak data is bytes with no better name. */
const TYPE = (name: string) =>
  name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";

export default defineConfig({
  base,
  plugins: [
    {
      name: "vorlaut:piper-runtime-vendor",
      /* The dev server has no dist/ to have copied into, so the same four
       * files are answered straight out of node_modules. Same names, same
       * /vendor/ directory, so wasmBase does not care which server it is. */
      configureServer(server) {
        server.middlewares.use("/vendor", (request, response, next) => {
          const wanted = VENDORED.find(([, name]) => request.url === `/${name}`);
          if (!wanted) return next();
          const source = resolve(__dirname, "node_modules", wanted[0]);
          response.setHeader("Content-Type", TYPE(wanted[1]));
          response.end(readFileSync(source));
        });
      },
      closeBundle() {
        const out = resolve(__dirname, "dist", "vendor");
        mkdirSync(out, { recursive: true });
        for (const [from, name] of VENDORED) {
          const source = resolve(__dirname, "node_modules", from);
          if (!existsSync(source)) {
            throw new Error(`Cannot serve ${name} from this origin: ${from} is missing.`);
          }
          copyFileSync(source, resolve(out, name));
        }
      },
    },
  ],
  build: {
    outDir: "dist",
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
