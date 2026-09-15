import { t } from "./boot.js";
import type { Finding } from "./validate.js";

/** One of the five, and everything that can be written into one.
 *
 * A tiny class rather than a template module, because there is one shape and
 * five instances of it. The editor's templates/ exist because its markup is
 * large and belongs beside the modules that wire it; four methods do not need
 * that arrangement and would only make this flow readable in two files.
 *
 * Six instances now, and the sixth has no number - the firmware section, which
 * adr/0017 added. It is not a step of the flow and must not read as one: a
 * person with a talker in front of them does the five, in order, every time,
 * and touches the firmware once ever. So it is the same object with the same
 * lines and buttons and log, drawn without the marker that says where in a
 * sequence something is.
 */
export class Step {
  readonly root = document.createElement("section");
  private readonly body = document.createElement("div");
  private readonly aheadLine = document.createElement("p");
  private hasAhead = false;
  private readonly mark = document.createElement("span");
  private readonly badge = document.createElement("span");

  constructor(private readonly n: number | null, titleKey: string,
              aheadKey: string | null = null) {
    this.root.className = n === null ? "step step--aside" : "step";
    this.root.dataset.state = "waiting";

    const head = document.createElement("div");
    head.className = "step__head";

    /* The number, in a marker of its own, so that the heading can be prose and
       so that a finished step can carry a check instead. aria-hidden on
       purpose: the sections are named by their headings and read in their own
       order, and an ordinal announced in front of each of five is noise. */
    this.mark.className = "step__mark";
    this.mark.textContent = n === null ? "" : String(n);
    this.mark.hidden = n === null;
    this.mark.setAttribute("aria-hidden", "true");

    const heading = document.createElement("h2");
    heading.id = `step-${n}`;
    heading.textContent = t(titleKey);
    /* Which turns five unnamed regions into five named ones. A <section> is a
       landmark only when it has a name, and landmark navigation is exactly how
       somebody gets back up to "Verbinden" from the bottom of a log. */
    this.root.setAttribute("aria-labelledby", heading.id);

    this.badge.className = "chip";
    this.badge.hidden = true;

    head.append(this.mark, heading, this.badge);

    /* What this step is going to ask for, while it is still waiting.
     *
     * Four numbered headings with nothing under them was what somebody
     * arriving read: "Check", "Compile", "Connect", "Send" and no way to find
     * out what any of them wanted short of walking into it. The
     * two that ask something of a person - a port, the press that writes to
     * the device - were exactly as silent beforehand as the two that ask
     * nothing.
     *
     * Beside the body and not in it, which is the whole of why this is an
     * element rather than a say(). components.css hides a waiting step's body
     * on purpose - "a step nobody can reach yet has nothing worth reading in
     * it" - and that rule is load-bearing for the two sections that are not
     * steps. This sentence is the exception to the sentiment, not to the rule:
     * it lives outside the body, so the body rules and the afternoon behind
     * them are untouched, and `data-state` alone decides whether it shows.
     * Nothing in begin(), waiting() or done() has to remember it. */
    this.aheadLine.className = "step__ahead";
    this.aheadLine.textContent = aheadKey ? t(aheadKey) : "";
    this.hasAhead = Boolean(aheadKey);

    this.body.className = "body";
    this.root.append(head, this.body);
    this.ahead(true);
  }

  /** What this step came to, beside its heading: a count of notes, a size, a
   *  refusal. The outcome of a step is what somebody scrolling past is looking
   *  for, and it was four sentences into the body. */
  /** In the document while the step is waiting, and out of it otherwise.
   *
   * data-state would be enough to *hide* it, and it is still what does the
   * hiding. What it is not enough for is a question: a section-scoped `p`
   * selector finds a hidden paragraph exactly as readily as a shown one, so a
   * preview left lying in the document goes on being the first paragraph of a
   * step that has long since said something else. e2e asks that question - "is
   * the compile step's first paragraph the compiled summary?" - and it was
   * answered with this sentence instead.
   *
   * Which is the better rule anyway, and not only the one that passes: a step
   * that has run says what it did, and what it was *going* to do has stopped
   * being true. It should be no more findable than it is readable. */
  private ahead(on: boolean): void {
    if (!this.hasAhead) return;
    if (on) this.root.insertBefore(this.aheadLine, this.body);
    else this.aheadLine.remove();
  }

  chip(text: string | null, kind = ""): void {
    this.badge.hidden = !text;
    this.badge.textContent = text ?? "";
    this.badge.className = kind ? `chip chip--${kind}` : "chip";
  }

  /** Wipes whatever this step was saying and marks it live. Every step redraws
   *  itself whole rather than appending, so that a second file dropped on the
   *  page cannot leave a line from the first one standing. */
  begin(): void {
    this.ahead(false);
    this.root.dataset.state = "doing";
    this.mark.textContent = this.n === null ? "" : String(this.n);
    this.chip(null);
    this.body.replaceChildren();
  }

  waiting(): void {
    this.ahead(true);
    this.root.dataset.state = "waiting";
    this.mark.textContent = this.n === null ? "" : String(this.n);
    this.chip(null);
    this.body.replaceChildren();
  }

  /** Nothing to press, and nothing coming - which is not what waiting means
   *  and must not look like it. The state a step is left in when this browser
   *  cannot do it at all. */
  blocked(): void {
    this.ahead(false);
    this.root.dataset.state = "blocked";
    this.mark.textContent = this.n === null ? "" : String(this.n);
  }

  done(): void {
    this.ahead(false);
    this.root.dataset.state = "done";
    this.mark.textContent = this.n === null ? "" : "✓";
  }

  say(text: string, className = ""): HTMLParagraphElement {
    const line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    this.body.append(line);
    return line;
  }

  /** The findings, as a list rather than as paragraphs.
   *
   * A list because it is one, and because "3 items" is what a screen reader
   * says on the way in - which is the count somebody wants before they read
   * any of them. The marker is text in the item rather than a ::before, for
   * the same reason: it has to reach a reader who is not looking at colour. */
  findings(all: Finding[]): void {
    if (!all.length) return;
    const list = document.createElement("ul");
    list.className = "findings";
    for (const one of all) {
      const item = document.createElement("li");
      item.className = one.refuses ? "finding--refuses" : "finding--note";
      /* The marker in an element of its own rather than in the same text run.
         It stays text, which is the half of the original decision that was
         right - what was wrong is that the browser drew its own disc in front
         of it, so every line on the page began with two bullets. */
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = one.refuses ? "✖" : "•";
      const words = document.createElement("span");
      words.textContent = one.says;
      item.append(mark, words);
      list.append(item);
    }
    this.body.append(list);
  }

  button(label: string, run: () => void, className = "btn"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.onclick = run;
    return button;
  }

  /** A control that has to read as a link rather than as a button, which is
   *  what components.css keeps .linklike for: "a button that has to read as a
   *  link, because it opens a dialog rather than navigating". Which is
   *  literally what its one caller does - showDirectoryPicker(). */
  link(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linklike";
    button.textContent = label;
    button.onclick = run;
    return button;
  }

  /** A question with two answers, asked before a press rather than during it.
   *
   *  A checkbox and not two buttons, because it is not a thing to do: it
   *  changes what the button below it will do, and it has to be readable as
   *  set or unset at a glance while somebody decides whether to press that.
   *
   *  The label and the sentence under it are one control for a screen reader -
   *  aria-describedby rather than a paragraph that happens to sit nearby -
   *  because the sentence is the whole of why anybody would tick this. */
  choice(label: string, describes: string, on: boolean,
         changed: (now: boolean) => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "choice";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = on;
    box.id = `choice-${this.n ?? "x"}-${label.length}`;
    const words = document.createElement("label");
    words.htmlFor = box.id;
    words.textContent = label;
    const why = document.createElement("p");
    why.className = "footnote";
    why.id = `${box.id}-why`;
    why.textContent = describes;
    box.setAttribute("aria-describedby", why.id);
    box.onchange = () => changed(box.checked);
    const line = document.createElement("div");
    line.className = "row";
    line.append(box, words);
    wrap.append(line, why);
    return wrap;
  }

  /** Anything that is not a sentence, a list or a control. Two callers: the
   *  board picture, which is a block of its own and brings its own layout,
   *  and the line naming the file. */
  show(element: HTMLElement): void {
    this.body.append(element);
  }

  row(...items: HTMLElement[]): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.append(...items);
    this.body.append(row);
    return row;
  }

  /** A live region for the running commentary, and a log under it.
   *
   * Two elements rather than one: the log is minutes of lines and must not be
   * read out as it grows, while the one line above it is the thing somebody
   * standing back from the screen needs announced. Same division the editor's
   * transfer sheet arrived at. */
  logging(): {
    now: (line: string) => void;
    add: (line: string) => void;
    far: (done: number, total: number) => void;
  } {
    const doing = document.createElement("p");
    doing.className = "doing";
    doing.setAttribute("role", "status");
    /* How far along, under the line that says it in words. onStep is already
       handed done and total; what the bar adds is that they can be read from
       where somebody actually is, which is over the talker with a cable in
       their hand rather than in front of the screen. */
    const bar = document.createElement("div");
    bar.className = "bar";
    const far = document.createElement("span");
    far.style.width = "0%";
    bar.append(far);
    const log = document.createElement("pre");
    log.className = "log";
    this.body.append(doing, bar, log);
    const lines: string[] = [];
    return {
      now: (line) => { doing.textContent = line; },
      far: (done, total) => {
        far.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
      },
      add: (line) => {
        lines.push(line);
        log.textContent = lines.join("\n");
        // Whatever is happening is happening at the bottom.
        log.scrollTop = log.scrollHeight;
      },
    };
  }
}
