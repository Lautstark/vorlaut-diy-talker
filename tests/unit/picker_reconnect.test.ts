import { describe, expect, it } from "vitest";
import { canReconnect } from "../../src/shell/picker.js";

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
 */
describe("whether there is a way back into a METACOM folder", () => {
  it("offers one where the browser has reset its permission", () => {
    expect(canReconnect({ kind: "needs-setup", code: "permission-needed" }))
      .toBe(true);
  });

  it("offers none where no folder was ever chosen", () => {
    expect(canReconnect({ kind: "needs-setup", code: "no-folder" })).toBe(false);
    expect(canReconnect({ kind: "needs-setup" })).toBe(false);
  });

  /* A folder that answers needs nothing, and neither does one whose trouble is
   * something a permission cannot fix - an empty folder, a path that has gone.
   * The sentence beside it says what those are; a button would promise to mend
   * them and would not. */
  it("offers none where the folder is fine, or broken in another way", () => {
    expect(canReconnect({ kind: "ready" })).toBe(false);
    expect(canReconnect({ kind: "broken", code: "permission-needed" })).toBe(false);
  });
});
