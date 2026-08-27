import { check } from "./harness.js";
import { CABLE_VERSION, versionVerdict } from "../../tools/cable.js";
import { findTalker } from "../../src/backend/cable.js";

/* What a version mismatch turns into for whoever is holding the cable.
 *
 * device/fixtures/cable/version-older-device and version-newer-device state
 * the verdict; this states what findTalker() does with it, which is a separate
 * question and the one where the useful failure lives. The number has been in
 * the greeting since the beginning and nothing that ran ever compared it -
 * `if (hello.version)` accepted any non-zero value and drove the device as
 * whatever this browser speaks - so the first bump, on 2026-08-27, went into a
 * field nobody read.
 *
 * The trap when closing that is to tighten the truthiness test into an equality
 * and stop there. A port answering with the wrong version would then be skipped
 * exactly like a printer, the walk would end with nothing found, and the page
 * would say "nothing answered" about a device that had answered - sending
 * somebody to check a cable that is fine. So the routing is what is checked
 * here, not just the comparison.
 */

/** A serial port that greets and says nothing else. Enough for findTalker():
 *  it opens, writes "> hello", and reads until "end hello".
 *
 * `lines: null` is the port that is not a talker. It closes its readable rather
 * than going quiet, which is a printer or a dongle that answers nothing and
 * ends up in findTalker's catch either way - but in milliseconds instead of the
 * three five-second greeting attempts a truly mute port would cost. Sitting
 * silent for sixteen seconds is what a real dongle does and it is not what this
 * file is measuring; the timeout itself belongs to hello(), which owns it.
 */
function greetingPort(lines: string[] | null) {
  const encoder = new TextEncoder();
  let closed = false;
  const outgoing = new TransformStream<Uint8Array, Uint8Array>();
  const incoming = new TransformStream<Uint8Array, Uint8Array>();
  const answer = incoming.writable.getWriter();
  if (!lines) answer.close().catch(() => {});

  /* Answer whenever the client writes, which is what a device does. */
  const sink = new WritableStream<Uint8Array>({
    async write() {
      if (!lines) return;
      for (const line of lines) await answer.write(encoder.encode(`${line}\n`));
    },
  });
  outgoing.readable.pipeTo(sink).catch(() => {});

  return {
    opened: 0,
    get closed() { return closed; },
    readable: incoming.readable,
    writable: outgoing.writable,
    async open() { this.opened++; },
    async close() { closed = true; },
    async setSignals() {},
  };
}

const greeting = (version: number) => [
  `< vorlaut ${version}`, "< total 1441792", "< free 1441792", "< files 0",
  "< end hello",
];

/** findTalker's answer, as a word: the Trouble it threw or "found". */
async function walk(ports: unknown[]): Promise<string> {
  try {
    const { cable, port } = await findTalker(ports as never, () => {});
    await cable.close().catch(() => {});
    await (port as { close(): Promise<void> }).close().catch(() => {});
    return "found";
  } catch (error) {
    return (error as { word?: string }).word ?? String(error);
  }
}

// --- The comparison itself ---------------------------------------------------

for (const [version, wanted] of [
  [0, "silent"], [CABLE_VERSION, "ok"],
  [CABLE_VERSION - 1, "device_older"], [CABLE_VERSION + 1, "device_newer"],
  [1, CABLE_VERSION === 1 ? "ok" : "device_older"],
  [255, "device_newer"],
] as [number, string][]) {
  const got = versionVerdict(version);
  check(`a device speaking ${version} is "${wanted}"`, got === wanted, got);
}

// --- What that becomes on the way to somebody reading it ---------------------

check("a talker of this version is the one that gets driven",
      await walk([greetingPort(greeting(CABLE_VERSION))]) === "found");

/* Each of these answered. Reporting them as "nothing answered" would be a
 * true-sounding sentence about the wrong thing. */
check("an older device is reported as an older device, not as no device",
      await walk([greetingPort(greeting(CABLE_VERSION - 1))])
      === "cable_device_older");

check("a newer device is reported as a newer device, not as no device",
      await walk([greetingPort(greeting(CABLE_VERSION + 1))])
      === "cable_device_newer");

/* And this one never said it was a vorlaut, so it is the case the older
 * sentence was written for and still says the right thing. Closing that route
 * off was the risk in comparing the version at all. */
check("a port that never says it is a vorlaut is still no device",
      await walk([greetingPort(null)]) === "cable_no_device");

/* A laptop has several ports. A mismatch on one of them must not cost the
 * person the board that works, whichever order they were granted in. */
check("a wrong-version board does not hide a right-version one behind it",
      await walk([greetingPort(greeting(CABLE_VERSION - 1)),
                  greetingPort(greeting(CABLE_VERSION))]) === "found");

check("nor one in front of it",
      await walk([greetingPort(greeting(CABLE_VERSION)),
                  greetingPort(greeting(CABLE_VERSION + 1))]) === "found");

check("with nothing drivable, the mismatch is what gets reported",
      await walk([greetingPort(null),
                  greetingPort(greeting(CABLE_VERSION + 1))])
      === "cable_device_newer");

/* The port a mismatch was found on is let go of. A port left open cannot be
 * opened again, and the symptom of that is a second attempt that looks like a
 * dead device - which is the failure the close() in the happy path exists for
 * and which a new early return could quietly skip. */
{
  const port = greetingPort(greeting(CABLE_VERSION + 1));
  await walk([port]);
  check("and the port it was found on is closed again", port.closed);
}
