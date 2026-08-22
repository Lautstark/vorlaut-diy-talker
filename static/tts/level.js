// Everything that happens to a recording after something has spoken it: trim
// the silence off both ends, fade, level it, write a 16 kHz mono 16 bit WAV.
// In the container that is one call to ffmpeg - tts.py, _filter_chain() and
// postprocess(). In a tab there is no ffmpeg, and the obvious replacement,
// ffmpeg.wasm, cannot be used: its newest core is built from ffmpeg 5.1.4,
// whose loudnorm gets the gain wrong by about 13 dB on half of all short
// sentences, silently. The measurement is in docs/browser-tts.md.
//
// So this is the second implementation of that chain, and the reason it is
// allowed to exist is that it is checked against the first one:
// tools/ttscheck.py runs a batch through both and measures each result with
// the real ffmpeg.
//
// Deliberately free of the browser - no AudioContext, no DOM, no fetch. Web
// Audio would do the resampling in one line, and then this file could only
// run where there is a window, which is exactly where comparing it against
// ffmpeg is hardest. Plain arrays instead, so node can run the same code.

// --- The chain, as constants -------------------------------------------------
// Each of these has a twin in tts.py. Nothing here can read that file, so
// tests/test_browser_tts.py is the link: it parses both and compares.
// Drift would be silent - the same sentence levelled two ways depending on
// which half of the project spoke it.

export const SAMPLE_RATE = 16000;         // tts.SAMPLE_RATE
export const SILENCE_THRESHOLD_DB = -45;  // tts.SILENCE_THRESHOLD
export const KEEP_HEAD = 0.06;            // tts.KEEP_HEAD
export const KEEP_TAIL = 0.10;            // tts.KEEP_TAIL
export const FADE = 0.012;                // tts.FADE
export const TAIL_PAD = 0.06;             // tts.TAIL_PAD

// tts.LOUDNORM is "I=-16:TP=-1.5:LRA=11", split into its parts here because
// this file has to act on them rather than pass them on.
export const TARGET_LUFS = -16;
export const TARGET_PEAK_DBTP = -1.5;
// LRA=11 has no twin below, and that is not an oversight. It is a target
// loudness *range*, and reaching it means compressing - which this path never
// does. It applies one gain to the whole sentence and leaves the dynamics
// alone.
//
// Whether that matters is a measurement, not an opinion. Over twenty
// sentences, seventeen had no loudness range for a compressor to work on, and
// on those ffmpeg does not compress either and the two land within 0.13 LU.
// On the three that did, ffmpeg gets 0.4 to 2.3 LU more level out of them than
// this does. Where that leaves things is written up in docs/browser-tts.md.

// --- WAV in ------------------------------------------------------------------

const MAGIC = (view, at) => String.fromCharCode(
  view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** The samples and the rate out of a RIFF/WAVE file, as one mono track.
 *
 * Written out rather than handed to decodeAudioData for the reason at the top
 * of this file, and because the two synthesisers here deliver exactly two
 * shapes: piper writes 16 bit PCM, Azure is asked for riff-16khz-16bit-mono-pcm.
 * Float and 24 bit are here anyway - they cost four lines and turn "silence"
 * into an error message if a third source ever appears.
 */
export function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (MAGIC(view, 0) !== "RIFF" || MAGIC(view, 8) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let format = 0, channels = 0, rate = 0, bits = 0, data = null;
  // Chunk by chunk rather than assuming fmt at 12 and data at 36: piper's
  // header is that plain, Azure's has a LIST chunk in between.
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const id = MAGIC(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      data = { at: body, size: Math.min(size, bytes.byteLength - body) };
    }
    at = body + size + (size % 2);   // chunks are padded to even length
  }
  if (!rate || !data) throw new Error("WAVE file without fmt or data");

  const float = format === 3;
  const width = bits / 8;
  const frames = Math.floor(data.size / (width * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = data.at + (i * channels + c) * width;
      if (float) sum += bits === 64 ? view.getFloat64(at, true) : view.getFloat32(at, true);
      else if (bits === 16) sum += view.getInt16(at, true) / 32768;
      else if (bits === 24) sum += ((view.getUint8(at) | (view.getUint8(at + 1) << 8)
        | (view.getInt8(at + 2) << 16))) / 8388608;
      else if (bits === 32) sum += view.getInt32(at, true) / 2147483648;
      else if (bits === 8) sum += (view.getUint8(at) - 128) / 128;
      else throw new Error(`WAVE with ${bits} bit samples`);
    }
    out[i] = sum / channels;          // -ac 1: mixed down, not first channel
  }
  return { samples: out, rate };
}

// --- WAV out -----------------------------------------------------------------

/** 16 bit PCM, one channel, the given rate. What the device reads. */
export function encodeWav(samples, rate = SAMPLE_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);         // fmt chunk length
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);   // bytes per second
  view.setUint16(32, 2, true);          // bytes per frame
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric on purpose: -1 has an integer, +1 does not, and rounding
    // +1 to 32768 wraps to the loudest possible negative sample - a click.
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return bytes;
}

// --- Resampling --------------------------------------------------------------

const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Windowed-sinc resampling, any ratio.
 *
 * Needed twice and for different reasons: piper's models speak at 22.05 kHz
 * and the device wants 16 kHz, and the loudness measurement below is only
 * defined at 48 kHz. Linear interpolation would do neither - going down to
 * 16 kHz without a low pass folds everything above 8 kHz back into the speech
 * as noise, and it is the loud consonants that get folded.
 *
 * ZEROS is how many zero crossings of the sinc are kept either side. 24 is
 * generous for a second and a half of speech; the whole thing costs a few
 * million multiplications and is nowhere near the 4-7 s the synthesiser takes.
 */
const ZEROS = 24;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Every kernel this ever needs, worked out once per pair of rates.
//
// The taps depend only on where an output sample falls between two input
// samples, and with whole-number rates there are only ever so many of those
// places: 22050 to 16000 is 441 input samples to 320 output ones, and then it
// repeats. So there are 320 kernels, not one per output sample - and the
// sines and cosines, which are what actually costs, are computed 320 times
// instead of twenty thousand.
//
// Measured on a two-second sentence: 866 ms of levelling became 78 ms, and
// the browser, which was slower still, came down from five seconds. That
// matters because tablets are where this is meant to run and they are not
// M-series Macs.
const kernelCache = new Map();

// Above this, the repeat is so long that precomputing it is the wasteful way
// round - which happens only if somebody feeds this two rates with no common
// factor worth the name. Then it does the arithmetic per sample, as it used to.
const MAX_PHASES = 4096;

function kernels(inRate, outRate) {
  const key = `${inRate}>${outRate}`;
  const known = kernelCache.get(key);
  if (known !== undefined) return known;

  const common = gcd(inRate, outRate);
  const phaseCount = outRate / common;      // output samples per repeat
  const stride = inRate / common;           // input samples per repeat
  if (phaseCount > MAX_PHASES) {
    kernelCache.set(key, null);
    return null;
  }
  const fc = 0.5 * Math.min(1, outRate / inRate);
  const halfWidth = ZEROS / (2 * fc);
  const phases = [];
  for (let r = 0; r < phaseCount; r++) {
    const exact = r * stride / phaseCount;
    const whole = Math.floor(exact);
    const offset = exact - whole;           // where between two input samples
    const first = Math.ceil(offset - halfWidth);
    const last = Math.floor(offset + halfWidth);
    const taps = new Float64Array(last - first + 1);
    let norm = 0;
    for (let k = first; k <= last; k++) {
      const t = k - offset;
      const angle = Math.PI * t / halfWidth;
      const h = 2 * fc * sinc(2 * fc * t)
        * (0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle));
      taps[k - first] = h;
      norm += h;
    }
    phases.push({ start: whole + first, taps, norm });
  }
  const built = { phaseCount, stride, phases };
  kernelCache.set(key, built);
  return built;
}

export function resample(x, inRate, outRate) {
  if (inRate === outRate || x.length === 0) return x;
  const outLen = Math.max(1, Math.round(x.length * outRate / inRate));
  const y = new Float32Array(outLen);
  const built = kernels(inRate, outRate);
  if (built === null) return resampleSlowly(x, inRate, outRate, y);

  const { phaseCount, stride, phases } = built;
  for (let i = 0, r = 0, block = 0; i < outLen; i++) {
    const phase = phases[r];
    const taps = phase.taps;
    const from = block * stride + phase.start;
    let sum = 0;
    for (let n = 0; n < taps.length; n++) {
      const j = from + n;
      // Outside the signal counts as silence, and still counts towards norm:
      // dividing by the taps that happened to land inside would amplify the
      // first and last few samples instead of letting them fade.
      if (j >= 0 && j < x.length) sum += x[j] * taps[n];
    }
    y[i] = phase.norm ? sum / phase.norm : 0;
    if (++r === phaseCount) { r = 0; block++; }
  }
  return y;
}

function resampleSlowly(x, inRate, outRate, y) {
  const ratio = outRate / inRate;
  const fc = 0.5 * Math.min(1, ratio);
  const halfWidth = ZEROS / (2 * fc);
  for (let i = 0; i < y.length; i++) {
    const centre = i / ratio;
    let sum = 0, norm = 0;
    for (let j = Math.ceil(centre - halfWidth); j <= Math.floor(centre + halfWidth); j++) {
      const t = j - centre;
      const angle = Math.PI * t / halfWidth;
      const h = 2 * fc * sinc(2 * fc * t)
        * (0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle));
      norm += h;
      if (j >= 0 && j < x.length) sum += x[j] * h;
    }
    y[i] = norm ? sum / norm : 0;
  }
  return y;
}

// --- Trim, fade, pad ---------------------------------------------------------

/** The two silenceremove filters, both ends at once.
 *
 * ffmpeg is told start_periods=1:start_duration=0:detection=peak, which means
 * "cut until the first sample louder than the threshold", and start_silence
 * says how much of the quiet to hand back. Once forwards and once through
 * areverse, so the tail gets the same treatment with its own allowance - a
 * word needs longer to ring out than it needs to start.
 */
export function trim(x, rate) {
  const threshold = Math.pow(10, SILENCE_THRESHOLD_DB / 20);
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) <= threshold) a++;
  while (b > a && Math.abs(x[b]) <= threshold) b--;
  // Nothing above the threshold anywhere. ffmpeg would hand back an empty
  // stream; a zero-length WAV is a worse answer than the silence itself,
  // which at least plays and shows up as a mistake in the recording.
  if (a >= b) return x;
  const from = Math.max(0, a - Math.round(KEEP_HEAD * rate));
  const to = Math.min(x.length, b + Math.round(KEEP_TAIL * rate) + 1);
  return x.subarray(from, to);
}

/** afade=t=in at both ends - the second one after areverse, so it is a fade
 * out. Twelve milliseconds against the click of a waveform starting away from
 * zero. Linear, which is what afade does when nobody names a curve. */
export function fadeEnds(x, rate) {
  const n = Math.min(Math.round(FADE * rate), Math.floor(x.length / 2));
  const y = Float32Array.from(x);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    y[i] *= g;
    y[y.length - 1 - i] *= g;
  }
  return y;
}

/** apad - a little quiet at the end, before the amplifier switches off. */
export function pad(x, rate) {
  const y = new Float32Array(x.length + Math.round(TAIL_PAD * rate));
  y.set(x, 0);
  return y;
}

// --- Loudness ----------------------------------------------------------------

function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Integrated loudness to ITU-R BS.1770-4, in LUFS.
 *
 * The two filters are the K weighting: a shelf for the head, then a high pass.
 * Their coefficients are the published 48 kHz ones, so the caller has to hand
 * this a 48 kHz signal - hence the resampling above.
 *
 * Then 400 ms blocks overlapping by three quarters, and the two gates that
 * make this "integrated" rather than an average: everything below -70 LUFS is
 * not programme material, and everything more than 10 LU below what is left
 * is a pause. Without them the silence we deliberately kept would drag the
 * answer down and every sentence would come out too loud.
 */
export function integratedLufs(x) {
  let k = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285,
    -1.69065929318241, 0.73248077421585);
  k = biquad(k, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);
  const block = Math.round(0.4 * 48000), step = Math.round(0.1 * 48000);
  const power = [];
  for (let s = 0; s + block <= k.length; s += step) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += k[i] * k[i];
    power.push(sum / block);
  }
  // Shorter than one block - a "Ja!" trimmed hard can be. Measure what there
  // is rather than refusing: BS.1770 has nothing to say about it, and an
  // unlevelled word among levelled ones is the failure this exists to stop.
  if (!power.length && k.length) {
    let sum = 0;
    for (let i = 0; i < k.length; i++) sum += k[i] * k[i];
    power.push(sum / k.length);
  }
  if (!power.length) return -Infinity;
  const loudness = (v) => -0.691 + 10 * Math.log10(v || 1e-12);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  let gated = power.filter((v) => loudness(v) > -70);
  if (!gated.length) return -Infinity;
  const relative = loudness(mean(gated)) - 10;
  gated = gated.filter((v) => loudness(v) > relative);
  if (!gated.length) return -Infinity;
  return loudness(mean(gated));
}

/** True peak in dBTP: the loudest point of the waveform between the samples,
 * not the loudest sample. Four times oversampled, which is what BS.1770-4
 * asks for at these rates. It matters at 16 kHz more than it would at 44.1: a
 * peak sitting between two samples can be most of a dB above both of them,
 * and TP=-1.5 exists to leave room for exactly that. */
export function truePeakDb(x, rate) {
  const dense = resample(x, rate, rate * 4);
  let peak = 0;
  for (let i = 0; i < dense.length; i++) peak = Math.max(peak, Math.abs(dense[i]));
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  return 20 * Math.log10(peak || 1e-12);
}

// --- The whole chain ---------------------------------------------------------

/** A synthesiser's WAV in, the device's WAV out.
 *
 * Same order as tts._filter_chain(): trim, fade, pad, level - and levelling
 * last, so it measures what the trim actually left rather than the silence
 * that went in.
 *
 * Returns the numbers as well as the bytes. tools/ttscheck.py prints them
 * next to what ffmpeg says about the same file, and a levelling nobody can
 * check is how the 13 dB in ffmpeg.wasm stayed invisible for three years.
 */
export function postprocess(wavBytes, { rate = SAMPLE_RATE } = {}) {
  const { samples, rate: inRate } = decodeWav(wavBytes);
  const shaped = pad(fadeEnds(trim(samples, inRate), inRate), inRate);

  // Measured at the rate it was spoken at, not at 16 kHz: the K weighting
  // reaches above 8 kHz, and measuring after the downsample would quietly
  // leave that energy out of the answer.
  const lufs = integratedLufs(resample(shaped, inRate, 48000));

  const out = resample(shaped, inRate, rate);

  // One gain for the whole sentence, pulled back if it would breach the
  // ceiling. That is a clamp and not a limiter, and it is deliberate: it is
  // what ffmpeg does here too. loudnorm normalises linearly while it can and
  // only compresses when the linear gain would breach TP - and on this
  // project's sentences it almost never gets that far, because a synthesised
  // voice reading one sentence has next to no loudness range. Measured over
  // twenty sentences, ffmpeg compressed on the three whose LRA was not zero
  // and clamped on the other seventeen.
  //
  // A limiter was written and measured before this comment was. It lands
  // closer to -16 than ffmpeg does - and that is the argument against it. The
  // two halves of this project speak the same sentences into the same cache;
  // a browser that levels better than the container is a device on which the
  // sentence recorded yesterday is quieter than the one recorded today. The
  // container is the oracle, not the target.
  let gainDb = TARGET_LUFS - lufs;
  const peakDb = truePeakDb(out, rate);
  const headroom = TARGET_PEAK_DBTP - peakDb;
  const clamped = gainDb > headroom;
  if (clamped) gainDb = headroom;

  const gain = Math.pow(10, gainDb / 20);
  const levelled = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) levelled[i] = out[i] * gain;

  return {
    wav: encodeWav(levelled, rate),
    rate,
    seconds: levelled.length / rate,
    lufs,
    gainDb,
    clamped,
    peakDb: peakDb + gainDb,
    trimmedSeconds: (samples.length - (shaped.length - Math.round(TAIL_PAD * inRate))) / inRate,
  };
}
