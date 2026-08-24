/* Asking before something goes, and taking no for an answer.
 *
 * One function, and the shape of it is the whole point: it answers a promise
 * of true or false and does nothing else. Every way out of the dialog that is
 * not the destructive button - the other button, Escape, the backdrop - is
 * false, and false means nothing happened. That is a rule this repository has
 * broken before in the other direction, on the button that sends to the
 * device: a dismissed picker cost a full build. A dialog somebody closes has
 * to cost nothing.
 *
 * The words are all the caller's, including the button's, because the button
 * has to say what it is about to do rather than "OK". "Delete 3 sets" is a
 * sentence somebody can decline; "OK" is a sentence nobody can read.
 */
import { $ } from "./dom.js";
import { t } from "../core/texts.js";

export interface Question {
  /** The heading. Short - it is what this is about, not the question. */
  title: string;
  /** What is about to happen, in full, naming the thing and how much of it. */
  text: string;
  /** The destructive button's label: what it does, not whether you agree. */
  go: string;
}

export function ask(question: Question): Promise<boolean> {
  const dialog = $<HTMLDialogElement>("confirm");
  $("confirmTitle").textContent = question.title;
  $("confirmText").textContent = question.text;
  const yes = $<HTMLButtonElement>("confirmYes");
  const no = $<HTMLButtonElement>("confirmNo");
  yes.textContent = question.go;
  no.textContent = t("ui.cancel");

  return new Promise<boolean>((resolve) => {
    /* Each button answers for itself, and `close` catches every other way out.
     *
     * This was written the other way round first - one listener on `close`,
     * reading returnValue - which is the tidier shape and has a failure mode
     * this dialog cannot afford. If `close` does not arrive, the promise never
     * settles, the caller sits awaiting it for the life of the page, and what
     * the person sees is a button that did nothing: no error, no dialog, no
     * deletion. It was found exactly that way, in a browser that set
     * returnValue to "go" and fired no event.
     *
     * So the two presses resolve directly, because they are the two answers,
     * and the listener is left in place for Escape and the backdrop - the ways
     * out that are dismissals rather than answers, and every one of them is
     * false. `answered` is what stops the close that follows a press from
     * arriving second with the opposite answer. */
    let answered = false;
    const settle = (answer: boolean) => {
      if (answered) return;
      answered = true;
      dialog.removeEventListener("close", dismissed);
      resolve(answer);
    };
    const dismissed = () => settle(false);
    dialog.addEventListener("close", dismissed);
    yes.onclick = () => { dialog.close("go"); settle(true); };
    no.onclick = () => { dialog.close(""); settle(false); };
    // Cleared explicitly: a dialog keeps the returnValue of the last time it
    // was closed, so a second question dismissed with Escape would answer with
    // the first one's yes.
    dialog.returnValue = "";
    dialog.showModal();
    // Focus starts on the way out, not on the way through. The destructive
    // button is one press from here and should be reached deliberately.
    no.focus();
  });
}
