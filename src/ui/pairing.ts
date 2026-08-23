// A talker showing five digits wants its key. The boxes stand where the keys
// stand - set key on the left under the speaker, 1 and 2 above it, 3 and 4
// below - so nobody has to be told an order. As one string the code runs
// key1 key2 key3 key4 setkey; that order is the whole agreement with the
// device, and it is written down in docs/software.md.
import { $, status} from "./dom.js";
import { reason } from "../core/errors.js";
import { pairState, confirmPairCode } from "../backend/index.js";
import { t } from "../core/texts.js";

const PAIR_ORDER = ["1", "2", "3", "4", "S"];
let pairBoxes = [];
let pairShown = false;

function buildPairKeys() {
  const grid = $("pairKeys");
  grid.innerHTML = "";
  pairBoxes = PAIR_ORDER.map(() => {
    const box = document.createElement("input");
    box.className = "field";
    box.type = "text";
    box.inputMode = "numeric";
    box.maxLength = 1;
    box.autocomplete = "off";
    // Typing runs on by itself, and a backspace on an empty box steps back -
    // five separate fields should not mean five separate clicks.
    box.oninput = () => {
      box.value = box.value.replace(/[^0-9]/g, "").slice(0, 1);
      if (box.value) {
        const next = pairBoxes[pairBoxes.indexOf(box) + 1];
        if (next) next.focus();
      }
    };
    box.onkeydown = (event) => {
      if (event.key === "Backspace" && !box.value) {
        const previous = pairBoxes[pairBoxes.indexOf(box) - 1];
        if (previous) { previous.focus(); event.preventDefault(); }
      }
      if (event.key === "Enter") confirmPair();
    };
    return box;
  });

  // The set key first: it is the left-hand column and spans both rows, the
  // same shape the editor draws above.
  const setBox = document.createElement("div");
  setBox.className = "setBox";
  setBox.appendChild(pairBoxes[4]);
  grid.appendChild(setBox);
  for (let i = 0; i < 4; i++) grid.appendChild(pairBoxes[i]);
}

function pairCode() {
  return pairBoxes.map((box) => box.value).join("");
}

export async function confirmPair() {
  const code = pairCode();
  if (code.length !== PAIR_ORDER.length) return;
  $("pairError").textContent = "";
  try {
    const answer = await confirmPairCode(code);
    if (!answer.ok) {
      $("pairError").textContent = answer.left
        ? answer.error + " (" + t("ui.pair_left", { left: answer.left }) + ")"
        : answer.error;
      pairBoxes.forEach((box) => { box.value = ""; });
      pairBoxes[0].focus();
      return;
    }
    hidePair();
    status(t("ui.pair_done"));
  } catch (error) {
    $("pairError").textContent = t("ui.pair_failed", { error: reason(error) });
  }
}

function hidePair() {
  pairShown = false;
  $("pairing").classList.remove("show");
}

// Asked for regularly, because nobody tells the page that somebody has just
// walked up to the talker and started a pairing.
//
// Deliberately without a check on document.hidden. It would save a few bytes
// on a local network and buy a failure that looks like nothing at all: a page
// the browser considers hidden - a second window, another desktop - would sit
// there while somebody stands at the device reading out digits.
export async function watchPair() {
  try {
    const answer = await pairState();
    const waiting = (answer.waiting || []).length > 0;
    if (waiting && !pairShown) {
      pairShown = true;
      buildPairKeys();
      $("pairError").textContent = "";
      $("pairing").classList.add("show");
      pairBoxes[0].focus();
    } else if (!waiting && pairShown) {
      // Gave up at the device, or the code ran out.
      hidePair();
    }
  } catch (error) {
    // A pairing nobody can ask about is not worth an error on screen.
  }
  setTimeout(watchPair, 5000);
}
