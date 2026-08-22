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
// url() pointing at nothing. tokens.css first - ui.css reads the custom
// properties it defines.
import "./styles/tokens.css";
import "./styles/ui.css";

// The page's structure. Each of these sits beside the module that owns it;
// index.html is the shell they go into, and the order here is the order they
// appear on screen.
import * as header from "./ui/templates/header.js";
import * as board from "./ui/templates/board.js";
import * as picker from "./ui/templates/picker.js";
import * as settingsSheet from "./ui/templates/settings_sheet.js";

header.render();
board.render();
picker.render();
settingsSheet.render();

const { start } = await import("./app.js");
start();
