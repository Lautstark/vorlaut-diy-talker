/* Piper, imported from a CDN at the moment somebody first asks for speech.
 *
 * The package does not import piper; the consumer hands it in, which is why
 * this is a URL in a dynamic import rather than a dependency. That also puts it
 * outside anything the compiler or the bundler resolves: it is fetched by the
 * browser, at runtime, from a pinned version.
 *
 * Declared as unknown rather than typed. Writing a shape here would be a second
 * description of somebody else's module with nothing checking it, and the only
 * caller hands it straight to usePiper() without looking inside.
 */
declare module "https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/vits-web.js" {
  const piper: unknown;
  export default piper;
}
