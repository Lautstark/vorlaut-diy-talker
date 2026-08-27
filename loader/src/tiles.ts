// The browser half of tiles.py: a symbol picture in, the exact bytes the
// ST7735 shows out.
//
// Same shape as render_symbol() there, and deliberately the same vocabulary -
// fillColour, TILE_SIZE, toRgb565Be - so the two can be read side by side
// while both exist. A tile still depends on its symbol and nothing else: the
// six pixels round it are the firmware's, not baked in here.
//
// Two things in here look like over-engineering and are not. The thumbnail
// size is worked out with Pillow's rounding rather than an obvious one,
// because a size one pixel different moves every pixel after it. And there is
// a hand-written Lanczos next to canvas drawImage, because the two do not
// resample alike and how far apart they are was the question this module had
// to answer - see docs/tile-rendering.md and tools/tilecheck.py.

export const IMG_SIZE = 128;          // display area
export const TILE_SIZE = IMG_SIZE;    // the whole of it, and what becomes a file

// There was a BORDER of 6 between those two, and the tile was the 116 square
// inside it. The border was the set's colour, drawn by the firmware so that
// one symbol stayed one file across differently coloured sets; the colour is
// gone and the six pixels were being blacked out for nothing. A symbol gets
// them now - about a tenth wider in each direction, which is the whole of the
// change and is worth 22% more bytes a file.

// Mirrors TILE_PIPELINE in tiles.py, and tests/test_tile_render_js.py fails
// if the two ever drift. The tile file name is a hash over this number, so the
// device only re-fetches everything when it is bumped on purpose - and this is
// such a time: every tile is a different size, so every one of them has to be
// rendered again and none of the old ones may be mistaken for current.
export const TILE_PIPELINE = 3;

const WHITE = [255, 255, 255];
const PLACEHOLDER_GREY = [200, 200, 200];
const PLACEHOLDER_WIDTH = 4;

/* The negation cross - see Slot.negated in core/types.ts for what it says.
 *
 * design's --danger in its light value, written out because a tile has no
 * stylesheet and no scheme: the ST7735 shows one ground, white, and the dark
 * value is chosen to sit on a dark one. The same red the page draws the cross
 * in, so a key looks on the device like it looks in the editor.
 *
 * Thicker and further out than the placeholder's cross, and that is the point
 * of them being two numbers rather than one. The placeholder says "no picture
 * yet" to somebody building a board on a screen; this says "not" to a child
 * reading a 128-pixel key across a room, over line art it must not be mistaken
 * for a part of.
 *
 * The width is device pixels and stayed 9 when the tile grew from 116 to 128,
 * which is the answer rather than an oversight: the panel is 15.21 mm either
 * way, so 9 pixels is the same 1.07 mm of stroke to look at. The inset is a
 * share of the tile and so grew with it, which keeps the cross the same shape
 * over a larger picture. */
const NEGATION_RED = [173, 51, 44];
const NEGATION_WIDTH = 9;
/** How far in from the edge the cross starts, as a share of the tile. */
const NEGATION_INSET = 0.12;

// --- the colour the leftover strip gets ------------------------------------

/** The colour for the area left over next to a symbol.
 *
 * The reasoning is fill_colour()'s in tiles.py: no alpha channel and all four
 * corners the same colour means an edge-to-edge coloured symbol, and that
 * colour continues into the strip. Otherwise white, because dark line art
 * needs the light ground.
 *
 * Note this only ever reads corner pixels of a fully opaque picture. That
 * matters: a canvas stores colour premultiplied by alpha, so the RGB under a
 * half-transparent pixel does not survive the round trip through
 * getImageData - but by then we have already returned white.
 */
export function fillColour(pixels) {
  const { data, width, height } = pixels;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return WHITE.slice();
  }
  const corner = (x, y) => {
    const at = (y * width + x) * 4;
    return `${data[at]},${data[at + 1]},${data[at + 2]}`;
  };
  const corners = new Set([
    corner(0, 0), corner(width - 1, 0),
    corner(0, height - 1), corner(width - 1, height - 1),
  ]);
  if (corners.size !== 1) return WHITE.slice();
  return [...corners][0].split(",").map(Number);
}

// --- how big the picture gets drawn ----------------------------------------

/** What Image.thumbnail() would make of a picture this size.
 *
 * Fit-within, aspect preserved, and two details that are easy to miss and
 * expensive to get wrong. It never enlarges - a picture smaller than the tile
 * keeps its size and is simply centred. And the rounded side is not floored
 * but picked: of floor and ceil, whichever leaves the aspect ratio closer to
 * the original, ties to floor. That is round_aspect() in Pillow, and one
 * pixel of disagreement here shifts everything that follows.
 */
export function thumbnailSize(width, height, max = TILE_SIZE) {
  if (max >= width && max >= height) return [width, height];

  const roundAspect = (number, error) => {
    const low = Math.floor(number);
    const high = Math.ceil(number);
    // Python's min() keeps the earlier argument on a tie, and floor is first.
    const best = error(high) < error(low) ? high : low;
    return Math.max(best, 1);
  };

  const aspect = width / height;
  let [x, y] = [max, max];
  if (x / y >= aspect) {
    x = roundAspect(y * aspect, (n) => Math.abs(aspect - n / y));
  } else {
    y = roundAspect(x / aspect, (n) => (n === 0 ? 0 : Math.abs(aspect - x / n)));
  }
  return [x, y];
}

// --- resampling -------------------------------------------------------------

/** RGBA to premultiplied RGBA, Pillow's "RGBa" conversion.
 *
 * This is here because of one line in Image.resize(): an RGBA image is
 * converted to premultiplied, resized, and converted back. Which is the same
 * thing a canvas does, and the reason the two ends of this port can agree at
 * all - resampling straight through an alpha channel drags the colour of
 * fully transparent pixels into the edges, and the two would drag differently.
 *
 * Worth knowing: that recursion inside resize() also drops reducing_gap, so
 * the integer pre-shrink Pillow applies to opaque images never happens to
 * ours. Every symbol goes through convert("RGBA") first, so this is the only
 * path there is.
 */
export function premultiply(pixels) {
  const { data, width, height } = pixels;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 255) {
      out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2];
    } else if (alpha === 0) {
      // Whatever colour sat under a fully transparent pixel is dropped, not
      // carried into the edges. A canvas does the same, which is the single
      // reason the halo around a symbol can come out the same on both sides.
      out[i] = out[i + 1] = out[i + 2] = 0;
    } else {
      for (let c = 0; c < 3; c++) {
        // MULDIV255: rounding division by 255, to the byte Pillow lands on.
        const tmp = data[i + c] * alpha + 128;
        out[i + c] = (tmp + (tmp >> 8)) >> 8;
      }
    }
    out[i + 3] = alpha;
  }
  return { data: out, width, height };
}

/** Premultiplied RGBA back to straight RGBA - and truncating, as Pillow does. */
export function unpremultiply(pixels) {
  const { data, width, height } = pixels;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    for (let c = 0; c < 3; c++) {
      out[i + c] = alpha ? Math.min(255, Math.trunc(data[i + c] * 255 / alpha)) : data[i + c];
    }
    out[i + 3] = alpha;
  }
  return { data: out, width, height };
}

const LANCZOS_SUPPORT = 3.0;
// Pillow computes 8-bit resampling in fixed point, 22 bits after the point,
// and rounds each coefficient once. Doing the same costs nothing and removes
// a source of last-bit disagreement that would otherwise need explaining.
const PRECISION_BITS = 22;
const PRECISION_SCALE = 2 ** PRECISION_BITS;

function sinc(x) {
  if (x === 0) return 1.0;
  const t = x * Math.PI;
  return Math.sin(t) / t;
}

function lanczos(x) {
  if (x <= -LANCZOS_SUPPORT || x >= LANCZOS_SUPPORT) return 0.0;
  return sinc(x) * sinc(x / LANCZOS_SUPPORT);
}

/** Per-output-pixel taps and weights, precompute_coeffs() in Pillow. */
function coefficients(inSize, outSize, start, end) {
  const scale = (end - start) / outSize;
  const filterScale = Math.max(scale, 1.0);
  const support = LANCZOS_SUPPORT * filterScale;
  const bounds = [];
  const weights = [];

  for (let out = 0; out < outSize; out++) {
    const center = start + (out + 0.5) * scale;
    const min = Math.max(0, Math.trunc(center - support + 0.5));
    const max = Math.min(inSize, Math.trunc(center + support + 0.5));
    const taps = [];
    let sum = 0;
    for (let i = min; i < max; i++) {
      const w = lanczos((i - center + 0.5) / filterScale);
      taps.push(w);
      sum += w;
    }
    // Normalise in floating point, then round once into fixed point.
    for (let i = 0; i < taps.length; i++) {
      const w = sum !== 0 ? taps[i] / sum : 0;
      taps[i] = Math.trunc(w < 0 ? w * PRECISION_SCALE - 0.5 : w * PRECISION_SCALE + 0.5);
    }
    bounds.push([min, max - min]);
    weights.push(taps);
  }
  return { bounds, weights };
}

function clip8(value) {
  const shifted = Math.floor(value / PRECISION_SCALE);
  return shifted < 0 ? 0 : shifted > 255 ? 255 : shifted;
}

const ROUNDING = PRECISION_SCALE / 2;

/** Lanczos resample, the two passes and the arithmetic Pillow uses.
 *
 * Horizontal first into an 8-bit intermediate, then vertical, exactly as
 * ImagingResample does - the clamp in between is part of the result, not an
 * implementation detail one may skip.
 */
export function resampleLanczos(pixels, outWidth, outHeight) {
  const { data, width, height } = pixels;
  const [left, top, right, bottom] = [0, 0, width, height];

  const horizontal = coefficients(width, outWidth, left, right);
  const middle = new Uint8ClampedArray(outWidth * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < outWidth; x++) {
      const [min, count] = horizontal.bounds[x];
      const taps = horizontal.weights[x];
      let r = ROUNDING, g = ROUNDING, b = ROUNDING, a = ROUNDING;
      for (let i = 0; i < count; i++) {
        const at = (y * width + min + i) * 4;
        const w = taps[i];
        r += data[at] * w;
        g += data[at + 1] * w;
        b += data[at + 2] * w;
        a += data[at + 3] * w;
      }
      const at = (y * outWidth + x) * 4;
      middle[at] = clip8(r);
      middle[at + 1] = clip8(g);
      middle[at + 2] = clip8(b);
      middle[at + 3] = clip8(a);
    }
  }

  const vertical = coefficients(height, outHeight, top, bottom);
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const [min, count] = vertical.bounds[y];
    const taps = vertical.weights[y];
    for (let x = 0; x < outWidth; x++) {
      let r = ROUNDING, g = ROUNDING, b = ROUNDING, a = ROUNDING;
      for (let i = 0; i < count; i++) {
        const at = ((min + i) * outWidth + x) * 4;
        const w = taps[i];
        r += middle[at] * w;
        g += middle[at + 1] * w;
        b += middle[at + 2] * w;
        a += middle[at + 3] * w;
      }
      const at = (y * outWidth + x) * 4;
      out[at] = clip8(r);
      out[at + 1] = clip8(g);
      out[at + 2] = clip8(b);
      out[at + 3] = clip8(a);
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

/** Pillow's thumbnail(), start to finish. */
export function thumbnail(pixels, outWidth, outHeight) {
  if (pixels.width === outWidth && pixels.height === outHeight) return pixels;
  return unpremultiply(resampleLanczos(premultiply(pixels), outWidth, outHeight));
}

/** The shrunk picture on its ground, Pillow's alpha_composite().
 *
 * Doing this by hand rather than letting a canvas do it is the difference
 * between a tile that is defined by this file and a tile that is defined by
 * whoever's browser is open - and the browsers do not agree. The integer
 * arithmetic below is Pillow's, kept as it is written there so that the two
 * round the same way rather than nearly the same way.
 */
export function compose(patch, ground, offset, size = TILE_SIZE) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = ground[0];
    out[i + 1] = ground[1];
    out[i + 2] = ground[2];
    out[i + 3] = 255;
  }

  const [left, top] = offset;
  for (let y = 0; y < patch.height; y++) {
    const row = y + top;
    if (row < 0 || row >= size) continue;
    for (let x = 0; x < patch.width; x++) {
      const column = x + left;
      if (column < 0 || column >= size) continue;
      const from = (y * patch.width + x) * 4;
      const alpha = patch.data[from + 3];
      if (alpha === 0) continue;
      const to = (row * size + column) * 4;
      if (alpha === 255) {
        out[to] = patch.data[from];
        out[to + 1] = patch.data[from + 1];
        out[to + 2] = patch.data[from + 2];
        continue;
      }
      // The ground is opaque, which collapses Pillow's general case: the
      // weights come out as alpha and 255 - alpha, and the rounding is its
      // shift-based divide by 255 rather than a plain one.
      for (let c = 0; c < 3; c++) {
        const mixed = patch.data[from + c] * alpha
          + out[to + c] * (255 - alpha) + 128;
        out[to + c] = ((mixed >> 8) + mixed) >> 8;
      }
    }
  }
  return { data: out, width: size, height: size };
}

// --- the placeholder --------------------------------------------------------

function roundUp(f) {
  return f >= 0 ? Math.floor(f + 0.5) : -Math.floor(Math.abs(f) + 0.5);
}

function roundDown(f) {
  return f >= 0 ? Math.ceil(f - 0.5) : -Math.ceil(Math.abs(f) - 0.5);
}

/** The quadrilateral Pillow turns a thick line into.
 *
 * A canvas would draw the cross with antialiased edges and Pillow does not,
 * so every pixel along both diagonals would differ for a reason that has
 * nothing to do with resampling. Hard-edged and identical is cheap here: the
 * shape is fixed and small.
 */
function wideLinePolygon(x0, y0, x1, y1, width) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const half = (width - 1) / 2.0;
  const ratioMax = roundUp(half) / length;
  const ratioMin = roundDown(half) / length;
  const dxMin = roundDown(ratioMin * dy);
  const dxMax = roundDown(ratioMax * dy);
  const dyMin = roundDown(ratioMin * dx);
  const dyMax = roundDown(ratioMax * dx);
  return [
    [x0 - dxMin, y0 + dyMax],
    [x1 - dxMin, y1 + dyMax],
    [x1 + dxMax, y1 - dyMin],
    [x0 + dxMax, y0 - dyMin],
  ];
}

/** Scanline fill of a polygon with integer corners, into RGBA bytes.
 *
 * Spans are half open in y so that a corner shared by two edges is counted
 * once, and the very last row is closed again so the bottom corner is not
 * lost. Those two rules together reproduce Pillow's cross exactly, which was
 * checked against it for every width and inset the placeholder might use.
 */
function fillPolygon(target, points, colour) {
  const { data, width, height } = target;
  const edges = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    if (ay === by) continue;
    edges.push({
      ax, ay,
      min: Math.min(ay, by),
      max: Math.max(ay, by),
      slope: (bx - ax) / (by - ay),
    });
  }
  if (!edges.length) return;

  const top = Math.min(...edges.map((e) => e.min));
  const bottom = Math.max(...edges.map((e) => e.max));
  for (let y = top; y <= bottom; y++) {
    const last = y === bottom;
    const crossings = edges
      .filter((e) => (y >= e.min && y < e.max) || (last && e.max === y))
      .map((e) => (y - e.ay) * e.slope + e.ax)
      .sort((a, b) => a - b);
    for (let i = 1; i < crossings.length; i += 2) {
      for (let x = roundUp(crossings[i - 1]); x <= roundDown(crossings[i]); x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const at = (y * width + x) * 4;
        data[at] = colour[0];
        data[at + 1] = colour[1];
        data[at + 2] = colour[2];
        data[at + 3] = 255;
      }
    }
  }
}

/** A cross corner to corner, inset by `pad`, in `colour`. Both crosses this
 *  module draws are this shape at two sizes. */
function crossInto(target, size, pad, width, colour) {
  for (const line of [
    [pad, pad, size - pad, size - pad],
    [size - pad, pad, pad, size - pad],
  ] as [number, number, number, number][]) {
    fillPolygon(target, wideLinePolygon(...line, width), colour);
  }
}

/** Empty field, and nothing on it - a key holding neither word nor picture.
 *
 * Not placeholder() below, and the difference is the whole reason this exists.
 * That grey cross says "no picture yet", which is true of a key that wants one
 * and false of a key nobody has put anything on. The two were the same tile
 * until 2026-08-27, and what made the difference visible was the app package:
 * diyBoards() writes no button at all where slotIsEmpty() holds, so one empty
 * key was an empty cell on a tablet and a missing-picture cross on the device.
 * Nothing had ever compared the two paths, because they never meet.
 *
 * White, rather than no tile at all. The device has five panels and they are
 * always lit, so it cannot leave one out the way a grid leaves out a cell -
 * and not writing a tile is not the same as writing a blank one. A slot whose
 * hash is sixteen zero bytes names a file that is not there, so drawTile()
 * clears the panel to black and prints `missing:`, and a dark key in a row of
 * white ones reads as a device that has broken rather than a key that is free.
 */
export function blank(size = TILE_SIZE) {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  return { data, width: size, height: size };
}

/** Empty field with a grey cross - a symbol that is still missing. */
export function placeholder(size = TILE_SIZE) {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const target = { data, width: size, height: size };
  crossInto(target, size, Math.floor(size / 4), PLACEHOLDER_WIDTH, PLACEHOLDER_GREY);
  return target;
}

/** Crosses a rendered tile out, in place.
 *
 * Drawn onto the composed pixels rather than onto the source picture, so the
 * stroke is the same width whatever size the symbol was and whether it was
 * shrunk at all. Hard-edged, like the placeholder's: fillPolygon does not
 * antialias, and a tile is compared byte for byte against a frozen reference -
 * a canvas stroke would put a different edge on it in every engine.
 */
export function negateInto(pixels) {
  const size = pixels.width;
  crossInto(pixels, size, Math.round(size * NEGATION_INSET), NEGATION_WIDTH, NEGATION_RED);
  return pixels;
}

// --- what the panel gets ----------------------------------------------------

export function rgbTo565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Raw RGB565, big-endian, the form the ST7735 expects. */
export function toRgb565Be(pixels) {
  const { data, width, height } = pixels;
  const out = new Uint8Array(width * height * 2);
  let write = 0;
  for (let read = 0; read < data.length; read += 4) {
    const value = rgbTo565(data[read], data[read + 1], data[read + 2]);
    out[write++] = value >> 8;
    out[write++] = value & 0xff;
  }
  return out;
}

// --- putting it together ----------------------------------------------------

function scratch(width, height) {
  const canvas = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  // Reading pixels back is the point of every one of these canvases, so tell
  // the browser not to put it on the GPU.
  return canvas.getContext("2d", { willReadFrequently: true });
}

/** The source picture as plain RGBA bytes, at its own size. */
export function sourcePixels(source) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const context = scratch(width, height);
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, width, height);
}

/** 116x116 symbol area on its ground colour, without a border.
 *
 * `source` is anything drawImage takes - an ImageBitmap, an <img>, a canvas -
 * or null for a symbol that does not resolve, which is not an error but a
 * grey cross.
 *
 * `resample` picks how the picture is shrunk. "lanczos" runs the filter in
 * here and follows Pillow step for step, and is the one to use: on every
 * fixture, in both engines it was measured in, it comes out byte for byte
 * what tiles.py makes. "canvas" hands the job to drawImage, and is kept only
 * so tools/tilecheck.py can keep saying by how much that would be worse.
 *
 * `negated` crosses the finished tile out - Slot.negated, baked into the
 * pixels. Last, over everything, because the cross is over the picture and
 * not part of it; and off by default, so every tile that was frozen before
 * this existed still renders byte for byte what it did.
 */
export function renderSymbol(source, { resample = "lanczos", negated = false } = {}) {
  if (!source) return renderPixels(null, { negated });

  const pixels = sourcePixels(source);

  if (resample === "canvas") {
    const crossed = (done) => toRgb565Be(negated ? negateInto(done) : done);
    const ground = fillColour(pixels);
    const [width, height] = thumbnailSize(pixels.width, pixels.height);
    const offset = [
      Math.floor((TILE_SIZE - width) / 2),
      Math.floor((TILE_SIZE - height) / 2),
    ];
    const context = scratch(TILE_SIZE, TILE_SIZE);
    context.fillStyle = `rgb(${ground[0]},${ground[1]},${ground[2]})`;
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, offset[0], offset[1], width, height);
    return crossed(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE));
  }

  return renderPixels(pixels, { negated });
}

/** renderSymbol(), from the point where the picture has already been decoded.
 *
 * The same bytes as renderSymbol() for the same input - it is the second half
 * of that function, called by it - and the reason it is reachable on its own
 * is where the browser stops being needed. Everything above this line wants a
 * canvas: sourcePixels() draws the source to get at its pixels, and the
 * "canvas" resample hands the whole shrink to drawImage. Everything below it
 * is arithmetic over a Uint8ClampedArray, which is why
 * tests/unit/device_compile.test.ts can compile a device build under node
 * and why data/device_package.ts asks its host to decode rather than decoding.
 *
 * `pixels` is anything with `data`, `width` and `height` - an ImageData, or
 * the same three fields out of a fixture. null is a symbol that did not
 * resolve, which is not an error but the grey cross.
 *
 * Only the Lanczos path. "canvas" needs the source itself rather than its
 * pixels, so it stays where the source is; it exists for tools/tilecheck.py
 * and has never been what a build uses.
 */
export function renderPixels(pixels, { negated = false } = {}) {
  const crossed = (done) => toRgb565Be(negated ? negateInto(done) : done);
  if (!pixels) return crossed(placeholder());

  const ground = fillColour(pixels);
  const [width, height] = thumbnailSize(pixels.width, pixels.height);
  const offset = [
    Math.floor((TILE_SIZE - width) / 2),
    Math.floor((TILE_SIZE - height) / 2),
  ];
  return crossed(compose(thumbnail(pixels, width, height), ground, offset));
}
