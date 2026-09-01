import { check } from "./harness.js";
import {
  ADPCM_BLOCK_BYTES, ADPCM_BLOCK_SAMPLES, decodeAdpcmWav, encodeAdpcmWav,
  isRecording, recordingsForDevice, WAV_FORMAT_IMA_ADPCM, WAV_FORMAT_PCM,
  wavFormatTag,
} from "../../loader/src/audio_encode.js";
import { CABLE_AUDIO_FORM } from "../../loader/tools/cable.js";

/* What the browser will and will not compress, and what it hands back when it
 * will not.
 *
 * The codec itself is tests/test_adpcm.py, which puts the firmware's own
 * decoder on the other end of these bytes and holds the round trip against the
 * four real recordings in example/speech/. What is left here is the half a
 * compiler is not needed for, and it is the half with the quiet failures: a
 * file that comes back changed when it should not have been touched is a word
 * at the wrong pitch, or a recording that a talker in the field plays as
 * noise.
 */

/** A WAV of `samples` samples, in the form the build writes. `shape` puts
 *  something between fmt and data, or changes what fmt says. */
function wav(samples: Int16Array, {
  rate = 16000, channels = 1, bits = 16, tag = WAV_FORMAT_PCM, list = false,
} = {}): Uint8Array<ArrayBuffer> {
  const body: number[] = [];
  const push = (...bytes: number[]) => body.push(...bytes);
  const u16 = (v: number) => push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff,
                                  (v >>> 24) & 0xff);
  const id = (s: string) => push(...[...s].map((c) => c.charCodeAt(0)));

  id("fmt "); u32(16);
  u16(tag); u16(channels); u32(rate);
  u32(rate * channels * (bits / 8)); u16(channels * (bits / 8)); u16(bits);
  if (list) {
    // Thirteen bytes and a pad byte the size does not count - the same shape
    // device/fixtures/audio/extra-chunk states, and what the four recordings
    // in example/speech/ really carry.
    id("LIST"); u32(13); id("INFOISFTvorla"); push(0);
  }
  id("data"); u32(samples.length * 2);
  for (const one of samples) push(one & 0xff, (one >> 8) & 0xff);

  const out = new Uint8Array(12 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set(body, 12);
  return out;
}

/** A deterministic word: a tone with an envelope, which is roughly what a
 *  synthesised syllable looks like to a quantiser and is the same every run. */
function spoken(count: number): Int16Array {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const envelope = Math.sin(Math.PI * i / count);
    out[i] = Math.round(9000 * envelope * Math.sin(2 * Math.PI * 220 * i / 16000));
  }
  return out;
}

/** The samples of a PCM WAV, by walking it. A third reader, on purpose: using
 *  the module's own would be quoting the answer back at itself. */
function samplesOf(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = String.fromCharCode(
      bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    const size = view.getUint32(at + 4, true);
    if (name === "data") {
      const have = Math.min(size, bytes.length - at - 8);
      const out = new Int16Array(have >> 1);
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(at + 8 + 2 * i, true);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return new Int16Array(0);
}

// --- the form a recording travels in -----------------------------------------

{
  const was = wav(spoken(8000));
  const now = encodeAdpcmWav(was);
  check("a recording the device plays comes back as WAVE format tag 0x11",
        wavFormatTag(now) === WAV_FORMAT_IMA_ADPCM,
        `0x${(wavFormatTag(now) ?? 0).toString(16).padStart(4, "0")}`);
  check("and it is about a quarter of the size",
        was.length / now.length > 3.5, `factor ${(was.length / now.length).toFixed(2)}`);
  check("and it is still a RIFF/WAVE, because the container did not change",
        String.fromCharCode(...now.subarray(0, 4)) === "RIFF"
        && String.fromCharCode(...now.subarray(8, 12)) === "WAVE");

  const back = decodeAdpcmWav(now);
  check("the browser reads its own form back as PCM", back !== null
        && wavFormatTag(back) === WAV_FORMAT_PCM);
  const heard = samplesOf(back!);
  const original = samplesOf(was);
  check("the word that comes back is at least as long as the one that went in",
        heard.length >= original.length, `${heard.length} for ${original.length}`);

  /* Every block states its own first sample in its header, so those come back
   * untouched however the quantiser did in between. It is the one part of this
   * round trip that is lossless, and it is what says the blocks were found
   * where the decoder went looking for them - an off-by-one in the block walk
   * still decodes to something, and it decodes to something wrong here. */
  let exact = true;
  for (let at = 0; at < original.length; at += ADPCM_BLOCK_SAMPLES) {
    if (heard[at] !== original[at]) exact = false;
  }
  check("and every block's first sample is exactly the one that went in", exact);
}

{
  const now = encodeAdpcmWav(wav(spoken(8000)));
  // What the device reads a block at a time. A data chunk that is not whole
  // blocks would leave the last one short, which is readable but is not what
  // this writes - and a reader elsewhere is entitled to expect blocks.
  const data = now.length - 12 - (8 + 20) - (8 + 4) - 8;
  check("the samples are written as whole blocks",
        data > 0 && data % ADPCM_BLOCK_BYTES === 0, `${data} bytes`);
}

// --- what is handed back untouched -------------------------------------------

/* The raw form keeps the right of way, exactly as it does for a tile. Each of
 * these is a file this module must not have an opinion about, and the way it
 * says so is by returning the same bytes - not by throwing, and not by
 * writing something the device would then play. */
for (const [what, file] of [
  ["a 44.1 kHz stereo recording", wav(spoken(4000), { rate: 44100, channels: 2 })],
  ["a recording that is already compressed", encodeAdpcmWav(wav(spoken(8000)))],
  ["something that is not a RIFF at all", new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3])],
  ["a file with no data chunk", wav(new Int16Array(0)).subarray(0, 36)],
] as [string, Uint8Array<ArrayBuffer>][]) {
  const now = encodeAdpcmWav(file);
  check(`${what} is handed back untouched`,
        now.length === file.length
        && now.every((byte, at) => byte === file[at]),
        `${file.length} bytes in, ${now.length} out`);
}

{
  // The "not smaller is not worth having" rule, which is tile_encode.ts's own
  // and is here for the same reason: a recording that does not pay for itself
  // must not cost more than it did. Twenty samples against twenty-eight bytes
  // of extra header is the losing side of that.
  const tiny = wav(spoken(20));
  const now = encodeAdpcmWav(tiny);
  check("a recording too short to pay for the header stays as it was",
        now.length === tiny.length, `${tiny.length} bytes in, ${now.length} out`);
}

{
  // The four real recordings in example/speech/ carry a LIST chunk between fmt
  // and data, so this is not a hypothetical: a reader that seeks by the
  // declared size and forgets the pad byte after an odd one lands on the pad,
  // reads four bytes of nothing as a chunk id and finds no data at all.
  const now = encodeAdpcmWav(wav(spoken(4000), { list: true }));
  check("a LIST chunk between fmt and data is walked past",
        wavFormatTag(now) === WAV_FORMAT_IMA_ADPCM);
}

{
  check("the browser refuses to read a PCM recording as the compressed form",
        decodeAdpcmWav(wav(spoken(1000))) === null);
  check("and says so for a file that is not a WAV at all",
        wavFormatTag(new Uint8Array([1, 2, 3])) === null);
}

// --- which files this applies to ---------------------------------------------

for (const [name, want] of [
  ["a0123456789abcdef0123456789abcdef.wav", true],
  ["t0123456789abcdef0123456789abcdef.bin", false],
  ["layout.bin", false],
] as [string, boolean][]) {
  check(`${name} is ${want ? "" : "not "}a recording`, isRecording(name) === want);
}

// --- who gets which form -----------------------------------------------------

/* The decision, and it is the half with the expensive failure. Sending a
 * compressed recording to a talker that cannot play one does not draw
 * something odd on a screen: it puts a full-volume hiss out of the speaker, at
 * the moment a child pressed a key expecting a word. That device is in
 * somebody's house and there is no update channel.
 *
 * So the rule is a whitelist and not a comparison. Two answers both have to be
 * yes - the device named this exact word, and a person said this collection is
 * one where four bits a sample is bearable - and everything else is the plain
 * form.
 */
{
  const RECORDING = "afedcba9876543210fedcba9876543210.wav";
  const TILE = "t0123456789abcdef0123456789abcdef.bin";
  const COLLECTION = "c00112233445566778899aabbccddeeff.bin";
  const spokenWav = wav(spoken(8000));

  const build = new Map<string, Uint8Array<ArrayBuffer>>([
    [RECORDING, spokenWav],
    [TILE, new Uint8Array([1, 2, 3, 4])],
    [COLLECTION, new Uint8Array([9, 9, 9])],
  ]);

  {
    const sent = recordingsForDevice(build, CABLE_AUDIO_FORM, true);
    const heard = sent.get(RECORDING)!;
    check("a talker that named the form, for a collection somebody chose, "
          + "gets the recording compressed",
          heard.length < spokenWav.length
          && wavFormatTag(heard) === WAV_FORMAT_IMA_ADPCM,
          `${heard.length} of ${spokenWav.length} bytes`);
    for (const [what, name] of [["tile", TILE], ["collection", COLLECTION]] as const) {
      const bytes = sent.get(name)!;
      check(`and the ${what} goes across untouched`,
            bytes === build.get(name), `${bytes.length} bytes`);
    }
  }

  /* Every way of not being both answers. Written out one by one rather than as
   * a table, because each of them is a different device or a different person
   * and the point is that all of them get the same bytes. */
  for (const [what, form, wanted] of [
    ["a talker that named no recording form", "", true],
    ["a talker flashed before the hello had the line", "", false],
    ["a talker naming a form this browser has never heard of", "va9", true],
    ["a talker naming something newer-looking", "va2", true],
    ["a form word with the right letters in the wrong case", "VA1", true],
    ["a collection nobody said that about, on a talker that could", "va1", false],
  ] as [string, string, boolean][]) {
    const sent = recordingsForDevice(build, form, wanted);
    check(`${what} gets the recording as it always was`,
          sent.get(RECORDING) === spokenWav);
  }

  {
    // The map itself, not only its contents. Where nothing is compressed the
    // build is handed straight back, which is what keeps the common case free
    // and is the same thing forDevice() does for tiles.
    check("a build nothing applies to is not copied at all",
          recordingsForDevice(build, "", false) === build);
  }
}
