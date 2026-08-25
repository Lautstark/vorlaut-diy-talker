// What the page does when it opens.
//
// Two steps, and the order is the point: put the structure in the document,
// then wire it. Everything that touches an element lives in app.ts, which is
// imported *after* the templates have mounted - see the note there for why a
// separate module is what makes that ordering hold rather than a comment
// asking people to be careful.
//
// The stylesheets are imported rather than linked, so the bundler knows they
// exist: it hashes them, inlines what is small enough and fails the build on a
// url() pointing at nothing. Tokens first - ui.css reads the custom properties
// they define.
//
// The tokens come from @lautstark/design, generated per product from one line
// of input (vorlaut's accent) - see that repo's README for how every value that
// has to clear a contrast ratio is solved for it. There used to be a copy of
// this file checked in here, byte-identical to the package's; a copy that is
// identical today is a copy that drifts tomorrow, and the lockfile pin is what
// says which version this page wears.
import "@lautstark/design/tokens/vorlaut.css";
// The components layer, between the tokens and this page's own rules: the
// button, the field, the chip, the menu, the sheet and the folded panel,
// each written once against the token names. It restyles nothing by itself
// except :focus-visible - everything else is opt-in by class - which is why
// ui.css below is now the layout that is vorlaut's alone, and no longer a
// second copy of the vocabulary. The panel in it came from here in the first
// place and has gone home.
import "@lautstark/design/components.css";
import "./styles/ui.css";

// The page's structure. Each of these sits beside the module that owns it;
// index.html is the shell they go into, and the order here is the order they
// appear on screen.
//
// The editors are not here. frame.ts lays out the page with a hole in the
// middle of it - the list of Sammlungen down the side, and #editor - and one
// editor fills the hole, but *which* one is a fact about the Sammlung that has
// not been read out of the database yet. So the templates mount in app.ts, at
// the moment a layout arrives and again whenever a different one does. This
// file and app.ts are still the two that may name both halves; see
// tests/unit/layers.test.ts.
import * as frame from "./shell/templates/frame.js";
import * as footer from "./shell/templates/footer.js";
import * as settingsSheet from "./shell/templates/settings_sheet.js";
import * as collectionSheet from "./shell/templates/collection_sheet.js";
import * as legal from "./shell/templates/legal.js";
import { initTheme } from "@lautstark/design/theme";

// Before anything renders, though the attribute it would set is already set by
// the inline script in index.html. What this adds is the address bar, which
// needs the token import above to have a --bg to read, and the listener that
// keeps it right when the OS turns over under a page that is following it.
initTheme("vorlaut.theme");

frame.render();
// Under the board, and it is the last thing in the page's flow. The two after
// it are dialogs: they sit over everything when they are open and take no room
// at all when they are not, so where they mount decides nothing.
//
// There were three. The symbol picker was one, and it went when both editors
// grew a picture column of their own - see src/shell/sheet.ts. The sheets that
// replaced it are built when they open and removed when they close, so they
// mount nowhere at all.
footer.render(document.querySelector("main")!);
settingsSheet.render();
// The Sammlung's own, behind the ⋯ beside its name. Mounted here with the
// other two and for the same reason: it is one document, it opens over
// everything and it takes no room at all while it is closed, so where it sits
// in the flow decides nothing.
collectionSheet.render();
legal.render();

const { start } = await import("./app.js");
start();
