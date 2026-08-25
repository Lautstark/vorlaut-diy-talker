/* The hole in the shell that an editor is plugged into.
 *
 * The shell owns the boards, the storage, the symbols, the voices and the
 * settings; editor-diy owns the five-key device - four keys to a set, five
 * sets at a time, a colour round each display, and the cable at the end of it -
 * and editor-app owns the tablet, which is pages of a grid composing a
 * sentence in a bar. What this file buys is the direction of the arrows: the
 * shell used to `import { render } from "../ui/editor.js"` in three places,
 * which meant the board list, the symbol picker and the save loop all knew
 * what a set was.
 *
 * tests/unit/layers.test.ts is what holds it: nothing outside an editor's own
 * directory may import out of it, except the composition root that installs
 * them, and no editor may import out of another.
 *
 * ## A registry, not an installed instance
 *
 * There was one editor, and `useEditor(diy)` in app.ts was the whole of the
 * wiring. That could not survive a second one, and the way it failed is worth
 * writing down because nothing would have caught it: the sidebar draws a count
 * per Sammlung, and it drew every one of them with whichever editor happened
 * to be installed. A page open on a talker Sammlung counted a tablet Sammlung
 * in sets, found none, and put "0" beside a row holding sixty buttons.
 *
 * So what the composition root registers is *every* editor, by target, and
 * each caller asks for the one belonging to the layout in its hand. Which
 * editor is a fact about the Sammlung, not about the page, and the sidebar
 * holds several Sammlungen at once.
 *
 * Seven members, and each is a question the shell genuinely has to ask rather
 * than a general-purpose escape hatch:
 *
 *   blank()   a new Sammlung has to start as something, and what "empty" means
 *             is the target's answer - one set of four keys, or one page of an
 *             empty grid. The one member that takes anything: the size of that
 *             grid is asked at the same moment as the target, so the answer
 *             comes in with the question rather than being written over a
 *             board that has already been made.
 *   adopt()   a different Sammlung is in force. Where the editor was standing
 *             may not exist in this one.
 *   render()  redraw from state.layout, after something outside changed it.
 *   sample()  a sentence off the board, for trying a voice on. "" if there is
 *             none, and the settings sheet has its own specimen for that.
 *   labels()  the fixed words on the editor's own controls, re-read whenever
 *             the language moves.
 *   count()   how much is in one, for the list and for the delete question.
 *   unit      what that number counts, so the shell can put a word to it.
 */
import type { GridSize, Layout, Target } from "./types.js";

export interface Editor {
  /** What a Sammlung looks like before anybody has typed in it.
   *
   *  `grid` is what was chosen while the Sammlung was being made, and is the
   *  target's to ignore: the five-key device has no grid to size, so only the
   *  tablet reads it. Absent means whatever that target calls a first board. */
  blank(grid?: GridSize): Layout;
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
   *  target's answer - sets for the device, buttons for a tablet - so the
   *  shell asks rather than reaching into the layout and counting.
   *
   *  Takes the layout rather than reading state.layout, because the sidebar
   *  counts every Sammlung and only one of them is open. */
  count(layout: Layout): number;
  /** What count() counts, as the stem of a text key: the shell composes
   *  `ui.collection_delete_ask_${unit}` and its three siblings out of it.
   *
   *  A stem rather than the word itself, because the word is German in one
   *  language and English in the other and both live in boot_data.ts - which
   *  is what tests/test_language.py holds. It also has to be a stem rather
   *  than a `{unit}` placeholder in one shared sentence: in German the two
   *  nouns take different articles, so the singular sentence differs in a word
   *  no plural rule reaches. */
  unit: string;
}

/** One editor, and how to put it in the page.
 *
 * The markup comes with the editor because the two are the same decision: a
 * tablet Sammlung must not have a #releaseBtn anywhere in the document, or the
 * coupling this whole arrangement exists to remove comes straight back through
 * the DOM instead of through an import. So mounting is not something the page
 * does around an editor, it is part of showing one.
 */
export interface EditorHalf {
  editor: Editor;
  /** Put this editor's own markup in #editor and in the work head's slot.
   *  Called on every switch *between* targets, never twice in a row for one. */
  mount(): void;
  /** Bind the controls that markup just put there. Called straight after
   *  mount(), because the elements it reaches are the ones mount() made.
   *
   *  May answer with a teardown, which is called before this editor's markup
   *  is taken out of the page again. Handlers bound to that markup need none -
   *  they go with the elements - but a listener registered with a *shell*
   *  notifier does: the shell outlives every editor, so a subscription left
   *  behind keeps reaching for elements that are no longer there. That is
   *  exactly how editor-diy's build mark went on asking for #releaseBtn from
   *  inside the save loop of a tablet Sammlung. */
  wire(): void | (() => void);
}

/** Every editor there is, by the target it serves. */
export type Editors = Record<Target, EditorHalf>;

/** What a Sammlung is for when nobody has said.
 *
 * Two readers, and both are the same moment: the seed a browser that has never
 * been here gets, and the layout written before there were two editors. A
 * first visit gets a talker, because that is what this product is and what its
 * name is about - the tablet editor is the second thing it learned to do, and
 * somebody who wanted one starts by pressing "+ Neue Sammlung" and saying so.
 *
 * Named rather than written "diy" at each site so that the two cannot drift,
 * and so that this paragraph is somewhere. */
export const FIRST_TARGET: Target = "diy";

let registry: Editors | null = null;
let installed: Editor | null = null;
let showing: Target | null = null;
/** The outgoing editor's teardown, held until it is replaced. */
let letGo: (() => void) | null = null;

/** Called once, by the composition root, before anything is wired. */
export function useEditors(all: Editors): void {
  registry = all;
}

/** The editor for a target, whether or not it is the one on screen.
 *
 * This is what the sidebar counts every row with. It draws nothing and mounts
 * nothing, which is what makes asking about a second editor while a first one
 * is on screen a safe thing to do - and it is why counting is not reached
 * through editor() below.
 */
export function editorFor(target: Target): Editor {
  if (!registry) throw new Error("no editors are registered");
  return registry[target].editor;
}

/** The same, read off a layout rather than named. Absent counts as "diy", for
 *  the reason DiyLayout.target gives: every layout written before there was a
 *  second editor is one. */
export function editorOf(layout: Layout): Editor {
  return editorFor(layout.target ?? FIRST_TARGET);
}

/**
 * Put the editor this layout needs on screen, and hand it the layout.
 *
 * The one call the save loop makes when a Sammlung arrives, and the reason it
 * is here rather than in core/save.ts: choosing between editors is the
 * composition root's business, and save.ts may not name either of them.
 *
 * Mounting happens only when the target actually changes. Switching between
 * two talker Sammlungen leaves the markup alone - which matters, because a
 * remount would rebuild every element the editor has a handler on and the
 * page would be re-wired for no reason. Switching from a talker to a tablet
 * replaces it wholesale, which is the point.
 */
export function showEditorFor(layout: Layout): void {
  if (!registry) throw new Error("no editors are registered");
  const target: Target = layout.target ?? FIRST_TARGET;
  const half = registry[target];
  if (showing !== target) {
    // Whatever the outgoing editor registered with the shell, taken back
    // before its markup goes - see EditorHalf.wire().
    letGo?.();
    letGo = null;
    half.mount();
    letGo = half.wire() || null;
    showing = target;
    installed = half.editor;
    // The labels this editor's own markup needs, which applyTexts() could not
    // have set: at the first paint there was no editor, and at every switch
    // after it the elements are new. See haveEditor().
    half.editor.labels();
  }
  installed = half.editor;
  // Where the editor was standing may not exist in this Sammlung at all - it
  // is a different one every time somebody picks one out of the list.
  half.editor.adopt();
}

/** Whether an editor is on screen yet.
 *
 * The one place a null answer is a real state rather than a broken page: at
 * the first paint the page has no editor, because which editor is a fact about
 * a Sammlung and the Sammlung has not been read out of the database yet.
 * applyTexts() runs in that window on purpose - the shell's own labels should
 * be up before the first round trip - and it is the only caller.
 */
export function haveEditor(): boolean {
  return installed !== null;
}

/** The editor on screen.
 *
 * Throws rather than answering null, for the reason $() does: every caller is
 * running inside a page that the composition root has already put one on, so a
 * null here is not a case to handle - it is a composition root that has
 * stopped doing its one job, and the complaint should say so once rather than
 * at whichever call site happened to be first.
 */
export function editor(): Editor {
  if (!installed) throw new Error("no editor is on screen");
  return installed;
}
