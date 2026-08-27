/* A talker's package, committed, for the page that reads one.
 *
 * loader.spec.ts needs a file to feed the page. Until the split this file built
 * one through the editor's own writer - src/data/device_package.ts - so that
 * everything about its *shape* was the product's rather than this file's, and
 * a spec could perturb the input and get a file the editor could not write.
 * That writer left with the editor (adr/0012), and vendoring a copy of it here
 * is the one edit docs/split-crossings.md names as the edit that must not
 * happen: a second opinion about the format, in the repository that reads it.
 *
 * So the four packages below are committed, and they are that writer's actual
 * output - generated from it on the day of the split, at the last commit that
 * still held it. README.md in the directory beside them has the recipe and the
 * provenance. This is the move adr/0014 already made once, when it replaced
 * tests/unit/device_roundtrip.test.ts with a fixture kind: a reader held
 * against files rather than against a writer standing next to it.
 *
 * What is lost, stated rather than discovered. Nothing here regenerates these
 * - regenerating them means running the recipe in vorlaut-editor - so a change
 * to the editor's writer does not reach this spec, and a package shape that
 * drifts there goes unnoticed here until somebody re-cuts them. That is the
 * cost the fixture answer has and the writer answer did not. What is kept is
 * the other half: device/fixtures/package/ holds the loader's *reader* to the
 * format independently of these files, so a stale fixture here cannot quietly
 * become the format - it can only stop being a case worth running.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The packages, by what is wrong with each. `board` is the plain one.
 *
 *  Named rather than numbered because the name is what a failing spec prints,
 *  and "too-many-sets" is the whole diagnosis where "package 2" is none. */
export type Package =
  | "board"
  | "too-many-sets"
  | "sound-at-the-wrong-rate"
  | "picture-that-will-not-decode";

/** One of them, as the bytes of a file. */
export const packageBytes = (which: Package = "board"): Buffer =>
  readFileSync(join(HERE, "fixtures", "packages", `${which}.obz`));

export const VOICE = "piper:de_DE-thorsten-medium";

/** Every sentence in the package that has a recording. "Niemals" is
 *  deliberately not one: it is the silent key. */
export const SPOKEN = ["Hallo", "Nicht hallo", "Danke", "Bitte"];

/** How long the one long clip runs, in seconds. Past
 *  LONG_CLIP_SECONDS in loader/src/validate.ts, so that the note about a key
 *  that answers nothing while it talks has a case. */
export const LONG = 12;
