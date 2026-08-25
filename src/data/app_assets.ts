// The two things an app package holds that a layout only points at: pictures
// and recordings, as files.
//
// Kept apart from app_package.ts because this half needs the browser - a
// canvas, and the platform's Opus encoder - while the mapping is a function
// over data. That line is what lets the mapping and its validator be checked
// under node, which is where most of the rules worth checking live.

import { thumbnailSize } from "./tiles.js";
import { digest, IMAGE_SIZE, type BakedImage, type BakedSound } from "./app_package.js";
import { encodeOpus, ENCODER_RATE } from "./opus.js";

/**
 * A symbol as a PNG for the package.
 *
 * **Not the device's tile.** tiles.ts renders 116x116 RGB565 on an opaque
 * ground, because that is what an ESP32 blits; a tablet wants the picture. So
 * this goes back to the source the reference resolves to - the same source the
 * tile is made from - and writes it at the size exchange/SPEC.md §5.3 asks
 * for. Scaling a 116-pixel tile up to 512 would put the device's pixels on a
 * screen four times their size, along with the ground colour the tile baked in
 * because the firmware has no alpha.
 *
 * Fitted rather than padded, and never enlarged. A symbol smaller than 512 is
 * written at its own size: upscaling here would add bytes and blur to a
 * picture the viewer is going to scale to its button anyway. Transparency is
 * kept - §5.3 asks for truecolour with alpha, because symbols are line art and
 * a ground colour chosen here would be wrong against half the buttons.
 *
 * `negated` draws the cross into the PNG - see Slot.negated. Baked rather than
 * carried as a field, and that is a decision about the format rather than a
 * shortcut: §4.3 closes the list of button extensions at v1 and §5 already
 * requires every image to be a file in the archive, so a viewer that knows
 * nothing about negation still shows a crossed-out button correctly. A flag
 * would need the spec, the fixtures and the Android viewer to move together
 * before one child saw one cross.
 */
export async function bakeImage(
  source: CanvasImageSource, { negated = false } = {},
): Promise<BakedImage> {
  const width = "naturalWidth" in source
    ? (source.naturalWidth || (source as HTMLImageElement).width)
    : Number((source as { width: number }).width);
  const height = "naturalHeight" in source
    ? (source.naturalHeight || (source as HTMLImageElement).height)
    : Number((source as { height: number }).height);

  // thumbnailSize() is tiles.ts's fit, which follows Pillow step for step.
  // Borrowed rather than re-derived so that a symbol lands in the same
  // proportions on the tablet as on the device.
  const [drawWidth, drawHeight] = width <= IMAGE_SIZE && height <= IMAGE_SIZE
    ? [width, height]
    : thumbnailSize(width, height, IMAGE_SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = drawWidth;
  canvas.height = drawHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser gave no 2d canvas to draw a symbol on");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, drawWidth, drawHeight);
  if (negated) crossOut(context, drawWidth, drawHeight);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("this browser would not encode a PNG");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { key: await digest(bytes), bytes, width: drawWidth, height: drawHeight };
}

/* design's --danger in its light value, the same red tiles.ts writes into a
 * tile. Written out for the same reason: a PNG in an archive has no
 * stylesheet, and a viewer's scheme is not ours to guess at. */
const NEGATION_RED = "#ad332c";

/** The cross, corner to corner over the picture that was just drawn.
 *
 * Stroked rather than filled, unlike the device's: nothing compares this file
 * byte for byte, and a tablet shows it at whatever size a button happens to
 * be, so the antialiased edge a canvas gives is the better one. Stretched to
 * the box rather than kept square, so a wide symbol is crossed the whole way
 * across instead of through its middle third. */
function crossOut(context: CanvasRenderingContext2D, width: number, height: number): void {
  const inset = 0.12;
  const [x0, y0] = [width * inset, height * inset];
  const [x1, y1] = [width - x0, height - y0];
  context.strokeStyle = NEGATION_RED;
  context.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.075));
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x0, y0);
  context.lineTo(x1, y1);
  context.moveTo(x1, y0);
  context.lineTo(x0, y1);
  context.stroke();
}

/**
 * A sentence as an Ogg Opus clip.
 *
 * The samples come from the synthesiser at ENCODER_RATE and go to the encoder
 * unchanged. §6.1 is worth reading before touching this: the device's 16 kHz
 * WAVs are a downsample of the same master, and encoding *those* to Opus would
 * stack a downsample and a lossy codec for no reason. Both come from the
 * master; neither comes from the other.
 */
export async function bakeSound(samples: Float32Array): Promise<BakedSound> {
  const clip = await encodeOpus(samples, ENCODER_RATE);
  return { key: await digest(clip.bytes), bytes: clip.bytes, seconds: clip.seconds };
}
