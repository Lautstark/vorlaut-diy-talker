import type { Layout } from "./types.js";

// The one value the whole page shares.
//
// The script this came from opened with eleven module-level `let`s, and the
// obvious reading was that all eleven were shared state. They were not: they
// sat together because one file has one scope. Nine of them are used by one
// section only - searchToken, pickTarget and sources never leave the symbol
// picker, dragSet and dragSlot never leave the editor, saveTimer, unsaved and
// layoutVersion never leave saving, and preview is read by render() alone.
// Each of those is now a plain `let` inside the one module that uses it,
// which is a stronger statement than any accessor: nothing else *can* touch
// them.
//
// This one really is shared: the board that is open. Which *set* within it is
// on screen used to sit here beside it and does not any more - a set is the
// five-key device's idea, and the shell has no business holding an index into
// something it cannot describe. It is a `let` inside src/editor-diy/editor.ts
// now, which is the same argument the nine below were moved out on.
//
// An object whose field is mutated, rather than an exported `let`: a module
// that imports `export let layout` gets a live view of it but cannot assign to
// it, so `layout = fresh` from the save loop would be a syntax error. An
// accessor pair would work too and would cost two functions to say what
// `state.layout` already says. The object also reads better at the call site:
// bare `layout` said nothing about where it came from.
export const state = {
  layout: { sleep_timeout_seconds: 600, sets: [] } as Layout,
};
