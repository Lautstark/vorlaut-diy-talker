#!/usr/bin/env python3
"""Breaks the device interface on purpose and checks that the fixtures notice.

    python3 tools/devicemutate.py

device/fixtures/ claims that both ends of this interface agree. That claim is
only worth what the fixtures catch, and a fixture set that catches nothing
looks exactly like one that catches everything - it passes either way. The
only way to tell them apart is to introduce the faults on purpose and watch.

This is the acceptance test for the whole directory, and
docs/device-interface.md section 5 is explicit about why it is not optional:
the fixtures replace a check where the browser's bytes went straight into the
compiled C reader with two checks that never meet. Completeness is a claim
until somebody breaks each implementation on purpose.

The same shape as tools/cablemutate.py, with one thing added. Each fault is
applied to ONE end, and the run records which end noticed:

    browser   npx vitest run tests/unit/device_fixtures.test.ts
    firmware  python3 tests/test_device_host.py
    reader    npx vitest run tests/unit/device_package_reader.test.ts

Three ends and TWO boundaries, which adr/0014 is the decision behind. The first
pair is the device interface: the bytes between a browser and the talker. The
second is the device package - the .obz between the editor and the loader page,
one step upstream - and only its READER is here. The fixtures for both live
under device/fixtures/ and belong to none of the three.

**There were four.** The package's writer was `src/data/device_package.ts` and
eight of the faults below were put into it; it left with the editor on
2026-08-27 (adr/0012), and this file went on naming
`tests/unit/device_package_writer.test.ts` until 2026-08-31, which meant the
baseline check below failed and nothing here ran at all. Its mutants went with
it rather than being pointed at a copy: a vendored writer is the edit
docs/split-crossings.md forbids, and a mutation run against one would be
measuring this repository's opinion of somebody else's code.

What that costs is worth stating. Nothing here can break the WRITER and watch
device/fixtures/package/ notice, so the claim that those fixtures hold both
ends of the package boundary is now only half checked from this side.
vorlaut-editor holds the other half and has to make it.

A fault in a header that only the browser runner catches would mean the two
runners are not independent after all, and a fault in either that NEITHER
catches is a hole in the fixtures. Both are printed as such rather than
counted as a pass.

Every fault is put to all three runners rather than to the ones of its own
boundary. That is not free and it is not ceremony: loader/src/device_package.ts
takes HASH_BYTES and the key vocabulary out of loader/src/layout_format.ts, so
the two boundaries are not as disjoint as the picture above suggests, and a run
that only asked the near pair would never see it.

**A mutation nothing catches is a finding, not a tidy-up.** What it means is
that the fixture set is silent about something, and the answer is a new
fixture - not a smaller list here.

The working tree has to be clean. Each mutation is written into a tracked file
and undone afterwards, and doing that on top of unsaved work is not a risk
worth taking for a check that can wait until after a commit.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

LAYOUT_H = ROOT / "firmware" / "vorlaut" / "layout_format.h"
TILE_H = ROOT / "firmware" / "vorlaut" / "tile_format.h"
WAV_H = ROOT / "firmware" / "vorlaut" / "wav_format.h"
NAME_H = ROOT / "firmware" / "vorlaut" / "name_format.h"
CABLE_H = ROOT / "firmware" / "vorlaut" / "cable_format.h"
TEXTS_H = ROOT / "firmware" / "vorlaut" / "texts.h"

LAYOUT_TS = ROOT / "loader" / "src" / "layout_format.ts"
TILES_TS = ROOT / "loader" / "src" / "tiles.ts"
AUDIO_TS = ROOT / "loader" / "src" / "audio_format.ts"
CABLE_JS = ROOT / "loader" / "tools" / "cable.js"
PACKAGE_TS = ROOT / "loader" / "src" / "device_package.ts"

FIRMWARE = "firmware"
BROWSER = "browser"
READER = "reader"

# (file, which end it is, what to find, what to put there, what that would mean)
MUTANTS: list[tuple[pathlib.Path, str, str, str, str]] = [
    # --- strides -------------------------------------------------------------
    (LAYOUT_H, FIRMWARE, "#define NAME_BYTES 32", "#define NAME_BYTES 30",
     "the name field shrinks by two bytes"),
    (LAYOUT_H, FIRMWARE, "#define HASH_BYTES 16", "#define HASH_BYTES 15",
     "a hash is a byte shorter"),
    (LAYOUT_H, FIRMWARE, "#define LAYOUT_HEADER_BYTES 12",
     "#define LAYOUT_HEADER_BYTES 10", "the header shrinks"),
    (LAYOUT_H, FIRMWARE, "#define SLOT_COUNT 4", "#define SLOT_COUNT 5",
     "a set gains a fifth slot"),
    (LAYOUT_H, FIRMWARE, "#define MAX_SETS 64", "#define MAX_SETS 65",
     "the device claims room for one set more than there is"),
    (LAYOUT_H, FIRMWARE, "#define KEY_COUNT (SLOT_COUNT + 1)",
     "#define KEY_COUNT (SLOT_COUNT + 2)",
     "a set gains a sixth key nothing draws"),
    (LAYOUT_TS, BROWSER, "export const NAME_BYTES = 32;",
     "export const NAME_BYTES = 30;",
     "the browser cuts names two bytes earlier"),
    (LAYOUT_TS, BROWSER, "export const SLOTS_PER_SET = 4;",
     "export const SLOTS_PER_SET = 5;",
     "the browser writes five slots to a set"),
    (LAYOUT_TS, BROWSER, "export const MAX_SETS = 64;",
     "export const MAX_SETS = 65;",
     "the browser thinks the device has room for one set more than it has"),
    (LAYOUT_TS, BROWSER, "export const KEYS_PER_SET = SLOTS_PER_SET + 1;",
     "export const KEYS_PER_SET = SLOTS_PER_SET + 2;",
     "the browser writes a sixth key into every set"),
    (LAYOUT_TS, BROWSER, "export const HEADER_BYTES = 4 + 4 + 4;",
     "export const HEADER_BYTES = 4 + 4 + 2;",
     "the browser's header shrinks"),

    # --- the version, and the refusals ---------------------------------------
    (LAYOUT_H, FIRMWARE, "#define LAYOUT_VERSION 3", "#define LAYOUT_VERSION 4",
     "the device wants a version the builder does not write"),
    (LAYOUT_TS, BROWSER, "export const LAYOUT_VERSION = 3;",
     "export const LAYOUT_VERSION = 2;",
     "the builder writes the version from before every key said what it "
     "does"),
    (LAYOUT_H, FIRMWARE, "if (data[4] != LAYOUT_VERSION) return LAYOUT_BAD_VERSION;",
     "if (false) return LAYOUT_BAD_VERSION;",
     "the version is no longer checked at all"),
    (LAYOUT_H, FIRMWARE, 'if (memcmp(data, "MTRD", 4) != 0) return LAYOUT_BAD_MAGIC;',
     "if (false) return LAYOUT_BAD_MAGIC;", "the magic is no longer checked"),
    (LAYOUT_H, FIRMWARE, "if (data[6] != SLOT_COUNT) return LAYOUT_BAD_SLOT_COUNT;",
     "if (false) return LAYOUT_BAD_SLOT_COUNT;",
     "the slot count is no longer checked"),
    (LAYOUT_H, FIRMWARE, "if (sets > MAX_SETS) return LAYOUT_BAD_LENGTH;",
     "if (false) return LAYOUT_BAD_LENGTH;",
     "a file naming more sets than there is room for is taken"),
    (LAYOUT_H, FIRMWARE, "if (length < LAYOUT_HEADER_BYTES) return LAYOUT_TOO_SHORT;",
     "if (false) return LAYOUT_TOO_SHORT;",
     "a file shorter than its own header is read anyway"),

    # --- what a key does, and where it goes ------------------------------------
    (LAYOUT_H, FIRMWARE, "  into.does = p[2 * HASH_BYTES + 1];",
     "  into.does = LAYOUT_KEY_SPEAK;",
     "every key is read as one that speaks and goes nowhere"),
    (LAYOUT_H, FIRMWARE, "  into.target = p[2 * HASH_BYTES + 2];",
     "  into.target = 0;",
     "every key that goes anywhere is read as going to the first set"),
    (LAYOUT_H, FIRMWARE, "  return does != LAYOUT_KEY_GO;",
     "  return does == LAYOUT_KEY_SPEAK;",
     "a key that speaks and then goes on stops saying its word"),
    (LAYOUT_H, FIRMWARE, "  if (target >= setCount) return -1;",
     "  if (false) return -1;",
     "a target naming no set is handed back as one, and sets[] is read "
     "past its end"),
    (LAYOUT_H, FIRMWARE,
     "  if (does != LAYOUT_KEY_SPEAK_AND_GO && does != LAYOUT_KEY_GO) return -1;",
     "  if (does == LAYOUT_KEY_SPEAK) return -1;",
     "a value no version has explained becomes a jump rather than a key "
     "that stays put"),
    (LAYOUT_H, FIRMWARE, "    layoutReadKey(keys, e.key);",
     "    layoutReadKey(keys + LAYOUT_KEY_BYTES, e.key);",
     "the set key is read out of the first speech key"),
    (LAYOUT_TS, BROWSER,
     'export const KEY_DOES = { speak: 0, "speak-and-go": 1, go: 2 };',
     'export const KEY_DOES = { speak: 0, "speak-and-go": 2, go: 1 };',
     "the browser writes the two answers that go somewhere the wrong way "
     "round"),
    (LAYOUT_TS, BROWSER, "    view.setUint8(at++, target);",
     "    view.setUint8(at++, 0);",
     "every key is written as going to the first set"),
    (PACKAGE_TS, READER,
     '          : button?.ext_lautstark_speak_on_navigate === true ? "speak-and-go"',
     '          : false ? "speak-and-go"',
     "a key that speaks and then goes on is read as one that only goes on"),
    (PACKAGE_TS, READER,
     "  const named = rows.length ? rows[rows.length - 1]?.[0] : null;",
     "  const named = rows.length ? rows[0]?.[0] : null;",
     "the set key is looked for in the cell the speaker sits in"),

    # --- byte 7, the one extension point --------------------------------------
    (LAYOUT_H, FIRMWARE, "  out.language = data[7];", "  out.language = 0;",
     "the language byte is ignored and everything is English"),
    (LAYOUT_H, FIRMWARE, "  out.language = data[7];", "  out.language = data[6];",
     "the language is read out of the slot count instead"),
    (TEXTS_H, FIRMWARE, "#define LANGUAGE_DEFAULT 0", "#define LANGUAGE_DEFAULT 1",
     "the byte-7 default stops meaning English"),
    (TEXTS_H, FIRMWARE, "  languageIndex = code < LANGUAGE_COUNT ? code : LANGUAGE_DEFAULT;",
     "  languageIndex = code;",
     "an index past the table is no longer brought back inside it"),
    (LAYOUT_TS, BROWSER, "export const LANGUAGE_CODES = { en: 0, de: 1 };",
     "export const LANGUAGE_CODES = { en: 0, de: 2 };",
     "the browser writes a German index the device has no table for"),
    (LAYOUT_TS, BROWSER, 'export const DEFAULT_LANGUAGE = "en";',
     'export const DEFAULT_LANGUAGE = "de";',
     "a language the builder does not know falls back to German"),

    # --- the sleep timeout ----------------------------------------------------
    (LAYOUT_H, FIRMWARE, "  if (sleepSeconds == 0) return LAYOUT_SLEEP_DEFAULT;",
     "  if (sleepSeconds == 0) return LAYOUT_SLEEP_MIN;",
     "an unset timeout means ten seconds instead of ten minutes"),
    (LAYOUT_H, FIRMWARE,
     "  if (sleepSeconds > LAYOUT_SLEEP_MAX) return LAYOUT_SLEEP_MAX;",
     "  if (false) return LAYOUT_SLEEP_MAX;",
     "the timeout is no longer clamped, so the multiplication wraps again"),
    (LAYOUT_H, FIRMWARE,
     "  if (sleepSeconds < LAYOUT_SLEEP_MIN) return LAYOUT_SLEEP_MIN;",
     "  if (false) return LAYOUT_SLEEP_MIN;",
     "a timeout below the floor is obeyed"),
    (LAYOUT_H, FIRMWARE, "#define LAYOUT_SLEEP_MAX 86400u",
     "#define LAYOUT_SLEEP_MAX 43200u",
     "the device honours half the range the builder may write"),
    (LAYOUT_H, FIRMWARE, "#define LAYOUT_SLEEP_DEFAULT 600u",
     "#define LAYOUT_SLEEP_DEFAULT 900u",
     "the two halves disagree about what an unset timeout means"),
    # The one the lock cannot see: clamping where the parse happens rather than
    # where the number becomes a length of time. sleep_seconds and idle_seconds
    # are separate fixture fields precisely so that this is caught here.
    (LAYOUT_H, FIRMWARE, "  out.sleepSeconds = layoutU32(data + 8);",
     "  out.sleepSeconds = layoutIdleSeconds(layoutU32(data + 8));",
     "the reader clamps the field instead of handing it back as it stands"),
    (LAYOUT_TS, BROWSER, "export const SLEEP_MAX = 86400;",
     "export const SLEEP_MAX = 604800;",
     "the browser may emit a week, which the device will not wait"),
    (LAYOUT_TS, BROWSER, "export const SLEEP_MIN = 10;",
     "export const SLEEP_MIN = 1;",
     "the browser may emit a timeout below the device's floor"),
    (LAYOUT_TS, BROWSER, "export const SLEEP_DEFAULT = 600;",
     "export const SLEEP_DEFAULT = 300;",
     "the browser thinks an unset timeout is five minutes"),
    (LAYOUT_TS, BROWSER, "  if (sleepSeconds === 0) return SLEEP_DEFAULT;",
     "  if (sleepSeconds === 0) return 0;",
     "the browser reads an unset timeout as a wait of nothing"),

    # --- byte order -----------------------------------------------------------
    (LAYOUT_H, FIRMWARE,
     "  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16)\n"
     "       | ((uint32_t)p[3] << 24);",
     "  return (uint32_t)p[3] | ((uint32_t)p[2] << 8) | ((uint32_t)p[1] << 16)\n"
     "       | ((uint32_t)p[0] << 24);",
     "the sleep timeout is read the wrong way round"),
    (LAYOUT_TS, BROWSER, "  view.setUint32(at, sleep, true);",
     "  view.setUint32(at, sleep, false);",
     "the sleep timeout is written the wrong way round"),

    # --- the has-audio flag and the spare byte --------------------------------
    #
    # The byte after the flag used to be the reserved one. Version 3 spent it
    # on `does` and put a new spare at the end of the key, so the second of
    # these now swaps the flag for `does` rather than for a byte nobody reads.
    (LAYOUT_H, FIRMWARE, "  into.hasAudio = p[2 * HASH_BYTES] != 0;",
     "  into.hasAudio = p[2 * HASH_BYTES] == 1;",
     "a has-audio flag that is not exactly 1 silences the key"),
    (LAYOUT_H, FIRMWARE, "  into.hasAudio = p[2 * HASH_BYTES] != 0;",
     "  into.hasAudio = p[2 * HASH_BYTES + 3] != 0;",
     "the spare byte at the end of a key is read as the has-audio flag"),
    (LAYOUT_TS, BROWSER, "    view.setUint8(at++, sound ? 1 : 0);\n"
                         "    view.setUint8(at++, does);",
     "    view.setUint8(at++, does);\n"
     "    view.setUint8(at++, sound ? 1 : 0);",
     "the browser writes the has-audio flag and `does` the other way round"),

    # --- the tile -------------------------------------------------------------
    (TILE_H, FIRMWARE, "#define TILE_W 128", "#define TILE_W 116",
     "the device goes back to the tile inside a border"),
    (TILE_H, FIRMWARE, "#define TILE_H 128", "#define TILE_H 127",
     "the device reads one row fewer than there is"),
    (TILE_H, FIRMWARE, "  if (got < want) memset(row + got, 0, want - got);",
     "  if (false) memset(row + got, 0, want - got);",
     "a short row is no longer filled in"),
    (TILES_TS, BROWSER, "export const IMG_SIZE = 128;          // display area",
     "export const IMG_SIZE = 116;          // display area",
     "the browser goes back to the tile inside a border"),
    (TILES_TS, BROWSER,
     "  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);",
     "  return ((r & 0xf8) << 8) | ((g & 0xf8) << 3) | (b >> 3);",
     "green loses a bit in the truncation"),
    (TILES_TS, BROWSER, "    out[write++] = value >> 8;\n"
                        "    out[write++] = value & 0xff;",
     "    out[write++] = value & 0xff;\n"
     "    out[write++] = value >> 8;",
     "the browser writes RGB565 little-endian"),

    # --- the recording --------------------------------------------------------
    (WAV_H, FIRMWARE, "    file.seek(file.position() + size + (size & 1));",
     "    file.seek(file.position() + size);",
     "the pad byte after an odd chunk is not stepped over"),
    (WAV_H, FIRMWARE,
     '  if (memcmp(header, "RIFF", 4) != 0 || memcmp(header + 8, "WAVE", 4) != 0) {',
     '  if (memcmp(header, "RIFF", 4) != 0) {',
     "the WAVE half of the header is no longer checked"),
    (WAV_H, FIRMWARE, "#define WAV_SAMPLE_RATE 16000u",
     "#define WAV_SAMPLE_RATE 22050u",
     "the device plays at a rate the builder does not write"),
    (AUDIO_TS, BROWSER, "export const DEVICE_SAMPLE_RATE = 16000;",
     "export const DEVICE_SAMPLE_RATE = 22050;",
     "the builder asks for a rate the device does not play at"),

    # --- the name rule --------------------------------------------------------
    (NAME_H, FIRMWARE, '    snprintf(out + 2 + i * 2, 3, "%02x", hash[i]);',
     '    snprintf(out + 2 + i * 2, 3, "%02X", hash[i]);',
     "the device looks for an upper-case spelling of the name"),
    (NAME_H, FIRMWARE, "  out[0] = '/';\n  out[1] = kind;",
     "  out[0] = kind;\n  out[1] = '/';",
     "the leading slash and the kind change places"),
    (CABLE_H, FIRMWARE, "if (c <= ' ' || c >= 0x7f || c == '/') return false;",
     "if (c <= ' ' || c >= 0x7f) return false;",
     "a slash is allowed in a name the device will store"),
    (CABLE_H, FIRMWARE, "if (name[0] == '.') return false;",
     "if (false) return false;",
     "a leading dot is allowed in a name"),
    (CABLE_H, FIRMWARE, "#define CABLE_NAME_MAX 63", "#define CABLE_NAME_MAX 31",
     "the name limit shrinks below what a hashed name needs"),
    (LAYOUT_TS, BROWSER, "  const core = stem(String(filename)).slice(1);",
     "  const core = stem(String(filename)).slice(2);",
     "the browser drops a digit before reading the hash"),

    # --- the cable ------------------------------------------------------------
    (CABLE_H, FIRMWARE, "#define CABLE_VERSION 2", "#define CABLE_VERSION 3",
     "the protocol version moves"),
    (CABLE_H, FIRMWARE, "#define CABLE_HOST_SIGIL '>'",
     "#define CABLE_HOST_SIGIL '@'", "the host sigil changes"),
    (CABLE_H, FIRMWARE, '"%c %s %s %08lx\\n"', '"%c %s %s %lx\\n"',
     "a checksum loses its zero padding"),
    (CABLE_H, FIRMWARE, "#define CABLE_CRC_INIT 0u",
     "#define CABLE_CRC_INIT 0xffffffffu",
     "the checksum starts from the wrong value"),
    (CABLE_H, FIRMWARE, "  else return (command->verb = CABLE_UNKNOWN);",
     "  else return CABLE_NONE;",
     "a verb the device does not have is ignored rather than refused"),
    (CABLE_JS, BROWSER, "if (want.includes(answer.key)) return answer;",
     "return answer;",
     "the browser stops skipping keywords it does not know"),
    # The version, which for a year was compared by a test and by nothing that
    # runs. Each of these is a way of having the field back without a reader.
    (CABLE_JS, BROWSER, "  if (theirs === CABLE_VERSION) return \"ok\";",
     "  return \"ok\";",
     "any version the device announces is accepted again"),
    (CABLE_JS, BROWSER,
     "  return theirs < CABLE_VERSION ? \"device_older\" : \"device_newer\";",
     "  return theirs < CABLE_VERSION ? \"device_newer\" : \"device_older\";",
     "the two directions of a version mismatch are swapped"),
    (CABLE_JS, BROWSER, "  if (theirs === CABLE_VERSION) return \"ok\";",
     "  if (theirs >= CABLE_VERSION) return \"ok\";",
     "a device newer than the browser is driven as though it were not"),
    (CABLE_JS, BROWSER, 'await this.send(`put ${name} ${bytes.length} ${hex8(sum)}`);',
     'await this.send(`put ${name} ${hex8(sum)} ${bytes.length}`);',
     "the browser sends the size and the checksum the other way round"),
    (CABLE_JS, BROWSER,
     'const window = Number((await this.expectOneOf(["go"])).rest);',
     "const window = 4096;",
     "the browser assumes a window instead of reading the one it was given"),
    (CABLE_JS, BROWSER,
     '        const acked = Number((await this.expectOneOf(["ack"])).rest);',
     "        const acked = at;",
     "the browser stops waiting to be acknowledged"),

    # --- the device package: what a reader must make of it -------------------
    #
    # The other boundary, and the one adr/0014 added this directory a kind for.
    # Everything below is aimed at a package that PARSES: a talker that says
    # the wrong sentence rather than one that says nothing, which
    # docs/device-interface.md section 6 is a whole section about.
    #
    # The writer's half of this list is in vorlaut-editor - see the head of
    # this file, under "There were four".
    (PACKAGE_TS, READER, "        empty: slotIsEmpty({ text, symbol }),",
     "        empty: false,",
     "a key holding nothing comes back as a key holding something"),
    (PACKAGE_TS, READER, "  if (walked.length !== byBoardId.size) {",
     "  if (false) {",
     "a board nothing in the package reaches is taken along with the rest"),
    (PACKAGE_TS, READER,
     "      sleepTimeoutSeconds: root.ext_vorlaut_sleep_timeout_seconds as number,",
     "      sleepTimeoutSeconds: walked[walked.length - 1]!.ext_vorlaut_sleep_timeout_seconds as number,",
     "the sleep timeout is read off the last board rather than the root"),
    (PACKAGE_TS, READER, "        negated: button?.ext_vorlaut_negated === true,",
     "        negated: false,",
     "a crossed-out key comes back as a plain one"),
    (PACKAGE_TS, READER, "      if (button === setKey) continue;",
     "      if (false) continue;",
     "the key that turns the page comes back as a fifth key on the board"),
    (PACKAGE_TS, READER, "      if (!entry.path) {", "      if (false) {",
     "a gap the export recorded on purpose is read as a missing file"),
    (PACKAGE_TS, READER,
     '      const text = String(button?.vocalization ?? button?.label ?? "");',
     '      const text = String(button?.label ?? "");',
     "the caption printed on a key is taken for the sentence it speaks"),
    (PACKAGE_TS, READER, "        if (!isDeviceWav(heard)) {",
     "        if (false) {",
     "the reader stops refusing a recording at the wrong sample rate"),
    (PACKAGE_TS, READER, "        if (!AUDIO_NAME.test(name)) {",
     "        if (false) {",
     "the reader stops refusing a recording under a name layout.bin cannot carry"),
    (PACKAGE_TS, READER,
     '        contentType: String(entry.content_type ?? "application/octet-stream"),',
     '        contentType: "application/octet-stream",',
     "what a picture is gets forgotten between the file and the compiler"),
]

# Real faults that no fixture at this boundary can see, with the reason.
#
# A separate list rather than a shorter MUTANTS list, because the two say
# different things: a fault in MUTANTS that survives is a fixture that wants
# writing, and one of these is a fault that a fixture CANNOT reach. Deleting
# them would make the run look complete and leave nobody knowing.
#
# Nothing runs these. They are here to be read.
UNREACHABLE: list[tuple[pathlib.Path, str, str, str]] = [
    (WAV_H, "  if (file.read((uint8_t *)header, 12) != 12) return false;",
     "a WAV header that arrived short is read anyway",
     "Every file this accepts and every file it refuses come out the same "
     "either way: a short read leaves nothing available, so the chunk walk "
     "does not run and the answer is still no. What changes is that the WAVE "
     "check then compares four bytes of uninitialised stack. That is a "
     "memory-safety fault rather than a format one, it needs a sanitiser and "
     "not a fixture, and a fixture written to 'catch' it would be asserting "
     "whatever happened to be on the stack that day."),
]

# Changes that alter nothing the fixtures can see. These SHOULD survive: a run
# in which everything fails proves only that the harness is broken.
CONTROLS: list[tuple[pathlib.Path, str, str, str, str]] = [
    # The window a transcript pins is the transcript's, not the firmware's -
    # device_host takes it from the fixture. So the firmware may announce any
    # window it likes and these fixtures still hold, which is what lets one of
    # them announce 256 and hold a browser to reading the number rather than
    # assuming one.
    (CABLE_H, FIRMWARE, "#define CABLE_WINDOW 4096", "#define CABLE_WINDOW 2048",
     "the firmware announces a different window from the fixtures'"),
    (CABLE_H, FIRMWARE, "#define CABLE_QUIET_MS 4000",
     "#define CABLE_QUIET_MS 5000",
     "the device waits longer for bytes that stopped arriving"),
    (LAYOUT_H, FIRMWARE, "#define LAYOUT_MAX_BYTES (LAYOUT_HEADER_BYTES + MAX_SETS * LAYOUT_SET_BYTES)",
     "#define LAYOUT_MAX_BYTES (LAYOUT_HEADER_BYTES + MAX_SETS * LAYOUT_SET_BYTES + 0)",
     "the buffer size is spelled differently"),
]


# The three runners, in the order a report reads best. Each one meets the
# fixtures and never another runner: that is the property the whole directory
# is built on, and a runner added here that imported another end's code would
# take it away without anything going red.
def vitest(spec: str):
    return lambda: subprocess.run(
        ["npx", "vitest", "run", spec],
        cwd=ROOT, capture_output=True, text=True).returncode == 0


RUNNERS = {
    BROWSER: vitest("tests/unit/device_fixtures.test.ts"),
    FIRMWARE: lambda: subprocess.run(
        [sys.executable, "tests/test_device_host.py"],
        cwd=ROOT, capture_output=True, text=True).returncode == 0,
    READER: vitest("tests/unit/device_package_reader.test.ts"),
}


def everything_passes() -> bool:
    return all(passes() for passes in RUNNERS.values())


def apply(case) -> dict[str, bool] | None:
    """Which runners still passed, or None if the text to change has moved."""
    path, _end, find, replace, _what = case
    original = path.read_text(encoding="utf-8")
    if find not in original:
        return None
    path.write_text(original.replace(find, replace, 1), encoding="utf-8")
    try:
        return {end: passes() for end, passes in RUNNERS.items()}
    finally:
        # Whatever happened, including a keyboard interrupt on the way past.
        path.write_text(original, encoding="utf-8")


def describe(result: dict[str, bool]) -> str:
    return "+".join(end for end, ok in result.items() if not ok)


def main() -> int:
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
    if dirty:
        print("The working tree is not clean. This edits tracked files and "
              "puts them back,\nand it should not be doing that on top of "
              "changes you have not saved:\n")
        print(dirty)
        return 2

    if not everything_passes():
        print("The fixture runners do not both pass to begin with, so nothing "
              "here would mean anything.")
        return 2

    missed, moved, wrong_end = [], [], []
    print(f"{len(MUTANTS)} faults, one at a time. The column is which end "
          f"noticed:\n")
    for case in MUTANTS:
        _path, end, _find, _replace, what = case
        result = apply(case)
        if result is None:
            moved.append(what)
            print(f"  ?                  {what} - the code to change has moved")
            continue
        caught = describe(result)
        if not caught:
            missed.append(what)
            print(f"  MISSED                    {what}")
            continue
        print(f"  caught  {caught:<17} {what}")
        # A fault put into one end that only the OTHER end noticed would mean
        # the two runners are not the independent halves they are meant to be.
        if end not in caught:
            wrong_end.append(f"{what} - broken in the {end}, caught by "
                             f"{caught} and not by {end}")

    print(f"\n{len(CONTROLS)} changes that should NOT be noticed:\n")
    wrongly = []
    for case in CONTROLS:
        result = apply(case)
        what = case[4]
        if result is None:
            moved.append(what)
            print(f"  ?               {what} - the code to change has moved")
        elif all(result.values()):
            print(f"  survived        {what}")
        else:
            wrongly.append(what)
            print(f"  WRONGLY CAUGHT  {what}")

    caught = len(MUTANTS) - len(missed) - len(moved)
    print(f"\n{caught} of {len(MUTANTS) - len(moved)} faults caught.")

    if UNREACHABLE:
        print(f"\n{len(UNREACHABLE)} fault(s) no fixture at this boundary can "
              f"reach, and not run:\n")
        for path, find, what, why in UNREACHABLE:
            gone = "" if find in path.read_text(encoding="utf-8") else \
                "  - and the code it names has MOVED, so this note wants "\
                "checking\n"
            print(f"  {what}\n    {why}\n{gone}")
    if moved:
        print(f"{len(moved)} could not be applied - this file has drifted from "
              f"the code and wants updating.")
    if missed:
        print("\nWhat went unnoticed is the interesting part. Each of these is "
              "something\nthe fixtures are silent about, and the answer is a "
              "fixture rather than a\nshorter list here:")
        for what in missed:
            print(f"  {what}")
    if wrong_end:
        print("\nCaught by the wrong end, which means the two runners are not "
              "as\nindependent as they are meant to be:")
        for what in wrong_end:
            print(f"  {what}")
    if wrongly:
        print("\nA control was caught, which means a runner is failing for a "
              "reason\nthat has nothing to do with the change made.")
    return 1 if (missed or wrongly or moved or wrong_end) else 0


if __name__ == "__main__":
    raise SystemExit(main())
