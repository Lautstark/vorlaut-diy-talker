import { expect, test } from "vitest";

/** The shape the browser suites were written against, kept on purpose.
 *
 * They were plain node scripts that printed `ok`/`FAIL` lines and exited with a
 * code, and each check carried a `detail` saying what the number actually was -
 * "got -16.00", "128 keys in step". That detail is the most useful thing in the
 * file when something moves, so it is passed to expect() as the message rather
 * than dropped for a bare assertion.
 *
 * The alternative was rewriting several hundred assertions into expect() calls
 * while porting them, which is the kind of change that quietly alters what a
 * frozen reference checks.
 */
export function check(name: string, ok: boolean, detail = ""): void {
  test(`${name}${detail ? `   ${detail}` : ""}`, () => {
    expect(ok, detail || name).toBe(true);
  });
}
