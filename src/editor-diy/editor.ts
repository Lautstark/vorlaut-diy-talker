// The five-key talker's editor: the set tabs, the set tile and the four speech
// keys - everything the page shows when no dialog is open - and the
// drag-and-drop that reorders it.
//
// This is the device-specific half. Four keys to a set, at most five sets on
// the device at once, a colour drawn round all five displays: none of that is
// true of AAC in general and all of it is true of this hardware, which is why
// it sits under editor-diy/ and why nothing in the shell may import it. The
// shell reaches it through core/editor.ts instead, and `diy` at the foot of
// this file is what it reaches.
//
// dragSet, dragSlot, armedSlot, preview and `current` live here and nowhere
// else.
import { $, status } from "../shell/dom.js";
import { previewInto, symbolInto } from "../backend/index.js";
import { state } from "../core/state.js";
import type { Editor } from "../core/editor.js";
import type { Layout } from "../core/types.js";
import { limits, palette } from "../core/boot.js";
import { t } from "../core/texts.js";
import { save, saveSoon } from "../core/save.js";
import { speak } from "../shell/speech.js";
import { openPicker } from "../shell/picker.js";

let dragSet = null;         // index of the dragged set
let dragSlot = null;        // index of the dragged key
let armedSlot = null;       // index of the key a keyboard swap starts from
let preview = false;        // show tiles the way the display shows them
/* Which set is being edited. It was `state.current` while the page held one
 * board and every module that touched a set index was allowed to know about
 * it. Now it is an index into whichever board is open, so it belongs to the
 * thing that draws the sets, and it is reset by adopt() rather than clamped by
 * the save loop. */
let current = 0;

// Cached rather than looked up: render() moves this button into the set
// column on every pass, so it has to be the same element each time.
const removeSetBtn = $<HTMLButtonElement>("removeSet");

function clearDragMarks() {
  document.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
}

// Lets go of a half-done keyboard swap. Told to the status line as well,
// because arming moves nothing on the page that eyes-free users would hear.
function disarmSwap() {
  armedSlot = null;
  document.querySelectorAll(".grip.armed").forEach((el) => {
    el.classList.remove("armed");
    el.setAttribute("aria-pressed", "false");
  });
  status("");
}

// Where a set lands, whether dropped or moved by Alt+Arrow. The moved set
// becomes the edited one, as it always has on drop; focus follows its tab
// because render() rebuilds the row, and the keyboard would otherwise be
// left standing on nothing.
async function moveSet(from, to) {
  const moved = state.layout.sets.splice(from, 1)[0];
  state.layout.sets.splice(to, 0, moved);
  current = to;
  await save();
  render();
  ($("tabs").children[to] as HTMLElement).focus();
}

// Where a swap of two speech keys lands, whether dropped or completed by the
// second Enter on a grip.
async function swapSlots(slots, a, b) {
  [slots[a], slots[b]] = [slots[b], slots[a]];
  await save();
  render();
}

function activeCount() {
  return state.layout.sets.filter((s) => s.active !== false).length;
}

function emptySet(index, active) {
  return {
    name: "Set " + (index + 1),
    active: !!active,
    symbol: "",
    color: palette[index % palette.length],
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  };
}

// The visible area of the ScreenKeys is only 15.21 mm. Whether a pictogram
// is recognisable on it shows only at this size - and shown the way the
// display shows it: scaled to 116x116 and rounded to RGB565.
//
// The large tile above deliberately stays the source image. It is there for
// picking and should be sharp.
function actualSize(symbol, colour) {
  const line = document.createElement("div");
  line.className = "actualSize";
  const image = document.createElement("img");
  previewInto(image, symbol, colour);
  line.append(image, document.createTextNode(t("ui.device_size")));
  return line;
}

// Built rather than written out as markup. The parts handed in come from
// layout.json, and a value out of there has no business being parsed as HTML -
// the same reason picker.js gives its captions textContent.
function placeholder(...parts) {
  // A span, not a div: this lands inside the thumb, which is a <button> now,
  // and phrasing content is all a button may hold. The thumb is a flex box,
  // so the span is blockified and text-align centres it all the same.
  const line = document.createElement("span");
  line.className = "blank";
  line.append(...parts);
  return line;
}

function thumb(symbol, onClick) {
  const box = document.createElement("button");
  box.className = "thumb";
  box.setAttribute("aria-label", t("ui.pick_symbol"));
  if (symbol) {
    const image = document.createElement("img");
    symbolInto(image, symbol);
    image.onerror = () => {
      // Two different absences. A metacom: reference resolves out of the
      // licensed folder, so its picture being unreachable means the folder is
      // not connected in this browser - remediable in the gear, and the words
      // should point there. Anything else is a file this browser's store does
      // not hold, which is what a board imported from elsewhere looks like.
      const why = symbol.startsWith("metacom:")
        ? t("ui.symbol_needs_folder") : t("ui.symbol_missing");
      box.replaceChildren(placeholder(symbol, document.createElement("br"), why));
    };
    box.appendChild(image);
  } else {
    box.appendChild(placeholder(t("ui.no_symbol")));
  }
  box.onclick = onClick;
  return box;
}

export function render() {
  // A half-done keyboard swap does not survive a re-render: the grip that
  // carried the mark is thrown away with the rest of the DOM, and the set it
  // counted in may be gone too.
  armedSlot = null;
  const tabs = $("tabs");
  tabs.innerHTML = "";
  state.layout.sets.forEach((entry, index) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (index === current ? " active" : "")
                  + (entry.active === false ? " off" : "");
    tab.title = entry.active === false ? t("ui.tab_off") : t("ui.tab_on");
    tab.style.borderColor = index === current ? entry.color : "transparent";
    const dot = document.createElement("span");
    dot.className = "dot";
    // A property, not a composed style="..." attribute: entry.color is
    // whatever was last typed into the hex field. The line above already
    // does it this way.
    dot.style.background = entry.color;
    tab.appendChild(dot);
    tab.append(entry.name || t("ui.set_n", { n: index + 1 }));
    const open = () => { current = index; render(); };
    tab.onclick = open;
    // Not a <button>, although it is pressed like one: the tab is dragged to
    // reorder, and engines disagree on what dragging a button means. So the
    // div stays, and the two things the element would have brought - a place
    // in the tab order, acting on Enter and Space - are written out.
    tab.setAttribute("role", "button");
    tab.tabIndex = 0;
    if (index === current) tab.setAttribute("aria-current", "true");
    tab.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
    tab.onkeydown = (event) => {
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        // Claimed even when the move has nowhere to go: Alt+Left is history
        // back in some engines, and reordering must never walk off the page.
        event.preventDefault();
        const to = index + (event.key === "ArrowRight" ? 1 : -1);
        if (to >= 0 && to < state.layout.sets.length) moveSet(index, to);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    };

    // Reorder sets: the order determines how the set key cycles through.
    tab.draggable = true;
    tab.ondragstart = (event) => {
      dragSet = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    };
    tab.ondragover = (event) => {
      if (dragSet === null || dragSet === index) return;
      event.preventDefault();
      tab.classList.add("dragover");
    };
    tab.ondragleave = () => tab.classList.remove("dragover");
    tab.ondrop = async (event) => {
      event.preventDefault();
      clearDragMarks();
      if (dragSet === null || dragSet === index) return;
      const from = dragSet;
      dragSet = null;
      await moveSet(from, index);
    };
    tab.ondragend = () => { dragSet = null; clearDragMarks(); };

    tabs.appendChild(tab);
  });
  if (state.layout.sets.length < limits.maxSets) {
    const add = document.createElement("button");
    add.className = "tab add";
    add.textContent = t("ui.add_set");
    add.onclick = async () => {
      // A new set is active straight away only when a slot is still free -
      // otherwise the layout could not be saved at all.
      state.layout.sets.push(
        emptySet(state.layout.sets.length, activeCount() < limits.maxActive));
      current = state.layout.sets.length - 1;
      await save();
      render();
    };
    tabs.appendChild(add);
  }

  const used = activeCount();
  $("slots").classList.toggle("warn", used === 0 && state.layout.sets.length > 0);
  $("slots").textContent = used === 0 && state.layout.sets.length > 0
    ? t("ui.none_active", { n: state.layout.sets.length })
    : t("ui.slots_used", { used: used, max: limits.maxActive })
      + (state.layout.sets.length > used
         ? "  ·  " + t("ui.sets_created", { n: state.layout.sets.length }) : "");

  const device = $("device");
  device.innerHTML = "";
  removeSetBtn.style.display = state.layout.sets.length ? "" : "none";
  const entry = state.layout.sets[current];
  if (!entry) {
    device.innerHTML = '<p style="color:var(--muted)"></p>';
    device.firstChild.textContent = t("ui.no_sets");
    return;
  }
  const color = entry.color;

  // Set tile on the left, then the four speech keys in a 2x2 grid.
  const setCol = document.createElement("div");
  setCol.className = "setCol";
  const setTile = document.createElement("div");
  setTile.className = "tile setTile";
  setTile.style.borderColor = color;
  const setLabel = document.createElement("div");
  setLabel.className = "slotNr";
  setLabel.textContent = t("ui.set_key");
  setTile.appendChild(setLabel);
  setTile.appendChild(thumb(entry.symbol, () => openPicker({
    seed: entry.name,
    // What the picker does with a chosen symbol is handed to it rather than
    // read out of the layout by it - it has no idea what a set is, and the
    // dialog is the shell's. Only prefill an empty field, never overwrite
    // anything: the symbol is called "zustimmen", but your key should say
    // "Ja!".
    apply: async (symbol, label) => {
      entry.symbol = symbol;
      if (label && !entry.name.trim()) entry.name = label;
      await save();
      render();
    },
  })));

  if (preview) setTile.appendChild(actualSize(entry.symbol, color));

  const nameInput = document.createElement("input");
  nameInput.className = "field";
  nameInput.type = "text";
  nameInput.value = entry.name;
  nameInput.placeholder = t("ui.set_name");
  nameInput.oninput = () => { entry.name = nameInput.value; saveSoon(); renderTabsOnly(); };
  setTile.appendChild(nameInput);

  // Only five sets fit onto the device - creating more is allowed. This
  // switch decides which of them come along.
  const activeToggle = document.createElement("label");
  activeToggle.className = "toggle onDevice";
  // Short, because the device-preview switch sits right next to it - the same
  // word twice in one view reads like the same thing. The title says what it
  // means.
  activeToggle.title = t("ui.active_title", { max: limits.maxActive });
  const activeBox = document.createElement("input");
  activeBox.type = "checkbox";
  activeBox.checked = entry.active !== false;
  const activePill = document.createElement("span");
  activePill.className = "pill";
  activeToggle.append(activeBox, activePill, document.createTextNode(t("ui.active")));
  activeBox.onchange = async () => {
    if (activeBox.checked && activeCount() >= limits.maxActive) {
      activeBox.checked = false;
      status(t("ui.active_full", { max: limits.maxActive }));
      return;
    }
    entry.active = activeBox.checked;
    await save();
    status("");
    render();
  };

  const colorRow = document.createElement("div");
  colorRow.className = "colorRow";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = color;
  colorInput.title = t("ui.colour_title");
  const hexInput = document.createElement("input");
  hexInput.className = "field";
  hexInput.type = "text";
  hexInput.value = color;
  const applyColor = (value) => {
    entry.color = value.toUpperCase();
    saveSoon();
    render();
  };
  colorInput.oninput = () => applyColor(colorInput.value);
  hexInput.onchange = () => applyColor(hexInput.value);
  colorRow.append(colorInput, hexInput);
  setTile.appendChild(colorRow);

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  palette.forEach((hex) => {
    const swatch = document.createElement("button");
    const isActive = hex.toUpperCase() === (color || "").toUpperCase();
    swatch.className = "swatch" + (isActive ? " active" : "");
    swatch.setAttribute("aria-pressed", String(isActive));
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.onclick = () => applyColor(hex);
    swatches.appendChild(swatch);
  });
  // Directly below the name field: the quick picks are the normal case, the
  // colour picker below them the exception.
  setTile.insertBefore(swatches, colorRow);

  // At the very bottom and set apart: name and colour describe the set,
  // "Aktiv" decides what happens to it - the same corner as the delete button
  // below. Deliberately not in its red: switching off is reversible.
  const activeRow = document.createElement("div");
  activeRow.className = "activeRow";
  activeRow.appendChild(activeToggle);
  if (entry.active === false) {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = t("ui.ready_not_on_device");
    activeRow.appendChild(note);
  }
  setTile.appendChild(activeRow);

  setCol.append(setTile, removeSetBtn);
  device.appendChild(setCol);

  entry.slots.forEach((slot, index) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.style.borderColor = color;

    const caption = document.createElement("div");
    caption.className = "slotNr";
    caption.textContent = t("ui.key_n", { n: index + 1 });

    // Swap keys: in the fixed 2x2 grid swapping is less ambiguous than
    // inserting - the other key moves exactly where this one came from.
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "\u283F";
    grip.title = t("ui.grip_title");
    // The same hand-made button-ness as the tabs above, for the same reason:
    // the grip is dragged, so it cannot be a <button>. Enter arms a swap and
    // Enter on another key's grip completes it - the two ends of what the
    // mouse holds down and lets go of. Escape lets go without swapping.
    grip.setAttribute("role", "button");
    grip.tabIndex = 0;
    grip.setAttribute("aria-label", t("ui.grip_label", { n: index + 1 }));
    grip.setAttribute("aria-pressed", "false");
    grip.onkeydown = async (event) => {
      if (event.key === "Escape" && armedSlot !== null) {
        event.preventDefault();
        disarmSwap();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (armedSlot === null) {
        armedSlot = index;
        grip.classList.add("armed");
        grip.setAttribute("aria-pressed", "true");
        status(t("ui.swap_armed", { n: index + 1 }));
      } else if (armedSlot === index) {
        disarmSwap();
      } else {
        const from = armedSlot;
        armedSlot = null;
        await swapSlots(entry.slots, from, index);
        // The armed key sits at this index now; focus lands on the grip
        // that would move it again.
        document.querySelectorAll<HTMLElement>("#device .grip")[index].focus();
      }
    };
    grip.draggable = true;
    grip.ondragstart = (event) => {
      dragSlot = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      event.dataTransfer.setDragImage(tile, 40, 40);
    };
    grip.ondragend = () => { dragSlot = null; clearDragMarks(); };
    caption.appendChild(grip);
    tile.appendChild(caption);

    tile.ondragover = (event) => {
      if (dragSlot === null || dragSlot === index) return;
      event.preventDefault();
      tile.classList.add("dragover");
    };
    tile.ondragleave = () => tile.classList.remove("dragover");
    tile.ondrop = async (event) => {
      event.preventDefault();
      clearDragMarks();
      if (dragSlot === null || dragSlot === index) return;
      const from = dragSlot;
      dragSlot = null;
      await swapSlots(entry.slots, from, index);
    };

    tile.appendChild(thumb(slot.symbol, () => openPicker({
      seed: slot.text,
      apply: async (symbol, label) => {
        slot.symbol = symbol;
        if (label && !slot.text.trim()) slot.text = label;
        await save();
        render();
      },
    })));

    const row = document.createElement("div");
    row.className = "row";
    const textInput = document.createElement("input");
    textInput.className = "field";
    textInput.type = "text";
    textInput.value = slot.text;
    textInput.placeholder = t("ui.text_placeholder");
    textInput.oninput = () => { slot.text = textInput.value; saveSoon(); };
    const playBtn = document.createElement("button");
    playBtn.className = "btn play";
    playBtn.textContent = "▶";
    playBtn.title = t("ui.play_title");
    playBtn.onclick = () => speak(slot.text, playBtn);
    row.append(textInput, playBtn);
    tile.appendChild(row);

    if (preview) tile.appendChild(actualSize(slot.symbol, color));
    device.appendChild(tile);
  });
}

export function renderTabsOnly() {
  state.layout.sets.forEach((entry, index) => {
    const tab = $("tabs").children[index];
    if (tab) { tab.lastChild.textContent = entry.name || t("ui.set_n", { n: index + 1 }); }
  });
}

// The two controls that belong to the editor rather than to any dialog.
export function wireEditor() {
  $<HTMLInputElement>("previewToggle").onchange = () => {
    preview = $<HTMLInputElement>("previewToggle").checked;
    render();
  };

  removeSetBtn.onclick = async () => {
    if (!state.layout.sets.length) return;
    if (!confirm(t("ui.confirm_delete",
                   { name: state.layout.sets[current].name || "" }))) return;
    state.layout.sets.splice(current, 1);
    current = Math.max(0, current - 1);
    await save();
    render();
  };
}

/* What the shell is handed, and the whole of what it may ask for.
 *
 * Five methods, and each one is a question the shell has that only the device
 * can answer - see core/editor.ts for what each is and why it is not a general
 * "do something to the board" hook. app.ts installs this object; nothing in
 * src/shell/ imports this file, and tests/unit/layers.test.ts is what says so.
 */
export const diy: Editor = {
  /* What a new board starts as, and it is a fact about this hardware: one set
   * of four empty keys, in the first colour of the palette. app.py seeded
   * content/ from example/ so that nobody met an empty screen; this is that
   * idea at its smallest, because the examples are pictures and recordings
   * that would have to be fetched, and an empty board somebody can type into
   * is worth more than a wait. */
  blank(): Layout {
    return {
      sleep_timeout_seconds: 600,
      language: "de",
      sets: [{
        name: "",
        symbol: "",
        color: palette[0]!,
        active: true,
        slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
      }],
    };
  },

  /* A different board is in force. Back to its first set rather than clamped
   * to where the last board happened to be standing: set three of the kitchen
   * board and set three of the nursery board have nothing to do with each
   * other, and landing on one because the other was open reads as the page
   * having lost its place. */
  adopt(): void {
    current = 0;
    render();
  },

  render,

  /* A sentence somebody actually wrote, from the set on screen, so that trying
   * a voice out is heard on the content rather than on a specimen. "" when
   * this board has nothing typed on it yet; the settings sheet has its own
   * specimen for that, in the reader's language, which is not this file's to
   * choose. */
  sample(): string {
    const set = state.layout.sets[current];
    const slot = (set ? set.slots || [] : []).find((entry) => (entry.text || "").trim());
    return slot ? slot.text.trim() : "";
  },

  /* The fixed words on the controls this editor owns. They sit in the header
   * and in the board, and they are re-read on every language switch like every
   * other label - applyTexts() calls this rather than naming these five ids
   * itself. */
  labels(): void {
    $("previewLabel").title = t("ui.preview_title");
    $("previewText").textContent = t("ui.preview");
    $<HTMLButtonElement>("releaseBtn").textContent = t("ui.release");
    $<HTMLButtonElement>("releaseStop").textContent = t("ui.stop");
    removeSetBtn.textContent = t("ui.remove_set");
  },
};
