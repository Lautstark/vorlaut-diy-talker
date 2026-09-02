import { check } from "./harness.js";
import { Cable } from "../../loader/tools/cable.js";

/* A greeting from a talker that is full, and the patience it needs.
 *
 * `hello` and `list` both make the firmware walk its file system, and the walk
 * is not free. Measured on v0.11 with a 7040 KiB partition holding 322 files:
 * the greeting's `free` line came back at 0.7s and `files` at 7.1s, everything
 * before and after it instant. The client's per-answer timeout was 5s, so a
 * talker that had been filled up stopped answering a page that the same talker
 * answered fine when it was nearly empty - and from the outside that is
 * indistinguishable from no device at all, which is the sentence the page said.
 *
 * What is checked here is that the two walking verbs no longer wait on the
 * per-answer timeout. Rather than delaying a fixture by seven real seconds,
 * the cable is built with a tiny one: if the walk still borrowed `this.timeout`
 * the greeting below would fail, and it does not.
 */
function slowWalk(before: string[], gapMs: number, after: string[]) {
  const encoder = new TextEncoder();
  const outgoing = new TransformStream<Uint8Array, Uint8Array>();
  const incoming = new TransformStream<Uint8Array, Uint8Array>();
  const answer = incoming.writable.getWriter();
  const sink = new WritableStream<Uint8Array>({
    async write() {
      for (const line of before) await answer.write(encoder.encode(`${line}\n`));
      await new Promise((r) => setTimeout(r, gapMs));
      for (const line of after) await answer.write(encoder.encode(`${line}\n`));
    },
  });
  outgoing.readable.pipeTo(sink).catch(() => {});
  return { readable: incoming.readable, writable: outgoing.writable };
}

/* The shape of the real stall: everything up to `free`, then the walk, then
 * the rest. 40ms against a 10ms per-answer timeout stands in for 6.4s against
 * five seconds. */
const STALL = 40;
const IMPATIENT = 10;

const port = slowWalk(
  ["< vorlaut 2", "< firmware v0.11", "< total 7208960", "< free 3231744"],
  STALL,
  ["< files 322", "< collections 16", "< tiles vt1", "< audio va1", "< end hello"],
);
const cable = new Cable(port, { timeout: IMPATIENT });
let greeted: { files?: number; free?: number } | null = null;
let refused = "";
try {
  greeted = await cable.hello();
} catch (error) {
  refused = String((error as Error).message ?? error);
}
await cable.close().catch(() => {});

check("a greeting survives the file-system walk", greeted !== null,
      refused || "it did not finish");
check("and carries the count the walk went to fetch", greeted?.files === 322,
      `files ${greeted?.files}`);
check("with the lines before the stall intact", greeted?.free === 3231744,
      `free ${greeted?.free}`);

/* list() walks the same directory, and a fix that stopped at the greeting
 * would strand somebody one step further on - the collections view lists
 * before it can say what is on the device. */
const second = slowWalk(["< file t1.bin 32768"], STALL,
                        ["< file a1.wav 41008", "< end list 2"]);
const listing = new Cable(second, { timeout: IMPATIENT });
let held: { name: string }[] | null = null;
try {
  held = await listing.list();
} catch {
  held = null;
}
await listing.close().catch(() => {});

check("and so does a listing", held?.length === 2, `${held?.length} files`);
