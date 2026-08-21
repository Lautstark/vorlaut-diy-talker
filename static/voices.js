// The chosen voice stands in layout.json next to the language and is saved
// with everything else. What can be spoken with here is a different question,
// answered by the server on every open: a key entered in the meantime, or a
// model that has arrived, should show up without reloading the page.
//
// This file also owns the settings sheet itself - opening it and its one Save
// - because that Save is mostly about the voice. The Azure and METACOM panel
// inside it is settings.js, which this calls into.
import { $, api, status } from "./dom.js";
import { LANG, LANGUAGES } from "./boot.js";
import { state } from "./state.js";
import { t } from "./texts.js";
import { save } from "./save.js";
import { speak } from "./speech.js";
import { loadSettings, saveSettings } from "./settings.js";

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

async function loadVoices() {
  try {
    voices = await (await api("/api/voices")).json();
  } catch (error) {
    status(t("ui.voice_failed", { error: error.message }));
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

function voiceRow(id, name, note, mute, on) {
  const row = document.createElement("div");
  row.className = "voiceRow" + (on ? " on" : "");

  const play = document.createElement("button");
  play.className = "play";
  play.textContent = "▶";
  play.title = t("ui.play_title");
  // Nothing to listen to for a voice that is not here. The button stays, so
  // the row keeps its shape, but it cannot be pressed.
  play.disabled = !!mute;
  // The voice of this row, not the saved one - otherwise trying one out would
  // mean committing to it first.
  play.onclick = () => speak(sampleText(), play, id || voices.active);

  const pick = document.createElement("button");
  pick.className = "pick";
  const naming = document.createElement("span");
  naming.textContent = name;
  pick.appendChild(naming);
  if (note) {
    const extra = document.createElement("span");
    extra.className = "note";
    extra.textContent = " " + note;
    pick.appendChild(extra);
  }
  pick.onclick = () => chooseVoice(id);

  row.appendChild(play);
  row.appendChild(pick);
  return row;
}

// The button that fetches what is missing. Sits under the list when there is
// one and in place of it when there is not - a machine that cannot speak at
// all should not have to be told about a command line.
function fetchRow() {
  const row = document.createElement("div");
  row.className = "voiceRow empty";
  const button = document.createElement("button");
  button.textContent = t("ui.voice_fetch");
  button.disabled = fetching.running;
  button.onclick = startFetch;
  row.appendChild(button);
  return row;
}

function renderVoices() {
  const list = $("voiceList");
  list.innerHTML = "";
  if (!voices.voices.length) {
    const empty = document.createElement("div");
    empty.className = "voiceRow empty";
    empty.textContent = t("ui.voice_none");
    list.appendChild(empty);
    if (fetching.missing) list.appendChild(fetchRow());
    $("voiceHint").textContent = fetchNote() || t("ui.voice_none_hint");
    return;
  }
  // An empty entry in layout.json means "whatever works here", and that is
  // the normal case for a fresh one. It is not shown as a choice of its own:
  // "Automatic" tells nobody anything, and a row that has to explain itself
  // is a row too many. Instead the voice it comes out as stands marked, with
  // a word to say nobody picked it by hand. Choosing any row writes it down,
  // and from then on the layout carries a decision instead of a default.
  const marked = pendingVoice || voices.active;
  for (const voice of voices.voices) {
    list.appendChild(voiceRow(
      voice.id, voice.label,
      !pendingVoice && voice.id === voices.active ? t("ui.voice_auto_note") : "",
      false, voice.id === marked));
  }
  // A voice can be chosen and not be here: a key withdrawn, a model deleted,
  // a layout carried over from another machine. It stays chosen on purpose -
  // so it has to be visible, or the list would show nothing as chosen and the
  // next save would quietly drop a deliberate decision.
  if (pendingVoice && !voices.voices.some((v) => v.id === pendingVoice)) {
    list.appendChild(voiceRow(pendingVoice, pendingVoice,
                              t("ui.voice_gone"), true, true));
  }
  if (fetching.missing) list.appendChild(fetchRow());
  $("voiceHint").textContent = fetchNote() || t("ui.voice_rebuild");
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
    fetching = await (await api("/api/voices/fetch")).json();
  } catch (error) {
    fetching = { running: false, done: 0, total: 0, name: "",
                 error: error.message, missing: 0 };
  }
}

async function startFetch() {
  fetchDone = false;
  try {
    await api("/api/voices/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
    fetching.error = error.message;
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
  try {
    await saveSettings();
  } catch (error) {
    status(t("ui.save_failed", { error: error.message }));
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
  status(t("ui.settings_saved"));
  $("voices").close();
}

// The options name themselves: "Deutsch" stays "Deutsch" whatever the page is
// set to. That is the point of them here - this is the one control somebody
// reaches for when they cannot read the interface around it, so it must not
// depend on being able to read the interface around it. In the header it was
// "DE"/"EN", because the full words cost a third of the bar on a phone; in a
// dialog there is room to say it properly.
export function wireLanguage() {
  const pick = $("langPick");
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
}

export async function openVoices() {
  $("voiceList").innerHTML = "";
  $("voiceHint").textContent = "";
  fetchDone = false;
  $("voices").showModal();
  await Promise.all([loadVoices(), readFetch(), loadSettings()]);
  pendingVoice = voices.chosen;
  // Reopening after Cancel has to show the language the page is actually in,
  // not the one that was picked and then dropped.
  pendingLanguage = LANG;
  $("langPick").value = LANG;
  renderVoices();
  // A download started before this dialog was opened - in another tab, or
  // before a reload - still has something to report.
  if (fetching.running) pollFetch();
}
