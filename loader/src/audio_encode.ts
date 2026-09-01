/* The compressed form of an a<hash>.wav, written here and read by
 * firmware/vorlaut/adpcm_format.h.
 *
 * What a recording costs is the same thing a tile costs, and more of it. Four
 * collections beside each other on one device are 6031 KiB of speech against
 * about 6500 KiB the file area holds once the pictures are in it - 93 per cent
 * of the occupied space - and the cable moves 60 KB a second, so that is a
 * hundred seconds of somebody holding a talker still. IMA ADPCM is four bits a
 * sample instead of sixteen, so both numbers divide by roughly four.
 *
 * Three rules keep the two forms from ever being confused for one another, and
 * they are deliberately the same three tile_encode.ts works by:
 *
 *   It stays a WAV. IMA ADPCM is WAVE format tag 0x11, so the container does
 *   not change, seekToWavData() still walks to the data chunk, and a reader
 *   tells the forms apart by the tag in fmt rather than by a new extension.
 *   A codec change, not a container change.
 *
 *   The raw form keeps the right of way. encodeAdpcmWav() hands the PCM bytes
 *   straight back whenever the encoding would not be smaller, so a file that
 *   does not pay for itself never costs more than it did.
 *
 *   The file name does not change. It is a hash of the recording the editor
 *   synthesised, not of the file, so one word is one name in either form -
 *   which is what lets a talker holding PCM and a browser sending ADPCM agree
 *   about what is already there.
 *
 * Why IMA ADPCM and not Opus or MP3 is the argument adr/0019 already made for
 * deflate: device/fixtures/ has to regenerate byte for byte, the board has no
 * PSRAM, and every reader here is hand-written and compiled by a test. IMA
 * ADPCM is a fixed quantiser with no entropy coding and no tables that a
 * library version could change underneath a fixture.
 */

import {
  DEVICE_BITS_PER_SAMPLE, DEVICE_CHANNELS, DEVICE_SAMPLE_RATE,
} from "./audio_format.js";

/** The WAVE format tag of plain PCM, which is what the build writes today. */
export const WAV_FORMAT_PCM = 0x0001;
/** The WAVE format tag of IMA ADPCM. The whole of what says which form a
 *  recording is in - there is no magic of our own, because the container
 *  already has a field for exactly this. */
export const WAV_FORMAT_IMA_ADPCM = 0x0011;

/**
 * One block of encoded samples, in bytes.
 *
 * 256 is what everything else that writes this format uses, which matters
 * more here than it looks: these files are opened on a bench in Audacity when
 * a word sounds wrong, and a block size nobody else emits would make that
 * check a test of the reader rather than of the recording.
 *
 * It also sets what the device holds at once. A block decodes to 505 samples,
 * 1010 bytes of PCM, about 32 ms - the same order as the AUDIO_CHUNK that
 * playWav() already writes to I2S in, so the decoder changes the size of a
 * write and not the shape of the loop.
 */
export const ADPCM_BLOCK_BYTES = 256;

/** Samples one block holds: the first comes out of the block header verbatim,
 *  and every byte after it carries two. */
export const ADPCM_BLOCK_SAMPLES = 1 + (ADPCM_BLOCK_BYTES - 4) * 2;

/* The two tables IMA ADPCM is. Fixed by the format, not tuned here: an
 * encoder and a decoder that disagree about one entry produce a word that
 * drifts into noise rather than one that fails, which is why both halves of
 * this repository carry the same tables and tests/test_adpcm.py runs one
 * against the other. */
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

const clampSample = (value: number): number =>
  value < -32768 ? -32768 : value > 32767 ? 32767 : value;
const clampIndex = (value: number): number =>
  value < 0 ? 0 : value > 88 ? 88 : value;

/**
 * One sample into one nibble, moving the predictor exactly as a decoder will.
 *
 * The delta is accumulated out of the same three shifts the decoder adds up,
 * rather than recomputed from the nibble afterwards. That is not a shortcut:
 * it is what makes the encoder's idea of where the signal is and the decoder's
 * the same number at every sample, which is the only thing keeping the two
 * from drifting apart over the length of a word.
 */
function encodeSample(sample: number, state: { predictor: number; index: number }): number {
  let step = STEP_TABLE[state.index]!;
  let diff = sample - state.predictor;
  let nibble = 0;
  if (diff < 0) {
    nibble = 8;
    diff = -diff;
  }
  let delta = step >> 3;
  if (diff >= step) {
    nibble |= 4;
    diff -= step;
    delta += step;
  }
  step >>= 1;
  if (diff >= step) {
    nibble |= 2;
    diff -= step;
    delta += step;
  }
  step >>= 1;
  if (diff >= step) {
    nibble |= 1;
    delta += step;
  }
  state.predictor = clampSample(
    nibble & 8 ? state.predictor - delta : state.predictor + delta);
  state.index = clampIndex(state.index + INDEX_TABLE[nibble]!);
  return nibble;
}

/** One nibble back into one sample. The mirror of encodeSample(), and the
 *  line-for-line twin of adpcmDecodeBlock() in adpcm_format.h. */
function decodeSample(nibble: number, state: { predictor: number; index: number }): number {
  const step = STEP_TABLE[state.index]!;
  let diff = step >> 3;
  if (nibble & 4) diff += step;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 1) diff += step >> 2;
  state.predictor = clampSample(
    nibble & 8 ? state.predictor - diff : state.predictor + diff);
  state.index = clampIndex(state.index + INDEX_TABLE[nibble]!);
  return state.predictor;
}

/* ------------------------------------------------------------- the WAV --- */

/** What a RIFF chunk header says, with the body left where it is. */
interface Chunk { id: string; at: number; size: number; }

function* chunks(bytes: Uint8Array): Generator<Chunk> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    const size = view.getUint32(at + 4, true);
    yield { id, at: at + 8, size };
    // Word aligned, and an odd size carries a pad byte it does not count. The
    // same step device_package.ts takes, and the one device/fixtures/audio/
    // extra-chunk exists to catch a reader forgetting.
    at += 8 + size + (size % 2);
  }
}

function isRiffWave(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (at: number) => String.fromCharCode(
    bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  return tag(0) === "RIFF" && tag(8) === "WAVE";
}

function riff(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let length = 12;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);            // RIFF
  view.setUint32(4, length - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);            // WAVE
  let at = 12;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length & 1;
  const out = new Uint8Array(8 + body.length + padded);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/* ------------------------------------------------------------- reading --- */

/** A recording as this module needs to see it: the tag it declares and the
 *  bytes of its data chunk, with the chunk walk already done. */
interface Recording {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  data: Uint8Array;
}

function readRecording(bytes: Uint8Array): Recording | null {
  if (!isRiffWave(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: Omit<Recording, "data"> | null = null;
  let data: Uint8Array | null = null;
  for (const one of chunks(bytes)) {
    if (one.id === "fmt " && one.size >= 16 && one.at + 16 <= bytes.length) {
      format = {
        formatTag: view.getUint16(one.at, true),
        channels: view.getUint16(one.at + 2, true),
        sampleRate: view.getUint32(one.at + 4, true),
        blockAlign: view.getUint16(one.at + 12, true),
        bitsPerSample: view.getUint16(one.at + 14, true),
      };
    } else if (one.id === "data") {
      // What is declared, against what is there. A truncated recording
      // declares the length it meant to have - device/fixtures/audio/
      // data-longer-than-file is that file, and the device plays a short word
      // rather than reading off the end.
      const have = Math.max(0, bytes.length - one.at);
      data = bytes.subarray(one.at, one.at + Math.min(one.size, have));
    }
  }
  return format && data ? { ...format, data } : null;
}

/** The samples of a 16-bit PCM data chunk, little-endian, as the device
 *  reads them back. */
function samplesOf(data: Uint8Array): Int16Array {
  const out = new Int16Array(data.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = (data[2 * i]! | (data[2 * i + 1]! << 8)) << 16 >> 16;
  }
  return out;
}

/* ------------------------------------------------------------ encoding --- */

/**
 * A recording, compressed - or the same bytes back if that would not be
 * smaller, or if it is not the PCM the device plays.
 *
 * Takes and returns a whole WAV rather than samples, because every caller has
 * a file in its hand: the compile produces a<hash>.wav and this is applied to
 * one on the way to a talker that said it can read the form. Anything that is
 * not 16 kHz mono 16-bit PCM comes back untouched - a file this cannot make
 * sense of is a file to leave alone, not one to guess at, and isDeviceWav()
 * in device_package.ts is what refuses it earlier and louder.
 *
 * The samples are padded with silence up to a whole block. A partial final
 * block is what a truncated file looks like, and the cost of not writing one
 * is at most 504 samples - 31 ms - of the encoder settling on zero, at the
 * end of a word that playWav() already follows with 96 ms of silence.
 */
export function encodeAdpcmWav(wav: Uint8Array): Uint8Array<ArrayBuffer> {
  const heard = readRecording(wav);
  const usable = heard !== null
    && heard.formatTag === WAV_FORMAT_PCM
    && heard.channels === DEVICE_CHANNELS
    && heard.sampleRate === DEVICE_SAMPLE_RATE
    && heard.bitsPerSample === DEVICE_BITS_PER_SAMPLE;
  if (!usable) return wav as Uint8Array<ArrayBuffer>;

  const pcm = samplesOf(heard.data);
  const perBlock = ADPCM_BLOCK_SAMPLES;
  const blocks = Math.ceil(pcm.length / perBlock);
  const data = new Uint8Array(blocks * ADPCM_BLOCK_BYTES);
  const view = new DataView(data.buffer);

  // The step index carries across the block boundary even though every block
  // states its own. Both are true and they are not the same thing: the header
  // is what a decoder starts from, so a block is still readable on its own,
  // and carrying it means the encoder does not begin each block by climbing
  // back up to where the signal already was.
  const state = { predictor: 0, index: 0 };
  for (let block = 0; block < blocks; block++) {
    const first = block * perBlock;
    const at = block * ADPCM_BLOCK_BYTES;
    // The first sample of the block is stored whole and is the predictor, so
    // it comes back exactly. Everything past the end of the recording is zero.
    state.predictor = pcm[first] ?? 0;
    view.setInt16(at, state.predictor, true);
    data[at + 2] = state.index;
    data[at + 3] = 0;                       // reserved, and written as zero
    for (let i = 1; i < perBlock; i++) {
      const nibble = encodeSample(pcm[first + i] ?? 0, state);
      const to = at + 4 + ((i - 1) >> 1);
      // Low nibble first, which is the order every other reader of this
      // format expects and the one adpcm_format.h unpacks in.
      if ((i - 1) & 1) data[to] = data[to]! | (nibble << 4);
      else data[to] = nibble;
    }
  }

  const fmt = new Uint8Array(20);
  const fmtView = new DataView(fmt.buffer);
  fmtView.setUint16(0, WAV_FORMAT_IMA_ADPCM, true);
  fmtView.setUint16(2, DEVICE_CHANNELS, true);
  fmtView.setUint32(4, DEVICE_SAMPLE_RATE, true);
  fmtView.setUint32(
    8, Math.floor(DEVICE_SAMPLE_RATE * ADPCM_BLOCK_BYTES / perBlock), true);
  fmtView.setUint16(12, ADPCM_BLOCK_BYTES, true);
  fmtView.setUint16(14, 4, true);           // bits per sample
  fmtView.setUint16(16, 2, true);           // cbSize
  fmtView.setUint16(18, perBlock, true);    // samples per block

  // How many samples the recording really had, before the padding. The device
  // never reads it - it decodes what is there - and a bench tool does, which
  // is the whole reason a non-PCM WAV carries this chunk at all.
  const fact = new Uint8Array(4);
  new DataView(fact.buffer).setUint32(0, pcm.length, true);

  const out = riff(chunk("fmt ", fmt), chunk("fact", fact), chunk("data", data));
  // Not smaller is not worth having. Short of about a tenth of a second the
  // twenty-eight bytes of extra header outweigh what the samples save, and a
  // recording that does not pay for itself travels as it always did.
  return out.length < wav.length ? out : wav as Uint8Array<ArrayBuffer>;
}

/**
 * The other direction: an ADPCM WAV back as the PCM WAV the device would have
 * been sent instead.
 *
 * For the tests and for anything on this side that has to hear what a talker
 * will hear. Reads what adpcm_format.h reads, including its forgiveness - a
 * final block short of ADPCM_BLOCK_BYTES decodes to however many samples its
 * nibbles hold rather than being refused. Returns null for a file that is not
 * this form, which is what tells a caller it was handed the raw one.
 */
export function decodeAdpcmWav(wav: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const heard = readRecording(wav);
  if (!heard || heard.formatTag !== WAV_FORMAT_IMA_ADPCM) return null;
  const align = heard.blockAlign >= 5 ? heard.blockAlign : ADPCM_BLOCK_BYTES;

  const out: number[] = [];
  const state = { predictor: 0, index: 0 };
  for (let at = 0; at + 4 <= heard.data.length; at += align) {
    const bytes = Math.min(align, heard.data.length - at);
    state.predictor =
      (heard.data[at]! | (heard.data[at + 1]! << 8)) << 16 >> 16;
    state.index = clampIndex(heard.data[at + 2]!);
    out.push(state.predictor);
    for (let i = 0; i < (bytes - 4) * 2; i++) {
      const byte = heard.data[at + 4 + (i >> 1)]!;
      out.push(decodeSample(i & 1 ? byte >> 4 : byte & 0x0f, state));
    }
  }

  const data = new Uint8Array(out.length * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < out.length; i++) view.setInt16(2 * i, out[i]!, true);

  const fmt = new Uint8Array(16);
  const fmtView = new DataView(fmt.buffer);
  fmtView.setUint16(0, WAV_FORMAT_PCM, true);
  fmtView.setUint16(2, heard.channels, true);
  fmtView.setUint32(4, heard.sampleRate, true);
  fmtView.setUint32(
    8, heard.sampleRate * heard.channels * (DEVICE_BITS_PER_SAMPLE / 8), true);
  fmtView.setUint16(12, heard.channels * (DEVICE_BITS_PER_SAMPLE / 8), true);
  fmtView.setUint16(14, DEVICE_BITS_PER_SAMPLE, true);
  return riff(chunk("fmt ", fmt), chunk("data", data));
}

/** Which WAVE format tag a recording declares, or null if it is not a WAVE at
 *  all. The one question a caller has to ask before it knows which form it is
 *  holding, and the browser's half of what seekToWavData() now reports. */
export function wavFormatTag(wav: Uint8Array): number | null {
  const heard = readRecording(wav);
  return heard ? heard.formatTag : null;
}

/** Whether a file is one of the recordings this applies to. The sibling of
 *  isTile() in tile_encode.ts, and the same shape of answer. */
export function isRecording(name: string): boolean {
  return name.startsWith("a") && name.endsWith(".wav");
}
