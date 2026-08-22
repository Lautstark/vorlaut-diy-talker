import {
  AZURE_FORMAT,
  AZURE_RATE,
  CHECKED,
  LIBRARY,
  MEASURE_RATE,
  MIRRORS,
  PIPELINE_VERSION,
  TARGET_LUFS,
  TARGET_PEAK_DBTP,
  TRIM,
  VERSION,
  VOICES,
  asBlob,
  attributionsFor,
  azureVoices,
  buildSsml,
  byId,
  decodeWav,
  displayName,
  downloaded,
  downloadedModels,
  encodeWav,
  fadeEnds,
  forget,
  forgetModels,
  hasPiperRuntime,
  integratedLufs,
  isAllowed,
  localeOf,
  modelUrls,
  pad,
  parseVoiceId,
  phonemise,
  postprocess,
  qualityOf,
  refuse,
  remapPhonemeIds,
  resample,
  shippable,
  speak,
  synthesize,
  toPcm16,
  trim,
  truePeakDb,
  usePiper,
  usePiperRuntime
} from "./chunk.js";

// src/list.ts
var language = (s) => s.toLowerCase().replace(/_/g, "-").split("-")[0];
function matches(v, o) {
  if (o.lang && language(v.locale) !== language(o.lang)) return false;
  if (o.gender && v.gender !== o.gender.toLowerCase()) return false;
  if (o.recommended && !v.recommended) return false;
  return true;
}
function piperVoices(offering = {}) {
  return shippable(offering).map((v) => ({
    id: `piper:${v.id}`,
    name: v.name,
    lang: v.lang,
    locale: v.locale,
    gender: v.gender,
    source: "piper",
    downloadBytes: v.bytes,
    needsKey: false,
    recommended: v.recommended === true,
    ...v.licence.attribution ? { attribution: v.licence.attribution } : {}
  }));
}
async function listVoices(o = {}) {
  const { azureVoices: azureVoices2 } = await import("./speak.js");
  const all = [...piperVoices(o), ...o.azure ? await azureVoices2(o.azure) : []];
  return all.filter((v) => matches(v, o));
}

// src/mp3.ts
var lame = null;
var load = () => lame ??= import("./lamejs.js");
var DEFAULT_BITRATE = 192;
async function encodeMp3(samples, rate, bitrate = DEFAULT_BITRATE) {
  const { Mp3Encoder } = await load();
  const encoder = new Mp3Encoder(1, rate, bitrate);
  const pcm = toPcm16(samples);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const block = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (block.length) parts.push(new Uint8Array(block));
  }
  const rest = encoder.flush();
  if (rest.length) parts.push(new Uint8Array(rest));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
export {
  AZURE_FORMAT,
  AZURE_RATE,
  CHECKED,
  DEFAULT_BITRATE,
  LIBRARY,
  MEASURE_RATE,
  MIRRORS,
  PIPELINE_VERSION,
  TARGET_LUFS,
  TARGET_PEAK_DBTP,
  TRIM,
  VERSION,
  VOICES,
  asBlob,
  attributionsFor,
  azureVoices,
  buildSsml,
  byId,
  decodeWav,
  displayName,
  downloaded,
  downloadedModels,
  encodeMp3,
  encodeWav,
  fadeEnds,
  forget,
  forgetModels,
  hasPiperRuntime,
  integratedLufs,
  isAllowed,
  listVoices,
  localeOf,
  modelUrls,
  pad,
  parseVoiceId,
  phonemise,
  piperVoices,
  postprocess,
  qualityOf,
  refuse,
  remapPhonemeIds,
  resample,
  shippable,
  speak,
  synthesize,
  toPcm16,
  trim,
  truePeakDb,
  usePiper,
  usePiperRuntime
};
