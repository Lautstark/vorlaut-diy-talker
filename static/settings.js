// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.
//
// This is the lower half of the settings sheet. The sheet itself, and its one
// Save, are in voices.js.
import { $, api, status } from "./dom.js";
import { t } from "./texts.js";

let settings = { azureKey: { set: false, hint: "" }, azureRegion: "",
                 metacom: { path: "", ok: false, count: 0, keywords: false,
                            fixed: false },
                 local: true };

function renderSettings() {
  $("azureRegion").value = settings.azureRegion || "";
  $("metacomPath").value = settings.metacom.path || "";
  $("azureKeyState").textContent = settings.azureKey.set
    ? t("ui.azure_key_set", { hint: settings.azureKey.hint })
    : t("ui.azure_key_none");
  // The key is never sent back to the page, so the field starts empty and
  // means "leave it alone" until somebody types in it.
  $("azureKey").value = "";
  $("azureKey").disabled = !settings.local;
  if (!settings.local) $("azureKeyState").textContent = t("ui.azure_local_only");

  const where = settings.metacom;
  const found = !where.path
    ? t("ui.metacom_none")
    : (where.ok
        ? t("ui.metacom_ok", {
            count: where.count,
            kind: t(where.keywords ? "ui.metacom_keywords" : "ui.metacom_names"),
          })
        : t("ui.metacom_bad"));
  // Handed in from outside - the container. The path in the field is the one
  // inside it, a host path typed here could not take effect, and the write
  // would land in the .env that the mount is read from. Same shape as the
  // Azure key above: disabled, and the line underneath says why rather than
  // leaving somebody to wonder at a save that changed nothing. What was found
  // stays in front of it either way - that half is worth reading regardless of
  // who may edit the path.
  $("metacomPath").disabled = !!where.fixed;
  $("metacomState").textContent = where.fixed
    ? `${found} - ${t("ui.metacom_fixed")}`
    : found;
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
