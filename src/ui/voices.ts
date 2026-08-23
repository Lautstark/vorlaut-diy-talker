// The chosen voice stands in layout.json next to the language and is saved
// with everything else. What can be spoken with here is a different question,
// answered by the server on every open: a key entered in the meantime, or a
// model that has arrived, should show up without reloading the page.
//
// This file also owns the settings sheet itself - opening it and its one Save
// - because that Save is mostly about the voice. The Azure and METACOM panel
// inside it is settings.js, which this calls into.
import { $, status} from "./dom.js";
import { reason } from "../core/errors.js";
import { listVoices, voiceFetchState, startVoiceFetch } from "../backend/index.js";
import { LANG, LANGUAGES } from "../core/boot.js";
import { state } from "../core/state.js";
import { t } from "../core/texts.js";
import { save } from "../core/save.js";
import { speak } from "./speech.js";
import { forgetKey, loadSettings, saveSettings } from "./settings.js";

let voices = { voices: [], active: "", chosen: "" };
// What is ticked in the sheet. Separate from voices.chosen, which is what
// stands in layout.json - between opening and pressing Save the two differ,
// and that difference is the whole point of having a Save.
let pendingVoice = "";

// Same rule as the voice below: nothing is written until Save. It matters
// more here, because applying a language means reloading the page - doing
// that on change would throw away an Azure key half typed into the field
// underneath.
let pendingLanguage = "";

// About 130 MB, so the server downloads in the background and is asked how far
// it has got. Polling rather than a held-open request: this server answers one
// request per thread, and the interface should stay usable meanwhile.
let fetching = { running: false, done: 0, total: 0, name: "", error: "",
                 missing: 0 };
let fetchDone = false;   // finished in this dialog - worth saying so

// One loop at a time: closing the dialog does not stop it, so opening it again
// would otherwise leave two of them polling and rendering over each other.
let polling = false;

// How the list narrows. A key of your own brings hundreds of voices, and all
// of them at once pushed everything below the voice section out of the sheet -
// the panel that holds the key among them, which is the one thing somebody
// with no voices has come here to find. The old answer was to fold the list
// down to the chosen voice and offer "show all"; this is mitreden's answer
// instead, and it is better: the list scrolls in a box of its own, and what
// somebody is looking for is reached by typing or by language rather than by
// unfolding everything and scrolling past what they did not want.
let query = "";
let onlyLang: string | null = null;

async function loadVoices() {
  try {
    voices = await listVoices();
  } catch (error) {
    status(t("ui.voice_failed", { error: reason(error) }));
  }
}

// What a voice is tried out on: a sentence from the set being worked on, so
// one hears the actual content rather than a specimen. Only if there is none
// does the sample step in.
function sampleText() {
  const set = state.layout.sets[state.current];
  const slot = (set ? set.slots || [] : []).find((entry) => (entry.text || "").trim());
  return slot ? slot.text.trim() : t("ui.voice_sample");
}

/* stimmquelle publishes three, and a corpus of several speakers is `mixed`
 * rather than a guess. Anything it adds later is shown as it came, which is
 * honest, rather than as the name of a missing translation. */
function genderOf(gender: string): string {
  return gender === "female" || gender === "male" || gender === "mixed"
    ? t(`ui.gender_${gender}`) : gender;
}

/* Who renders it. Not the model's name or the vendor's product name: what
 * somebody choosing is deciding is whether it is already here or has to be
 * fetched from a company. */
function sourceOf(source: string): string {
  // Empty is not a backend, and the one row that has none is the voice that
  // is chosen but not here: it must not claim to be bundled while saying in
  // the same line that it cannot be found.
  if (!source) return "";
  return t(source === "azure" ? "ui.source_azure"
         : source === "system" ? "ui.source_system" : "ui.source_piper");
}

/* What it speaks, named in the language of whoever is reading. */
function speaks(code: string): string {
  const tag = (code || "").replaceAll("_", "-");
  if (!tag) return "";
  try {
    return new Intl.DisplayNames([LANG], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** What this voice costs to have before it will speak. */
function weighs(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

/** stimmquelle's rule: `de_DE`, `de-DE` and `de` all compare equal. */
function language(code: string): string {
  return (code || "").toLowerCase().replaceAll("_", "-").split("-")[0];
}

function matches(voice) {
  if (onlyLang && language(voice.language) !== onlyLang) return false;
  if (!query) return true;
  const hay = `${voice.label} ${voice.language} ${sourceOf(voice.source)} ${speaks(voice.language)}`;
  return hay.toLowerCase().includes(query);
}

/* One voice, in the four facts that decide between two of them: who renders
 * it, what it speaks, whose voice it is, and what it costs to have. The list
 * used to be bare names, where "Thorsten" and "Katja" were indistinguishable
 * in every way that matters - one is on this machine, the other is a request
 * to Microsoft per sentence.
 *
 * Four facts and no verdict. stimmquelle's `recommended` is not among them and
 * deliberately is not carried into OfferedVoice either - see the note there.
 *
 * Two buttons per row, still: hearing a voice and choosing it are two
 * different decisions, and the first must not commit to the second. That is
 * why the row is a wrapper and not itself the button mitreden makes it - a
 * button inside a button is not a thing a browser will render. */
function voiceRow(voice, note: string, mute: boolean, on: boolean) {
  const row = document.createElement("div");
  row.className = "voiceRow";

  const play = document.createElement("button");
  play.className = "btn play";
  play.type = "button";
  play.textContent = "▶";
  play.title = t("ui.play_title");
  // Nothing to listen to for a voice that is not here. The button stays, so
  // the row keeps its shape, but it cannot be pressed.
  play.disabled = mute;
  // The voice of this row, not the saved one - otherwise trying one out would
  // mean committing to it first.
  play.onclick = () => speak(sampleText(), play, voice.id || voices.active);

  const pick = document.createElement("button");
  pick.className = "voice";
  pick.type = "button";
  pick.setAttribute("role", "radio");
  pick.setAttribute("aria-checked", String(on));

  const naming = document.createElement("span");
  naming.className = "voice__name";
  naming.textContent = voice.label;

  const facts = document.createElement("span");
  facts.className = "voice__facts";
  facts.textContent = [
    sourceOf(voice.source),
    speaks(voice.language),
    genderOf(voice.gender || ""),
    voice.needsKey ? t("ui.voice_needs_key")
      : voice.downloadBytes ? weighs(voice.downloadBytes) : "",
    note,
  ].filter(Boolean).join(" · ");

  pick.append(naming, facts);
  pick.onclick = () => chooseVoice(voice.id);

  row.append(play, pick);
  return row;
}

/* One chip per language the list actually holds, plus "all". Built from the
 * voices in hand rather than from LANGUAGES: the page speaks two, the
 * catalogue speaks a good many more, and a filter offering a language nothing
 * can speak is a filter that answers with nothing. */
function renderFilters() {
  const box = $("voiceFilters");
  box.innerHTML = "";
  const codes = [...new Set(voices.voices.map((v) => language(v.language)))]
    .filter(Boolean).sort();
  // Nothing to narrow with one language in the list.
  if (codes.length < 2) return;

  const chip = (label: string, code: string | null) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(onlyLang === code));
    button.onclick = () => { onlyLang = code; renderVoices(); };
    box.appendChild(button);
  };
  chip(t("ui.voice_lang_all"), null);
  for (const code of codes) chip(speaks(code), code);
}

// The button that fetches what is missing. Under the voice section whether or
// not that section has anything in it - a machine that cannot speak at all
// should not have to be told about a command line.
//
// With the note under it, always: the button used to be the word "Fetch"
// beside a list of voices, which left what it would fetch, from where, and
// how long it would take to a hint at the bottom that only appeared when
// there were no voices at all.
function fetchRow() {
  const row = document.createElement("div");
  row.className = "offer";
  const button = document.createElement("button");
  button.textContent = t("ui.voice_fetch");
  button.disabled = fetching.running;
  button.onclick = startFetch;
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = t("ui.voice_fetch_note");
  row.appendChild(button);
  row.appendChild(note);
  return row;
}

function renderVoices() {
  const list = $("voiceList");
  list.innerHTML = "";
  renderFilters();
  if (!voices.voices.length) {
    const empty = document.createElement("div");
    empty.className = "voiceRow blank";
    empty.textContent = t("ui.voice_none");
    list.appendChild(empty);
    renderOffer();
    $("voiceHint").textContent = fetchNote();
    return;
  }
  // An empty entry in layout.json means "whatever works here", and that is
  // the normal case for a fresh one. It is not shown as a choice of its own:
  // "Automatic" tells nobody anything, and a row that has to explain itself
  // is a row too many. Instead the voice it comes out as stands marked, with
  // a word to say nobody picked it by hand. Choosing any row writes it down,
  // and from then on the layout carries a decision instead of a default.
  const marked = pendingVoice || voices.active;
  const box = document.createElement("div");
  box.className = "voices";
  box.setAttribute("role", "radiogroup");
  const hits = voices.voices.filter(matches);
  for (const voice of hits) {
    box.appendChild(voiceRow(
      voice,
      !pendingVoice && voice.id === voices.active ? t("ui.voice_auto_note") : "",
      false, voice.id === marked));
  }
  if (!hits.length) {
    const none = document.createElement("p");
    none.className = "note";
    none.textContent = t("ui.voice_no_match");
    box.appendChild(none);
  }
  list.appendChild(box);
  // A voice can be chosen and not be here: a key withdrawn, a model deleted,
  // a layout carried over from another machine. It stays chosen on purpose -
  // so it has to be visible, or the list would show nothing as chosen and the
  // next save would quietly drop a deliberate decision.
  if (pendingVoice && !voices.voices.some((v) => v.id === pendingVoice)) {
    box.appendChild(voiceRow(
      { id: pendingVoice, label: pendingVoice, language: "", source: "",
        gender: "", downloadBytes: 0, needsKey: false },
      t("ui.voice_gone"), true, true));
  }
  renderOffer();
  // The standing rule, whether or not anything was just ticked: a voice is
  // part of what every sentence is spoken with, so changing it re-records all
  // of them rather than only the ones edited afterwards.
  $("voiceHint").textContent = fetchNote() || t("ui.voice_rebuild");
}

function renderOffer() {
  const box = $("voiceOffer");
  box.innerHTML = "";
  if (fetching.missing) box.appendChild(fetchRow());
}

// What the hint line says while a download runs, or "" when it has nothing
// to add and the usual note applies.
function fetchNote() {
  if (fetching.error) return fetching.error;
  if (fetching.running) {
    return t("ui.voice_fetching", {
      name: fetching.name,
      done: fetching.done + 1,
      total: fetching.total,
    });
  }
  return fetchDone ? t("ui.voice_fetch_done") : "";
}

async function readFetch() {
  try {
    fetching = await voiceFetchState();
  } catch (error) {
    fetching = { running: false, done: 0, total: 0, name: "",
                 error: reason(error), missing: 0 };
  }
}

async function startFetch() {
  fetchDone = false;
  try {
    await startVoiceFetch();
  } catch (error) {
    fetching.error = reason(error);
    renderVoices();
    return;
  }
  await readFetch();
  renderVoices();
  pollFetch();
}

// Stops by itself when the download is over. Two seconds is plenty: this is
// minutes of downloading, not milliseconds.
function pollFetch() {
  if (polling) return;
  polling = true;
  setTimeout(async () => {
    polling = false;
    await readFetch();
    if (fetching.running) {
      renderVoices();
      pollFetch();
      return;
    }
    fetchDone = !fetching.error;
    // The voices themselves have to be asked for again - the list was empty
    // when the dialog opened.
    await loadVoices();
    renderVoices();
  }, 2000);
}

// Ticks a row. Nothing is written until Save - a voice changed by accident
// would mean every recording spoken again on the next release.
function chooseVoice(id) {
  pendingVoice = id;
  renderVoices();
}

// One Save for the whole sheet, because that is how it reads: two panels and
// one button. The voice goes into layout.json, the rest into .env - which is
// the server's business, not something the page should make anybody think
// about.
export async function saveVoice() {
  let azureChanged = false;
  try {
    ({ azureChanged } = await saveSettings());
  } catch (error) {
    status(t("ui.save_failed", { error: reason(error) }));
    return;                       // stay open, the message is in the header
  }
  let changed = false;
  if (pendingVoice && pendingVoice !== voices.chosen) {
    state.layout.voice = pendingVoice;
    changed = true;
    // The server decides what the entry resolves to, so ask rather than guess -
    // and the release button has to light up, which save() already does.
  }
  const switching = pendingLanguage && pendingLanguage !== LANG;
  if (switching) {
    state.layout.language = pendingLanguage;
    changed = true;
  }
  if (changed) await save();
  // The labels are baked into the page by the server, so a new language is a
  // reload rather than a re-render - anything else would mean a second copy
  // of every string in the browser. Last, and only once the writing is done.
  if (switching) {
    location.reload();
    return;
  }
  // A key that has just arrived can mean Azure voices that were not there
  // when the sheet opened.
  await loadVoices();
  if (azureChanged) {
    // Stay open. This save's whole point was to change where the voices come
    // from, and closing meant the person who typed a key had to reopen the
    // sheet to learn what it did - the panel's state line and the refreshed
    // list are the answer, and they belong on the screen the question was
    // asked from. Picking a voice still closes, below: that save is the end
    // of the errand, this one is the middle of it.
    renderVoices();
    status(t("ui.settings_saved"));
    return;
  }
  status(t("ui.settings_saved"));
  $<HTMLDialogElement>("voices").close();
}

// Removing the key is the same shape of errand as saving one: the list it
// feeds is on this sheet, so the sheet stays open and the Azure rows leave
// in front of the person who asked.
export async function forgetAzureKey() {
  try {
    await forgetKey();
  } catch (error) {
    status(t("ui.save_failed", { error: reason(error) }));
    return;                       // stay open, the message is in the header
  }
  await loadVoices();
  renderVoices();
  status(t("ui.azure_key_removed"));
}

// The options name themselves: "Deutsch" stays "Deutsch" whatever the page is
// set to. That is the point of them here - this is the one control somebody
// reaches for when they cannot read the interface around it, so it must not
// depend on being able to read the interface around it. In the header it was
// "DE"/"EN", because the full words cost a third of the bar on a phone; in a
// dialog there is room to say it properly.
export function wireLanguage() {
  const pick = $<HTMLSelectElement>("langPick");
  const names = { de: "Deutsch", en: "English" };
  for (const code of LANGUAGES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = names[code] || code;
    pick.appendChild(option);
  }
  pick.value = LANG;
  pendingLanguage = LANG;
  pick.onchange = () => { pendingLanguage = pick.value; };

  // Typed into once and read on every render afterwards. The field is in the
  // sheet's markup rather than rebuilt with the list, so the caret survives.
  const search = $<HTMLInputElement>("voiceQuery");
  search.oninput = () => { query = search.value.trim().toLowerCase(); renderVoices(); };
}

export async function openVoices() {
  $("voiceList").innerHTML = "";
  $("voiceHint").textContent = "";
  $("voiceOffer").innerHTML = "";
  fetchDone = false;
  // Folded again on every open, both of them. Somebody who unfolded one last
  // time was after a single thing in it, not after a preference. The headings
  // say what is inside, so nothing is hidden by folding them - and
  // loadSettings() below unfolds the symbols panel again if what is in there
  // is broken. The voice list is narrowed back the same way, for the same
  // reason: a filter left on would hide voices with no sign that it had.
  query = "";
  onlyLang = null;
  $<HTMLInputElement>("voiceQuery").value = "";
  $<HTMLDetailsElement>("azurePanel").open = false;
  $<HTMLDetailsElement>("symbolsPanel").open = false;
  $<HTMLDialogElement>("voices").showModal();
  await Promise.all([loadVoices(), readFetch(), loadSettings()]);
  pendingVoice = voices.chosen;
  // Reopening after Cancel has to show the language the page is actually in,
  // not the one that was picked and then dropped.
  pendingLanguage = LANG;
  $<HTMLSelectElement>("langPick").value = LANG;
  renderVoices();
  // A download started before this dialog was opened - in another tab, or
  // before a reload - still has something to report.
  if (fetching.running) pollFetch();
}
