import { api, status } from "./dom.js";
import { t } from "./texts.js";

// A voice given here is listened to instead of the saved one - that is what
// lets the picker play a voice before it is chosen.
export async function speak(text, button, voice) {
  if (!text.trim()) { status(t("ui.need_text")); return; }
  const before = button.textContent;
  button.textContent = "···";
  try {
    const response = await api("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voice || "" }),
    });
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    status("");
  } catch (error) {
    status(t("ui.play_failed", { error: error.message }));
  } finally {
    button.textContent = before;
  }
}
