// The words a person reads: a size, a language, a voice, a port, and what
// went wrong. Each is a fact the page holds in one shape and says in another.
import { says, t } from "./boot.js";
import { Trouble, reason } from "./errors.js";
import { CableError } from "./cable.js";
import { LANGUAGE_CODES } from "./layout_format.js";

export const KIB = (bytes: number) => Math.round(bytes / 1024);

/** The device's own two languages, by name. LANGUAGE_CODES is the table that
 *  decides which ones the device can be labelled in at all, so it is also the
 *  one that decides which have a name to give - anything else is a code, and
 *  a code is what validate.ts is already complaining about on the next line. */
export function languageName(code: string): string {
  return Object.hasOwn(LANGUAGE_CODES, code) && says(`lang.${code}`)
    ? t(`lang.${code}`)
    : code;
}

/** The voice, in the half of its name a person recognises.
 *
 * plan.voice is a model id - `piper:de_DE-thorsten-medium` - and printing it
 * whole put a line of machinery in the middle of four sentences a carer is
 * reading to decide whether this is the right file. The name is the second
 * field, and anything that is not shaped like one is left exactly as it came:
 * a voice from somewhere other than piper is still true, and a wrong guess at
 * a name would not be. */
export function voiceName(voice: string): string {
  const model = voice.slice(voice.indexOf(":") + 1);
  const name = model.split("-")[1] ?? "";
  if (!/^[a-z]+$/i.test(name)) return voice;
  return name[0]!.toUpperCase() + name.slice(1);
}

/** A granted port, in the only words the browser has for one.
 *
 * WebSerial hands over a vendor and a product id and nothing else - no name,
 * no path, no serial number. It is still worth showing: it is the difference
 * between "some port" and "the same port as last time", which is the question
 * somebody looking at this step is actually asking. */
export function portName(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined && info.usbProductId === undefined) {
    return t("load.port_plain");
  }
  const hex = (value: number | undefined) => (value ?? 0).toString(16).padStart(4, "0");
  return t("load.port", {
    vendor: hex(info.usbVendorId), product: hex(info.usbProductId),
  });
}

/** The sentence for a failure, whichever end of the cable it came from.
 *
 * Two vocabularies meet here. Trouble carries a word this page raised itself.
 * CableError carries the word the *device* answered with, and that half used
 * to arrive as prose: "Sending failed: session" put a protocol token where a
 * sentence belonged, and on a read-only look it was not even sending. What to
 * do about it is already written down in errors.ts - a word is a case, and a
 * case has a line in boot_data.ts.
 *
 * Under err.device_ because the two vocabularies are separate and stay that
 * way: one is raised on this side and one is quoted from the other, and a word
 * that means one thing over the wire should not be able to collide with a word
 * this page chose. says() is the guard for the rest of it - a future firmware
 * may answer with a word this page has never heard of, and that should reach
 * somebody as the generic sentence rather than as "err.device_whatever". */
export function saying(error: unknown, generic = "cable.failed"): string {
  if (error instanceof Trouble) {
    return t(`err.${error.word}`, { name: String(error.facts.name || "") });
  }
  /* Asserted once here rather than at each place that asks. tools/cable.js is
     JavaScript, so `instanceof` against CableError establishes which thing this
     is without narrowing what it holds - and the shape it holds is two strings
     that file has carried since it was written. */
  const said = error instanceof CableError
    ? (error as { word: string; detail?: string })
    : null;
  if (said && says(`err.device_${said.word}`)) {
    return t(`err.device_${said.word}`, { name: String(said.detail || "") });
  }
  /* The generic sentence names what was being done, because "Sending failed"
     under a heading that says "Your talker" is a page describing an action
     nobody took. The word matters most exactly here: this is the branch for a
     failure nothing has a prepared sentence for, so the verb is the only
     context it carries. */
  return t(generic, { error: reason(error) });
}
