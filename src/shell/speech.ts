import { status} from "./dom.js";
import { reason } from "../core/errors.js";
import { synthesise } from "../backend/index.js";
import { t } from "../core/texts.js";

// A voice given here is listened to instead of the saved one - that is what
// lets the picker play a voice before it is chosen.
export async function speak(text: string, button: HTMLElement, voice?: string) {
  if (!text.trim()) { status(t("ui.need_text")); return; }
  // Nothing here refuses an empty layout.voice any more, and the sentence that
  // used to - "no voice chosen yet, pick one in the gear" - has gone with it.
  // An empty field is not the absence of an answer now: the Sammlung's
  // language picks one, the sheet marks it and says nobody chose it, and
  // synthesise() resolves the same default rather than sending an empty name
  // to the catalogue. Telling somebody to go and pick a voice while the gear
  // shows one ticked was the contradiction; the guard was written for the
  // nameless refusal underneath it, and there is no longer a path to it.
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
