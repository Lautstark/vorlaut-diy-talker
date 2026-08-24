/* The hole in the shell that an editor is plugged into.
 *
 * The shell owns the boards, the storage, the symbols, the voices and the
 * settings; editor-diy owns the five-key device - four keys to a set, five
 * sets at a time, a colour round each display, and the cable at the end of it.
 * There is one editor today and this file does not pretend otherwise. What it
 * buys is the direction of the arrows: the shell used to `import { render }
 * from "../ui/editor.js"` in three places, which meant the board list, the
 * symbol picker and the save loop all knew what a set was.
 *
 * tests/unit/layers.test.ts is what holds it: nothing outside src/editor-diy/
 * may import out of it, except the composition root that installs it.
 *
 * Four methods, and each is a question the shell genuinely has to ask rather
 * than a general-purpose escape hatch:
 *
 *   blank()   a new board has to start as something, and what "empty" means is
 *             the device's answer - one set of four keys here, a grid or a
 *             sentence bar in whatever comes next.
 *   adopt()   a different board is in force. Where the editor was standing may
 *             not exist in this one.
 *   render()  redraw from state.layout, after something outside changed it.
 *   sample()  a sentence off the board, for trying a voice on. "" if there is
 *             none, and the settings sheet has its own specimen for that.
 *   labels()  the fixed words on the editor's own controls, re-read whenever
 *             the language moves.
 *   count()   how much is in one, for the list and for the delete question.
 */
import type { Layout } from "./types.js";

export interface Editor {
  /** What a board looks like before anybody has typed in it. */
  blank(): Layout;
  /** A whole different layout is in state now: let go of where you were. */
  adopt(): void;
  /** Draw what state.layout says. */
  render(): void;
  /** A sentence somebody wrote, to hear a voice on. "" when there is none. */
  sample(): string;
  /** Re-read the fixed labels on the controls this editor owns. */
  labels(): void;
  /** How many things are in this layout, for the sidebar's row and for the
   *  question asked before one is deleted. What is being counted is the
   *  device's answer - sets here, pages or sentences in whatever comes next -
   *  so the shell asks rather than reaching into the layout and counting. */
  count(layout: Layout): number;
}

let installed: Editor | null = null;

/** Called once, by the composition root, before anything is wired. */
export function useEditor(editor: Editor): void {
  installed = editor;
}

/** The editor in force.
 *
 * Throws rather than answering null, for the reason $() does: every caller is
 * running inside a page that app.ts has already installed one on, so a null
 * here is not a case to handle - it is a composition root that has stopped
 * doing its one job, and the complaint should say so once rather than at
 * whichever call site happened to be first.
 */
export function editor(): Editor {
  if (!installed) throw new Error("no editor is installed");
  return installed;
}
