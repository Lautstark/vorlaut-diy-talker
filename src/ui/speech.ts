import { status} from "./dom.js";
import { reason } from "../core/errors.js";
import { synthesise } from "../backend/index.js";
import { state } from "../core/state.js";
import { t } from "../core/texts.js";

// A voice given here is listened to instead of the saved one - that is what
// lets the picker play a voice before it is chosen.
export async function speak(text: string, button: HTMLElement, voice?: string) {
  if (!text.trim()) { status(t("ui.need_text")); return; }
  // No voice anywhere is an answer the page can give itself, and should: sent
  // on, it comes back as the catalogue refusing an empty name, which reads as
  // a fault rather than as the one thing left to do.
  if (!voice && !state.layout.voice) { status(t("ui.no_voice_yet")); return; }
  const before = button.textContent;
  button.textContent = "···";
  try {
    const url = URL.createObjectURL(await synthesise(text, voice));
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    status("");
  } catch (error) {
    status(t("ui.play_failed", { error: reason(error) }));
  } finally {
    button.textContent = before;
  }
}
