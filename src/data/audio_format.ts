// What an a<hash>.wav has to be, on the side that writes one.
//
// The rate was a literal inside VORLAUT in backend/local.ts, which is where
// the recording chain is asked for a word. That put the browser's opinion of
// the device's audio format in the middle of the orchestration, and the
// consequence was the one docs/device-interface.md names: the device's
// acceptor is whatever seekToWavData() walks past, and nothing on this side
// was ever held to it.
//
// So the three numbers are here, next to layout_format.ts and tiles.ts, and
// device/fixtures/audio/ holds both ends to them.
//
// Worth knowing which way the obligation runs. A writer MUST produce this;
// the reader on the device checks none of it - it finds the data chunk and
// plays whatever is in it at the rate I2S was started with. A file at another
// rate is therefore not refused, it is a word at the wrong pitch, which is
// why the rule lives on this side.

/** 16 kHz, which is the rate the device starts I2S at. */
export const DEVICE_SAMPLE_RATE = 16000;

/** Mono. One amplifier, one speaker. */
export const DEVICE_CHANNELS = 1;

/** Signed 16-bit samples, little-endian, which is what playWav() reads them
 *  back as when it measures how loud a word came out. */
export const DEVICE_BITS_PER_SAMPLE = 16;
