// Writing the firmware, which is the one thing on this page that talks to the
// chip rather than to the program on it.
//
// adr/0017 is the decision and firmware.ts is everything about the image that
// is not this. What is here is small on purpose: the ROM protocol belongs to
// esptool-js, which is Espressif's own client compiled for the web, and a
// second implementation of it in this repository would be a worse one that
// nothing checks. So this module is the shape of the conversation - a port, an
// image, progress, and what a failure is called - and none of its bytes.
//
// ## Getting into the bootloader, and back out again
//
// Both ends of this were written as instructions to a person and both were
// wrong, in the same way: they assumed a bare Feather on a bench. In an
// assembled talker **BOOT and RESET are inside the case**, and the first
// person to try this could not reach either. adr/0017's "Not to be fixed
// later" argued against driving the reset from the page; what it was arguing
// against was doing it for convenience, and what the case establishes is that
// the manual route does not exist at all. So:
//
// **In.** intoWriteMode() opens the running talker's port at 1200 baud and
// closes it again. The Arduino core's USB stack watches for exactly that -
// line coding of 1200 with DTR dropped - and restarts into the ROM. It is the
// same touch the Arduino IDE uses, and it needs no pins.
//
// **Out.** Not a hard reset. `after("hard_reset")` toggles DTR and RTS, and on
// this board that does nothing at all: the S3 talks to the host through its
// own USB-Serial/JTAG, where those lines are a fiction. Measured on the bench
// on 2026-08-30 - esptool's own hard reset left the chip in the bootloader,
// and so did unplugging the cable, because the talker has a battery in it and
// never lost power. What does work is the RTC watchdog, which is a handful of
// register writes over the same protocol that just wrote the flash. esptool
// spells them out in targets/esp32s3.py; they are copied below with the
// addresses beside them.
//
// The port changes identity across both of these - Adafruit 239a:8113 while
// the firmware runs, Espressif 303a:1001 in the ROM - so Chrome hands back a
// different SerialPort and a second grant is unavoidable. Two presses is the
// floor here, and the second one is a picker rather than a pair of buttons
// nobody can reach.
import { ESPLoader, Transport } from "esptool-js";
import { Trouble, reason } from "./errors.js";
import type { Carried, Piece } from "./firmware.js";

/** What to write, in the order it is written. */
export type Writing = { piece: Piece; bytes: Uint8Array };

export type Flashing = {
  /** esptool-js's own running commentary - what chip it found, how it is
   *  getting on. Straight into the page's log, because when this goes wrong
   *  it is the only thing that says why. */
  onLog?: (line: string) => void;
  onStep?: (written: number, total: number) => void;
};

/** The 1200-baud touch: the way in.
 *
 * Nothing is written and nothing is read - the open and the close *are* the
 * signal. A device that has already restarted, or a port somebody unplugged
 * between one press and the next, throws here and the caller carries on: the
 * point of the call is a chip in the bootloader, and one that is there already
 * needs nothing done to it.
 */
export async function intoWriteMode(port: SerialPort): Promise<void> {
  await port.open({ baudRate: 1200 });
  // Long enough for the core to see the line coding before DTR drops with the
  // close. The Arduino IDE waits about this long for the same reason.
  await new Promise((wait) => setTimeout(wait, 200));
  await port.close();
}

/** How long the ROM takes to come up as a USB device of its own.
 *
 * Measured at rather under a second on macOS; this is that with room over it.
 * It is spent inside the press that started the write, and Chrome allows about
 * five seconds of transient activation, so the port picker that follows still
 * opens. */
export const WRITE_MODE_MS = 1600;

// The RTC watchdog, which is how a device that talks over USB-Serial/JTAG is
// made to restart. Straight out of esptool's targets/esp32s3.py - the same
// four writes in the same order, and the same 0x50d83aa1 key that unlocks the
// register and the 0 that locks it again.
const RTC_WDT_CONFIG0 = 0x60008098;
const RTC_WDT_CONFIG1 = 0x6000809c;
const RTC_WDT_WPROTECT = 0x600080b0;
const RTC_WDT_WKEY = 0x50d83aa1;
// enable | stage 0 resets the system | length | reset the whole chip
const RTC_WDT_ENABLE = ((1 << 31) | (5 << 28) | (1 << 8) | 2) >>> 0;

/** The baud the ROM is talked to at.
 *
 * Not the 115200 the cable uses, and for once the number is not a compromise:
 * there is no UART in the path on the S3's native USB, so this only decides
 * what the two ends agree to call it. esptool's own default, left alone
 * because a device that will not sync is the failure everybody meets first and
 * a non-standard baud is the first thing to be suspected. */
const BAUD = 115200;

/**
 * Write the image onto the chip on the other end of this port.
 *
 * The port must be one the person chose from the picker **after** putting the
 * board into download mode: it is a different USB device from the talker's,
 * and a port granted before the reset is a handle to something that is no
 * longer there.
 *
 * Everything that goes wrong here comes back as a Trouble with a word, in the
 * way errors.ts describes, because the two failures worth telling apart are
 * "this is not a chip in download mode" - by far the commonest, and the one
 * with an answer somebody can act on - and everything else.
 */
export async function writeFirmware(
  port: SerialPort, what: Writing[], how: Carried, options: Flashing = {},
): Promise<void> {
  const { onLog = () => {}, onStep = () => {} } = options;
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: BAUD,
    // esptool-js talks in lines and in fragments of lines; the page's log
    // takes lines. A fragment is kept until it is finished rather than shown
    // as a line of its own, so a progress dot does not become a hundred rows.
    terminal: {
      clean: () => {},
      writeLine: (line: string) => onLog(line),
      write: () => {},
    },
    debugLogging: false,
  });

  try {
    // "no_reset" because the board is already where it needs to be. Every
    // other mode here starts by driving the signals that would send a device
    // that is *not* in download mode into it - and take the port with it.
    let chip: string;
    try {
      chip = await loader.main("no_reset");
    } catch {
      throw new Trouble("flash_no_chip");
    }
    onLog(chip);

    const total = what.reduce((sum, one) => sum + one.bytes.length, 0);
    let before = 0;
    try {
      await loader.writeFlash({
        fileArray: what.map((one) => ({
          data: one.bytes, address: one.piece.address,
        })),
        flashMode: how.flashMode as never,
        flashFreq: how.flashFreq as never,
        flashSize: how.flashSize as never,
        // Never. The whole image already covers everything up to the end of
        // the program, and erasing the rest would take the content with it in
        // the one case - the update - where keeping it is the point.
        eraseAll: false,
        // The image is mostly the same byte, so this is the difference
        // between a minute and several. The chip decompresses as it writes.
        compress: true,
        reportProgress: (at, written) => {
          if (at > 0 && written === 0) before += what[at - 1]!.bytes.length;
          onStep(before + written, total);
        },
      });
    } catch (error) {
      // The library's own words go into the log rather than into the
      // sentence: they name a block and an address, which is exactly what is
      // wanted underneath a line somebody can read and exactly not what that
      // line should be made of.
      onLog(reason(error));
      throw new Trouble("flash_write_failed");
    }

    // And out of the bootloader, so the talker comes back as a talker. See the
    // head of this file: on this board the ordinary hard reset is a no-op and
    // the watchdog is what runs, so this is not a preference between two ways
    // of doing the same thing - it is the only one that works. It is still
    // wrapped, because a device that has already restarted is a success rather
    // than a failure, and the alternative to a reset here is somebody with a
    // sealed case and a talker that will not come back.
    try {
      await loader.writeReg(RTC_WDT_WPROTECT, RTC_WDT_WKEY);
      await loader.writeReg(RTC_WDT_CONFIG1, 2000);
      await loader.writeReg(RTC_WDT_CONFIG0, RTC_WDT_ENABLE);
      await loader.writeReg(RTC_WDT_WPROTECT, 0);
    } catch {
      // Whatever is left to try. On a board with real DTR and RTS lines this
      // is the one that works, so it is a fallback rather than a formality.
      await loader.after("hard_reset").catch(() => {});
    }
  } finally {
    await transport.disconnect().catch(() => {});
    await port.close().catch(() => {});
  }
}
