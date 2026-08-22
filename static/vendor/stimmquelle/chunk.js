// voices.json
var voices_default = {
  _: [
    "Which piper voices may be shipped, and which of them actually speak.",
    "",
    "One list, one place. mitreden's Dockerfile and vorlaut's tts.py each carried their",
    "own copy of the same four voices - same mirror, same paths, same order - and each",
    "carried its own copy of the rule about model licences. Three copies of that rule",
    "existed before this file did, all correct, none able to learn anything from the",
    "other two. That is how a voice under a non-commercial licence ended up in",
    "mitreden's browser build: it ran perfectly, and running was the only question",
    "anything asked of it.",
    "",
    "So every voice anyone has considered is in here, including the ones that were",
    "turned down, with the reason. A list that only holds what passed cannot stop a",
    "voice being reconsidered on the strength of the same evidence that let it in the",
    "first time.",
    "",
    "THREE INDEPENDENT QUESTIONS. A voice must pass all three, and passing one says",
    "nothing about the others.",
    "",
    "  licence   May it be handed on? Read the MODEL_CARD next to the model, never the",
    "            file name. CC0 and public domain qualify unconditionally. CC-BY",
    "            qualifies if the attribution is actually rendered. CC BY-NC-SA does",
    "            not qualify at all - a recording made for somebody else's child",
    "            cannot carry a non-commercial condition. 'See URL' means the card",
    "            points at a dataset instead of naming a licence, which is not a yes.",
    "",
    "  quality   Only medium and high survive @diffusionstudio/vits-web. Every low and",
    "            x_low voice dies with 'idx=... must be within the inclusive range",
    "            [-130,129]', because vits-web phonemizes against one fixed symbol",
    "            table instead of the phoneme_id_map inside each model's own",
    "            .onnx.json. This is a browser limit only - the container speaks them",
    "            all perfectly.",
    "",
    "  reach     vits-web can only fetch what is in its hardcoded PATH_MAP. Its",
    "            voices() call returns the mirror's index instead - 124 entries",
    "            against 119 in the map - so five voices are advertised by the library",
    "            and cannot be downloaded by it.",
    "",
    "'browser' says ok, or which question the voice failed",
    "runtime. 'licence.ship' is separate from both: a voice can run everywhere and",
    "still not be shippable. Consumers filter on licence.ship AND the runtime they",
    "are.",
    "",
    "'proof' says how the runtime answer was established, because a list that says",
    "tested and means assumed is worth less than no list:",
    "",
    "  spike      run in a browser in mitreden's docs/spike",
    "  vorlaut    run in a browser from vorlaut's tools/ttscheck.html",
    "  rule       medium or high and present in PATH_MAP, but never actually spoken",
    "",
    "Every licence and every byte count below was read from the MODEL_CARD and the",
    "mirror on the date in 'checked', not copied from anywhere. Both mirrors were",
    "compared and carry identical bytes for every entry.",
    "",
    "Roughly a third of the English medium and high voices piper publishes cannot be handed on, and none of them says so anywhere a file name would show it. hfc_female, hfc_male and ryan in both qualities are all CC BY-NC-SA. That is the reason the rejected entries are in this file rather than left out of it.",
    "",
    "browser_with_own_ids: what is expected once a consumer drives the inference itself via usePiperRuntime, rather than calling vits-web's predict(). Not a second answer to the same question - it is a different question, because that path takes ids from this model's own table. Nothing here flips to ok on it until it has been heard.",
    "",
    "browser_with_own_ids 'ok by measurement' means the ids reaching the model are the model's own and the audio is speech - checked against native piper's own dump. It does not mean anybody has listened. `browser` flips when a person says it sounds right, not when the arithmetic does.",
    "",
    'recommended: one voice per language-and-gender slot, so a picker can show four and keep the rest behind "more voices". It is an editorial choice and not a runtime or licence answer - `recommended_why` says why that one, so the next person argues with the reason rather than guessing at it. Two of the four need usePiperRuntime: vits-web cannot speak Kerstin and cannot fetch John.'
  ],
  revised: "2026-08-22",
  checked: "2026-08-22",
  library: {
    name: "@diffusionstudio/vits-web",
    version: "1.0.3"
  },
  mirrors: {
    browser: "https://huggingface.co/diffusionstudio/piper-voices/resolve/main"
  },
  voices: [
    {
      id: "de_DE-thorsten-medium",
      name: "Thorsten",
      lang: "de",
      locale: "de_DE",
      gender: "male",
      quality: "medium",
      bytes: 63201294,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "CC0",
        ship: true
      },
      browser: "ok",
      proof: "spike, vorlaut, container",
      note: "The default in both browser builds, and the only single German voice that speaks in a tab.",
      recommended: true,
      recommended_why: "German male. Not thorsten-high, which is 114 MB against 63 for a difference a tablet speaker does not carry; not thorsten_emotional, whose moods a picker would have to expose before it made sense."
    },
    {
      id: "de_DE-thorsten-high",
      name: "Thorsten",
      lang: "de",
      locale: "de_DE",
      gender: "male",
      quality: "high",
      bytes: 113895201,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "CC0",
        ship: true
      },
      browser: "ok",
      proof: "spike",
      note: "The same person as de_DE-thorsten-medium and nearly twice the download. A picker showing both has to say more than the name."
    },
    {
      id: "de_DE-thorsten_emotional-medium",
      name: "Thorsten (emotional)",
      lang: "de",
      locale: "de_DE",
      gender: "male",
      quality: "medium",
      bytes: 76745905,
      sampleRate: 22050,
      speakers: 8,
      licence: {
        name: "CC0",
        ship: true
      },
      browser: "ok",
      proof: "spike",
      note: "Eight speakers, one per emotion, chosen by speaker id. vits-web speaks the first and offers no way to pick another, so in a browser this is one mood and not eight."
    },
    {
      id: "de_DE-mls-medium",
      name: "MLS",
      lang: "de",
      locale: "de_DE",
      gender: "mixed",
      quality: "medium",
      bytes: 76961079,
      sampleRate: 22050,
      speakers: 236,
      licence: {
        name: "CC-BY 4.0",
        ship: true,
        attribution: "Stimme: Multilingual LibriSpeech (MLS), CC BY 4.0.",
        note: "Shippable only where the attribution is actually rendered. Nothing in the family renders one yet, so adding this voice means adding that first."
      },
      browser: "ok",
      proof: "spike",
      note: "A corpus, not a person: 236 speakers in one model and no name a picker can show. The closest thing to a German female voice that runs in a browser at all, which is a statement about the alternatives rather than about this. Listened to rather than assumed: a sentence came back roughly four times longer than Thorsten's. The attribution is not the only thing standing between this and a usable second German voice."
    },
    {
      id: "en_US-kristin-medium",
      name: "Kristin",
      lang: "en",
      locale: "en_US",
      gender: "female",
      quality: "medium",
      bytes: 63531379,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "public domain",
        ship: true
      },
      browser: "ok",
      proof: "spike, vorlaut, container",
      recommended: true,
      recommended_why: "English female. LJ Speech is equally free and equally good, but it is an audiobook corpus rather than a person, and a picker showing a name reads better with Kristin."
    },
    {
      id: "en_US-ljspeech-medium",
      name: "LJ Speech",
      lang: "en",
      locale: "en_US",
      gender: "female",
      quality: "medium",
      bytes: 63531379,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "public domain",
        ship: true
      },
      browser: "ok",
      proof: "rule, mitreden",
      note: "The name of a dataset, which reads like a mistake in a list of first names. In mitreden's list since hfc_female came out of it, and recorded in the live page before it was added rather than taken on the strength of the tier."
    },
    {
      id: "de_DE-kerstin-low",
      name: "Kerstin",
      lang: "de",
      locale: "de_DE",
      gender: "female",
      quality: "low",
      bytes: 63104526,
      sampleRate: 16e3,
      speakers: 1,
      licence: {
        name: "CC0",
        ship: true
      },
      browser: "quality",
      proof: "container",
      note: "Free to ship and fine in a container - she is mitreden's container default and is in vorlaut's. Published as low only, so no other file helps. Reading each model's own phoneme_id_map instead of vits-web's fixed table is what would bring her back, and it means owning the phonemizer glue rather than calling a library. Note the 16 kHz: vorlaut's device wants exactly that, so a low voice would need no resampling at all. The cause is now diagnosed and fixed in code: the phonemizer writes the ich-Laut decomposed and this model's map has only the precomposed form, so remapPhonemeIds composes it and every id lands in range. `browser` stays `quality` until somebody has actually heard it \u2014 the proof field exists so this list cannot say tested and mean assumed. The harness has reported: she speaks, 63 ids, nothing dropped, the ich-Laut at 40 where native piper leaves a bare plosive at 16. Native piper drops the combining mark her map lacks, so it says Ik, m\xF6kte, nikt - which means native is not the oracle here and cannot flip this either way. What is left is a human ear. Heard 2026-08-22: the ich-Laut is right and she is intelligible throughout, so the remap does what it claimed. The verdict on the voice itself was okay but not great, which is a judgement about a 2021 low-tier model and not about the fix. `browser` stays `quality` for ever - that column is what vits-web can do, and it still cannot phonemise her.",
      browser_with_own_ids: "ok, heard 2026-08-22 - intelligible and correct, unremarkable",
      recommended: true,
      recommended_why: "German female, and the only licence-clear one piper publishes - Eva K and Ramona both have cards naming no licence. Needs usePiperRuntime, and needs somebody to have heard her. Heard on 2026-08-22 and judged okay but not great: she is the pick because she is the only licence-clear German female voice piper publishes, not because she beat anything."
    },
    {
      id: "en_US-john-medium",
      name: "John",
      lang: "en",
      locale: "en_US",
      gender: "male",
      quality: "medium",
      bytes: 63531379,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "public domain",
        ship: true
      },
      browser: "reach",
      proof: "container",
      note: "Not missing from the mirror - it is on both, at the byte count above, and both container images fetch it successfully. vits-web cannot have it: predict() looks the id up in PATH_MAP, finds nothing, and asks the mirror for 'undefined.json'. voices() advertises it anyway. mitreden's docs/spike/README.md recorded this as missing files, which was wrong and has been corrected there.",
      recommended: true,
      recommended_why: "English male, and the only licence-clear one - ryan and hfc_male are both CC BY-NC-SA. Needs usePiperRuntime, which fetches from the mirror rather than vits-web PATH_MAP."
    },
    {
      id: "de_DE-eva_k-x_low",
      name: "Eva K",
      lang: "de",
      locale: "de_DE",
      gender: "female",
      quality: "x_low",
      bytes: 20628813,
      sampleRate: 16e3,
      speakers: 1,
      licence: {
        name: "unclear",
        ship: false,
        note: "The MODEL_CARD names no licence. It points at the M-AILABS speech dataset, https://www.caito.de/2019/01/03/the-m-ailabs-speech-dataset/, and says 'See URL'. Unclear is not a yes - this is exactly the case mitreden's README warns about."
      },
      browser: "quality",
      proof: "rule",
      note: "The second of the three German female voices piper publishes. At 20.6 MB it is the only one that is genuinely smaller than a medium model - low is not, despite the name. The cause is now diagnosed and fixed in code: the phonemizer writes the ich-Laut decomposed and this model's map has only the precomposed form, so remapPhonemeIds composes it and every id lands in range. `browser` stays `quality` until somebody has actually heard it \u2014 the proof field exists so this list cannot say tested and mean assumed. Flipping it is a one-line change once vorlaut's ttscheck harness reports.",
      browser_with_own_ids: "ok by measurement, not yet by ear"
    },
    {
      id: "de_DE-ramona-low",
      name: "Ramona",
      lang: "de",
      locale: "de_DE",
      gender: "female",
      quality: "low",
      bytes: 63104526,
      sampleRate: 16e3,
      speakers: 1,
      licence: {
        name: "unclear",
        ship: false,
        note: "M-AILABS, 'See URL'. Same as Eva K."
      },
      browser: "quality",
      proof: "rule",
      note: "The third and last German female voice piper publishes. The cause is now diagnosed and fixed in code: the phonemizer writes the ich-Laut decomposed and this model's map has only the precomposed form, so remapPhonemeIds composes it and every id lands in range. `browser` stays `quality` until somebody has actually heard it \u2014 the proof field exists so this list cannot say tested and mean assumed. Flipping it is a one-line change once vorlaut's ttscheck harness reports.",
      browser_with_own_ids: "ok by measurement, not yet by ear"
    },
    {
      id: "de_DE-karlsson-low",
      name: "Karlsson",
      lang: "de",
      locale: "de_DE",
      gender: "male",
      quality: "low",
      bytes: 63104526,
      sampleRate: 16e3,
      speakers: 1,
      licence: {
        name: "unclear",
        ship: false,
        note: "M-AILABS, 'See URL'. Same as Eva K."
      },
      browser: "quality",
      proof: "rule",
      browser_with_own_ids: "ok by measurement, not yet by ear",
      note: " The cause is now diagnosed and fixed in code: the phonemizer writes the ich-Laut decomposed and this model's map has only the precomposed form, so remapPhonemeIds composes it and every id lands in range. `browser` stays `quality` until somebody has actually heard it \u2014 the proof field exists so this list cannot say tested and mean assumed. Flipping it is a one-line change once vorlaut's ttscheck harness reports."
    },
    {
      id: "en_US-hfc_female-medium",
      name: "HFC female",
      lang: "en",
      locale: "en_US",
      gender: "female",
      quality: "medium",
      bytes: 63201294,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "CC BY-NC-SA 4.0",
        ship: false,
        url: "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en",
        note: "Non-commercial and share-alike. Not a condition a recording made for somebody else's child can carry."
      },
      browser: "ok",
      proof: "spike",
      note: "The voice this file exists for. It speaks perfectly, it was in mitreden's browser build on exactly that basis, and it cannot be shipped. Nothing failed when it was wrong; the file simply played."
    },
    {
      id: "en_US-hfc_male-medium",
      name: "HFC male",
      lang: "en",
      locale: "en_US",
      gender: "male",
      quality: "medium",
      bytes: 63201294,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "CC BY-NC-SA 4.0",
        ship: false,
        url: "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en",
        note: "Same dataset, same model card, same answer."
      },
      browser: "ok",
      proof: "rule"
    },
    {
      id: "en_US-ryan-medium",
      name: "Ryan",
      lang: "en",
      locale: "en_US",
      gender: "male",
      quality: "medium",
      bytes: 63201294,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "CC BY-NC-SA 4.0",
        ship: false,
        url: "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en",
        note: "Non-commercial and share-alike. Not a condition a recording made for somebody else's child can carry."
      },
      browser: "ok",
      proof: "rule",
      note: "Runs, and cannot ship. Listed so that the next person to go looking for an English male voice finds the answer rather than the model card."
    },
    {
      id: "en_US-ryan-high",
      name: "Ryan",
      lang: "en",
      locale: "en_US",
      gender: "male",
      quality: "high",
      bytes: 120786792,
      sampleRate: 22050,
      speakers: 1,
      licence: {
        name: "CC BY-NC-SA 4.0",
        ship: false,
        url: "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en",
        note: "Non-commercial and share-alike. Not a condition a recording made for somebody else's child can carry."
      },
      browser: "ok",
      proof: "rule",
      note: "Same model card as the medium. Both qualities, one licence."
    }
  ]
};

// src/catalogue.ts
var VOICES = Object.freeze(
  voices_default.voices.map((v) => Object.freeze(v))
);
var MIRRORS = Object.freeze(voices_default.mirrors);
var LIBRARY = Object.freeze(voices_default.library);
var CHECKED = voices_default.checked;
var QUALITIES = ["x_low", "low", "medium", "high"];
function shippable(offering = {}) {
  return VOICES.filter((v) => refuse(v.id, offering) === null);
}
function byId(id) {
  const model = parseVoiceId(id)?.model ?? id;
  return VOICES.find((v) => v.id === model);
}
function refuse(id, offering = {}) {
  const model = parseVoiceId(id)?.model ?? id;
  const voice = byId(model);
  if (!voice) return `${model} is not in the catalogue, so it must not be fetched.`;
  if (!voice.licence.ship) return `${model} may not be shipped: ${voice.licence.name}.`;
  if (voice.licence.attribution && !offering.rendersAttribution) {
    return `${model} is ${voice.licence.name} and owes an attribution. Render it, then pass { rendersAttribution: true }.`;
  }
  if (!offering.ownsInference && voice.browser !== "ok") {
    return `${model} does not speak through vits-web: ${voice.browser}.`;
  }
  return null;
}
function isAllowed(id, offering = {}) {
  return refuse(id, offering) === null;
}
function parseVoiceId(id) {
  const at = id.indexOf(":");
  if (at < 1 || at === id.length - 1) return null;
  return { backend: id.slice(0, at), model: id.slice(at + 1) };
}
function displayName(id) {
  const model = parseVoiceId(id)?.model ?? id;
  const known = VOICES.find((v) => v.id === model);
  if (known) return known.name;
  const withoutLocale = model.includes("-") ? model.slice(model.indexOf("-") + 1) : model;
  const stem = QUALITIES.reduce((s, q) => s.endsWith(`-${q}`) ? s.slice(0, -q.length - 1) : s, withoutLocale);
  return stem.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function qualityOf(id) {
  const model = parseVoiceId(id)?.model ?? id;
  return QUALITIES.find((q) => model.endsWith(`-${q}`)) ?? null;
}
function attributionsFor(ids) {
  const owed = /* @__PURE__ */ new Set();
  for (const id of ids) {
    const a = byId(id)?.licence.attribution;
    if (a) owed.add(a);
  }
  return [...owed];
}
function speakerOf(voice) {
  return voice.id.slice(voice.locale.length + 1, voice.id.length - voice.quality.length - 1);
}
function modelUrls(id) {
  const voice = byId(id);
  if (!voice) return null;
  const base = MIRRORS.browser;
  const dir = `${voice.lang}/${voice.locale}/${speakerOf(voice)}/${voice.quality}`;
  return { onnx: `${base}/${dir}/${voice.id}.onnx`, config: `${base}/${dir}/${voice.id}.onnx.json` };
}

// src/contract.ts
var TARGET_LUFS = -16;
var TARGET_PEAK_DBTP = -1.5;
var TRIM = Object.freeze({
  thresholdDb: -50,
  keepHeadSec: 0.05,
  keepTailSec: 0.05
});
var MEASURE_RATE = 48e3;
var VERSION = "2.0.0";
var PIPELINE_VERSION = 1;

// src/level.ts
function checkRate(rate, what) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new TypeError(
      `${what} must be a positive finite number, not ${JSON.stringify(rate)}. A rate that arrived as a string needs parsing first.`
    );
  }
}
var magic = (view, at) => String.fromCharCode(
  view.getUint8(at),
  view.getUint8(at + 1),
  view.getUint8(at + 2),
  view.getUint8(at + 3)
);
function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (magic(view, 0) !== "RIFF" || magic(view, 8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let format = 0, channels = 0, rate = 0, bits = 0;
  let data = null;
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const id = magic(view, at);
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
    at = body + size + size % 2;
  }
  if (!rate || !data || !channels) throw new Error("WAVE file without fmt or data");
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
      else if (bits === 24) sum += (view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getInt8(at + 2) << 16) / 8388608;
      else if (bits === 32) sum += view.getInt32(at, true) / 2147483648;
      else if (bits === 8) sum += (view.getUint8(at) - 128) / 128;
      else throw new Error(`WAVE with ${bits} bit samples`);
    }
    out[i] = sum / channels;
  }
  return { samples: out, rate };
}
function toPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return pcm;
}
function encodeWav(samples, rate) {
  checkRate(rate, "the sample rate");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  const pcm = toPcm16(samples);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}
var sinc = (x) => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
var gcd = (a, b) => b ? gcd(b, a % b) : a;
var ZEROS = 24;
var MAX_PHASES = 4096;
var kernelCache = /* @__PURE__ */ new Map();
function kernels(inRate, outRate) {
  const key = `${inRate}>${outRate}`;
  const known = kernelCache.get(key);
  if (known !== void 0) return known;
  const common = gcd(inRate, outRate);
  const phaseCount = outRate / common;
  const stride = inRate / common;
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
    const offset = exact - whole;
    const first = Math.ceil(offset - halfWidth);
    const last = Math.floor(offset + halfWidth);
    const taps = new Float64Array(last - first + 1);
    let norm = 0;
    for (let k = first; k <= last; k++) {
      const t = k - offset;
      const angle = Math.PI * t / halfWidth;
      const h = 2 * fc * sinc(2 * fc * t) * (0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle));
      taps[k - first] = h;
      norm += h;
    }
    phases.push({ start: whole + first, taps, norm });
  }
  const built = { phaseCount, stride, phases };
  kernelCache.set(key, built);
  return built;
}
function resample(x, inRate, outRate) {
  checkRate(inRate, "the input rate");
  checkRate(outRate, "the output rate");
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
      if (j >= 0 && j < x.length) sum += x[j] * taps[n];
    }
    y[i] = phase.norm ? sum / phase.norm : 0;
    if (++r === phaseCount) {
      r = 0;
      block++;
    }
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
      const h = 2 * fc * sinc(2 * fc * t) * (0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle));
      norm += h;
      if (j >= 0 && j < x.length) sum += x[j] * h;
    }
    y[i] = norm ? sum / norm : 0;
  }
  return y;
}
function trim(x, rate, o = {}) {
  const threshold = Math.pow(10, (o.thresholdDb ?? TRIM.thresholdDb) / 20);
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) <= threshold) a++;
  while (b > a && Math.abs(x[b]) <= threshold) b--;
  if (a >= b) return x;
  const from = Math.max(0, a - Math.round((o.keepHeadSec ?? TRIM.keepHeadSec) * rate));
  const to = Math.min(x.length, b + Math.round((o.keepTailSec ?? TRIM.keepTailSec) * rate) + 1);
  return x.subarray(from, to);
}
function fadeEnds(x, rate, seconds) {
  const n = Math.min(Math.round(seconds * rate), Math.floor(x.length / 2));
  const y = Float32Array.from(x);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    y[i] *= g;
    y[y.length - 1 - i] *= g;
  }
  return y;
}
function pad(x, rate, seconds) {
  const y = new Float32Array(x.length + Math.round(seconds * rate));
  y.set(x, 0);
  return y;
}
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
function integratedLufs(x) {
  let k = biquad(
    x,
    1.53512485958697,
    -2.69169618940638,
    1.19839281085285,
    -1.69065929318241,
    0.73248077421585
  );
  k = biquad(k, 1, -2, 1, -1.99004745483398, 0.99007225036621);
  const block = Math.round(0.4 * MEASURE_RATE), step = Math.round(0.1 * MEASURE_RATE);
  const power = [];
  for (let s = 0; s + block <= k.length; s += step) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += k[i] * k[i];
    power.push(sum / block);
  }
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
  return gated.length ? loudness(mean(gated)) : -Infinity;
}
function truePeakDb(x, rate) {
  const dense = resample(x, rate, rate * 4);
  let peak = 0;
  for (let i = 0; i < dense.length; i++) peak = Math.max(peak, Math.abs(dense[i]));
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  return 20 * Math.log10(peak || 1e-12);
}
function postprocess(wavBytes, o = {}) {
  const rate = o.rate === void 0 ? 44100 : o.rate;
  checkRate(rate, "the output rate");
  const { samples, rate: inRate } = decodeWav(wavBytes);
  let shaped = trim(samples, inRate, o);
  if (o.fadeSec) shaped = fadeEnds(shaped, inRate, o.fadeSec);
  if (o.padSec) shaped = pad(shaped, inRate, o.padSec);
  const lufs = integratedLufs(resample(shaped, inRate, MEASURE_RATE));
  const out = resample(shaped, inRate, rate);
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
    samples: levelled,
    rate,
    seconds: levelled.length / rate,
    lufs,
    gainDb,
    clamped,
    peakDb: peakDb + gainDb
  };
}

// src/phonemes.ts
function remapPhonemeIds(phonemes, phonemeIds, map) {
  const bos = map["^"]?.[0], eos = map["$"]?.[0], pad2 = map["_"]?.[0];
  if (bos === void 0 || eos === void 0 || pad2 === void 0) {
    throw new Error("phoneme_id_map is missing '^', '$' or '_'");
  }
  const structural = /* @__PURE__ */ new Set([bos, eos, pad2]);
  const out = [];
  const dropped = [];
  let k = 0, exact = true, dropPad = false;
  for (const id of phonemeIds) {
    if (structural.has(id)) {
      if (dropPad && id === pad2) {
        dropPad = false;
        continue;
      }
      out.push(id);
      continue;
    }
    const phoneme = phonemes[k++];
    if (phoneme === void 0) {
      out.push(id);
      continue;
    }
    if (map[phoneme]) {
      out.push(...map[phoneme]);
      continue;
    }
    const previous = phonemes[k - 2];
    const composed = previous === void 0 ? null : (previous + phoneme).normalize("NFC");
    if (composed && [...composed].length === 1 && map[composed]) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (!structural.has(out[i])) {
          out.splice(i, 1, ...map[composed]);
          break;
        }
      }
      exact = false;
      dropPad = true;
      continue;
    }
    dropped.push(phoneme);
    exact = false;
    dropPad = true;
  }
  return { ids: out, dropped, exact };
}

// src/synthesize.ts
var runtime = null;
function usePiperRuntime(r) {
  runtime = r;
}
var hasPiperRuntime = () => runtime !== null;
function need() {
  if (!runtime) {
    throw new Error(
      "No piper runtime. Call usePiperRuntime({ phonemizer, onnx, wasmBase }) with wherever this app serves piper_phonemize and onnxruntime from."
    );
  }
  return runtime;
}
async function opfs() {
  try {
    const root = await navigator?.storage?.getDirectory?.();
    return await root?.getDirectoryHandle("stimmquelle-models", { create: true }) ?? null;
  } catch {
    return null;
  }
}
async function cached(name, url, o = {}) {
  const r = need();
  if (r.fetchModel) return r.fetchModel(url);
  const dir = await opfs();
  if (dir) {
    try {
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      if (!o.expectBytes || file.size >= o.expectBytes) return await file.arrayBuffer();
      await dir.removeEntry(name).catch(() => {
      });
    } catch {
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: the mirror said ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let bytes;
  if (o.onProgress && total && response.body) {
    const reader = response.body.getReader();
    const parts = [];
    let loaded = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      o.onProgress(loaded / total);
    }
    bytes = new Uint8Array(loaded);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (total && bytes.length !== total) {
    throw new Error(
      `${name}: ${bytes.length} bytes arrived of the ${total} the mirror promised. The download stopped early. Nothing has been cached, so trying again is safe.`
    );
  }
  if (dir) {
    try {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    } catch {
    }
  }
  return bytes.buffer;
}
async function downloadedModels() {
  const dir = await opfs();
  if (!dir) return [];
  const out = [];
  for await (const name of dir.keys()) {
    if (name.endsWith(".onnx")) out.push(name.slice(0, -".onnx".length));
  }
  return out;
}
async function forgetModels() {
  const dir = await opfs();
  if (!dir) return;
  const names = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names) await dir.removeEntry(name).catch(() => {
  });
}
async function phonemise(text, espeakVoice) {
  const r = need();
  const { createPiperPhonemize } = await r.phonemizer();
  const base = r.wasmBase.endsWith("/") ? r.wasmBase : `${r.wasmBase}/`;
  if (!espeakVoice) {
    throw new TypeError(
      "phonemise(text, espeakVoice) wants espeak's language code \u2014 the `espeak.voice` field of a model's .onnx.json, usually 'de' or 'en-us'. A piper voice id is not it."
    );
  }
  const line = await new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: resolve,
      printErr: (message) => reject(new Error(
        message || "the phonemizer failed and said nothing about why"
      )),
      locateFile: (path) => path.endsWith(".wasm") ? `${base}piper_phonemize.wasm` : path.endsWith(".data") ? `${base}piper_phonemize.data` : path
    }).then((module) => module.callMain([
      "-l",
      espeakVoice,
      "--input",
      JSON.stringify([{ text: text.trim() }]),
      "--espeak_data",
      "/espeak-ng-data"
    ])).catch(reject);
  });
  const parsed = JSON.parse(line);
  return { phonemes: parsed.phonemes, phonemeIds: parsed.phoneme_ids };
}
async function synthesize(text, id, progress) {
  const options = typeof progress === "function" ? { onProgress: progress } : progress ?? {};
  const known = ["onProgress", "rendersAttribution"];
  const keys = typeof progress === "object" && progress !== null ? Object.keys(progress) : [];
  if (keys.length && !keys.some((k) => known.includes(k))) {
    throw new TypeError(
      "synthesize() takes a progress callback, or { onProgress }. It sits next to speak(), which takes a whole options object \u2014 passing speak's options here is the easy mistake and this is it being caught."
    );
  }
  const refusal = refuse(id, { ...options, ownsInference: true });
  if (refusal) throw new Error(refusal);
  const r = need();
  const voice = byId(id);
  const urls = modelUrls(voice.id);
  const configBytes = await cached(`${voice.id}.onnx.json`, urls.config);
  const config = JSON.parse(new TextDecoder().decode(configBytes));
  const { phonemes, phonemeIds } = await phonemise(text, config.espeak.voice);
  const { ids, dropped, exact } = remapPhonemeIds(phonemes, phonemeIds, config.phoneme_id_map);
  const model = await cached(
    `${voice.id}.onnx`,
    urls.onnx,
    { expectBytes: voice.bytes, onProgress: options.onProgress }
  );
  const ort = await r.onnx();
  ort.env.allowLocalModels = false;
  ort.env.wasm.wasmPaths = r.wasmBase.endsWith("/") ? r.wasmBase : `${r.wasmBase}/`;
  const session = await ort.InferenceSession.create(model);
  const feeds = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([ids.length], BigInt)),
    scales: new ort.Tensor("float32", Float32Array.from([
      config.inference.noise_scale,
      config.inference.length_scale,
      config.inference.noise_w
    ]))
  };
  if (config.speaker_id_map && Object.keys(config.speaker_id_map).length) {
    feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]));
  }
  const output = await session.run(feeds);
  const audio = (output.output ?? Object.values(output)[0]).data;
  return { samples: audio, rate: config.audio.sample_rate, exact, dropped };
}

// src/speak.ts
var loadPiper = null;
function usePiper(load) {
  loadPiper = load;
}
async function piper() {
  if (!loadPiper) {
    throw new Error(
      "No piper module. Call usePiper(() => import(\u2026)) with wherever this app serves @diffusionstudio/vits-web from."
    );
  }
  return loadPiper();
}
async function downloaded() {
  return (await piper()).stored();
}
async function forget() {
  return (await piper()).flush();
}
async function synthesizePiper(text, model, onProgress) {
  const tts = await piper();
  if (!(model in tts.PATH_MAP)) {
    throw new Error(`${model} is not in vits-web's PATH_MAP and cannot be fetched by it. See voices.json for what can.`);
  }
  const blob = await tts.predict({ text: text.trim(), voiceId: model }, (p) => {
    if (onProgress && p && p.total) {
      onProgress({ url: p.url, loaded: p.loaded, total: p.total, share: p.loaded / p.total });
    }
  });
  return new Uint8Array(await blob.arrayBuffer());
}
var AZURE_FORMAT = "riff-16khz-16bit-mono-pcm";
var AZURE_RATE = "-5%";
var endpoint = (region) => `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
var voiceList = (region) => `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
function localeOf(name) {
  const parts = name.split("-");
  return parts.length >= 3 ? parts.slice(0, 2).join("-") : "de-DE";
}
var xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function buildSsml(text, voice, rate = AZURE_RATE) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xml(localeOf(voice))}"><voice name="${xml(voice)}"><prosody rate="${xml(rate)}">${xml(text.trim())}</prosody></voice></speak>`;
}
async function synthesizeAzure(text, voice, o) {
  if (!o.key) throw new Error("No Azure key.");
  const response = await fetch(endpoint(o.region), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": o.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AZURE_FORMAT
    },
    body: buildSsml(text, voice, o.rate ?? AZURE_RATE)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error(`Azure rejected the key for ${o.region}.`);
    throw new Error(`Azure said ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
async function azureVoices(o) {
  const response = await fetch(voiceList(o.region), {
    headers: { "Ocp-Apim-Subscription-Key": o.key }
  });
  if (!response.ok) throw new Error(`Azure said ${response.status} to the voice list.`);
  const want = (o.languages ?? ["de-DE", "en-US"]).map((l) => l.toLowerCase());
  const all = await response.json();
  return all.filter((v) => want.some((w) => (v.Locale ?? "").toLowerCase() === w || (v.Locale ?? "").toLowerCase().startsWith(`${w}-`))).map((v) => ({
    id: `azure:${v.ShortName}`,
    name: v.LocalName ?? v.DisplayName ?? v.ShortName,
    lang: (v.Locale ?? "").split("-")[0],
    locale: v.Locale ?? "",
    gender: (v.Gender ?? "").toLowerCase(),
    source: "azure",
    // Nothing is downloaded and nothing is kept: a cloud voice needs the
    // network for every sentence instead of once for the model.
    downloadBytes: 0,
    needsKey: true,
    // Azure publishes hundreds and this package has no opinion on which to
    // put in front of somebody. The catalogue's picks are about the four
    // voices it can actually vouch for.
    recommended: false
  })).sort((a, b) => a.id.localeCompare(b.id));
}
async function speak(text, vid, options = {}) {
  if (!text || !text.trim()) throw new Error("Nothing to say.");
  const parsed = parseVoiceId(vid);
  const backend = parsed?.backend ?? "piper";
  const model = parsed?.model ?? vid;
  if (backend !== "piper" && backend !== "azure") {
    throw new Error(`${backend}: is not a backend this package speaks. Use piper: or azure:.`);
  }
  if (backend === "piper") {
    const refusal = refuse(model, options);
    if (refusal) throw new Error(refusal);
  }
  const started = performance.now();
  if (backend === "piper" && hasPiperRuntime()) {
    const spoken2 = await synthesize(text, model, {
      // Carried through rather than defaulted: `synthesize` asks the licence
      // question again on its own account, and it must get the same answer this
      // call already got rather than a stricter one.
      rendersAttribution: options.rendersAttribution,
      ownsInference: true,
      onProgress: options.onProgress ? (share) => options.onProgress({ url: model, loaded: share, total: 1, share }) : void 0
    });
    const synthesisedAt = performance.now();
    const result2 = postprocess(encodeWav(spoken2.samples, spoken2.rate), options);
    return {
      ...result2,
      voice: vid,
      rawBytes: spoken2.samples.length * 2,
      synthesisMs: Math.round(synthesisedAt - started),
      levellingMs: Math.round(performance.now() - synthesisedAt)
    };
  }
  if (backend === "azure" && !options.azure) {
    throw new Error("An azure: voice needs options.azure with a key and a region.");
  }
  const raw = backend === "azure" ? await synthesizeAzure(text, model, options.azure) : await synthesizePiper(text, model, options.onProgress);
  const spoken = performance.now();
  const result = postprocess(raw, options);
  return {
    ...result,
    voice: vid,
    rawBytes: raw.length,
    synthesisMs: Math.round(spoken - started),
    levellingMs: Math.round(performance.now() - spoken)
  };
}
var asBlob = (wav) => new Blob([wav], { type: "audio/wav" });

export {
  VOICES,
  MIRRORS,
  LIBRARY,
  CHECKED,
  shippable,
  byId,
  refuse,
  isAllowed,
  parseVoiceId,
  displayName,
  qualityOf,
  attributionsFor,
  modelUrls,
  TARGET_LUFS,
  TARGET_PEAK_DBTP,
  TRIM,
  MEASURE_RATE,
  VERSION,
  PIPELINE_VERSION,
  decodeWav,
  toPcm16,
  encodeWav,
  resample,
  trim,
  fadeEnds,
  pad,
  integratedLufs,
  truePeakDb,
  postprocess,
  remapPhonemeIds,
  usePiperRuntime,
  hasPiperRuntime,
  downloadedModels,
  forgetModels,
  phonemise,
  synthesize,
  usePiper,
  downloaded,
  forget,
  AZURE_FORMAT,
  AZURE_RATE,
  localeOf,
  buildSsml,
  azureVoices,
  speak,
  asBlob
};
