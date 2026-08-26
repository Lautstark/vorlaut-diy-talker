/* One press, one window: the sheet both editors open, and nothing about what
 * is in it.
 *
 * This is design's docs/mocks/vorlaut-editor-sheet.html at the seam that file
 * draws itself along: the picture with its search on the left, on the right
 * only what the device in question really has, deleting at the bottom left and
 * the way onward at the bottom right. The left column, the foot and the way
 * the promise settles are the same for a tablet button, a talker key, a page
 * and a set. What differs is the rows in the right column, and those are the
 * caller's - the tablet has four, the talker one, because a talker key has no
 * word class (the device draws no colour at all: the five displays carry the
 * picture and nothing round it) and no sentence bar to put anything into.
 *
 * ## Why this is in the shell and not in either editor
 *
 * It was in editor-app/editor.ts, which is where it was written. Bringing the
 * talker onto it could not be an import: tests/unit/layers.test.ts forbids one
 * editor reaching into another, deliberately, because that is the cheap
 * version of a second editor - editor-app borrowing editor-diy's thumb, and
 * thereby making one device's ideas the other's.
 *
 * So the shape shell/picker.ts already had is the shape here. That module
 * stopped knowing what a set was by taking `apply` instead of a target to
 * write into - and has since stopped drawing anything at all, leaving the seam
 * this column is built on; this one never learns what a set is, for the same
 * reason and by the same means. It is handed a title, a picture to show, some rows it does not read,
 * and three labelled things to do. What a row means, what the picture goes on
 * and what "done" writes are the caller's, every one of them.
 *
 * The test for whether the seam is in the right place is whether anything
 * below would have to say the word "set", "page", "key" or "button". Nothing
 * does.
 *
 * ## The promise settles from the presses, with a guard
 *
 * design.md §3.4, and the same reasoning shell/collections.ts's askTarget()
 * writes out: `close` is what a *host* fires, and a host that hides a dialog
 * without firing it would leave the promise pending for the life of the page -
 * a button that did nothing, with no error anywhere. So the presses resolve for
 * themselves and `close` only carries the dismissal.
 *
 * ## Nothing is written until the confirming press
 *
 * Not enforced here - it cannot be, because this module never sees the draft -
 * but it is what the shape is for, and both callers keep it. Every way out
 * that is not a foot button costs exactly nothing, which is the rule an empty
 * cell makes unavoidable: pressing one must not leave a blank key behind when
 * the sheet is dismissed.
 *
 * The picture column has one choice that is made over several presses rather
 * than one - the crop - and so it has to be asked, on the way out through a
 * foot button, whether it is holding anything. That is Picked.settle() below,
 * and it is on that side of the line rather than this one for exactly the
 * reason above: a foot button is the confirming press, and the ✕, Escape and a
 * press outside still cost nothing.
 */
import { openDialog } from "@lautstark/design/dialog";
import { menuOn } from "@lautstark/design/menu";
import { negationCross, say, status } from "./dom.js";
import { symbolInto } from "../backend/index.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
import { cropSquare, pngName } from "./crop.js";
import type { Cropper } from "./crop.js";
import { creditLine, findSymbols, searchPlaceholder, takeSymbol, uploadOwn }
  from "./picker.js";
import type { SymbolHit } from "./picker.js";

/** How a sheet was left. `null` is every way out that wrote nothing. */
export type Left = "done" | "next" | null;

/* --- Small builders ------------------------------------------------------
 *
 * Exported because the rows are the caller's to build and these are what they
 * are built out of. They carry no opinion about what a row is for.
 */

/** One of the answers a dropdown offers. */
export interface Choice {
  /** What the caller stores, and what it reads back. Never drawn. */
  value: string;
  /** What is drawn - on the trigger while it is closed, and in the list. */
  label: string;
}

/** A trigger and the list it opens. */
export interface Dropdown {
  /** What a row is handed: the anchor the list hangs from. menu.js appends
   *  the list to the trigger's parent, so the anchor is what positions it. */
  readonly anchor: HTMLElement;
  /** The trigger itself - the thing a caption names, a test presses and focus
   *  lands on. A button is not a labelable element, so a row that captions one
   *  has to point at it with aria-labelledby; see formRow below. */
  readonly button: HTMLButtonElement;
  /** Which answer is in force. Assigning redraws the trigger and calls nobody
   *  back, which is what writing to a select's `.value` did. */
  value: string;
}

/**
 * A button and a menu, which is what this family means by a dropdown.
 *
 * Not a `<select>`, and the reason is components.css's rather than this
 * module's: a select's open list is drawn by the operating system, so it is
 * the one control on a page that cannot follow the tokens - survivable while a
 * product committed to one ground and not once the scheme became a choice.
 * The same reasoning replaced the two pickers in the settings sheet, and this
 * is the third and last place in the product that had one.
 *
 * `checked` is set on every item rather than only the one in force. It is
 * tri-state on purpose - see docs/lib/menu.d.ts - and these are alternatives,
 * so leaving it off would make them read as a list of equal commands and put
 * the current answer beyond anything but the drawing.
 *
 * Choosing what is already chosen calls nothing back, which is the one piece
 * of a select's behaviour worth copying deliberately rather than by accident:
 * a `change` event that fires on a non-change is how a row that watches one
 * comes to redraw itself for nothing.
 */
export function dropdown(choices: Choice[], value: string,
                         onChange: (value: string) => void): Dropdown {
  const anchor = document.createElement("span");
  // .start, because these stand at the left of a form column: the default
  // hangs the list rightward off its trigger, which suits the overflow menu at
  // the right edge of a row and nothing here.
  anchor.className = "menu-anchor start";

  const button = document.createElement("button");
  button.type = "button";
  /* A field wearing a chevron, not a button wearing one.
   *
   * components.css draws `.dropdown` on a `.btn`, which is as wide as the word
   * on it - right for the ⋯ at the end of a row, and for a picker standing on
   * its own in a settings panel. In a column of questions it is wrong: the
   * fields above and below are full-width, so a trigger that stops after
   * "Wort" leaves four controls reading as four kinds of thing with no left
   * edge to follow down.
   *
   * `.dropdown` asks nothing of `.btn` - it sets a custom property and an
   * `::after`, and both work on whatever they are put on. So this composes two
   * shared classes rather than restating either one's geometry here, which is
   * what `.dropdown`'s own comment warns against: an earlier version of that
   * rule set radius and padding and silently outranked `.btn`.
   *
   * Worth promoting to a named variant in @lautstark/design the next time a
   * second product wants a dropdown inside a form - the same test `.dropdown`
   * and `.menu-anchor.start` were each promoted on. */
  button.className = "field dropdown";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  anchor.appendChild(button);

  let held = value;
  /* The trigger says what is chosen, which a select did for free and a button
   * does not. That is the defect this shape shipped with the first time it
   * replaced a select here - the trigger went on naming the answer somebody
   * had just switched away from - so it is one function called from both
   * places that can change the answer. */
  const paint = () => {
    button.textContent = choices.find((one) => one.value === held)?.label ?? "";
  };
  paint();

  button.onclick = () => {
    menuOn(button, (add) => {
      for (const one of choices) {
        add(one.label, () => {
          if (one.value === held) return;
          held = one.value;
          paint();
          onChange(held);
        }, { checked: one.value === held });
      }
    });
    fit(anchor, button);
  };

  return {
    anchor, button,
    get value() { return held; },
    set value(next: string) { held = next; paint(); },
  };
}

/**
 * Keeps an open list inside the sheet it was opened in.
 *
 * A sheet's body is the one scrolling area (see `.sheet > .body`), and a list
 * that is positioned inside a scrolling box is clipped by it and adds to what
 * it scrolls. So a long menu near the foot of a sheet - Wortart is eleven
 * entries - pushed the sheet's own scrollbar out and hid its own last rows
 * behind the foot.
 *
 * Two answers, in this order. Open upward where there is more room above than
 * below, which is what a menu at the foot of a form needs and all a chooser of
 * three or four ever needs. Then cap what is left, so that a list too long for
 * either side scrolls within itself rather than out of the sheet.
 *
 * Here rather than in the shared menu: the package positions a list against
 * its anchor and says so, and which box a product wants it kept inside is the
 * product's - "the plumbing stays per product", components.css's own words for
 * the same seam.
 */
function fit(anchor: HTMLElement, button: HTMLElement): void {
  const menu = anchor.querySelector<HTMLElement>(".menu");
  // A second press on the trigger is a dismissal, and menuOn has already
  // closed the list rather than opened one.
  if (!menu) { anchor.classList.remove("menu-anchor--up"); return; }

  const box = anchor.closest(".body");
  const view = box ? box.getBoundingClientRect()
                   : new DOMRect(0, 0, innerWidth, innerHeight);
  const at = button.getBoundingClientRect();
  // The 6px components.css hangs the list at, spent again at the far end so a
  // capped list does not sit flush against the edge it was capped by.
  const gap = 12;
  const below = view.bottom - at.bottom - gap;
  const above = at.top - view.top - gap;
  const up = menu.offsetHeight > below && above > below;

  anchor.classList.toggle("menu-anchor--up", up);
  // A floor, because a cap small enough to show nothing is worse than a list
  // that overhangs: two rows and a scrollbar is still a menu.
  menu.style.maxHeight = `${Math.max(96, Math.floor(up ? above : below))}px`;
}

/** One labelled thing in a sheet: a label, a control, and a sentence under it.
 *
 * A <div> with a <label for>, rather than a <label> wrapped round the whole
 * row. A wrapping label owns every control inside it, which is right for one
 * input and wrong for a radio group or a control with a play button beside it -
 * pressing the caption would then land on whichever the browser picked first.
 * An empty `text` leaves the caption out, for a row that is a button.
 *
 * `names` says what the caption is the name of, and its type says how:
 *
 * - an id, for one labelable control. A real <label for>, so pressing the
 *   caption reaches it, which is what a field wants.
 * - an element, where there is no id that would work. A <button> is not a
 *   labelable element, so `for` pointed at one silently does nothing - the
 *   association has to be aria-labelledby, and a <label> that labels nothing
 *   would be furniture. A dropdown's trigger is that case; settings_sheet.ts
 *   reached the same shape by hand before this did.
 * - "", for a control that is several controls. The caption names the box.
 */
export function formRow(text: string, control: HTMLElement, note = "",
                        names: string | HTMLElement = control.id): HTMLElement {
  const box = document.createElement("div");
  box.className = "form__row";
  if (text) {
    const points = typeof names === "string" ? "" : names;
    const caption = document.createElement(points ? "span" : "label");
    caption.className = "lbl";
    if (typeof names === "string" && names) {
      (caption as HTMLLabelElement).htmlFor = names;
    } else {
      caption.id = `row${++captions}`;
      (points || control).setAttribute("aria-labelledby", caption.id);
    }
    caption.textContent = text;
    box.appendChild(caption);
  }
  box.appendChild(control);
  /* The sentence is named to the control, not only placed beside it.
   *
   * It reads as a note about the field because it sits next to it, and that
   * is the whole of the association a sighted reader needs. A reader that
   * gets the row one element at a time is handed the caption and the field
   * and nothing else, so the sentence that says what an empty one means is
   * the one part of the row it never hears. `aria-describedby` is what says
   * it belongs to the control - announced after the caption, on focus.
   *
   * On whatever the caption names, which is the element that already carries
   * the row's `for` or its `aria-labelledby`. A row whose caption names a box
   * of several controls gets none: a description on the box is a description
   * on nothing anybody focuses. */
  if (note) {
    const line = hint(note);
    line.id = `note${++notes}`;
    const said = typeof names === "string"
      ? (names ? (control.id === names ? control
                                       : control.querySelector(`#${names}`)) : null)
      : names;
    said?.setAttribute("aria-describedby", line.id);
    box.appendChild(line);
  }
  return box;
}
let captions = 0;
let notes = 0;

/** The sentence under a row, or beside it. Its own builder because a row whose
 *  sentence changes with the answer has to rewrite one rather than rebuild the
 *  row around it. */
export function hint(text = ""): HTMLElement {
  const line = document.createElement("span");
  line.className = "form__hint";
  line.textContent = text;
  return line;
}

/** A text field that writes into the caller's draft as it is typed. Nothing
 *  reaches a layout until the sheet's confirming press - see the head of this
 *  file - so there is no debounce here and nothing to save yet. */
export function textField(value: string, onInput: (value: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "field";
  input.value = value;
  input.autocomplete = "off";
  input.oninput = () => onInput(input.value);
  return input;
}

/** A sentence where a picture should have been.
 *
 * Two different absences, and the words point at different remedies - which is
 * the one piece of reading about a symbol that both editors and this module's
 * own preview all have to make. A `metacom:` reference resolves out of the
 * licensed folder, so its picture being unreachable means the folder is not
 * connected in this browser, which is remediable in the gear. Anything else is
 * a file this browser's store does not hold, which is what a board imported
 * from elsewhere looks like.
 */
export function missing(symbol: string): HTMLElement {
  const line = document.createElement("span");
  line.className = "blank";
  line.textContent = t(symbol.startsWith("metacom:")
    ? "ui.symbol_needs_folder" : "ui.symbol_missing");
  return line;
}

/* --- The picture, its search and the upload ------------------------------ */

/** The left column, for the sheets that have one.
 *
 * A page on the tablet has no picture and its sheet is one column wide; every
 * other sheet in the product opens on the thing's picture, because that is
 * what somebody is looking at when they press it.
 */
export interface PickColumn {
  /** The symbol the sheet opens on, "" for none. */
  symbol: string;
  /** What to put in the search field: usually the word already on the thing,
   *  which is what somebody is most likely looking for a picture of. */
  seed: string;
  /** A picture was chosen, however it was chosen. `caption` is the
   *  collection's own word for it and "" when it has none; what the caller
   *  does with either is the caller's - see the note at takeSymbol's callers,
   *  and both of them only ever fill a field that is still empty. */
  onPick(symbol: string, caption: string): void;
  /** Whether the picture opens crossed out - Slot.negated. Absent, together
   *  with onNegate below, for a picture that cannot be: a set key is
   *  navigation rather than a word, and there is nothing on it to negate. */
  negated?: boolean;
  /** Somebody crossed the picture out, or stopped. */
  onNegate?(negated: boolean): void;
}

/** The left column, and the one thing the foot has to be able to ask it. */
interface Picked {
  node: HTMLElement;
  /** Anything the column has started and not finished, finished - see settle()
   *  where it is built. Resolves immediately when there is nothing pending,
   *  which is almost always. */
  settle(): Promise<void>;
}

/** Builds the left column. Private: the only way to one is through openSheet,
 *  because a picture column outside a sheet has no meaning. */
function drawPick(spec: PickColumn): Picked {
  const pick = document.createElement("div");
  pick.className = "pick";
  let symbol = spec.symbol;
  let negated = Boolean(spec.negated);

  const preview = document.createElement("div");
  const drawPreview = () => {
    preview.innerHTML = "";
    preview.className = "pick__preview";
    if (!symbol) {
      preview.classList.add("pick__preview--none");
      preview.setAttribute("role", "img");
      preview.setAttribute("aria-label", t("ui.symbol_none"));
      preview.innerHTML =
        `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18"`
        + ` height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/>`
        + `<path d="M21 16l-5-5-5 5-3-3-5 5"/></svg>`;
      return;
    }
    preview.removeAttribute("role");
    preview.removeAttribute("aria-label");
    const image = document.createElement("img");
    image.alt = "";
    symbolInto(image, symbol);
    // Not the "no picture yet" glyph: there is one, and saying there is not
    // would send somebody to pick a second.
    image.onerror = () => { image.replaceWith(missing(symbol)); };
    preview.appendChild(image);
    // Over the picture, at the size of the box, so the preview says the same
    // thing the cell behind the sheet says and the device will say.
    if (negated) preview.appendChild(negationCross());
  };
  drawPreview();
  pick.appendChild(preview);

  /* Where the crop's slider and its one sentence go while there is a crop.
   *
   * Directly under the box and above everything else, built empty and hidden,
   * because the alternative is inserting elements into a live column at the
   * moment somebody is looking at it. What fills it comes from shell/crop.ts;
   * what it says is this column's, the way every other sentence here is. */
  const cropBar = document.createElement("div");
  cropBar.className = "pick__crop";
  cropBar.hidden = true;
  const cropHint = document.createElement("p");
  cropHint.className = "pick__crophint";
  cropHint.id = "pickCropHint";
  cropHint.textContent = t("ui.crop_hint");
  pick.appendChild(cropBar);

  const query = document.createElement("input");
  query.type = "search";
  query.className = "field";
  query.autocomplete = "off";
  // Which collection is being searched, from the one place that knows - a
  // second copy of that answer is how a field comes to name a collection it is
  // not searching. Read as the sheet is built rather than once at boot,
  // because a METACOM folder arrives and leaves without a reload.
  query.placeholder = searchPlaceholder();
  query.setAttribute("aria-label", t("ui.symbol_search"));
  query.value = spec.seed.trim();
  pick.appendChild(query);

  /* What kind of answer the hits are, above the hits themselves.
   *
   * Its own element rather than a line inside the grid: the grid scrolls at
   * 150px and a sentence written into it scrolls away from the pictures it is
   * about, which is the same silence as not writing it. Above, because it is
   * read before the tiles are looked at rather than after.
   *
   * role="status" and built empty, so that the sentence is announced when it
   * arrives. A search runs on every Enter and the results are replaced under
   * a reader who cannot see them being replaced; the two silences in the box
   * below have never been announced either, and this one is the one that
   * changes what somebody does next. */
  const near = document.createElement("p");
  near.className = "pick__near";
  near.setAttribute("role", "status");
  near.hidden = true;
  pick.appendChild(near);

  const results = document.createElement("div");
  results.className = "pick__results";
  pick.appendChild(results);

  const took = (chosen: string, caption: string) => {
    symbol = chosen;
    spec.onPick(chosen, caption);
    drawPreview();
    drawResults();
    off.hidden = !symbol;
    // Nothing to cross out on an empty key, and something to cross out again
    // the moment there is a picture. The answer itself is left alone: taking a
    // picture off and putting another one on is choosing a different picture
    // for the same key, and the key is still the one that says "not".
    negateLabel.hidden = !symbol;
  };

  let hits: SymbolHit[] = [];
  const drawResults = () => {
    results.innerHTML = "";
    for (const hit of hits) {
      const one = document.createElement("button");
      one.type = "button";
      one.className = "pick__hit";
      // The hint tells twins apart - four METACOM tiles captioned "ja" differ
      // only by picture - and is display only, never the reference.
      one.setAttribute("aria-label",
        hit.label + ("hint" in hit && hit.hint ? ` - ${hit.hint}` : ""));
      const image = document.createElement("img");
      image.src = hit.url;
      image.loading = "lazy";
      image.alt = "";
      one.appendChild(image);
      one.onclick = () => {
        status(t(hit.source === "metacom" ? "ui.taking_symbol" : "ui.loading_symbol"));
        void takeSymbol(hit).then(
          (taken) => { took(taken.symbol, taken.label); status(""); },
          (error: unknown) => status(t("ui.symbol_failed", { error: reason(error) })));
      };
      results.appendChild(one);
    }
  };

  /** Puts the line above the results there, or takes it away. Hidden rather
   *  than left empty: an empty <p> above the grid is a gap that reads as a
   *  layout fault. */
  const tell = (line: string) => {
    near.textContent = line;
    near.hidden = !line;
  };

  // So a slow answer cannot overtake a newer one. The sheet's own, because the
  // sheet is its own search - there is no dialog behind it to hold one.
  let token = 0;
  const search = () => {
    const word = query.value.trim();
    if (!word) return;
    const mine = ++token;
    say(results, t("ui.searching"));
    tell("");
    void findSymbols(word).then((answer) => {
      if (mine !== token) return;
      hits = answer.hits;
      drawResults();
      // Both silences - a word the collection does not have, and a browser that
      // never managed to ask - come back as a sentence from the seam.
      if (answer.empty) say(results, answer.empty);
      // And the third answer, which is neither: hits that are the nearest the
      // collection holds rather than the word. They stay; this says so.
      tell(answer.near);
    });
  };
  query.onkeydown = (event) => {
    if (event.key !== "Enter") return;
    // The sheet is not a form, but Enter in a search field inside a dialog is
    // otherwise the browser's own way to close it.
    event.preventDefault();
    search();
  };

  /* Somebody's own picture, reached from inside the sheet. A modal over a
   * modal to choose a symbol was the second dialog this design set out to
   * remove, and the one it replaced has since gone entirely - shell/picker.ts
   * is the seam under this column and nothing else now. */
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  file.onchange = () => {
    const chose = file.files?.[0];
    file.value = "";
    if (!chose) return;
    const keep = (picture: Blob, name: string) => {
      status(t("ui.uploading"));
      return uploadOwn(picture, name).then(
        (made) => { took(made, ""); status(t("ui.upload_done")); },
        (error: unknown) => status(t("ui.upload_failed", { error: reason(error) })));
    };
    /* No crop offered is not a failure and does not get a sentence: the
     * picture was already square, or the browser could not read a size off it,
     * and in both cases the file goes exactly as it did before this step
     * existed. cropSquare()'s own head says which is which. */
    void cropSquare(chose).then(
      (cutter) => {
        if (cutter) beginCrop(cutter, chose.name);
        else void keep(chose, chose.name);
      },
      () => void keep(chose, chose.name));
  };
  const own = document.createElement("button");
  own.type = "button";
  own.className = "btn quiet";
  own.textContent = t("ui.symbol_own");
  own.onclick = () => file.click();

  /* Taking the picture off, which until now could only be done by putting a
   * different one on. Nothing downstream has to learn anything: `symbol: ""`
   * is what a button without a picture has always been in the model, and a
   * picture-less button draws its word large.
   *
   * Not a ✕ beside the search field. That field is an <input type="search">
   * and the browser puts its own ✕ inside it, which clears the *word being
   * searched for* - two ✕ a few pixels apart meaning two different things is
   * worse than the missing control was. So it is a labelled button, next to
   * the other thing that is done to the picture as a whole.
   *
   * Hidden rather than disabled when there is no picture: there is nothing to
   * take off, and a control that is permanently there and permanently dead
   * reads as broken. Hiding it does cost the press its own focus, though - the
   * button vanishes under it - so the press hands focus to the search field,
   * which is where somebody who has just cleared a picture is going next. */
  const off = document.createElement("button");
  off.type = "button";
  off.className = "btn quiet";
  off.textContent = t("ui.symbol_off");
  off.hidden = !symbol;
  off.onclick = () => {
    took("", "");
    query.focus();
    status(t("ui.symbol_off_done"));
  };

  const acts = document.createElement("div");
  acts.className = "pick__acts";
  acts.append(own, off);
  pick.append(acts, file);

  /* Going in and coming out of the crop.
   *
   * The search, its two sentences and the results go away for the duration
   * rather than dimming: a live grid of pictures under an open crop invites a
   * press that throws the crop away without saying so, and hiding them is one
   * property against a disabled look this stylesheet has nowhere else.
   *
   * The crop adds no buttons of its own, and it had two once. Both went the
   * same way and for the same reason: this sheet already has a foot, the foot
   * already says what it does, and a control repeating that a few inches
   * higher up is a question about which one is the real one rather than a
   * choice. Fertig keeps the square - see settle() below - and the ✕ and
   * Escape drop it, which is what they mean everywhere else here. The sentence
   * under the slider says the first half; the second half is what a ✕ has
   * always meant and does not need saying. */
  let cropping: Cropper | null = null;
  /* The square, waiting to be kept - see settle() at the foot of this function
   * for what asks. Held apart from the button that usually runs it because the
   * button is not the only press that means yes. */
  let keeping: (() => Promise<void>) | null = null;

  const endCrop = () => {
    keeping = null;
    cropping?.close();
    cropping = null;
    cropBar.hidden = true;
    cropBar.replaceChildren();
    acts.hidden = false;
    own.hidden = false;
    off.hidden = !symbol;
    if (spec.onNegate) negateLabel.hidden = !symbol;
    query.hidden = results.hidden = credits.hidden = false;
    // Whatever it was saying before, said again by the rule that put it there:
    // hidden when empty, because an empty <p> over the grid is a layout fault.
    near.hidden = !near.textContent;
    drawPreview();
    // Deliberately not moving focus. The two presses below do it for
    // themselves, because the third caller - settle(), from a foot button - is
    // closing the sheet, and taking focus back to a control inside a dialog
    // that is going away is how it ends up nowhere.
  };

  const beginCrop = (cutter: Cropper, name: string) => {
    cropping = cutter;
    preview.replaceChildren();
    preview.className = "pick__preview pick__preview--crop";
    preview.removeAttribute("role");
    preview.removeAttribute("aria-label");
    preview.appendChild(cutter.surface);
    cropBar.append(cutter.zoom, cropHint);
    cropBar.hidden = false;
    /* The row itself, not only the two buttons in it. An empty flex box is a
     * grid item all the same, and .pick's own 10px gap sits on both sides of
     * it - so leaving it standing costs a gap under the crop for a control
     * that is no longer there. */
    acts.hidden = true;
    own.hidden = off.hidden = true;
    if (spec.onNegate) negateLabel.hidden = true;
    query.hidden = near.hidden = results.hidden = credits.hidden = true;
    keeping = () => cutter.cut()
      .then((square) => uploadOwn(square, pngName(name)))
      .then(
        (made) => { endCrop(); took(made, ""); status(t("ui.upload_done")); },
        (error: unknown) => {
          endCrop();
          status(t("ui.upload_failed", { error: reason(error) }));
        });
    // The sentence under the slider is the box's description as well as the
    // column's copy: somebody who cannot see it has just been handed a control
    // whose name says what it is and not what to do with it.
    cutter.surface.setAttribute("aria-describedby", cropHint.id);
    cutter.surface.focus();
  };

  /* Crossing the picture out.
   *
   * A checkbox rather than a fifth thing in the row above, because it is not a
   * thing done *to* the picture the way choosing one and taking one off are -
   * it is a state the key is in, and it stays true while the picture under it
   * is swapped. That is the whole of why it is a field on the key rather than
   * a second reference: see Slot.negated.
   *
   * Hidden with no picture, for the reason the ✕ is: there is nothing to cross
   * out, and a live control over an empty box invites a press that does
   * nothing visible. It comes back by itself as soon as a picture is picked,
   * because drawActs() runs on every change to what is on the key. */
  const negate = document.createElement("input");
  negate.type = "checkbox";
  negate.id = "pickNegate";
  negate.checked = negated;
  negate.onchange = () => {
    negated = negate.checked;
    spec.onNegate?.(negated);
    drawPreview();
    status(t(negated ? "ui.symbol_negated" : "ui.symbol_negate_off"));
  };
  const negateLabel = document.createElement("label");
  negateLabel.className = "pick__negate";
  negateLabel.htmlFor = negate.id;
  negateLabel.append(negate, document.createTextNode(t("ui.symbol_negate")));
  /* A label and nothing else, though a sentence explaining *why* a German
   * board crosses a picture out rather than using another one would help a
   * carer who has not built one before.
   *
   * It was written and taken out again, measured rather than argued: three
   * lines of prose here cost 60px, and this column already overflows the
   * sheet's scrolling body by a little. Sixty more pushed the ARASAAC notice
   * at its foot from mostly visible to entirely below the fold, and that
   * notice is a condition of a licence rather than something we choose to
   * show. The reader who needs the explanation has already been given it by
   * then anyway: ui.search_near says the collection holds no picture for the
   * word they typed, one control above this one. */
  if (spec.onNegate) {
    negateLabel.hidden = !symbol;
    pick.appendChild(negateLabel);
  }

  /* What is owed for the collection these pictures come from.
   *
   * ARASAAC is CC BY-NC-SA and the wording is a condition of the licence, so
   * it belongs wherever its pictures are shown - which, since a sheet carries
   * its own search, is here. It was under the picker dialog's results, and
   * that dialog is gone; the standing copy is the ARASAAC panel in
   * Einstellungen, and e2e/legal.spec.ts holds both halves.
   *
   * The sentence is picker.ts's, built there and read here. */
  const credits = document.createElement("p");
  credits.className = "pick__credits";
  credits.textContent = creditLine();
  pick.appendChild(credits);

  if (query.value) search();
  /* Anything chosen but not yet kept, kept.
   *
   * The crop is the only such thing and is likely to stay the only one: every
   * other control in this column decides in a single press, and this one is
   * chosen over several. That is what made it different, and what made the
   * shape below wrong on the first try - the foot's Fertig closed the sheet
   * over an open crop and the key kept what it had.
   *
   * That was defensible written down. Nothing had been written, so no way out
   * of this sheet had cost anything, which is the rule the whole module is
   * built on. It is not what happens: somebody chooses a picture, moves it
   * about, and then presses the one primary button on the screen - and gets
   * nothing, with no sentence anywhere saying why.
   *
   * So a foot button means the square as well. Not the corner ✕, not Escape,
   * not a press outside: those say nothing happened, and after them nothing
   * has. The distinction is exactly the one openSheet already draws between a
   * press that resolves "done" and a close that resolves null.
   *
   * Cleared as it is read rather than when the write lands, so that two quick
   * presses cannot ask for the same square twice. */
  const settle = (): Promise<void> => {
    const pending = keeping;
    keeping = null;
    return pending ? pending() : Promise.resolve();
  };

  return { node: pick, settle };
}

/* --- The sheet ----------------------------------------------------------- */

/** The destructive act, on the left of the foot.
 *
 * `settle` closes the sheet as a done. A press that does not call it leaves
 * the sheet standing, which is what a delete that asks a question of its own
 * needs: the question draws a dialog over this one, and only a yes should take
 * the sheet underneath away - a no leaves somebody exactly where they were.
 */
export interface RemoveButton {
  label: string;
  onPress(settle: () => void): void;
}

/** A foot button that closes the sheet as soon as it has done its work. */
export interface FootButton {
  label: string;
  onPress(): void;
}

export interface SheetSpec {
  /** The heading, and the sheet's accessible name. */
  title: string;
  /** The left column. Absent for a sheet with nothing to show a picture of,
   *  which then takes the narrower single-column shape. */
  pick?: PickColumn;
  /** A sentence about the whole thing, across both columns and above them.
   *
   * Its own slot rather than the first of the rows, because those become the
   * form column and a sentence about the button as a whole read there as a
   * sentence about the field under it. It spans, so it also stays right on the
   * one-column sheets - the page card, and either sheet on a narrow screen. */
  notice?: HTMLElement;
  /** The right column, in order. Built with formRow() above; this module does
   *  not read them. */
  rows: HTMLElement[];
  remove?: RemoveButton;
  /** Keep going to the next thing without closing. A board is built in runs,
   *  and a sheet that had to be re-opened from the board fourteen more times
   *  would be slower than the property row it replaced. */
  next?: FootButton;
  done: FootButton;
  /** The control focus lands on when the sheet opens. showModal() would
   *  otherwise land it on the corner ✕, which is not what somebody who has
   *  just opened a thing is about to do to it. */
  focus?: HTMLElement;
}

/**
 * Opens the sheet and resolves with how it was left.
 *
 * `"done"` and `"next"` are the two foot buttons; every other way out - the
 * corner ✕, Escape, a press outside - is `null`, and null means nothing
 * happened.
 */
export function openSheet(spec: SheetSpec): Promise<Left> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (how: Left) => {
      if (settled) return;
      settled = true;
      resolve(how);
      // After resolving, so a close event arriving as a consequence of this
      // call finds the guard already set.
      sheet?.close();
    };

    const form = document.createElement("div");
    form.className = "form";
    form.append(...spec.rows);

    const picked = spec.pick ? drawPick(spec.pick) : null;
    /* What the two foot buttons wait for. A sheet with no picture column has
     * nothing to settle and says so in one line, so neither button below has
     * to know which kind of sheet it is on. */
    const settle = (): Promise<void> => picked ? picked.settle() : Promise.resolve();
    const columns: HTMLElement[] = picked ? [picked.node, form] : [form];
    const body: HTMLElement[] = spec.notice ? [spec.notice, ...columns] : columns;

    const foot: HTMLElement[] = [];
    if (spec.remove) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn destructive";
      remove.textContent = spec.remove.label;
      const press = spec.remove.onPress;
      remove.onclick = () => press(() => finish("done"));
      foot.push(remove);
    } else {
      // The foot puts the destructive act on the left and the confirming one on
      // the right; with nothing on the left the spacer is what keeps the right
      // where it is on every other sheet.
      foot.push(document.createElement("span"));
    }

    const right = document.createElement("span");
    right.className = "foot__right";
    if (spec.next) {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "btn quiet";
      next.textContent = spec.next.label;
      const press = spec.next.onPress;
      next.onclick = () => void settle().then(() => { press(); finish("next"); });
      right.appendChild(next);
    }
    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn primary";
    done.textContent = spec.done.label;
    done.onclick = () => void settle().then(() => { spec.done.onPress(); finish("done"); });
    right.appendChild(done);
    foot.push(right);

    const sheet: ReturnType<typeof openDialog> | undefined = openDialog({
      title: spec.title,
      closeLabel: t("ui.close"),
      body,
      footer: foot,
      onClose: () => finish(null),
    });
    /* A width override on the shared component, not a redefinition of it: two
     * columns need more than the 600px a sheet of prose wants. Everything else
     * - the head, body and foot anatomy, the border, the shadow - stays
     * components.css's. */
    sheet.dialog.classList.add("sheet--button");
    if (!spec.pick) sheet.dialog.classList.add("sheet--page");

    spec.focus?.focus();
  });
}
