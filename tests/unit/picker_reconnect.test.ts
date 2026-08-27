import { describe, expect, it } from "vitest";
import { canReconnect } from "../../src/shell/picker.js";
import type { ProviderStatus } from "@lautstark/bildquelle";

/* When a folder that is not answering is one a click could wake.
 *
 * Two states look alike from the picker and are not. A folder nobody has ever
 * chosen has no way back in: somebody has to go and find one, which is a
 * different errand in a different place. A folder this browser *was* given and
 * has since reset its permission for - which browsers do between visits,
 * without being asked - is one prompt away.
 *
 * The picture column offers a button on the second and only the second. Getting
 * it the wrong way round would put a press in front of somebody that opens a
 * folder picker they did not ask for, in the middle of looking for a picture;
 * getting it wrong the other way leaves them reading a paragraph that sends
 * them two screens away for one click. Neither is loud, and neither would fail
 * anything else in this repository.
 *
 * The half this shares with the rest of the family - whether a state is
 * anybody's to act on at all - is bildquelle's `needsAttention`, and the rule
 * under test is built out of it rather than beside it. So what these cases hold
 * is the *narrowing*: which of the states that need acting on are the ones a
 * permission prompt can mend.
 */
describe("whether there is a way back into a METACOM folder", () => {
  it("offers one where the browser has reset its permission", () => {
    expect(canReconnect(
      { kind: "needs-setup", code: "permission-needed" } as ProviderStatus)).toBe(true);
  });

  it("offers none where no folder was ever chosen", () => {
    expect(canReconnect(
      { kind: "needs-setup", code: "no-folder" } as ProviderStatus)).toBe(false);
    expect(canReconnect({ kind: "needs-setup" } as ProviderStatus)).toBe(false);
  });

  /* A folder that answers needs nothing, and neither does one whose trouble is
   * something a permission cannot fix - an empty folder, a path that has gone.
   * The sentence beside it says what those are; a button would promise to mend
   * them and would not. */
  it("offers none where the folder is fine", () => {
    expect(canReconnect({ kind: "ready" } as ProviderStatus)).toBe(false);
  });

  /* An unreadable folder - a path that has gone, an empty directory - is
   * somebody's to act on and bildquelle says so, but it is not a thing a
   * permission prompt mends. A button here would promise to fix it and would
   * open a dialog that changes nothing. */
  it("offers none where the folder cannot be read, though that needs acting on",
    () => {
      expect(canReconnect({ kind: "error", message: "gone" } as ProviderStatus))
        .toBe(false);
    });
});
