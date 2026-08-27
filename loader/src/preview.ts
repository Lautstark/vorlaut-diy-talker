// The compiled tiles, at the size a key really is.
//
// adr/0013 is why this is here and not in the editor. The short of it: this
// picture used to be previewInto() in src/backend/local.ts, drawn while
// somebody was choosing a pictogram, and it was the one place the editor ran
// the device's own code. The editor leaves this repository (adr/0012), and of
// the three things that could have happened to a preview at that boundary -
// duplicate tiles.ts, draw it with the browser's own scaler, or move it - only
// the third is free. docs/split-crossings.md has the costing.
//
// ## It renders nothing
//
// Every byte on this page has already been rendered: compileDevice() drew each
// tile once, and a tile is 128x128 RGB565 big-endian, which is exactly what
// the ST7735 is handed. So the whole of this module is the inverse of
// toRgb565Be() plus a grid, and there is no second opinion about pixels
// anywhere in it. That matters more than it looks: a preview that rendered its
// own copy would be a second implementation of the tile pipeline sitting next
// to the first one, which is the failure docs/frozen-references.md exists to
// record.
//
// It also stops being a prediction. In the editor this said what a ScreenKey
// *would* draw; here it is the bytes that are about to go down the cable.
//
// ## The five-bit problem, which is not a detail
//
// RGB565 has five bits of red and blue and six of green, and a panel lights
// the missing low bits by repeating the high ones. Dropping that gives a
// picture very slightly darker than the device - the kind of difference nobody
// can see and everybody argues about. previewInto() reproduced it and so does
// this; the arithmetic below is that function's, unchanged.
import { t } from "./boot.js";
import type { ReadDevicePackage } from "./device_package.js";
import type { DeviceBuild } from "./compile.js";
import { SLOTS_PER_SET } from "./layout_format.js";
import { TILE_SIZE } from "./tiles.js";
import { setLabel } from "./validate.js";

/* Where the six places on the hardware are, and it is not a row of five.
 *
 * Three columns and two rows: the speaker sits top left and is a hole rather
 * than a screen, the set key sits under it, and the four speech keys are the
 * rest. The same table editor-diy's CELLS holds, because it is the same
 * hardware - and the reason the picture is the board rather than a strip of
 * tiles is that the device shows five of these at once and that is the
 * comparison somebody is actually making. */
const PLACES: (null | "set" | number)[] = [null, 0, 1, "set", 2, 3];

/** One tile's bytes back as pixels a canvas can take.
 *
 * The inverse of toRgb565Be(), including the low bits a panel pads by
 * repeating the high ones - see the note at the head of this file.
 */
function tilePixels(bytes: Uint8Array): ImageData {
  const side = TILE_SIZE;
  const out = new ImageData(side, side);
  for (let i = 0; i < side * side; i++) {
    const value = (bytes[i * 2]! << 8) | bytes[i * 2 + 1]!;
    const r = (value >> 11) << 3;
    const g = ((value >> 5) & 0x3f) << 2;
    const b = (value & 0x1f) << 3;
    out.data[i * 4] = r | (r >> 5);
    out.data[i * 4 + 1] = g | (g >> 6);
    out.data[i * 4 + 2] = b | (b >> 5);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** One panel: the tile, drawn at its own 128x128 and sized in millimetres.
 *
 * A canvas rather than an <img> through a blob URL, which is what the editor
 * used: there is no <img> to hand over here and no load to wait for, so the
 * URL - and letting go of it again, which that code had to be careful about -
 * buys nothing. The element carries the picture directly.
 *
 * role="img" with a name, because that is what it is. Without one a screen
 * reader meets six unlabelled canvases and a board of pictures becomes a board
 * of nothing.
 */
function panel(bytes: Uint8Array | undefined, name: string): HTMLElement {
  const canvas = document.createElement("canvas");
  canvas.className = "device__key";
  canvas.width = canvas.height = TILE_SIZE;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", name);
  canvas.title = name;
  // Absent only if the compile and this disagreed about a file name, which
  // would be a bug rather than a state - so an empty panel and no throw, on
  // the same reasoning DeviceHost gives for an undecodable picture.
  if (bytes) canvas.getContext("2d")!.putImageData(tilePixels(bytes), 0, 0);
  return canvas;
}

/** What one key is called when it is read out rather than looked at. */
function keyName(nth: number, text: string, symbol: string): string {
  return t("load.preview_key", {
    n: nth + 1, what: text || symbol || t("load.preview_empty"),
  });
}

/**
 * The whole file as the device will show it, set by set.
 *
 * Every set rather than one at a time, and no control to page through them:
 * five boards of five keys is a picture that fits on a screen, and a preview
 * somebody has to operate is one they will look at once. What they came to
 * find out - whether a pictogram survives at this size - is a question about
 * all of them.
 */
export function previewBoards(read: ReadDevicePackage, build: DeviceBuild): HTMLElement {
  const { plan } = read;
  const box = document.createElement("div");
  box.className = "preview";

  const heading = document.createElement("h3");
  heading.textContent = t("load.preview");
  const lead = document.createElement("p");
  lead.className = "preview__lead";
  lead.textContent = t("load.preview_lead");
  /* The boards flow across rather than down. Five of them at 15.21 mm a key is
   * a strip about as wide as this column three times over, so wrapping puts
   * the whole Sammlung in view at once - which is the point of showing every
   * set rather than one. */
  const boards = document.createElement("div");
  boards.className = "preview__sets";
  box.append(heading, lead, boards);

  for (const [at, set] of plan.sets.entries()) {
    const screen = build.screens[at];
    if (!screen) continue;

    const figure = document.createElement("figure");
    figure.className = "preview__set";
    const caption = document.createElement("figcaption");
    caption.textContent = setLabel(plan, at);

    const board = document.createElement("div");
    board.className = "device";
    for (const place of PLACES) {
      if (place === null) {
        // The speaker. Not a screen and not a key, and drawn as the hole it is
        // so that the arrangement is recognisable as this device rather than
        // as a grid of six pictures.
        const hole = document.createElement("span");
        hole.className = "device__hole";
        hole.setAttribute("aria-hidden", "true");
        board.append(hole);
        continue;
      }
      if (place === "set") {
        board.append(panel(build.files.get(screen.label), t("load.preview_setkey")));
        continue;
      }
      // Past SLOTS_PER_SET there is no panel to show it on: a file may name a
      // fifth key and the device has four, which the checks have already said
      // in words. Drawing it here would contradict them.
      if (place >= SLOTS_PER_SET) continue;
      const slot = set.slots[place];
      board.append(panel(
        build.files.get(screen.slots[place] ?? ""),
        keyName(place, slot?.text ?? "", slot?.symbol ?? "")));
    }

    figure.append(caption, board);
    boards.append(figure);
  }
  return box;
}
