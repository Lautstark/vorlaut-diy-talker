/* The phonemizer's Emscripten glue, an npm package that ships no types.
 *
 * The deep path rather than the bare name, because the package's `main` names
 * a path that does not resolve ("/build/..." - absolute, from 2023) and there
 * is no exports map to do better; the file itself is what every consumer of
 * this package really imports. Declared as unknown for cdn.d.ts's reason: the
 * one caller casts it to stimmquelle's PhonemizerFactory, which is the
 * published description of what the factory has to be.
 */
declare module "@diffusionstudio/piper-wasm/build/piper_phonemize.js" {
  const createPiperPhonemize: unknown;
  export default createPiperPhonemize;
}
