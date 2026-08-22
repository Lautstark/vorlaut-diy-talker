/* What static/tts/level.js does, checked against something that is not itself.
 *
 *     node tests/browser/level.test.mjs
 *
 * Run by tests/test_browser_level.py, so `python3 tests/run.py` includes it.
 *
 * There is already a test next to this one - tests/test_browser_tts.py - and
 * it reads the constants out of level.js and compares them with tts.py. That
 * is worth having and it is not this. Constants can all be right while the
 * arithmetic between them is wrong, and that test would pass; it never runs a
 * line of JavaScript.
 *
 * This one runs the module. The hard part is not running it, though - it is
 * finding anything to compare the answer with. Almost everything here could
 * be measured with integratedLufs(), and integratedLufs() is what decided the
 * gain in the first place, so a wrong implementation would satisfy every
 * check that used it. That is exactly how the sibling project's browser audio
 * tests turned out to be circular, discovered only once its Python half was
 * being deleted.
 *
 * So the numbers below came from outside. tools/ttsfreeze.py measured them
 * with the real ffmpeg, and where a whole recording is involved it put that
 * recording through tts.py - the chain this file is a port of - and measured
 * the result. tests/reference/tts.lock.json is what it wrote down, along with
 * what produced it and what would invalidate it.
 *
 * If a check here fails, the fault is in level.js. Do not regenerate the lock
 * file to make it pass: that turns the one external opinion in this repository
 * back into a mirror, which is the thing it was built to stop.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SAMPLE_RATE, TARGET_LUFS, TARGET_PEAK_DBTP, KEEP_HEAD, KEEP_TAIL,
  decodeWav, encodeWav, resample, trim, fadeEnds, pad,
  integratedLufs, truePeakDb, postprocess,
} from "../../static/tts/level.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE = join(HERE, "..", "reference");
const lock = JSON.parse(readFileSync(join(REFERENCE, "tts.lock.json"), "utf-8"));

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  if (!ok) failures.push(name);
};

/* The tone the lock file describes, built the way it says it was built.
 * One line, and the four numbers that make it are frozen data rather than
 * literals here - so the signal a number belongs to cannot drift away from it. */
const tone = ({ freq, amp, seconds, rate, phase = 0 }) => {
  const x = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i++) {
    x[i] = amp * Math.sin(2 * Math.PI * freq * i / rate + phase);
  }
  return x;
};

const sampledbfs = (x) => {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  return 20 * Math.log10(peak || 1e-12);
};

/* --- is the ruler itself right? ---------------------------------------- */

/* Five tones, each somewhere the K weighting is doing something else. A
 * measurement that got the gating right and the filter wrong passes at
 * 1000 Hz and fails at 60 and at 10000; one with no weighting at all passes
 * nowhere except 1000 Hz. Nothing here can be satisfied by measuring the
 * output with the thing that produced it, because ffmpeg produced these.
 *
 * The 0.15 LU tolerance is not the accuracy of the agreement - it was 0.04 LU
 * or better on every one of them when they were frozen. It is the room a
 * different ffmpeg build is allowed to have without this turning red. */
function theRulerAgreesWithFfmpeg() {
  for (const spec of lock.tones) {
    const got = integratedLufs(tone(spec));
    check(`${spec.name} measures ${spec.lufs} LUFS, as ffmpeg reads it`,
          Math.abs(got - spec.lufs) < 0.15,
          `got ${got.toFixed(2)}   (${spec.why})`);
  }
}

/* --- and the peak meter? ----------------------------------------------- */

/* truePeakDb() is the other half of the gain decision: it is what says how
 * much headroom is left, so a peak meter reading 3 dB low hands out 3 dB too
 * much gain and the device clips.
 *
 * These tones are sampled an eighth of a cycle off their own peaks, so every
 * sample sits at cos(45 degrees) of the real maximum. Three opinions are
 * frozen for each: what ffmpeg read, what the waveform's peak actually is -
 * it is a sine, so that is arithmetic and not a measurement - and what the
 * loudest sample was. The last of those is what a meter that never
 * interpolated would report, and it is 3 dB adrift.
 *
 * ffmpeg reads these about 0.55 dB high; its interpolator overshoots. That is
 * in the lock file under "disagreements" rather than hidden in a tolerance,
 * and it is why the tight check is against the arithmetic and the loose one
 * against ffmpeg. */
function thePeakMeterFindsWhatIsBetweenTheSamples() {
  for (const spec of lock.peaks) {
    const x = tone({ ...spec, phase: Math.PI / 4 });
    const got = truePeakDb(x, spec.rate);
    check(`${spec.name}: the real peak is ${spec.analytic_peak_dbtp} dBTP`,
          Math.abs(got - spec.analytic_peak_dbtp) < 0.15,
          `got ${got.toFixed(2)}`);
    check(`${spec.name}: and that is well above the loudest sample`,
          got > spec.sample_peak_dbfs + 2.5,
          `${got.toFixed(2)} against ${spec.sample_peak_dbfs} dBFS - a meter `
          + `over the samples alone would report the latter`);
    check(`${spec.name}: ffmpeg reads it within 0.7 dB of that`,
          Math.abs(got - spec.ffmpeg_peak_dbtp) < 0.7,
          `ffmpeg ${spec.ffmpeg_peak_dbtp}, here ${got.toFixed(2)}`);
  }
}

/* --- the way down to the device's rate --------------------------------- */

/* Piper speaks at 22050 and the device reads 16000, so every recording is
 * resampled, and there are only two ways for that to be wrong: it can change
 * the level of what fits, or it can keep what does not.
 *
 * ffmpeg's resampler is not this one and the two are not expected to agree in
 * the stopband. What is frozen is which side of a fifty decibel gap each tone
 * lands on, and that is not a close call. */
function nothingSurvivesTheResampleThatShouldNot() {
  for (const spec of lock.resampling) {
    const down = resample(tone({ ...spec, seconds: spec.seconds, rate: spec.from }),
                          spec.from, spec.to);
    const got = integratedLufs(resample(down, spec.to, lock.measure_rate));
    if (spec.expect === "kept") {
      check(`${spec.name}: still ${spec.lufs_after} LUFS afterwards`,
            Math.abs(got - spec.lufs_after) < 0.15,
            `got ${got.toFixed(2)}   (${spec.why})`);
    } else {
      // ffmpeg leaves it at -62.5 and this leaves nothing measurable at all.
      // Either answer is inaudible; what matters is that neither is -13.6,
      // which is where the tone would be if it had been folded back instead
      // of removed.
      check(`${spec.name}: it is gone, not folded back`,
            got < -45,
            `${Number.isFinite(got) ? got.toFixed(2) : got} - it went in at `
            + `${spec.lufs_before}, ffmpeg leaves ${spec.lufs_after}`);
    }
  }
}

/* --- the whole chain, against the chain it is a port of ---------------- */

/* The one that would have caught anything. Each fixture went through
 * tts.postprocess() - real piper-shaped WAV in, real ffmpeg, real filter
 * chain - and the finished file was measured. level.js gets the same bytes
 * and has to arrive at the same place.
 *
 * The output is measured with integratedLufs() and truePeakDb(), which would
 * be circular on its own. It is not circular here, because those two were
 * held against ffmpeg above before being used. The order matters: the ruler
 * is checked first, then things are measured with it.
 *
 * 0.2 LU. docs/browser-tts.md measured seventeen of twenty real sentences
 * agreeing within 0.13 LU, and these four were within 0.05 when frozen. The
 * three that disagree there all had a loudness range for ffmpeg's compressor
 * to work on; none of these do, and a fixture that grew one would be a
 * different test. */
function theWholeChainLandsWhereTtsPyLands() {
  for (const spec of lock.utterances) {
    const bytes = new Uint8Array(readFileSync(join(REFERENCE, spec.file)));

    // The measurement in the lock file is about these bytes and no others.
    const digest = createHash("sha256").update(bytes).digest("hex");
    check(`${spec.name}.wav is the file that was measured`,
          digest === spec.sha256,
          `sha256 ${digest.slice(0, 16)}..., expected ${spec.sha256.slice(0, 16)}...`
          + ` - regenerate with tools/ttsfreeze.py, do not edit`);
    if (digest !== spec.sha256) continue;

    const result = postprocess(bytes);
    const { samples, rate } = decodeWav(result.wav);

    if (!spec.compare) {
      // No outside number for this one; the lock file says why. What is left
      // to insist on is that it did not clip and did not crash.
      check(`${spec.name}: gives back a finished file anyway`,
            rate === SAMPLE_RATE && samples.length > 0 && result.clamped === true,
            `${samples.length} samples at ${rate} Hz, clamped ${result.clamped}`);
      check(`${spec.name}: the gain gave way rather than the signal`,
            sampledbfs(samples) <= TARGET_PEAK_DBTP + 0.01,
            `${sampledbfs(samples).toFixed(2)} dBFS`);
      continue;
    }

    const lufs = integratedLufs(resample(samples, rate, lock.measure_rate));
    check(`${spec.name}: ffmpeg put tts.py at ${spec.tts_py.lufs} LUFS, and this lands there`,
          Math.abs(lufs - spec.tts_py.lufs) < 0.2,
          `got ${lufs.toFixed(2)}   (${spec.why})`);
    check(`${spec.name}: and under the ${TARGET_PEAK_DBTP} dBTP ceiling, as that did`,
          truePeakDb(samples, rate) <= TARGET_PEAK_DBTP + 0.05,
          `${truePeakDb(samples, rate).toFixed(2)} dBTP, tts.py ${spec.tts_py.peak}`);
    check(`${spec.name}: written at ${SAMPLE_RATE} Hz for the device`,
          rate === SAMPLE_RATE, `${rate} Hz`);
  }
}

/* --- the parts, where being wrong would not show in the level ---------- */

/* Trim, fade and pad move samples about without changing the loudness much,
 * so the checks above would not notice them going wrong. These are on the
 * promise rather than on any frozen number: they say what a finished
 * recording has to be true of, and they would still be the right checks if
 * the inside were rewritten. */
function theShapingDoesWhatItSays() {
  const rate = SAMPLE_RATE;
  const lead = 0.5, body = 0.6;
  const x = new Float32Array(Math.round((lead + body + lead) * rate));
  const from = Math.round(lead * rate), to = Math.round((lead + body) * rate);
  // A cosine, so the very first sample of the body is already at full
  // amplitude and there is no argument about where the word begins. With a
  // sine it starts at zero, the threshold is crossed a sample or two later,
  // and the amounts below would have to be approximate.
  for (let i = from; i < to; i++) {
    x[i] = 0.3 * Math.cos(2 * Math.PI * 300 * (i - from) / rate);
  }

  const cut = trim(x, rate);
  // Some silence is kept on purpose - a word starting on sample zero sounds
  // cut off - and how much is KEEP_HEAD at the front and KEEP_TAIL at the
  // back. Those two are different numbers (a word needs longer to ring out
  // than to start), and checking only their sum would pass with them swapped.
  //
  // Reading them from the module rather than writing 0.06 and 0.10 here is
  // deliberate and is not circular: what they are worth is
  // tests/test_browser_tts.py's job, which pins both against tts.py. What
  // this asks is whether trim() then applies them where it says it does.
  const head = Math.round(KEEP_HEAD * rate), tail = Math.round(KEEP_TAIL * rate);
  check("trim keeps KEEP_HEAD before the word and KEEP_TAIL after it",
        cut.length === (to - from) + head + tail,
        `${x.length} samples to ${cut.length}, expected `
        + `${(to - from) + head + tail} = ${to - from} + ${head} + ${tail}`);
  check("and the word itself starts exactly where KEEP_HEAD ends",
        cut[head] === x[from] && cut[head - 1] === 0,
        `head ${head} samples`);

  const faded = fadeEnds(cut, rate);
  check("the fade starts at silence and does not touch the middle",
        Math.abs(faded[0]) < 1e-9
        && Math.abs(faded[faded.length - 1]) < 1e-9
        && faded[Math.floor(faded.length / 2)] === cut[Math.floor(cut.length / 2)]);

  const padded = pad(faded, rate);
  check("pad adds quiet at the end and nothing else",
        padded.length > faded.length
        && padded[padded.length - 1] === 0
        && padded.subarray(0, faded.length).every((v, i) => v === faded[i]),
        `${faded.length} to ${padded.length} samples`);
}

function theWavItWritesCanBeReadBack() {
  // Round trip, and the ends of the range in particular: +1 must not wrap to
  // the loudest possible negative sample, which is a click at full scale.
  const x = Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2, 1e-9]);
  const { samples, rate } = decodeWav(encodeWav(x, SAMPLE_RATE));
  check("a WAV this wrote reads back at the rate it says", rate === SAMPLE_RATE);
  check("full scale saturates rather than wrapping",
        samples[1] > 0.99 && samples[2] < -0.99 && samples[5] > 0.99
        && samples[6] < -0.99,
        [...samples].map((v) => v.toFixed(3)).join(" "));
  check("and the quiet ones come back roughly as they went in",
        Math.abs(samples[3] - 0.5) < 1e-4 && Math.abs(samples[4] + 0.5) < 1e-4);
}

function itRefusesWhatWouldComeOutEmpty() {
  // A rate that is not a rate takes every multiplication downstream to NaN
  // and hands back a 44 byte WAV: a valid header with no audio under it. The
  // module says it throws instead; this is that promise, checked.
  const bytes = readFileSync(join(REFERENCE, lock.utterances[0].file));
  for (const rate of ["-5%", 0, -16000, NaN, undefined]) {
    let threw = false;
    try {
      postprocess(new Uint8Array(bytes), { rate });
    } catch {
      threw = true;
    }
    // undefined is the default, which is a real rate - it must not throw.
    const wanted = rate !== undefined;
    // String(), not JSON.stringify(): the latter turns NaN into null, and a
    // line saying null was refused when NaN was is a small lie in a file
    // whose whole subject is checks that only appear to say something.
    check(`a rate of ${typeof rate === "string" ? `"${rate}"` : String(rate)} `
          + `is ${wanted ? "refused" : "the default"}`, threw === wanted);
  }
}

/* --- the lock file itself ---------------------------------------------- */

function theReferenceIsStillAboutThisChain() {
  // The frozen numbers under tts_py are what one particular filter chain
  // produced. If that chain changes, they describe something that no longer
  // exists - and this is the one thing in here that a wrong answer means
  // "refreeze" rather than "fix level.js".
  check("the lock file says what made it and when",
        Boolean(lock.produced_by && lock.produced_on && lock.ffmpeg),
        `${lock.produced_by} on ${lock.produced_on}`);
  check("and it was frozen against the constants level.js still carries",
        lock.tts_py.sample_rate === SAMPLE_RATE
        && lock.tts_py.loudnorm.includes(`I=${TARGET_LUFS}`)
        && lock.tts_py.loudnorm.includes(`TP=${TARGET_PEAK_DBTP}`),
        `lock ${lock.tts_py.loudnorm} at ${lock.tts_py.sample_rate} Hz`);
}

theRulerAgreesWithFfmpeg();
thePeakMeterFindsWhatIsBetweenTheSamples();
nothingSurvivesTheResampleThatShouldNot();
theWholeChainLandsWhereTtsPyLands();
theShapingDoesWhatItSays();
theWavItWritesCanBeReadBack();
itRefusesWhatWouldComeOutEmpty();
theReferenceIsStillAboutThisChain();

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\n  All good.");
