// The set tabs, the set tile and the four speech keys - everything the page
// shows when no dialog is open, and the drag-and-drop that reorders it.
//
// dragSet, dragSlot and preview live here and nowhere else.
import { $, status } from "./dom.js";
import { previewInto, symbolInto } from "../backend/index.js";
import { state } from "../core/state.js";
import { limits, palette } from "../core/boot.js";
import { t } from "../core/texts.js";
import { save, saveSoon } from "../core/save.js";
import { speak } from "./speech.js";
import { openPicker } from "./picker.js";

let dragSet = null;         // index of the dragged set
let dragSlot = null;        // index of the dragged key
let preview = false;        // show tiles the way the display shows them

// Cached rather than looked up: render() moves this button into the set
// column on every pass, so it has to be the same element each time.
const removeSetBtn = $<HTMLButtonElement>("removeSet");

function clearDragMarks() {
  document.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
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
  const line = document.createElement("div");
  line.className = "empty";
  line.append(...parts);
  return line;
}

function thumb(symbol, onClick) {
  const box = document.createElement("div");
  box.className = "thumb";
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
  const tabs = $("tabs");
  tabs.innerHTML = "";
  state.layout.sets.forEach((entry, index) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (index === state.current ? " active" : "")
                  + (entry.active === false ? " off" : "");
    tab.title = entry.active === false ? t("ui.tab_off") : t("ui.tab_on");
    tab.style.borderColor = index === state.current ? entry.color : "transparent";
    const dot = document.createElement("span");
    dot.className = "dot";
    // A property, not a composed style="..." attribute: entry.color is
    // whatever was last typed into the hex field. The line above already
    // does it this way.
    dot.style.background = entry.color;
    tab.appendChild(dot);
    tab.append(entry.name || t("ui.set_n", { n: index + 1 }));
    tab.onclick = () => { state.current = index; render(); };

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
      const moved = state.layout.sets.splice(dragSet, 1)[0];
      state.layout.sets.splice(index, 0, moved);
      state.current = index;
      dragSet = null;
      await save();
      render();
    };
    tab.ondragend = () => { dragSet = null; clearDragMarks(); };

    tabs.appendChild(tab);
  });
  if (state.layout.sets.length < limits.maxSets) {
    const add = document.createElement("div");
    add.className = "tab add";
    add.textContent = t("ui.add_set");
    add.onclick = async () => {
      // A new set is active straight away only when a slot is still free -
      // otherwise the layout could not be saved at all.
      state.layout.sets.push(
        emptySet(state.layout.sets.length, activeCount() < limits.maxActive));
      state.current = state.layout.sets.length - 1;
      await save();
      render();
    };
    tabs.appendChild(add);
  }

  const used = activeCount();
  $("slots").classList.toggle("empty", used === 0 && state.layout.sets.length > 0);
  $("slots").textContent = used === 0 && state.layout.sets.length > 0
    ? t("ui.none_active", { n: state.layout.sets.length })
    : t("ui.slots_used", { used: used, max: limits.maxActive })
      + (state.layout.sets.length > used
         ? "  ·  " + t("ui.sets_created", { n: state.layout.sets.length }) : "");

  const device = $("device");
  device.innerHTML = "";
  removeSetBtn.style.display = state.layout.sets.length ? "" : "none";
  const entry = state.layout.sets[state.current];
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
  setTile.appendChild(thumb(entry.symbol, () => openPicker({ kind: "set" }, entry.name)));

  if (preview) setTile.appendChild(actualSize(entry.symbol, color));

  const nameInput = document.createElement("input");
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
    const swatch = document.createElement("span");
    const isActive = hex.toUpperCase() === (color || "").toUpperCase();
    swatch.className = "swatch" + (isActive ? " active" : "");
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
      const slots = entry.slots;
      [slots[dragSlot], slots[index]] = [slots[index], slots[dragSlot]];
      dragSlot = null;
      await save();
      render();
    };

    tile.appendChild(thumb(slot.symbol, () => openPicker({ kind: "slot", index }, slot.text)));

    const row = document.createElement("div");
    row.className = "row";
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = slot.text;
    textInput.placeholder = t("ui.text_placeholder");
    textInput.oninput = () => { slot.text = textInput.value; saveSoon(); };
    const playBtn = document.createElement("button");
    playBtn.className = "play";
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
                   { name: state.layout.sets[state.current].name || "" }))) return;
    state.layout.sets.splice(state.current, 1);
    state.current = Math.max(0, state.current - 1);
    await save();
    render();
  };
}
