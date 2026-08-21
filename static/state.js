// The two values the whole page shares.
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
// These two really are shared - which set is on screen, and what is in it.
//
// An object whose fields are mutated, rather than exported `let`s: a module
// that imports `export let current` gets a live view of it but cannot assign
// to it, so `current = 3` from the editor would be a syntax error. Accessors
// would work too and would cost twenty-two functions to say what
// `state.current` already says. The object also reads better at the call
// site: bare `current` said nothing about where it came from.
export const state = {
  layout: { sleep_timeout_seconds: 600, sets: [] },
  current: 0,
};
