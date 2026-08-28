// The firmware the deployed page carries, fetched at deploy time.
//
// adr/0017 is the decision: the page may write the firmware, and the image is
// an asset of the page's own origin rather than something the browser goes and
// asks GitHub for. This is the step that puts it there. It runs in pages.yml
// after `vite build`, needs `gh` and a token that can read releases, and
// writes into dist/firmware/.
//
// It is a script rather than forty lines of YAML for the ordinary reason - a
// workflow step cannot be read, run or reasoned about anywhere but in CI - and
// for one that is specific to this job: the truncation below has an assumption
// in it, and an assumption deserves somewhere to be written down and checked
// rather than a comment beside a `truncate`.
//
//   node tools/firmware_for_pages.mjs [<dist directory>]
//
// It never fails the build for having found no release. That is a real state
// of this repository - no `v*` tag has ever been cut - and the manifest says so
// in a way the page can read, so that the section is absent rather than broken.
// What it does fail for is a release it cannot make sense of, because a wrong
// image is worse than no image: it is written to somebody's talker.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where the program lives in the flash, and therefore where the whole image
 *  stops being interesting.
 *
 * Not a guess: it is the offset the release notes have always told people to
 * write `vorlaut.ino.bin` to, and the one the ESP32 core's default partition
 * scheme puts `app0` at. Everything below it - the bootloader at 0, the
 * partition table at 0x8000, the OTA selector at 0xe000 - is inside the merged
 * image and comes along. */
const PROGRAM_AT = 0x10000;

/** What the release publishes, by the names release.yml gives them. */
const WHOLE = "vorlaut.ino.merged.bin";
const PROGRAM = "vorlaut.ino.bin";

const OUT = process.argv[2] ?? "dist";
const FIRMWARE = join(OUT, "firmware");

const gh = (...args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

/** The newest release whose tag is a firmware release.
 *
 * `gh release view --latest` is not the question: release.yml marks every
 * release a prerelease, and "latest" skips those - it would answer "none" for
 * a repository full of them. So the list is asked for in its own order, which
 * is newest first, and the first `v*` in it wins.
 *
 * Tags are not sorted here, and deliberately. Sorting would mean this file
 * having an opinion about how a version compares, which is the opinion
 * loader/src/firmware.ts holds for the page; two of them, in two languages,
 * disagreeing about which release is newest is a bug nobody would look for.
 * What GitHub returns first is what was published last.
 */
function newestRelease() {
  // No `url` in this list, although a release has one: `gh release list`
  // refuses the field outright rather than leaving it empty, which is the
  // better failure and was still a surprise. It is built from the repository's
  // own address below instead.
  const listed = JSON.parse(gh("release", "list", "--limit", "100",
                               "--json", "tagName,isDraft"));
  const found = listed.find(
    (one) => !one.isDraft && /^v[0-9]/.test(one.tagName));
  if (!found) return null;
  const repo = JSON.parse(gh("repo", "view", "--json", "url")).url;
  return { tagName: found.tagName, url: `${repo}/releases/tag/${found.tagName}` };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function main() {
  mkdirSync(FIRMWARE, { recursive: true });

  const release = newestRelease();
  if (!release) {
    // Not a failure. See the head of this file.
    writeFileSync(join(FIRMWARE, "firmware.json"), JSON.stringify({
      release: null,
      why: "no v* release has been published, so this deploy carries no image",
    }, null, 2) + "\n");
    process.stdout.write("no v* release found - the page will carry no image\n");
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), "vorlaut-firmware-"));
  try {
    gh("release", "download", release.tagName, "--dir", scratch,
       "--pattern", WHOLE, "--pattern", PROGRAM);
    const whole = readFileSync(join(scratch, WHOLE));
    const program = readFileSync(join(scratch, PROGRAM));

    // The cut, and the assumption that makes it safe. A merged image covers
    // the whole 8 MB flash because that is what `esptool merge-bin` writes;
    // everything past the program is erased space, and erased flash is 0xff.
    // If that ever stops being true - a partition scheme that puts something
    // after app0, a merge that pads differently - this stops rather than
    // publishing an image that is missing whatever was there.
    const end = PROGRAM_AT + program.length;
    if (whole.length < end) {
      throw new Error(`${WHOLE} is ${whole.length} bytes, which is shorter `
        + `than the program's own end at ${end}. These two assets do not `
        + `belong to the same build.`);
    }
    const dropped = whole.subarray(end);
    const firstKept = dropped.findIndex((byte) => byte !== 0xff);
    if (firstKept !== -1) {
      throw new Error(`${WHOLE} carries something at 0x${(end + firstKept)
        .toString(16)}, past the end of the program. The cut in `
        + `tools/firmware_for_pages.mjs would drop it, so it is refused: `
        + `whoever changed the partition scheme has to change this too.`);
    }
    // And the program really is the program the merged image contains. Two
    // assets, one build - a release that mixed them would flash a bootloader
    // from one and an application from another, and nothing downstream could
    // tell.
    const inside = whole.subarray(PROGRAM_AT, end);
    if (!inside.equals(program)) {
      throw new Error(`the program inside ${WHOLE} at 0x${PROGRAM_AT
        .toString(16)} is not ${PROGRAM}. The two assets of ${release.tagName} `
        + `are from different builds.`);
    }

    const cut = whole.subarray(0, end);
    writeFileSync(join(FIRMWARE, "whole.bin"), cut);
    writeFileSync(join(FIRMWARE, "program.bin"), program);
    writeFileSync(join(FIRMWARE, "firmware.json"), JSON.stringify({
      release: release.tagName,
      url: release.url,
      // What the page tells esptool-js about the chip. Written here rather
      // than in the page so that the board setting lives beside the image it
      // describes - the same argument .github/actions/firmware makes for the
      // FQBN being in one place.
      chip: "esp32s3",
      flashSize: "8MB",
      flashMode: "dio",
      flashFreq: "80m",
      // Everything, for a device with nothing on it. Written at 0, and it
      // takes the file system with it.
      whole: {
        file: "whole.bin", address: 0,
        bytes: cut.length, sha256: sha256(cut),
      },
      // The program alone, for a device that is only behind. Written at
      // 0x10000, and the content on the device stays where it is.
      program: {
        file: "program.bin", address: PROGRAM_AT,
        bytes: program.length, sha256: sha256(program),
      },
    }, null, 2) + "\n");

    process.stdout.write(
      `${release.tagName}: ${cut.length} bytes whole (from ${whole.length}), `
      + `${program.length} bytes of program\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
