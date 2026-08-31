import { describe, expect, it } from "vitest";

import { check } from "../../loader/src/validate.js";
import { MAX_SETS, SLOTS_PER_SET } from "../../loader/src/layout_format.js";
import type { DeviceKey, ReadDevicePackage }
  from "../../loader/src/device_package.js";

/* The one refusal in loader/src/validate.ts that no artefact can carry.
 *
 * A talker refusing its own layout.bin is the worst outcome this page has: it
 * takes the transfer, the cable says nothing is wrong, and then five panels
 * stay dark with no screen anywhere saying why. So `check()` refuses a
 * Sammlung with more sets than the device has room for before a byte is sent,
 * and that refusal used to be driven end to end - e2e/loader.spec.ts fed the
 * page a six-set package and watched the ✖ appear.
 *
 * That stopped being possible on 2026-08-31, when MAX_SETS went from 5 to 64
 * (adr/0020). The e2e packages under e2e/fixtures/packages/ are the EDITOR's
 * writer's output, taken on the day of the split; that writer is in
 * vorlaut-editor now and docs/split-crossings.md names a vendored copy of it
 * as the edit that must not happen. So nothing in this repository can produce
 * a package of 65 boards, and the six-set one is simply a package the device
 * has room for.
 *
 * Three ways out of that, and this is the third:
 *
 *   commit a 65-board .obz    Fifty kilobytes of binary nothing here can
 *                             regenerate or explain, which is the failure
 *                             docs/frozen-references.md is about.
 *   vendor the writer         Forbidden, and rightly.
 *   ask the function          `check()` is pure and takes a plan. The plan is
 *                             the thing the rule is about, and a plan is three
 *                             lines to build.
 *
 * What is lost is stated rather than discovered: nothing now drives this
 * particular sentence onto the page. The refusal PATH is still driven end to
 * end by the recording at the wrong sample rate, so what went is one line's
 * rendering and not the mechanism.
 */

const key = (): DeviceKey => ({
  text: "", symbol: "", negated: false, empty: true, does: "speak", target: 0,
});

/** A plan of `sets` empty sets, and nothing else. Every other field is the
 *  value that makes no finding of its own, so a count in the result is a count
 *  of what this test is about. */
const planOf = (sets: number): ReadDevicePackage => ({
  plan: {
    language: "de",
    voice: "piper:de_DE-thorsten-medium",
    sleepTimeoutSeconds: 600,
    sets: Array.from({ length: sets }, (_, at) => ({
      name: `Set ${at + 1}`,
      key: key(),
      slots: Array.from({ length: SLOTS_PER_SET }, key),
    })),
  },
  sources: new Map(),
  sounds: new Map(),
});

describe("a Sammlung against the room the device has", () => {
  it("takes exactly MAX_SETS sets without a word", () => {
    expect(check(planOf(MAX_SETS))).toEqual([]);
  });

  it("refuses one more, and names both numbers", () => {
    const found = check(planOf(MAX_SETS + 1));
    expect(found).toHaveLength(1);
    expect(found[0]!.refuses).toBe(true);
    /* Both numbers in the sentence, not just the cap. Somebody reading it has
       the file in front of them and no way to count its boards. */
    expect(found[0]!.says).toContain(String(MAX_SETS + 1));
    expect(found[0]!.says).toContain(String(MAX_SETS));
  });

  it("refuses a Sammlung far past the cap the same way, and only once", () => {
    /* 255 is what the header's set-count byte can hold, so this is the largest
       Sammlung that could reach the page at all. One refusal rather than one
       per set: a list of 191 identical lines is a page nobody reads. */
    const found = check(planOf(0xff));
    expect(found).toHaveLength(1);
    expect(found[0]!.says).toContain("255");
  });
});
