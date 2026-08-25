/* Cutting somebody's own picture down to a square, before anything is kept.
 *
 * ## Why this exists at all
 *
 * Nothing was broken without it. data/tiles.ts fits a picture into the
 * device's 128x128 preserving its proportions and centres it on the ground
 * colour it works out from the picture's own corners, and data/app_assets.ts
 * does the same at 512 for the package the tablet opens. So a photo off a phone has always worked - it just arrived as
 * a 4:3 strip in a square tile, a quarter of the key given over to ground
 * colour and the child's face smaller than it needed to be. This is about
 * filling the key, not about fixing a fault.
 *
 * ## Why it is only ever somebody's own file
 *
 * A METACOM pick is a reference into a folder the family licensed, and the
 * whole of that rule is that we never write a derivative of it - see
 * takeSymbol() in shell/picker.ts and exchange/SPEC.md §5.2. A crop is a
 * derivative. ARASAAC pictograms are already square-ish line art and have
 * nothing to gain. So this hangs off the one branch that was already storing
 * bytes, and off no other.
 *
 * ## Why there is no second dialog
 *
 * shell/sheet.ts's head says a modal over a modal to choose a symbol is the
 * thing this design set out to remove, and .pick__preview is already a square
 * box with `overflow: hidden` and `position: relative` - it *is* the viewport.
 * So the crop happens inside it and the column's own two buttons change what
 * they say. Nothing new opens.
 *
 * ## The model
 *
 * A square of `side` source pixels at `(x, y)` in the picture. Zooming shrinks
 * `side` about its own centre; dragging moves `(x, y)`. Both are then clamped
 * so the square never leaves the picture, which is what makes an empty corner
 * impossible without a single guard at the drawing end.
 *
 * The picture is laid out in percentages of the box rather than in pixels, so
 * nothing here measures anything except while a drag is actually in flight.
 * A sheet that is resized, or opened at a width nobody predicted, stays right
 * on its own.
 *
 * What is deliberately absent is a pinch gesture. The slider is the zoom, it
 * works from the keyboard, and a two-pointer gesture that has to fight the
 * dialog's own scrolling is a lot of code for a second way to do the one thing
 * that already has one.
 */
import { IMAGE_SIZE } from "../data/app_package.js";
import { t } from "../core/texts.js";

/* How much of the box the kept square takes, leaving the rest to show what is
 * about to be cut off. A frame flush with the box would be less code and would
 * answer the wrong question: somebody moving a face into the middle needs to
 * see the shoulder that is leaving, not just the part that stays. */
const FRAME = 0.84;
const MARGIN = (1 - FRAME) / 2 * 100;

/** How far in the slider goes. Four times is a face out of a group photo,
 *  which is the far end of what this is for; past that a 128px tile is being
 *  cut from too few pixels to carry it. */
const CLOSEST = 4;

/** A picture waiting to be cut, and the two elements that show it. */
export interface Cropper {
  /** Goes inside the square preview box. */
  surface: HTMLElement;
  /** Goes under it, in the column. */
  zoom: HTMLElement;
  /** The chosen square, as a PNG. */
  cut(): Promise<Blob>;
  /** Lets go of what the picture was loaded from. Every way out has to call
   *  it, including the ones that keep the square: the cut is taken from the
   *  loaded picture, so it cannot be dropped before then. */
  close(): void;
}

/** What a cropped file is stored under.
 *
 * The bytes are a PNG this page has just drawn, whatever was chosen, so the
 * chosen name's extension is no longer true of them. Everything downstream
 * sniffs rather than reads the name - see picture() in backend/local.ts - so
 * this is tidiness rather than correctness, with one thing to show for it: a
 * cropped foto.jpg and an uncropped one are no longer the same store key.
 */
export const pngName = (name: string): string =>
  `${name.replace(/\.[^./\\]*$/, "")}.png`;

/**
 * Loads a file and hands back the crop, or `null` when there is nothing to
 * choose.
 *
 * Two silences, both of which mean "keep the file exactly as it is", because
 * that is what happened before this step existed and neither is a fault worth
 * a sentence:
 *
 * - the picture is already square, so a crop would only ask somebody to
 *   confirm a decision that has already been made. It also keeps the original
 *   bytes rather than re-encoding a square JPEG as a PNG for no gain.
 * - the browser could not read a size off it. An SVG with no intrinsic size
 *   lands here, and so does a file that is not a picture at all; the first
 *   still works as a symbol and the second failed before this and fails after.
 */
export async function cropSquare(file: Blob): Promise<Cropper | null> {
  const url = URL.createObjectURL(file);
  const picture = new Image();
  picture.src = url;
  try {
    await picture.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  const wide = picture.naturalWidth;
  const high = picture.naturalHeight;
  // Two per cent rather than exactly equal: a 500x510 pictogram is square as
  // far as anybody looking at a key is concerned, and the fit downstream will
  // absorb the difference without a visible margin.
  if (!wide || !high || Math.abs(wide - high) <= Math.max(wide, high) * 0.02) {
    URL.revokeObjectURL(url);
    return null;
  }

  const full = Math.min(wide, high);
  let side = full;
  let x = (wide - full) / 2;
  let y = (high - full) / 2;

  const clamp = () => {
    side = Math.min(side, full);
    x = Math.min(Math.max(x, 0), wide - side);
    y = Math.min(Math.max(y, 0), high - side);
  };

  /* Where the picture sits, as percentages of the box. `scale` is how much of
   * the box's width one source pixel takes: the square is FRAME of the box, so
   * a picture `wide` pixels across is `wide * scale` of it. The offsets put
   * source pixel (x, y) on the frame's top left corner, which is MARGIN in
   * from both edges. Height is left to follow the width, and the box being
   * square is what makes a percentage of it mean the same vertically. */
  const place = () => {
    const scale = FRAME * 100 / side;
    picture.style.width = `${wide * scale}%`;
    picture.style.left = `${MARGIN - x * scale}%`;
    picture.style.top = `${MARGIN - y * scale}%`;
  };

  const surface = document.createElement("div");
  surface.className = "crop";
  // Focusable, because the arrow keys below are the only way to move the
  // square without a pointer, and named, because the box it replaces was
  // showing a picture and is now showing a choice.
  surface.tabIndex = 0;
  surface.setAttribute("role", "group");
  surface.setAttribute("aria-label", t("ui.crop_frame"));
  picture.alt = "";
  picture.draggable = false;
  const frame = document.createElement("div");
  frame.className = "crop__frame";
  surface.append(picture, frame);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "crop__zoom";
  slider.min = "100";
  slider.max = String(CLOSEST * 100);
  slider.step = "1";
  slider.value = "100";
  slider.setAttribute("aria-label", t("ui.crop_zoom"));
  const zoom = document.createElement("div");
  zoom.className = "pick__zoom";
  zoom.appendChild(slider);

  /* Zooming about the square's own centre rather than its corner. The corner
   * is one line shorter and sends whatever somebody has just centred sliding
   * off towards the bottom right, which then has to be dragged back - so the
   * slider would undo the drag every time it was touched. */
  const zoomTo = (factor: number) => {
    const midX = x + side / 2;
    const midY = y + side / 2;
    side = full / factor;
    x = midX - side / 2;
    y = midY - side / 2;
    clamp();
    place();
  };
  slider.oninput = () => zoomTo(Number(slider.value) / 100);

  /* Dragging. Pointer events rather than mouse ones, and with capture, so that
   * a finger or a pen works and so that a drag which leaves the box still
   * follows the pointer instead of stopping at the edge.
   *
   * The box is measured here and not before: it is inside a dialog that is
   * laid out as it opens, and a width read at build time is the width of
   * nothing yet. `FRAME` is in it because the square, not the box, is what a
   * source pixel is being measured against. */
  let dragging = 0;
  surface.onpointerdown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const perPixel = side / (surface.clientWidth * FRAME);
    const fromX = event.clientX;
    const fromY = event.clientY;
    const wasX = x;
    const wasY = y;
    dragging = event.pointerId;
    surface.setPointerCapture(dragging);
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== dragging) return;
      // Backwards: dragging the picture right shows more of its left side, so
      // the square being kept moves left.
      x = wasX - (moved.clientX - fromX) * perPixel;
      y = wasY - (moved.clientY - fromY) * perPixel;
      clamp();
      place();
    };
    const stop = (ended: PointerEvent) => {
      if (ended.pointerId !== dragging) return;
      dragging = 0;
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", stop);
      surface.removeEventListener("pointercancel", stop);
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", stop);
    surface.addEventListener("pointercancel", stop);
  };

  /* The keyboard. Arrows nudge, and the step is a share of the square rather
   * than a count of source pixels: four per cent moves the same visible amount
   * whether the picture is a 400px scan or a 4000px photograph.
   *
   * Zoom is not here. The slider is a native range and already answers the
   * arrow keys when it has focus, so a second set of zoom keys on the box
   * beside it would be two answers to one question. */
  surface.onkeydown = (event: KeyboardEvent) => {
    const step = side * 0.04;
    if (event.key === "ArrowLeft") x -= step;
    else if (event.key === "ArrowRight") x += step;
    else if (event.key === "ArrowUp") y -= step;
    else if (event.key === "ArrowDown") y += step;
    else return;
    // Only once one of the four has matched, so that Tab and Escape still
    // belong to the dialog.
    event.preventDefault();
    clamp();
    place();
  };

  place();

  return {
    surface,
    zoom,
    async cut(): Promise<Blob> {
      /* Never enlarged, and never past what the package asks for: 512 is
       * IMAGE_SIZE out of exchange/SPEC.md §5.3, and bakeImage() writes a
       * smaller picture at its own size rather than upscaling it. Cutting a
       * 300-pixel square out of a small scan and blowing it up to 512 here
       * would add bytes and blur to something the viewer is going to scale to
       * its button anyway. */
      const out = Math.max(1, Math.min(Math.round(side), IMAGE_SIZE));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = out;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("this browser gave no 2d canvas to cut a picture on");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(picture, x, y, side, side, 0, 0, out, out);
      // PNG with its alpha kept, for the reason app_assets.ts keeps it: a
      // symbol may be line art on nothing, and a ground colour chosen here
      // would be wrong against half the keys.
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("this browser would not encode a PNG");
      return blob;
    },
    close(): void {
      URL.revokeObjectURL(url);
    },
  };
}
