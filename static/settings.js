// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.
//
// This is the lower half of the settings sheet. The sheet itself, and its one
// Save, are in voices.js.
import { $, api, status } from "./dom.js";
import { t } from "./texts.js";

let settings = { azureKey: { set: false, hint: "" }, azureRegion: "",
                 metacom: { path: "", ok: false, count: 0, keywords: false },
                 local: true };

// What a stored key looks like in the field: the four characters it ends in,
// behind enough dots to read as a secret. It is the placeholder and not the
// value, which is the point - the field stays empty, so it still means "leave
// the key alone" and there is nothing here to submit, copy or mistake for the
// key itself. Typing replaces it the way typing replaces any placeholder.
const MASK = "\u2022\u2022\u2022\u2022";

function keyPlaceholder() {
  if (!settings.azureKey.set) return t("ui.azure_key_placeholder");
  // Away from the machine itself the last four are not handed over - see
  // settings_state() in app.py. Then the dots alone say a key is there.
  return MASK + (settings.azureKey.hint || MASK);
}

function renderSettings() {
  $("azureRegion").value = settings.azureRegion || "";
  $("metacomPath").value = settings.metacom.path || "";
  // The key is never sent back to the page, so the field starts empty and
  // means "leave it alone" until somebody types in it.
  $("azureKey").value = "";
  $("azureKey").placeholder = keyPlaceholder();
  $("azureKey").disabled = !settings.local;
  // Only the one thing the field cannot show by itself. That a key is stored,
  // and which one, is in the placeholder above and in the heading below.
  $("azureKeyState").textContent = settings.local ? "" : t("ui.azure_local_only");
  $("azureState").textContent = settings.azureKey.set
    ? t("ui.azure_key_stored")
    : t("ui.azure_key_none");

  $("metacomState").textContent = metacomWord(false);
  $("symbolsState").textContent = metacomWord(true);
  // A folder that was set and cannot be read is the one state worth unfolding
  // for: somebody meant to configure this and it is not working.
  if (settings.metacom.path && !settings.metacom.ok) $("symbolsPanel").open = true;
}

// Where the symbols come from, in one line. Twice over, because the heading
// has room for two words and the line under the field has room for a
// sentence - and only the "nothing set" case differs between the two.
function metacomWord(short) {
  const where = settings.metacom;
  if (!where.path) return t(short ? "ui.metacom_short_none" : "ui.metacom_none");
  if (!where.ok) return t("ui.metacom_bad");
  return t("ui.metacom_ok", {
    count: where.count,
    kind: t(where.keywords ? "ui.metacom_keywords" : "ui.metacom_names"),
  });
}

export async function loadSettings() {
  try {
    settings = await (await api("/api/settings")).json();
    renderSettings();
  } catch (error) {
    status(t("ui.voice_failed", { error: error.message }));
  }
}

export async function saveSettings() {
  const wanted = {
    azureRegion: $("azureRegion").value.trim(),
    metacom: $("metacomPath").value.trim(),
  };
  // Only when something was typed: an untouched field must not wipe the key.
  const typed = $("azureKey").value.trim();
  if (typed) wanted.azureKey = typed;
  const answer = await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wanted),
  });
  settings = await answer.json();
  renderSettings();
}
