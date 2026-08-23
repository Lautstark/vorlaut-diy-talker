/* onnxruntime, imported from a CDN at the moment somebody first asks to speak.
 *
 * The module is fetched by the browser at runtime from a pinned version, even
 * though onnxruntime-web stands in package.json - that dependency exists for
 * the wasm binaries piperVendor() copies into vendor/, which have to be
 * exactly the ones this module expects, so the two pins name one version.
 * Bundling the module from node_modules instead would also work; what the URL
 * keeps is vorlaut's arrangement that piper's runtime weight stays off the
 * bundle and is paid at first use - and it is the seam e2e/build.spec.ts
 * routes to a stand-in, the way it once routed vits-web.
 *
 * Declared as unknown rather than typed. Writing a shape here would be a
 * second description of somebody else's module with nothing checking it; the
 * one caller casts it to stimmquelle's OnnxModule, the description the
 * package itself publishes for what it needs of this module.
 */
declare module "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js" {
  const ort: unknown;
  export default ort;
}
