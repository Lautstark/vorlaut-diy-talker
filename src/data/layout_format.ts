// layout.bin - the table the firmware reads, written in the browser.
//
// A port of render_layout_bin() from layout_format.py, byte for byte. The app
// is becoming a static site, so the writer has to exist here as well; the
// firmware does not change with it, which leaves exactly one acceptable
// output - the one Python already produces. tests/test_layout_format.py holds
// this to it: every case is written by both, the bytes are compared, and the
// firmware's own C reader reads the file this module produced.
//
// The structure itself is written down in layout_format.py and in
// firmware/vorlaut/layout_format.h, and is not copied a third time here. The
// strides below are spelled out as the same sums for the same reason: the sum
// is the thing that has to keep agreeing.
//
// Two places deviate from the Python on purpose, both only for input the
// Python does not survive either - they are marked where they are.

export const LAYOUT_BIN = "layout.bin";
export const LAYOUT_MAGIC = "MTRD";
export const LAYOUT_VERSION = 1;

export const SLOTS_PER_SET = 4;
export const NAME_BYTES = 32;
export const HASH_BYTES = 16;
// Fixed strides - the firmware works with the same numbers.
export const SLOT_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1;                       // 34
export const SET_BYTES = 2 + NAME_BYTES + HASH_BYTES + SLOTS_PER_SET * SLOT_BYTES; // 186
export const HEADER_BYTES = 4 + 4 + 4;                                           // 12

// The index the device labels its own menu by - see LANGUAGE_CODES in
// layout.py, and LANGUAGES in firmware/vorlaut/texts.h.
export const LANGUAGE_CODES = { en: 0, de: 1 };
export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_COLOR = "#3B5BDB";

const encoder = new TextEncoder();

/** The sets that go onto the device, in the order of the layout. */
export function activeSets(layout) {
  // A missing field means active, so that layouts from before the
  // distinction stay valid - the same rule as in layout.py.
  return (layout.sets || []).filter(
    (entry) => (entry.active === undefined ? true : Boolean(entry.active)));
}

export function normalizeColor(value) {
  let text = String(value || "").trim();
  if (!text.startsWith("#")) text = "#" + text;
  if (text.length === 4) {            // #abc -> #aabbcc
    text = "#" + [...text.slice(1)].map((ch) => ch + ch).join("");
  }
  // Python checks this with int(value[1:], 16), which also accepts an
  // underscore or a sign - and then breaks two lines later when it reads the
  // pairs. Rejecting it here turns that crash into the default colour, which
  // is what every reachable input gets anyway.
  if (text.length !== 7 || !/^[0-9a-fA-F]{6}$/.test(text.slice(1))) {
    return DEFAULT_COLOR;
  }
  return text.toUpperCase();
}

export function hexToRgb(value: string): [number, number, number] {
  const text = normalizeColor(value);
  return [parseInt(text.slice(1, 3), 16),
          parseInt(text.slice(3, 5), 16),
          parseInt(text.slice(5, 7), 16)];
}

export function rgbTo565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** What Path(name).stem does: the file name without its last suffix. */
function stem(filename) {
  const name = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // A leading dot is part of the name and not a suffix, and a name of nothing
  // but dots has no suffix at all.
  if (dot <= 0 || /^\.+$/.test(name)) return name;
  return name.slice(0, dot);
}

/** The 16 raw hash bytes out of "t3bd7a62….bin". */
export function hashBytes(filename) {
  const out = new Uint8Array(HASH_BYTES);
  if (!filename) return out;
  const core = stem(String(filename)).slice(1);   // drop the leading t or a
  // Python raises here rather than writing a hash that is not one, and so do
  // we: a silently zeroed hash would be a key without a picture on the
  // device, and nothing on the way there would say why.
  if (core.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(core)) {
    throw new Error(`not a hashed file name: ${filename}`);
  }
  for (let i = 0; i < Math.min(HASH_BYTES, core.length / 2); i++) {
    out[i] = parseInt(core.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * The bytes of layout.bin, as build.py would write them.
 *
 * layout is a normalized layout, the three lists are per active set and in
 * its order - exactly what builder.py hands the Python.
 */
export function renderLayoutBin(layout, labelFiles, tileFiles, audioFiles) {
  // The active sets only - the file lists are built the same way, and
  // setCount in the header has to match them.
  const sets = activeSets(layout);
  if (sets.length > 0xff) {
    throw new RangeError(`${sets.length} sets do not fit in one byte`);
  }
  const language = Object.hasOwn(LANGUAGE_CODES, layout.language)
    ? LANGUAGE_CODES[layout.language]
    : LANGUAGE_CODES[DEFAULT_LANGUAGE];
  const sleep = layout.sleep_timeout_seconds;
  if (!Number.isInteger(sleep) || sleep < 0 || sleep > 0xffffffff) {
    throw new RangeError(`sleep_timeout_seconds is not a uint32: ${sleep}`);
  }

  // The size is known before the first byte is written, and the buffer starts
  // zeroed - which is what every padding in this format is made of.
  const bytes = new Uint8Array(HEADER_BYTES + sets.length * SET_BYTES);
  const view = new DataView(bytes.buffer);
  let at = 0;

  for (let i = 0; i < LAYOUT_MAGIC.length; i++) {
    view.setUint8(at++, LAYOUT_MAGIC.charCodeAt(i));
  }
  view.setUint8(at++, LAYOUT_VERSION);
  view.setUint8(at++, sets.length);
  view.setUint8(at++, SLOTS_PER_SET);
  view.setUint8(at++, language);
  // Little-endian, spelled out at every call: DataView writes big-endian
  // unless told otherwise, while the firmware assembles its numbers out of
  // single bytes low one first (layoutU16, layoutU32 in layout_format.h).
  view.setUint32(at, sleep, true);
  at += 4;

  sets.forEach((entry, index) => {
    view.setUint16(at, rgbTo565(...hexToRgb(entry.color)), true);
    at += 2;
    // Cut after the 32nd byte, not after the 32nd character. A name of
    // umlauts is half as long as it looks, and cutting the string first would
    // make the two writers disagree the moment one is used.
    bytes.set(encoder.encode(String(entry.name ?? "")).subarray(0, NAME_BYTES), at);
    at += NAME_BYTES;
    bytes.set(hashBytes(labelFiles[index]), at);
    at += HASH_BYTES;
    for (let slot = 0; slot < SLOTS_PER_SET; slot++) {
      const sound = audioFiles[index][slot];
      bytes.set(hashBytes(tileFiles[index][slot]), at);
      at += HASH_BYTES;
      bytes.set(hashBytes(sound), at);
      at += HASH_BYTES;
      view.setUint8(at++, sound ? 1 : 0);
      view.setUint8(at++, 0);          // reserved
    }
  });
  return bytes;
}
