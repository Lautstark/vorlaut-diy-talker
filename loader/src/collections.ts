/* --------------------------------------------- what is already on it --- */
/*
 * The collections a talker is holding, and the one press that removes one.
 *
 * Set apart from the five, like the firmware section and for a related reason:
 * the five steps are what somebody does when there is a new board to send, and
 * this is what they do when the device is getting full or a game is finished
 * with. It needs no file, which is why it is drawn whether or not one has been
 * chosen.
 *
 * **Removing is here and not in the device's own menu**, and that is the whole
 * argument for the section existing. An irreversible action on five keys that a
 * child is holding has nowhere to put a "are you sure" - and nowhere to say
 * what it would cost either. Here there is room for both, and the press that
 * does it is a second press with a sentence between them, exactly as the
 * firmware section's writes are.
 */
import { t } from "./boot.js";
import { Trouble } from "./errors.js";
import { cableSupported, readCollections, removeCollection } from "./cable.js";
import { connectDevice, devices, haveDevice } from "./device.js";
import { announce } from "./page.js";
import { firmwareSection } from "./program.js";
import { held, redraw, type OnDevice } from "./state.js";
import { Step } from "./step.js";
import { KIB, saying } from "./words.js";

export const collections = new Step(null, "load.collections_title");

export function collectionsSection(): void {
  collections.begin();
  if (!cableSupported()) {
    collections.say(t("cable.no_serial"), "aside");
    collections.blocked();
    return;
  }
  const onDevice = held.onDevice;
  if (!onDevice) {
    collections.say(t("load.collections_lead"), "aside");
    const button = collections.button(t("load.collections_check"),
                                      () => void look(button));
    collections.row(button);
    return;
  }

  const room = onDevice.talker.collections;
  collections.say(t("load.collections_room", {
    on: onDevice.on.length, room, free: KIB(onDevice.free),
  }));
  if (room <= 1) {
    /* A talker from before this existed. It holds one collection under one
       name, this page cannot read that name back out of it, and sending a
       second would be a file it never looks at. Saying so beats a list of one
       nameless row with no explanation over it. */
    collections.say(t("load.collections_older"));
  }
  if (!onDevice.on.length) collections.say(t("load.collections_none"));

  for (const one of onDevice.on) {
    /* One line each: what it is called, what it costs, and the way to take it
       off. The name and size were a line and the button was another under it,
       so four collections were eight rows and a column of buttons that all
       said the same word - and which one belonged to which name was a matter
       of counting. */
    const row = document.createElement("div");
    row.className = "coll";
    const named = document.createElement("span");
    named.className = "coll__name";
    /* The name the DEVICE shows, which is the first set's. A collection this
       page could not read has none, and then the file name is the only true
       thing there is to call it. */
    named.textContent = one.name || one.file;
    const sized = document.createElement("span");
    sized.className = "coll__size";
    sized.textContent = t("load.chip_size", { size: KIB(one.size) });
    row.append(named, sized);

    if (!one.unreadable && held.removing !== one.file) {
      const off = document.createElement("button");
      off.type = "button";
      off.className = "btn quiet";
      off.textContent = t("load.collections_remove");
      off.onclick = () => { held.removing = one.file; collectionsSection(); };
      row.append(off);
    }
    collections.show(row);

    if (one.unreadable) {
      collections.say(t("load.collections_unreadable", { file: one.file }),
                      "aside");
      continue;
    }
    /* The second press and the sentence between them, under the row it is
       about rather than beside it - it is the one irreversible thing here and
       it should not read as part of a list. */
    if (held.removing === one.file) {
      collections.say(t("load.collections_warning", {
        name: one.name || one.file, frees: KIB(one.frees),
      }), "refusal");
      const go = collections.button(t("load.collections_really"),
                                    () => void drop(one, go), "btn primary");
      collections.row(go, collections.button(t("load.collections_keep"), () => {
        held.removing = null;
        collectionsSection();
      }, "btn quiet"));
    }
  }
  /* No "have a look" here any more. Arriving at the talker is what asks, a
     removal asks again on its own, and a failure offers "try again" beside the
     sentence that says what went wrong - so a button whose whole job was to
     start the thing that has already happened is one press describing the
     past. It stays in the branch above, where nothing has been asked yet. */
}

export async function look(button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  held.removing = null;
  held.looking = true;
  held.lookFailed = null;
  if (held.view === "talker") redraw.talker();
  try {
    /* From the click, before anything that awaits for long - the same rule the
       connect step is built around. A dismissed picker leaves the view exactly
       as it was. */
    if (!haveDevice()) {
      if (!await connectDevice()) { held.looking = false; redraw.talker(); return; }
    }
    /* The device's own log, kept for the failure path. It arrives unmarked on
       the same wire and is the most useful thing there is when a transfer goes
       wrong - cable.h says so where it prints it - and a view that showed only
       the sentence threw it away. */
    held.heard = [];
    held.onDevice = await readCollections(devices(), (line) => held.heard.push(line));
  } catch (error) {
    held.onDevice = null;
    if (error instanceof Trouble && error.word === "cable_no_device") {
      held.askAgain = true;
    }
    held.lookFailed = saying(error, "cable.failed_reading");
    /* Which is also what a board that has never been flashed looks like: there
       is no firmware on it to answer with. So the failure is recorded the way
       the firmware section reads it, rather than only as a sentence - see the
       note in the talker view about why that section is drawn under a
       failure. */
    if (error instanceof Trouble && error.word === "cable_no_device") {
      held.deviceSays = null;
      held.nothingAnswered = true;
    }
    return;
  } finally {
    held.looking = false;
    if (button) button.disabled = false;
    if (held.view === "talker") redraw.talker();
  }
  collectionsSection();

  /* And the firmware answer, from the session that has just finished.
   *
   * The greeting names the build, so a look already knows what the firmware
   * section used to open its own connection to find out. Two presses and two
   * sessions for two facts that arrive in the same line was a page asking the
   * device twice out of tidiness.
   *
   * It only ever fills the answer in; it never blanks one. A probe() that ran
   * first has the same word from the same greeting, so there is nothing here
   * that can disagree with it. */
  const onDevice = held.onDevice;
  held.deviceSays = { ...onDevice.talker, port: onDevice.port };
  held.nothingAnswered = false;
  if (held.carried) firmwareSection();

  announce(t("load.collections_room", {
    on: onDevice.on.length, room: onDevice.talker.collections,
    free: KIB(onDevice.free),
  }));
}

async function drop(one: OnDevice, go: HTMLButtonElement): Promise<void> {
  go.disabled = true;
  collections.begin();
  const { now, add, far } = collections.logging();
  now(t("cable.looking"));
  add(t("cable.looking"));
  try {
    const gone = await removeCollection(devices(), one.file, {
      onLog: (line) => add(`  ${line}`),
      onStep: (_what, name, done, total) => {
        now(t("cable.removing", { done, total, name }));
        far(done, total);
      },
    });
    add(t("load.collections_removed", {
      name: one.name || one.file, files: gone.removed, size: KIB(gone.freed),
    }));
    now(t("load.collections_removed_short"));
    far(1, 1);
    announce(t("load.collections_removed_short"));
    /* And the list again, from the device rather than from what this page
       thinks it just did. It is one more session and it is worth it: what the
       talker holds afterwards is the only thing worth showing, and a list
       edited in memory would be this page's opinion of it. */
    held.removing = null;
    held.onDevice = null;
    void look();
  } catch (error) {
    add(saying(error));
    now(t("cable.failed_short"));
    held.removing = null;
    held.onDevice = null;
    /* Not a look this time. The transcript above says what went wrong and
       reading it is the point; asking the device again would wipe it. */
    collections.row(collections.button(t("load.collections_check"),
                                       () => void look()));
  }
}
