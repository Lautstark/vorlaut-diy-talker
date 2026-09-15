/* ----------------------------------------------------------- the views --- */

/**
 * Three things, one at a time: the door, the talker, and sending.
 *
 * **The door comes first because the cable does.** Every fact worth showing
 * about a talker - which build it runs, what it is holding, how much room is
 * left - is on the far end of a connection, and a page that asks for a file
 * before asking for the device spends four steps before it can say any of
 * them. adr/0017 already put the program and the content below the flow for
 * being "what somebody does once" rather than every time; this goes further
 * and says the flow is one of the things you do *to* a talker, not the page
 * itself.
 *
 * **The door is not a gate, and that distinction is the whole risk here.**
 * Web Serial is Chrome and Edge; so is showDirectoryPicker(). There is a
 * comment above gate() in page.ts about a version of this page that let a
 * Firefox reader spend the whole thing to learn the one fact that decided
 * whether it was any use to them, and a door saying "connect the talker" and
 * nothing else is that same page in a better shape. So the door carries a
 * second way in, and in a browser with no cable that way in is the primary
 * button.
 *
 * Swapped rather than hidden. A view that is not showing is not in the
 * document, so nothing in it can be found by a query, focused by a tab, or
 * read aloud - the same rule the step preview arrived at, applied to the page.
 */
import { t } from "./boot.js";
import { cableSupported } from "./cable.js";
import { connectDevice } from "./device.js";
import { firmwareVerdict } from "./firmware.js";
import { viewRoot } from "./page.js";
import { collections, collectionsSection, look } from "./collections.js";
import { firmware, firmwareSection } from "./program.js";
import { connectionWanting, held, steps, useViews, type Holding, type View } from "./state.js";
import { KIB } from "./words.js";

export function goTo(next: View): void {
  held.view = next;
  render();
}

export function render(): void {
  if (held.view === "door") doorView();
  else if (held.view === "talker") talkerView();
  else sendView();
}

/* -------------------------------------------------------------- door --- */

function doorView(): void {
  const card = document.createElement("section");
  card.className = "door";

  const title = document.createElement("h2");
  title.textContent = t("door.wake_title");
  const lead = document.createElement("p");
  lead.textContent = t("door.wake_lead");
  card.append(title, lead);

  if (cableSupported()) {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn primary";
    go.textContent = t("door.connect");
    go.onclick = () => void enterTalker(go);
    card.append(go);
  }

  /* The way past, and in a browser that cannot reach a cable it is the only
     way on - so there it is the primary button rather than a line under one. */
  const past = document.createElement("p");
  past.className = "door__past";
  const anyway = document.createElement("button");
  anyway.type = "button";
  anyway.className = cableSupported() ? "linklike" : "btn primary";
  anyway.textContent = t("door.without");
  anyway.onclick = () => goTo("send");
  past.append(anyway);
  card.append(past);

  const browsers = document.createElement("p");
  browsers.className = "door__browsers";
  browsers.textContent = t("door.browsers");
  card.append(browsers);

  viewRoot.replaceChildren(card);
}

/** The picker, from this click and with nothing waiting behind it.
 *
 * device.ts spells out why that matters: requestPort() needs transient
 * activation and Chrome expires it in about five seconds, so a picker opened
 * behind a build costs a build nobody asked for. At the door there is nothing
 * behind it at all, which is the shape that rule always wanted. */
async function enterTalker(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    if (connectionWanting()) {
      if (!await connectDevice()) return;   // dismissed: the door, unchanged
      held.askAgain = false;
    }
    held.onDevice = null;
    held.view = "talker";
    void look();                            // which draws the view as it goes
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------ talker --- */

/** Whether the page carries a newer build than the one the talker answered
 *  with. The one state that earns a mark on the fact strip. */
function firmwareBehind(): boolean {
  const word = held.deviceSays?.firmware || held.onDevice?.talker.firmware || "";
  if (!held.carried || !word) return false;
  return firmwareVerdict(word, held.carried.release) === "device_older";
}

/** What the talker is, in the three facts its greeting already carried.
 *
 * Always the same three and always in this order, so that after the first
 * reading they are found by position. Firmware first: it is the one of the
 * three that can be wrong without anything looking wrong. */
function factsStrip(on: Holding): HTMLElement {
  const list = document.createElement("dl");
  list.className = "facts";
  const add = (label: string, value: string, small?: string, mark = false) => {
    const box = document.createElement("div");
    box.className = "fact";
    const term = document.createElement("dt");
    term.textContent = label;
    const said = document.createElement("dd");
    said.textContent = value;
    if (small) {
      const quiet = document.createElement("small");
      quiet.textContent = ` ${small}`;
      said.append(quiet);
    }
    if (mark) {
      const dot = document.createElement("span");
      dot.className = "fact__dot";
      dot.setAttribute("aria-hidden", "true");
      said.append(dot);
    }
    box.append(term, said);
    list.append(box);
  };
  /* A build that names itself, or a dash. flash.device_unnamed is the sentence
     for the other case and it belongs in the panel below, where there is room
     to say what it means; a strip read at a glance gets the dash. */
  add(t("talker.fact_firmware"), on.talker.firmware || "-", undefined,
      firmwareBehind());
  add(t("talker.fact_collections"), String(on.on.length),
      t("talker.of", { n: on.talker.collections }));
  add(t("talker.fact_room"), String(KIB(on.free)), "KiB");
  return list;
}

function roomBar(on: Holding): HTMLElement[] {
  const used = Math.max(0, on.total - on.free);
  const bar = document.createElement("div");
  bar.className = "meter";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("i");
  fill.style.width = `${on.total ? Math.round((used / on.total) * 100) : 0}%`;
  bar.append(fill);
  const line = document.createElement("p");
  line.className = "aside";
  line.textContent = t("talker.used", { used: KIB(used), total: KIB(on.total) });
  return [bar, line];
}

function talkerView(): void {
  const parts: HTMLElement[] = [];
  const title = document.createElement("h2");
  title.className = "view__title";
  title.textContent = t("talker.title");
  parts.push(title);

  if (held.looking) {
    const line = document.createElement("p");
    line.className = "aside";
    line.textContent = t("cable.looking");
    viewRoot.replaceChildren(...parts, line);
    return;
  }

  if (held.lookFailed) {
    const line = document.createElement("p");
    line.className = "refuses";
    line.textContent = held.lookFailed;
    const row = document.createElement("div");
    row.className = "row";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn primary";
    again.textContent = t("talker.reconnect");
    again.onclick = () => void look();
    /* And the door, because "try again" is the wrong answer when the talker
       on the other end is not the one that was meant. */
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn quiet";
    back.textContent = t("door.connect");
    back.onclick = () => goTo("door");
    row.append(again, back);

    /* And the firmware section under it, which is not a consolation prize.
       A board with no program on it cannot answer - that is what having no
       program means - so "nothing answered" is the normal state of exactly the
       device the first flash exists for. A view that showed only the failure
       would put the one thing that helps behind a door that cannot open. */
    const under: HTMLElement[] = [];
    if (held.heard.length) {
      const log = document.createElement("pre");
      log.className = "log";
      log.textContent = held.heard.join("\n");
      under.push(log);
    }
    if (held.carried) {
      firmwareSection();
      under.push(firmware.root);
    }
    viewRoot.replaceChildren(...parts, line, row, ...under);
    return;
  }

  if (held.onDevice) parts.push(factsStrip(held.onDevice), ...roomBar(held.onDevice));

  /* The program above the content, which is the order the sections settled
     into before the views existed and for the same reason: what the talker is
     comes before what is on it. */
  if (held.carried) {
    firmwareSection();
    parts.push(firmware.root);
  }
  collectionsSection();
  parts.push(collections.root);

  const row = document.createElement("div");
  row.className = "row";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn primary";
  go.textContent = t("talker.send");
  go.onclick = () => goTo("send");
  row.append(go);
  parts.push(row);

  viewRoot.replaceChildren(...parts);
}

/* ------------------------------------------------------------ sending --- */

/** Where you are and the way back. A button rather than a link, because it
 *  goes nowhere - it swaps the view - which is the same reason .linklike
 *  exists at all. */
function crumb(): HTMLElement {
  const line = document.createElement("p");
  line.className = "crumb";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "linklike";
  back.textContent = t("talker.back");
  back.onclick = () => goTo("talker");
  const arrow = document.createElement("span");
  arrow.textContent = "›";
  arrow.setAttribute("aria-hidden", "true");
  const now = document.createElement("b");
  now.textContent = t("talker.sending");
  line.append(back, arrow, now);
  return line;
}

function sendView(): void {
  const parts: HTMLElement[] = [];
  /* Only where there is a talker to go back to. Somebody who came through the
     second door has no device and no view behind this one. */
  if (held.onDevice) parts.push(crumb(), factsStrip(held.onDevice));
  parts.push(steps.file.root, steps.check.root, steps.compile.root);
  /* The recovery surface, and only when it has something to ask for. */
  if (connectionWanting()) parts.push(steps.connect.root);
  parts.push(steps.send.root);
  viewRoot.replaceChildren(...parts);
}

// The modules that ask for a redraw get these two, once, at load.
useViews({ talker: talkerView, send: sendView });
