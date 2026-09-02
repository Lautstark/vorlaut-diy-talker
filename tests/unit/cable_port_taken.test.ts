import { check } from "./harness.js";
import { findTalker } from "../../loader/src/cable.js";

/* A port that would not open, told apart from a port that stayed quiet.
 *
 * findTalker() greets every granted port to find the talker among them, and
 * the loop's catch used to be bare: every way a port can fail arrived at the
 * same sentence, "nothing answered, is the cable in, is the device awake?".
 *
 * That sentence is right for a printer and wrong for a port another program is
 * holding - a second tab, a serial monitor, the Arduino IDE - and the wrong
 * one sends somebody to check a cable that is fine on a device that is awake.
 * It happened on a bench, with a script on the other end of the same port,
 * and the page said the cable might be out while the cable was in.
 *
 * What separates the two is which half failed, not which error arrived: what
 * open() rejects with differs between browsers, and hanging a sentence on
 * those names would be a guess. Whether open() returned is not a guess.
 */
function port({ opens, lines }: { opens: boolean; lines: string[] | null }) {
  const encoder = new TextEncoder();
  const outgoing = new TransformStream<Uint8Array, Uint8Array>();
  const incoming = new TransformStream<Uint8Array, Uint8Array>();
  const answer = incoming.writable.getWriter();
  if (!lines) answer.close().catch(() => {});
  const sink = new WritableStream<Uint8Array>({
    async write() {
      if (!lines) return;
      for (const line of lines) await answer.write(encoder.encode(`${line}\n`));
    },
  });
  outgoing.readable.pipeTo(sink).catch(() => {});
  return {
    readable: incoming.readable,
    writable: outgoing.writable,
    async open() {
      if (!opens) {
        // What Chrome raises when the port belongs to somebody else. The name
        // is here for realism; the routing does not read it.
        const refusal = new Error("Failed to open serial port.");
        refusal.name = "NetworkError";
        throw refusal;
      }
    },
    async close() {},
    async setSignals() {},
  };
}

const greeting = ["< vorlaut 2", "< total 7208960", "< free 3231744",
                  "< files 322", "< end hello"];

async function verdict(ports: unknown[]): Promise<string> {
  try {
    const { cable, port: found } = await findTalker(ports as never, () => {});
    await cable.close().catch(() => {});
    await (found as { close(): Promise<void> }).close().catch(() => {});
    return "found";
  } catch (error) {
    return (error as { word?: string }).word ?? String(error);
  }
}

check("a port another program holds says so",
      await verdict([port({ opens: false, lines: greeting })]) === "cable_port_taken");

check("a port that opens and says nothing keeps the old sentence",
      await verdict([port({ opens: true, lines: null })]) === "cable_no_device");

/* The talker is still found when it is not the first port tried, and a
 * refusal beside it does not take the walk down with it. */
check("a talker beside a held port is still found",
      await verdict([port({ opens: false, lines: null }),
                     port({ opens: true, lines: greeting })]) === "found");

/* Nothing opened and nothing answered: the one somebody can act on wins, and
 * a printer that sat quiet is not it. */
check("a refusal outranks a port that merely stayed quiet",
      await verdict([port({ opens: true, lines: null }),
                     port({ opens: false, lines: null })]) === "cable_port_taken");
