import { status} from "./dom.js";
import { reason } from "../core/errors.js";
import { synthesise } from "../backend/index.js";
import { t } from "../core/texts.js";

// A voice given here is listened to instead of the saved one - that is what
// lets the picker play a voice before it is chosen.
export async function speak(text: string, button: HTMLElement, voice?: string) {
  if (!text.trim()) { status(t("ui.need_text")); return; }
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
