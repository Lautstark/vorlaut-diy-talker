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
 * word class (the device draws one colour round all five displays, not one per
 * key) and no sentence bar to put anything into.
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
 */
import { openDialog } from "@lautstark/design/dialog";
import { say, status } from "./dom.js";
import { symbolInto } from "../backend/index.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
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

export function option(value: string, text: string): HTMLOptionElement {
  const one = document.createElement("option");
  one.value = value;
  one.textContent = text;
  return one;
}

/** One labelled thing in a sheet: a label, a control, and a sentence under it.
 *
 * A <div> with a <label for>, rather than a <label> wrapped round the whole
 * row. A wrapping label owns every control inside it, which is right for one
 * input and wrong for a radio group or a control with a play button beside it -
 * pressing the caption would then land on whichever the browser picked first.
 * An empty `text` leaves the caption out, for a row that is a button.
 */
export function formRow(text: string, control: HTMLElement, note = "",
                        forId = control.id): HTMLElement {
  const box = document.createElement("div");
  box.className = "form__row";
  if (text) {
    const caption = document.createElement("label");
    caption.className = "lbl";
    /* `for` where there is one control to point at, and aria-labelledby where
     * there is not. A radio group is four controls and a play button makes the
     * row two, so a wrapping <label> would hand the caption's press to
     * whichever the browser picked first - which is why this is a <div> with a
     * <label for> rather than a <label> round the row. */
    if (forId) caption.htmlFor = forId;
    else {
      caption.id = `row${++captions}`;
      control.setAttribute("aria-labelledby", caption.id);
    }
    caption.textContent = text;
    box.appendChild(caption);
  }
  box.appendChild(control);
  if (note) {
    const hint = document.createElement("span");
    hint.className = "form__hint";
    hint.textContent = note;
    box.appendChild(hint);
  }
  return box;
}
let captions = 0;

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
}

/** Builds the left column. Private: the only way to one is through openSheet,
 *  because a picture column outside a sheet has no meaning. */
function drawPick(spec: PickColumn): HTMLElement {
  const pick = document.createElement("div");
  pick.className = "pick";
  let symbol = spec.symbol;

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
  };
  drawPreview();
  pick.appendChild(preview);

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

  const results = document.createElement("div");
  results.className = "pick__results";
  pick.appendChild(results);

  const took = (chosen: string, caption: string) => {
    symbol = chosen;
    spec.onPick(chosen, caption);
    drawPreview();
    drawResults();
    off.hidden = !symbol;
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

  // So a slow answer cannot overtake a newer one. The sheet's own, because the
  // sheet is its own search - there is no dialog behind it to hold one.
  let token = 0;
  const search = () => {
    const word = query.value.trim();
    if (!word) return;
    const mine = ++token;
    say(results, t("ui.searching"));
    void findSymbols(word).then((answer) => {
      if (mine !== token) return;
      hits = answer.hits;
      drawResults();
      // Both silences - a word the collection does not have, and a browser that
      // never managed to ask - come back as a sentence from the seam.
      if (answer.empty) say(results, answer.empty);
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
    status(t("ui.uploading"));
    void uploadOwn(chose).then(
      (made) => { took(made, ""); status(t("ui.upload_done")); },
      (error: unknown) => status(t("ui.upload_failed", { error: reason(error) })));
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
  return pick;
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

    const body: HTMLElement[] = spec.pick ? [drawPick(spec.pick), form] : [form];

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
      next.onclick = () => { press(); finish("next"); };
      right.appendChild(next);
    }
    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn primary";
    done.textContent = spec.done.label;
    done.onclick = () => { spec.done.onPress(); finish("done"); };
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
