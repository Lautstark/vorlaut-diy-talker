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
// ## Why this does not reset the board
//
// cable.ts refuses to drive DTR and RTS in sequence, deliberately, because
// that pattern is esptool's way into the bootloader and doing it by accident
// takes a working talker off the wire mid-session. Here it would be on
// purpose, and it is still not done, for a reason that outlives the taste
// argument: the Feather's USB is the S3's own - `USB CDC On Boot` - so a board
// that enters the ROM bootloader **re-enumerates as a different USB device**.
// The port this page is holding stops existing at that moment, and Chrome will
// not hand over the new one without a fresh grant from a fresh gesture, which
// a press that is already running cannot spend.
//
// So the person puts the board into download mode themselves - BOOT held,
// RESET tapped - and then picks the port that appeared. What arrives here is
// already a chip waiting to be written, which is why the connect below asks
// for no reset at all.
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

    // And out of the bootloader, so the talker comes back as a talker. If the
    // reset does not take - the same native-USB story as everywhere else in
    // this file - the device is written and a press of RESET finishes it,
    // which is what the page says next.
    await loader.after("hard_reset").catch(() => {});
  } finally {
    await transport.disconnect().catch(() => {});
    await port.close().catch(() => {});
  }
}
