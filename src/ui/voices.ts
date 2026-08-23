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
import { LANG, LANGUAGES, setLanguage } from "../core/boot.js";
import { state } from "../core/state.js";
import { applyTexts, t } from "../core/texts.js";
import { save } from "../core/save.js";
import { render as renderBoard } from "./editor.js";
import { showSources } from "./picker.js";
import { speak } from "./speech.js";
import { forgetKey, loadSettings, paintStates, saveSettings } from "./settings.js";

let voices = { voices: [], active: "", chosen: "", chosenLabel: "" };
// Nothing is "pending" on this sheet any more. What is ticked IS what stands
// in layout.json, because choosing writes - so voices.chosen is the single
// answer to "which voice", and the gap that used to be held open between
// opening the sheet and pressing Save no longer exists.

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

/* The quality tier, in words. stimmquelle publishes four; anything it adds
 * later is shown as it came, the way genderOf() does, rather than as the name
 * of a missing translation. Where this is said at all is voiceRow()'s
 * question, not this one's. */
function tierOf(quality: string): string {
  return quality === "x_low" || quality === "low"
      || quality === "medium" || quality === "high"
    ? t(`ui.quality_${quality}`) : quality;
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

/* The display names this list holds more than one of.
 *
 * Read from every offered voice rather than from what the filter left
 * standing, so that typing in the search field cannot change what a row says
 * about itself. A row's facts are facts about the voice; they must not shift
 * under somebody who is narrowing the list. */
function twiceNamed(): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const voice of voices.voices) {
    if (seen.has(voice.label)) twice.add(voice.label);
    seen.add(voice.label);
  }
  return twice;
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
 * The quality tier is the fifth fact, and `shared` is why it is not simply the
 * fifth column. A tier is not neutral the way the other four are: "low" beside
 * "high" reads as a ranking, and Kerstin is `low` for a reason that is
 * vits-web's fault rather than hers - a word that steers somebody away from a
 * good voice is the same harm `recommended` was kept out for. Between two
 * voices that stimmquelle names identically it is not a ranking at all but the
 * answer to a question the row otherwise leaves standing: why one Thorsten
 * costs 63 MB and the other 114. So it is said exactly where it decides
 * something, and nowhere else.
 *
 * Two buttons per row, still: hearing a voice and choosing it are two
 * different decisions, and the first must not commit to the second. That is
 * why the row is a wrapper and not itself the button mitreden makes it - a
 * button inside a button is not a thing a browser will render. */
function voiceRow(voice, note: string, mute: boolean, on: boolean,
                  shared: boolean) {
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
    // Beside the size rather than after the name, because the size is what it
    // explains.
    shared && voice.quality ? tierOf(voice.quality) : "",
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
  const marked = voices.chosen || voices.active;
  const box = document.createElement("div");
  box.className = "voices";
  box.setAttribute("role", "radiogroup");
  const hits = voices.voices.filter(matches);
  const twice = twiceNamed();
  for (const voice of hits) {
    box.appendChild(voiceRow(
      voice,
      !voices.chosen && voice.id === voices.active ? t("ui.voice_auto_note") : "",
      false, voice.id === marked, twice.has(voice.label)));
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
  if (voices.chosen && !voices.voices.some((v) => v.id === voices.chosen)) {
    box.appendChild(voiceRow(
      { id: voices.chosen, label: voices.chosenLabel || voices.chosen,
        language: "", source: "", gender: "", quality: "", downloadBytes: 0,
        needsKey: false },
      t("ui.voice_gone"), true, true, false));
  }
  renderOffer();
  // The standing rule, whether or not anything was just ticked: a voice is
  // part of what every sentence is spoken with, so changing it re-records all
  // of them rather than only the ones edited afterwards.
  $("voiceHint").textContent = fetchNote() || t("ui.voice_rebuild");
  paintVoiceState();
}

/* The voice panel's heading, folded: which voice, and the two facts that say
 * what kind of thing it is. Folded up this line is the whole answer to what
 * the panel is asked nine times out of ten - not "which voices are there" but
 * "which one is it speaking in". */
function paintVoiceState() {
  const id = voices.chosen || voices.active;
  const voice = voices.voices.find((v) => v.id === id);
  // The same name the row below uses when the voice is not here. Falling back
  // to the id put `azure:de-DE-KatjaNeural` in the one line that is the whole
  // answer nine times out of ten.
  $("voiceState").textContent = voice
    ? [voice.label, sourceOf(voice.source), speaks(voice.language)].filter(Boolean).join(" · ")
    : voices.chosenLabel || id || t("ui.voice_state_none");
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

// Ticks a row and writes it. There is no Save on this sheet any more, and a
// voice is no more dangerous than the text on a key - both are edits to the
// same layout, and that layout has been saving itself on a debounce for as
// long as it has existed. What a voice change costs is said where it is
// decided rather than guarded by a button: the hint under the list is the
// standing note that every recording is spoken again on the next release.
async function chooseVoice(id) {
  if (id === voices.chosen) return;
  state.layout.voice = id;
  voices.chosen = id;
  renderVoices();
  await save();
}

/* The one Save left, and it belongs to the Azure panel rather than the sheet.
 *
 * A key is the one field here that cannot be written as it is typed: half a
 * key is not a key, and the empty field has to keep meaning "leave the stored
 * one alone" rather than "drop it" - dropping it is the button beside this.
 *
 * The sheet stays open afterwards, and that was true before this was a panel
 * button: the whole point of the errand is to change where voices come from,
 * so the refreshed list and the panel's own state line are the answer, and
 * they are on the screen the question was asked from. */
export async function saveAzure() {
  let azureChanged = false;
  try {
    ({ azureChanged } = await saveSettings());
  } catch (error) {
    status(t("ui.save_failed", { error: reason(error) }));
    return;                       // stay open, the message is in the header
  }
  // A key that has just arrived can mean Azure voices that were not there
  // when the sheet opened - and one that has just been corrected can mean
  // rows that were missing come back.
  if (azureChanged) await loadVoices();
  renderVoices();
  // No paintStates() here: saveSettings() has already run renderSettings(),
  // which sets the Azure line and starts the probe that replaces it. Painting
  // again would put "stored" back on top of the probe's answer.
  status(t("ui.settings_saved"));
}

/* Switching language in place, which is what lets this sheet have no Save.
 *
 * It used to be a reload, and the reload was the reason for the Save: a page
 * that reloads on `change` throws away whatever is half-typed in the Azure
 * field two panels down. Nothing has to reload now - boot.ts holds both
 * tables, setLanguage() moves the two live bindings every label is read
 * through, and everything below re-reads them.
 *
 * The language also travels to the device, which is why it is written to the
 * layout rather than kept beside it. */
async function chooseLanguage(code: string) {
  if (!code || code === LANG) return;
  setLanguage(code);
  document.documentElement.lang = code;
  state.layout.language = code;
  // Every fixed label, then everything drawn from one: the board, the voice
  // list with its facts and filters, the settings panels' own state lines,
  // and the picker's source line.
  applyTexts();
  paintStates();
  renderVoices();
  renderBoard();
  showSources();
  await save();
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
  pick.onchange = () => { void chooseLanguage(pick.value); };

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
  $<HTMLSelectElement>("langPick").value = LANG;
  renderVoices();
  paintStates();
  // A download started before this dialog was opened - in another tab, or
  // before a reload - still has something to report.
  if (fetching.running) pollFetch();
}
