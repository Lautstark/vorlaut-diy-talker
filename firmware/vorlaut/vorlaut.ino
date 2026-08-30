// vorlaut - small talker with five Screenkey buttons
//
// Four keys speak, the fifth switches the set. While the device is awake all
// five displays are on. After the configured idle time it goes into deep
// sleep and wakes on any of the five keys - that first press deliberately
// triggers nothing.
//
// /layout.bin and the content files beside it are produced in the browser -
// renderLayoutBin() in loader/src/layout_format.ts writes the table, and either
// the cable or the folder export puts the lot on the file system. They were
// layout.h and data/, written by build.py, until the Python half went on
// 2026-08-22.

#include <Arduino.h>
#include <SPI.h>
#include <LittleFS.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <ESP_I2S.h>
#include <driver/rtc_io.h>
#include <driver/gpio.h>
#include <esp_sleep.h>

// --- Display ----------------------------------------------------------------
// The image files contain the symbol area only; the border in the set colour
// is drawn by the firmware itself.
#define DISPLAY_W 128
#define DISPLAY_H 128
// The menu draws its own frame; the talker's tiles have none, and fill the
// display edge to edge. TILE_W and TILE_H are what is left of a tile that used
// to be the square inside a border - the file is the whole panel now.
#define MENU_BORDER 6

// TILE_W and TILE_H were two more #defines here, which is the reason nothing
// ever compared them with the browser's TILE_SIZE: a number in a .ino is a
// number no test can include. They are in a header of their own now and the
// two ends are held against device/fixtures/tile/ from either side.
#include "tile_format.h"
static_assert(TILE_W == DISPLAY_W && TILE_H == DISPLAY_H,
              "a tile file is the whole panel - see tile_format.h");

// --- Structure of the content ------------------------------------------------
// How many sets there are, which colours and which file belongs to which key
// is NOT in the firmware but in /layout.bin on the file system. Otherwise a
// new set would have to be flashed over a cable.
//
// Structure and read logic live in layout_format.h - the same file gets
// compiled on the computer by tests/test_layout_frozen.py and checked against
// a real layout.bin. That was tests/test_layout_format.py's job until
// 2026-08-22; what changed with it is what the bytes are compared against, not
// that this reader parses them.
#include "layout_format.h"
#define LAYOUT_FILE "/layout.bin"

// hashPath(), which turns a slot's sixteen bytes into the file to open. It
// was here as a static function, which is why the one rule stated in three
// places had nothing holding the three together.
#include "name_format.h"

#include "pins.h"

// Everything the device shows in words, and the way it gets onto a panel
// that only knows code page 437.
#include "texts.h"
#include "panel_text.h"

// What counts as a recording, and where its samples start. seekToWavData()
// used to be further down this file, which meant the acceptor and the format
// were the same thing and neither could be asked about on its own.
#include "wav_format.h"

// --- Fetching content over the cable ----------------------------------------
//
// The editor is a page with no server behind it, and a tab cannot be something
// the device fetches from. So the browser pushes instead, down the USB-C cable
// the device is charged through anyway - docs/cable.md.
//
// It is the only way in. There was a Wi-Fi path here - the device found a
// server with a UDP broadcast, proved itself with five digits on the displays,
// and pulled a manifest - and it is gone, along with the radio, the captive
// portal, the stored networks and the key in NVS. What decided it was not the
// cable being better: it was that the server half went with app.py, so the
// device was carrying a stack that had nothing left to talk to.
#include "cable.h"


// --- Behaviour ---------------------------------------------------------------

// How long the MAX98357A gets between SD going high and the first sample.
// 5 ms was a guess and audibly too short - the start of every word arrived
// while the amplifier was still coming up. 50 ms is inaudible as latency and
// well past its settling time.
static const uint32_t AMP_WAKE_MS = 50;

static const uint32_t DEBOUNCE_MS = 80;    // this long a key has to stay down
// The set key needs longer. An accidental switch takes away the word she was
// about to say, and she first has to find her way back - that is more annoying
// than hitting the wrong word.
static const uint32_t SET_HOLD_MS = 400;
// The menu is reached only by two keys at once, held for five seconds. Those
// two sit diagonally furthest apart - hard to hit with a child's hand. While
// holding, a countdown runs; letting go cancels it.
static const uint32_t MENU_HOLD_MS = 5000;
static const uint8_t MENU_KEY_A = SET_BUTTON;   // the set key
static const uint8_t MENU_KEY_B = 1;            // key 2, diagonally opposite
// Back to normal operation without input. A device stuck in the menu no
// longer speaks - that must not happen.
static const uint32_t MENU_IDLE_MS = 30000;
// The rate the build writes the WAVs at. In wav_format.h with the rest of
// what a recording is, rather than as a literal here.
static const uint32_t SAMPLE_RATE = WAV_SAMPLE_RATE;
static const size_t AUDIO_CHUNK = 1024;

// How loud, as a percentage of what is in the file.
//
// The only volume control this device has, and it is here rather than on the
// amplifier because there is nowhere else for it: the MAX98357A's GAIN pin is
// strapped on the board, not wired to a GPIO, so nothing in software can move
// it. What is left is the samples themselves, scaled on their way past in
// playWav() - which costs one multiply per sample at 16 kHz and is not
// measurable beside a read from LittleFS.
//
// 50 is half the amplitude, about 6 dB down, and it is a first answer to a
// finished device being too loud in a room rather than a measured figure. The
// number to change is this one, and 100 is exactly what the device did before
// - the scaling is written so that 100 leaves every sample as it was.
//
// It is deliberately not settable from a layout. That would put a volume in
// layout.bin, which means a field in the format, a control in the editor and
// a version of the device interface - for a value that is set once when a
// talker is built and then never touched. The cheap version of "a bit
// quieter" is a build property, the same way FORCE_SLEEP_S is:
//
//   arduino-cli compile --build-property \
//     "compiler.cpp.extra_flags=-DAUDIO_VOLUME_PERCENT=35" ...
#ifndef AUDIO_VOLUME_PERCENT
#define AUDIO_VOLUME_PERCENT 50
#endif
static const int32_t AUDIO_VOLUME = AUDIO_VOLUME_PERCENT;
// Chunks of silence pushed after a word, before the amplifier is switched
// off. 1024 bytes is 512 samples, so at 16 kHz each of these is 32 ms.
static const uint8_t AUDIO_TAIL_CHUNKS = 3;

// --- Zustand -----------------------------------------------------------------

// setColRowStart is protected in the library. This subclass makes the panel
// offset reachable without touching the library.
class Panel : public Adafruit_ST7735 {
 public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void setOffsets(int8_t col, int8_t row) { setColRowStart(col, row); }

  // Everything initR() would have left behind, without initR().
  //
  // For a panel that is already initialised and was never switched off, the
  // init sequence is 760 ms of waiting for nothing: 150 for a software reset,
  // 500 for sleep-out, 10 and 100 for the display coming on. Five panels, one
  // after another, is 3.8 seconds - which was nearly all of the 4.3 the device
  // took to wake, and long enough that a press made into it got thrown away
  // and looked like a device that had not heard.
  //
  // What the panel needs is nothing. What the *driver object* needs is the
  // state initR() computes, and the library keeps the one field it hangs on -
  // tabcolor - private, so there is no way to hand it over. This is
  // Adafruit_ST7735::setRotation() for INITR_144GREENTAB, written out.
  //
  // It is a copy of somebody else's arithmetic and will not follow them if
  // they change it. The check is the screen: wrong here and the picture is
  // visibly offset or mirrored, which is not a subtle failure.
  void adoptAwake(uint8_t turn) {
    // The SPI half of what initR() does, which is the half that is not about
    // the panel at all: the clock frequency and initSPI(). Skipping it cost
    // seventeen seconds of drawing five screens through an unconfigured bus -
    // four times slower than the init this was meant to avoid. It sends the
    // panel nothing, so it is free.
    begin();

    rotation = turn & 3;
    WIDTH = HEIGHT = 128;
    _width = _height = 128;
    _colstart = PANEL_COL_OFFSET;
    _rowstart = (rotation < 2) ? 3 : 1;   // the 128 panel's own rule
    if (rotation & 1) { _xstart = _rowstart; _ystart = _colstart; }
    else              { _xstart = _colstart; _ystart = _rowstart; }

    uint8_t madctl;
    switch (rotation) {
      case 1:  madctl = ST77XX_MADCTL_MY | ST77XX_MADCTL_MV | ST7735_MADCTL_BGR; break;
      case 2:  madctl = ST7735_MADCTL_BGR; break;
      case 3:  madctl = ST77XX_MADCTL_MX | ST77XX_MADCTL_MV | ST7735_MADCTL_BGR; break;
      default: madctl = ST77XX_MADCTL_MX | ST77XX_MADCTL_MY | ST7735_MADCTL_BGR;
    }
    sendCommand(ST77XX_MADCTL, &madctl, 1);
    cp437(true);
  }
};

static Layout layout;

// Survives deep sleep: she should wake up in the same set.
RTC_DATA_ATTR static uint8_t rtcCurrentSet = 0;

static Panel *display[DISPLAY_COUNT];
static I2SClass i2s;

struct ButtonState {
  uint32_t downSince;  // 0 = not pressed
  bool reported;       // this press has already been handled
};
static ButtonState button[DISPLAY_COUNT];

static uint32_t lastActivity = 0;
static bool filesystemReady = false;
static bool contentReady = true;

enum Mode { MODE_NORMAL, MODE_MENU };
static Mode mode = MODE_NORMAL;
static uint32_t menuSince = 0;
static uint32_t comboSince = 0;   // since when both menu keys have been held
static int8_t countdownShown = -1;

// --- Loading the content -----------------------------------------------------------

// Reads /layout.bin and hands it to parseLayout from layout_format.h. If the
// file is missing or does not fit, there simply is no content yet - that is
// not an error but the state after the first flash.
static bool loadLayout() {
  if (!filesystemReady) return false;
  File file = LittleFS.open(LAYOUT_FILE, "r");
  if (!file) {
    Serial.println("layout.bin missing - no content on the device yet.");
    return false;
  }
  static uint8_t buffer[LAYOUT_MAX_BYTES];
  const size_t got = file.read(buffer, sizeof(buffer));
  file.close();

  const LayoutResult result = parseLayout(buffer, (uint32_t)got, layout);
  if (result != LAYOUT_OK) {
    Serial.printf("layout.bin unusable (reason %d, %u bytes)\n",
                  (int)result, (unsigned)got);
    return false;
  }
  // From here on the device talks in the language the content asks for.
  setLanguage(layout.language);
  Serial.printf("layout.bin: %u set(s), language %u, sleep %u s\n",
                layout.setCount, layout.language, layout.sleepSeconds);
  return layout.setCount > 0;
}

// --- Displays ----------------------------------------------------------------

// stillAwake: the panels kept their power, their registers and their picture
// through the sleep, because goToSleep() held CS high on all five and RST high
// as well, so the floating bus could not reach them. Then there is nothing to
// initialise and nothing to wait for - only the driver objects to tell.
static void setupDisplays(bool stillAwake) {
  if (stillAwake) {
    SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      pinMode(PIN_CS[i], OUTPUT);
      digitalWrite(PIN_CS[i], HIGH);
      display[i] = new Panel(&SPI, PIN_CS[i], PIN_DC, -1);
      display[i]->adoptAwake(PANEL_TURN[i]);
    }

    // goToSleep() sent DISPOFF and SLPIN, and holding the pins kept that
    // faithfully - the panels are off because they were told to be. Waking
    // them is two commands and two waits, and the waits are the panel
    // settling rather than the bus: send to all five first, then wait once.
    // That is 600 ms for five instead of 600 ms each, which is the whole
    // trick the library cannot do because it only ever knows about one panel.
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      display[i]->sendCommand(ST77XX_SLPOUT);
    }
    delay(120);   // datasheet wants 120 ms before the next command
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      display[i]->sendCommand(ST77XX_DISPON);
    }
    delay(100);
    return;
  }

  // RST is common to all five panels. So pulse it once by hand and hand the
  // drivers -1 - otherwise initialising display 3 would reset displays 1 and
  // 2 again.
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH);
  delay(10);
  digitalWrite(PIN_RST, LOW);
  delay(20);
  digitalWrite(PIN_RST, HIGH);
  delay(150);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);

  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    display[i] = new Panel(&SPI, PIN_CS[i], PIN_DC, -1);
    display[i]->initR(PANEL_INITR);  // 128x128, settled in stage 2
    display[i]->invertDisplay(PANEL_INVERT);  // IPS panels, settled in stage 2
    display[i]->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
    display[i]->setRotation(PANEL_TURN[i]);
    // Without this the font treats bytes above 0x7F as a legacy special case
    // and draws the wrong glyph. With it they are code page 437, which is
    // what panel_text.h converts to.
    display[i]->cp437(true);
    display[i]->fillScreen(ST77XX_BLACK);
  }
}

// Draws the whole display from the file (DISPLAY_W x DISPLAY_H, RGB565
// big-endian).
//
// There were six pixels of border round a smaller tile. They were the set's
// colour, drawn here rather than baked into the file so that one symbol was
// one file across differently coloured sets; the colour went, they were being
// blacked out for nothing, and a symbol has them now - about a tenth wider in
// each direction on a key 15.21 mm across.
//
// Nothing is cleared first any more, and that is the point of a tile that
// reaches the edge: it covers whatever was on the panel, including the grey
// frame drawMenuKey() leaves behind. The only case that still clears is a file
// that will not open, below.
static void drawTile(Panel *tft, const char *path) {
  static uint16_t line[TILE_W];

  File file = (filesystemReady && path) ? LittleFS.open(path, "r") : File();
  if (!file) {
    if (path) Serial.printf("missing: %s\n", path);
    tft->fillScreen(ST77XX_BLACK);
    return;
  }

  tft->startWrite();
  tft->setAddrWindow(0, 0, TILE_W, TILE_H);
  for (uint16_t y = 0; y < TILE_H; y++) {
    // Short rows come back filled with black, and nothing is said about it -
    // see tileReadRow() in tile_format.h and device/fixtures/tile/short.
    tileReadRow(file, (uint8_t *)line);
    // bigEndian = true: the bytes go out exactly as they stand in the file.
    // The build already writes them in panel order.
    tft->writePixels(line, TILE_W, true, true);
  }
  tft->endWrite();
  file.close();
}

// Two lines centred on a display, without a file. For states where there is
// nothing to show yet - at the very first start for instance, when the
// firmware is on but no content is.
// Two lines, each centred. Both go through toPanelText: it hands back the
// bytes the font draws and the number of glyphs, and the glyphs are what the
// centring has to count. Counting bytes would push every line with an umlaut
// in it off to the left.
static void drawTwoLines(Panel *tft, const char *first, const char *second,
                         int16_t width, uint8_t size) {
  const int16_t glyphW = 6 * size, glyphH = 8 * size;
  char panel[MENU_MAX_CHARS * 2 + 1];
  tft->setTextColor(ST77XX_WHITE);
  tft->setTextSize(size);
  for (uint8_t i = 0; i < 2; i++) {
    const char *line = i == 0 ? first : second;
    if (!line || !*line) continue;
    const uint8_t glyphs = toPanelText(line, panel, sizeof(panel));
    tft->setCursor((width - (int16_t)glyphs * glyphW) / 2,
                   DISPLAY_H / 2 - glyphH + i * (glyphH + 4));
    tft->print(panel);
  }
}

static void drawMessage(Panel *tft, const char *first, const char *second) {
  tft->fillScreen(ST77XX_BLACK);
  drawTwoLines(tft, first, second, DISPLAY_W, 2);
}

// All five displays with the same notice, so it cannot be missed.
static void showNoContent() {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    drawMessage(display[i], text().empty1, text().empty2);
  }
  Serial.println("No content on the device.");
  Serial.println("  Build and upload it - see docs/firmware.md");
}

static void drawCurrentSet() {
  if (!contentReady) {
    showNoContent();
    return;
  }
  const SetEntry &e = layout.sets[rtcCurrentSet];
  char path[2 + HASH_BYTES * 2 + 5];
  for (uint8_t i = 0; i < SLOT_COUNT && i < DISPLAY_COUNT - 1; i++) {
    hashPath(path, 't', e.slots[i].image, ".bin");
    drawTile(display[i], path);
  }
  hashPath(path, 't', e.label, ".bin");
  drawTile(display[SET_BUTTON], path);
  Serial.printf("set %u: %s\n", (unsigned)(rtcCurrentSet + 1), e.name);
}

// --- Menu --------------------------------------------------------------------
//
// Deliberately without files: text and frame are drawn. That way the menu
// works on a freshly flashed device with nothing on it yet - and that is
// exactly where it is needed first.
//
// A grey frame, where a talker key has none: one sees at a glance that this is
// not the talker. It used to be grey against the set's colour, and the
// distinction is if anything plainer now - a frame against no frame.
static const uint16_t MENU_FRAME = 0x8410;   // mid grey in RGB565

static void drawMenuKey(Panel *tft, const char *first, const char *second) {
  const int16_t inner = DISPLAY_H - 2 * MENU_BORDER;
  tft->fillRect(0, 0, DISPLAY_W, MENU_BORDER, MENU_FRAME);
  tft->fillRect(0, DISPLAY_H - MENU_BORDER, DISPLAY_W, MENU_BORDER, MENU_FRAME);
  tft->fillRect(0, MENU_BORDER, MENU_BORDER, inner, MENU_FRAME);
  tft->fillRect(DISPLAY_W - MENU_BORDER, MENU_BORDER, MENU_BORDER, inner,
                MENU_FRAME);
  tft->fillRect(MENU_BORDER, MENU_BORDER, DISPLAY_W - 2 * MENU_BORDER, inner,
                ST77XX_BLACK);
  if (!first && !second) return;   // a key with nothing behind it stays dark

  drawTwoLines(tft, first, second, DISPLAY_W, 2);
}

// Only show what actually exists. Entries appear once the function behind
// them exists - not before.
// Two live keys out of five, and the three dark ones are not an oversight.
// Fetching content, setting up Wi-Fi and pairing were keys 1 to 3, and all
// three went with the radio - content arrives over the cable now, and it needs
// nothing chosen here. What is left is worth keeping: Info is the only thing
// on the device that says what it is holding, and Back is the way out.
static void drawMenu() {
  drawMenuKey(display[0], text().info, nullptr);
  drawMenuKey(display[1], nullptr, nullptr);
  drawMenuKey(display[2], nullptr, nullptr);
  drawMenuKey(display[3], nullptr, nullptr);
  drawMenuKey(display[SET_BUTTON], text().back, nullptr);
}

// --- All five at once --------------------------------------------------------
//
// A transfer takes seconds, and a device that looks switched off during them
// invites a second press. So every display says the same thing while one runs.

// Defined further down with the other key handling. Needed up here because a
// transfer has to be interruptible while it is running.
static bool isDown(uint8_t index);
static int8_t pollButtons();

// A key pressed while a word was playing. playWav() blocks for the length of
// the word, and nothing read the buttons during it - so on real hardware four
// presses in ten simply never happened. Not because they were too quick or
// too weak: the device was inside playWav() and deaf.
//
// Interrupting the word was tried and was worse; dropping the press is what
// made a third of them do nothing. So it is remembered instead, and spoken
// when the word it arrived during has finished. One press, not a queue: after
// several the last one is what she still means.
static int8_t pendingKey = -1;

// How long setup() took, said later. Saying it at the end of setup() stopped
// working the moment setup() got quick: on the S3's native USB the port is not
// enumerated for the first second or so, and a line printed before that is
// simply gone. The measurement had become too good to report itself.
static uint32_t t_displays = 0, t_audio = 0, t_littlefs = 0;
static uint32_t t_layout = 0, t_drawn = 0;
static uint32_t readyMs = 0;
static bool wokeUp = false;
static bool readySaid = false;

static void showOnAll(const char *first, const char *second) {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    drawMenuKey(display[i], first, second);
  }
}

// --- The cable ----------------------------------------------------------
//
// Nothing has to be chosen in the menu for this. The browser starts talking
// and the device answers, which is the whole point: the five digits that used
// to prove somebody was standing in front of the device were needed because a
// network is shared, and whoever has hold of the cable is standing in front of
// it already.

static void cableProgress(const char *what, uint16_t done, uint32_t bytes) {
  (void)bytes;
  char count[12];
  snprintf(count, sizeof(count), "%u", done);
  if (strcmp(what, "hello") == 0) {
    // All five, so it is obvious at a glance that this is not the talker and
    // that the keys are not going to say anything for a moment.
    showOnAll(text().cable, nullptr);
  } else if (strcmp(what, "done") == 0) {
    showOnAll(text().done, count);
  } else {
    showOnAll(text().cable, count);
  }
}

// The way out. A transfer that has to be stopped is stopped here, not by
// pulling the plug - a half-written file left behind by a cable coming out is
// exactly what the .part rule is there to survive, but it should not be the
// normal way to say no.
static bool cableAbort() {
  return isDown(SET_BUTTON);
}

static void drawInfo() {
  char count[8];
  drawMenuKey(display[0], text().sets, nullptr);
  snprintf(count, sizeof(count), "%u", (unsigned)(contentReady ? layout.setCount : 0));
  drawMenuKey(display[1], count, nullptr);

  drawMenuKey(display[2], text().storage1, text().storage2);
  drawMenuKey(display[3],
              filesystemReady ? text().storagePresent : text().storageMissing,
              nullptr);
  drawMenuKey(display[SET_BUTTON], text().back, nullptr);

  if (filesystemReady) {
    Serial.printf("LittleFS: %u of %u bytes used\n",
                  (unsigned)LittleFS.usedBytes(), (unsigned)LittleFS.totalBytes());
  }
}

static void enterMenu() {
  mode = MODE_MENU;
  menuSince = millis();
  countdownShown = -1;
  Serial.println("menu opened");
  drawMenu();
}

static void leaveMenu() {
  mode = MODE_NORMAL;
  countdownShown = -1;
  Serial.println("menu left");
  drawCurrentSet();
}

static void backlight(bool on) {
  digitalWrite(PIN_BL, on ? HIGH : LOW);
}

// --- Sound ---------------------------------------------------------------------

static void setupAudio() {
  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);  // amplifier off until something actually plays

  i2s.setPins(PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DIN);
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_MONO)) {
    Serial.println("I2S would not start.");
  }
}

static void playWav(const char *path) {
  // A slot without text has no audio file - then it stays silent.
  if (!filesystemReady || !path) return;
  File file = LittleFS.open(path, "r");
  if (!file) {
    Serial.printf("no sound: %s\n", path);
    return;
  }
  uint32_t remaining = 0;
  if (!seekToWavData(file, remaining)) {
    Serial.printf("not a valid WAV: %s\n", path);
    file.close();
    return;
  }

  static uint8_t chunk[AUDIO_CHUNK];
  digitalWrite(PIN_AMP_SD, HIGH);
  // AMP_WAKE_MS and not the 5 ms this had: the MAX98357A is nowhere near full
  // gain that quickly, so every word began quiet and a word cut short by the
  // next key was mostly ramp - which is what made the loudness differ between
  // presses on real hardware.
  //
  // Holding it on for the whole waking time was tried instead and was worse:
  // with nothing feeding I2S between words the amplifier sits there
  // amplifying an idle bus, and it hisses audibly. Stage 5 had already shown
  // the pair of them - SD high AND silence written through the gaps was the
  // combination that was clean - and keeping I2S fed everywhere needs loop()
  // restructured or an audio task of its own, not a line moved.
  delay(AMP_WAKE_MS);

  // A word is not interrupted, and that is a decision rather than an
  // omission. Letting the next key cut this one off was tried on real
  // hardware and was worse: pressed quickly, nine presses out of ten were
  // clipped after a few tens of milliseconds, which is far too short to
  // recognise. Every press did start a word - the log said so - and it still
  // sounded exactly like a device ignoring a third of them.
  //
  // So a press during a word is dropped, and pressing quickly gives fewer
  // words rather than broken ones. For someone learning that a key makes the
  // device speak, a whole word she did not ask for is a better wrong answer
  // than a fragment she cannot make out.
  // How loud this word actually is, measured on the way past. Nothing in the
  // browser normalises any more - that went with the Python - so one word can
  // be a fraction of another, and AUDIO_VOLUME is one number for all of them
  // rather than something that could even that out. A word that is merely
  // quiet and a word that is silent look identical from the outside, and this
  // is the difference between them.
  //
  // Measured before the scaling, so it stays a fact about the file. What
  // reaches the amplifier is this times AUDIO_VOLUME percent, and a peak that
  // moved every time somebody turned the volume down would answer a different
  // question from the one it was put here for.
  int16_t peak = 0;
  const uint32_t sampleBytes = remaining;
  const uint32_t began = millis();

  while (remaining > 0) {
    size_t want = remaining < AUDIO_CHUNK ? remaining : AUDIO_CHUNK;
    size_t got = file.read(chunk, want);
    if (got == 0) break;
    for (size_t i = 0; i + 1 < got; i += 2) {
      const int16_t sample =
          (int16_t)((uint16_t)chunk[i] | ((uint16_t)chunk[i + 1] << 8));
      // INT16_MIN has no positive counterpart, so its size is taken as the
      // largest one that has. Only the measurement needs this; the sample
      // itself is scaled below and keeps its sign.
      int16_t loud = sample == INT16_MIN ? INT16_MAX : sample;
      if (loud < 0) loud = (int16_t)-loud;
      if (loud > peak) peak = loud;

      // And the volume, written back into the buffer that is about to be
      // handed to I2S. In 32 bits because 32767 * 100 does not fit in 16, and
      // rounded towards zero, which at this size is inaudible and is what
      // keeps AUDIO_VOLUME_PERCENT of 100 an exact no-op.
      const int16_t quieter =
          (int16_t)(((int32_t)sample * AUDIO_VOLUME) / 100);
      chunk[i] = (uint8_t)((uint16_t)quieter & 0xff);
      chunk[i + 1] = (uint8_t)(((uint16_t)quieter >> 8) & 0xff);
    }
    i2s.write(chunk, got);
    remaining -= got;

    const int8_t caught = pollButtons();
    if (caught >= 0) pendingKey = caught;
  }

  Serial.printf("  %u bytes, %u ms, peak %d of 32767 (%d%%)\n",
                (unsigned)sampleBytes,
                (unsigned)(millis() - began),
                (int)peak, (int)((int32_t)peak * 100 / 32767));

  // Silence before the amplifier is switched off, or it clicks. Three chunks
  // and not the eight it was: at AUDIO_CHUNK and SAMPLE_RATE that is 96 ms
  // rather than 256, and those 160 ms were the fattest part of the ~740 ms a
  // press costs. The shorter that is, the less often two presses land inside
  // one word - which is the whole of what is still being lost.
  //
  // If the click comes back, this is the number that brought it back. It is
  // not the click stage 5 measured, though: that one was the I2S stream
  // running dry, and no amount of tail here addresses it.
  memset(chunk, 0, AUDIO_CHUNK);
  for (uint8_t i = 0; i < AUDIO_TAIL_CHUNKS; i++) {
    i2s.write(chunk, AUDIO_CHUNK);
    const int8_t caught = pollButtons();   // this counts too
    if (caught >= 0) pendingKey = caught;
  }
  digitalWrite(PIN_AMP_SD, LOW);
  file.close();
}

// --- Keys ------------------------------------------------------------------

static bool isDown(uint8_t index) {
  return digitalRead(PIN_BUTTON[index]) == LOW;  // buttons go to GND
}

static bool anyDown() {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    if (isDown(i)) return true;
  }
  return false;
}

static void clearButtonStates() {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    button[i].downSince = 0;
    button[i].reported = false;
  }
}

// After waking: wait until no key is really pressed any more. The press that
// woke the device must not trigger anything - she is pressing blind.
//
// It costs more than one press, though, and that was watched happening on a
// real morning: three presses before the first word. One to wake, which is
// this rule working. One during the boot that follows, which is this rule
// again - clearButtonStates() throws away anything pressed while the screens
// were still dark, and from the outside that press simply does nothing. And
// one that finally speaks.
//
// The rule is right and the cost is not: pressing blind at a dark device is
// exactly what she is doing for the whole of the boot, not just for the
// waking press. Either the dark stretch gets short enough that nobody presses
// into it - "ready N ms after waking" at the end of setup() is there to say
// how long it really is - or a press made during it should be remembered the
// way one made during a word now is.
static void waitForRelease() {
  while (anyDown()) delay(10);
  delay(DEBOUNCE_MS);
  clearButtonStates();
}

// How long this key has to be held before it triggers.
static uint32_t holdTime(uint8_t index) {
  return index == SET_BUTTON ? SET_HOLD_MS : DEBOUNCE_MS;
}

// Both menu keys held? Shows the countdown and reports once the five
// seconds are full. Letting go cancels, and nothing happens.
static bool menuComboReady() {
  const uint32_t now = millis();
  if (!(isDown(MENU_KEY_A) && isDown(MENU_KEY_B))) {
    if (comboSince != 0 && countdownShown >= 0) {
      // Cancelled: back to whatever was on screen before.
      countdownShown = -1;
      if (mode == MODE_MENU) drawMenu(); else drawCurrentSet();
    }
    comboSince = 0;
    return false;
  }
  if (comboSince == 0) comboSince = now;
  const uint32_t held = now - comboSince;
  if (held >= MENU_HOLD_MS) {
    comboSince = 0;
    countdownShown = -1;
    return true;
  }
  const int8_t left = (int8_t)((MENU_HOLD_MS - held) / 1000) + 1;
  if (left != countdownShown) {
    countdownShown = left;
    char seconds[4];
    snprintf(seconds, sizeof(seconds), "%d", left);
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      drawMenuKey(display[i], text().menu, seconds);
    }
  }
  return false;
}

// Returns the index of a newly recognised key, or -1.
static int8_t pollButtons() {
  const uint32_t now = millis();
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    if (isDown(i)) {
      if (button[i].downSince == 0) button[i].downSince = now;
      if (!button[i].reported && now - button[i].downSince >= holdTime(i)) {
        button[i].reported = true;
        return (int8_t)i;
      }
    } else {
      button[i].downSince = 0;
      button[i].reported = false;
    }
  }
  return -1;
}

// --- Sleep ----------------------------------------------------------------

static void goToSleep() {
  Serial.println("going to sleep");
  Serial.flush();

  backlight(false);
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    display[i]->fillScreen(ST77XX_BLACK);
    display[i]->sendCommand(ST77XX_DISPOFF);
    display[i]->sendCommand(ST77XX_SLPIN);
  }

  digitalWrite(PIN_AMP_SD, LOW);
  i2s.end();

  // Hold the backlight low through the sleep. Deep sleep stops driving the
  // digital pins unless it is asked not to, so PIN_BL floated and the
  // ScreenKeys lit themselves back up the moment the chip went under -
  // displays properly off, five backlights on, all night, on a battery. It
  // looks like a device that is awake and has nothing to say, which is the
  // worst of both.
  //
  // The amplifier's SD wants the same treatment for the same reason: floating
  // is not off, and a floating enable on a class-D amplifier is how a sleeping
  // device hisses.
  gpio_hold_en((gpio_num_t)PIN_BL);
  gpio_hold_en((gpio_num_t)PIN_AMP_SD);

  // And the panels' own lines, for a different reason than the backlight's.
  // They keep their power through the sleep, so they keep their registers and
  // their picture - but only if nothing reaches them. Deselected and not
  // reset, they are deaf to whatever the floating bus does, and waking needs
  // no init at all. That is 3.8 seconds of the 4.3 this used to take.
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    digitalWrite(PIN_CS[i], HIGH);
    gpio_hold_en((gpio_num_t)PIN_CS[i]);
  }
  digitalWrite(PIN_RST, HIGH);
  gpio_hold_en((gpio_num_t)PIN_RST);
  gpio_deep_sleep_hold_en();

  // Pull-ups have to stay active during sleep, otherwise the inputs float.
  uint64_t mask = 0;
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    gpio_num_t pin = (gpio_num_t)PIN_BUTTON[i];
    rtc_gpio_pullup_en(pin);
    rtc_gpio_pulldown_dis(pin);
    mask |= 1ULL << PIN_BUTTON[i];
  }
  esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_LOW);
  esp_deep_sleep_start();
}

// --- Arduino -----------------------------------------------------------------

void setup() {
  // Room for exactly one window, which is the most that can be in flight.
  //
  // The browser sends CABLE_WINDOW bytes and then waits to be told they are in
  // the file system, so this is not sized against how fast USB can push - it
  // is sized against a number the device itself chose and announces. That is
  // the difference from what stood here before: 64 KB picked to be bigger than
  // the worst burst anybody had measured, on a protocol where a burst that was
  // bigger still would have been discarded in silence.
  //
  // Has to come before begin() - the buffer is allocated there.
  Serial.setRxBufferSize(CABLE_WINDOW);
  Serial.begin(115200);


  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    pinMode(PIN_BUTTON[i], INPUT_PULLUP);
  }
  const bool wokeFromSleep =
      esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1;

  // Let go of what goToSleep() held. Until this the pins keep the level they
  // slept at and pinMode/digitalWrite are quietly ignored, so the backlight
  // would stay dark for the whole session rather than the whole sleep.
  if (wokeFromSleep) {
    // Drive each pin to the level it was held at *before* letting go of it.
    // A hold released onto an unconfigured pin floats for the moment in
    // between, and on RST that moment is a reset - which would throw away the
    // very panels this is keeping alive. So: take over, then let go.
    pinMode(PIN_RST, OUTPUT);
    digitalWrite(PIN_RST, HIGH);
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      pinMode(PIN_CS[i], OUTPUT);
      digitalWrite(PIN_CS[i], HIGH);
    }
    pinMode(PIN_BL, OUTPUT);
    digitalWrite(PIN_BL, LOW);
    pinMode(PIN_AMP_SD, OUTPUT);
    digitalWrite(PIN_AMP_SD, LOW);

    gpio_deep_sleep_hold_dis();
    gpio_hold_dis((gpio_num_t)PIN_BL);
    gpio_hold_dis((gpio_num_t)PIN_AMP_SD);
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      gpio_hold_dis((gpio_num_t)PIN_CS[i]);
    }
    gpio_hold_dis((gpio_num_t)PIN_RST);
  }

  pinMode(PIN_BL, OUTPUT);
  backlight(false);  // switch on only once there is really a picture

  setupDisplays(wokeFromSleep);
  t_displays = millis();
  setupAudio();
  t_audio = millis();

  // Formats when there is nothing to mount, and that changed with the release
  // becoming program-only. The merged image covers the whole flash and leaves
  // the file area as 1536 KiB of 0xFF, so a device flashed from one comes up
  // with a partition that is there and holds no file system. With begin(false)
  // that is a device which cannot mount, and therefore cannot be written to
  // over the cable either - the one way content reaches it would be shut on
  // exactly the devices that have none.
  //
  // It is not a silent wipe. begin(true) formats only when a partition named
  // "spiffs" exists and carries no file system; a wrong partition scheme has
  // no such partition and still fails, so the hints below still point at the
  // right thing. What it can cost is the content on a file system that has
  // become unreadable - and that content is one press away in the editor,
  // while a talker that will not mount is a talker that cannot be given any.
  filesystemReady = LittleFS.begin(true);
  t_littlefs = millis();
  if (!filesystemReady) {
    // Most common cause: the wrong partition scheme. The board's default
    // (tinyuf2) creates the data area as "ffat", but LittleFS looks for a
    // partition called "spiffs". The right one is "Default 8MB".
    Serial.println("LittleFS would not mount, and would not format either.");
    Serial.println("  1. partition scheme \"Default (3MB APP/1.5MB SPIFFS)\"?");
    Serial.println("  2. if that is right, the flash itself is the suspect.");
  }

  // Only here, because the file system has to be up for it.
  contentReady = loadLayout();
  t_layout = millis();
  if (contentReady && rtcCurrentSet >= layout.setCount) rtcCurrentSet = 0;

  drawCurrentSet();
  t_drawn = millis();
  backlight(true);

  clearButtonStates();
  if (wokeFromSleep) {
    // The waking press expires: only the displays come on, nothing else.
    waitForRelease();
  }

  // Which build is actually running, and the settings that are usually the
  // question. On a device flashed a dozen times in an evening "did that
  // upload take?" is a real question, and guessing wastes more than the line
  // costs. Deep sleep restarts the sketch, so waking reprints it.
  //
  // Down here rather than beside Serial.begin(): on the S3's native USB the
  // port is not enumerated for the first moment after begin(), and anything
  // printed into that gap is simply lost. It was, which is how this comment
  // came to be written.
  Serial.printf("vorlaut build %s %s (amp wake %u ms, cable window %u)\n",
                __DATE__, __TIME__, (unsigned)AMP_WAKE_MS,
                (unsigned)CABLE_WINDOW);
  // How long the press-to-picture gap is. Everything up to here happens with
  // the backlight deliberately off, so this number is exactly how long the
  // device looks broken to somebody who has just pressed a key.
  readyMs = millis();
  wokeUp = wokeFromSleep;

  lastActivity = millis();
}

void loop() {
  if (!readySaid && millis() > 2500) {
    readySaid = true;
    Serial.printf("  ready %u ms after %s"
                  " (displays %u, audio %u, littlefs %u, layout %u, drawn %u)\n",
                  (unsigned)readyMs, wokeUp ? "waking" : "power-on",
                  (unsigned)t_displays, (unsigned)t_audio, (unsigned)t_littlefs,
                  (unsigned)t_layout, (unsigned)t_drawn);
  }

  // A browser on the cable comes first. Cable::waiting() is one call to
  // Serial.available() when nothing is there, and when something is there it
  // is the most explicit thing anybody can be doing with this device.
  //
  // Serve() returns at once unless a browser really says hello, so a serial
  // monitor left open costs a quarter of a second and nothing else.
  if (Cable::waiting()) {
    const CableResult cable = Cable::serve(cableProgress, cableAbort);
    if (cable.ran) {
      Serial.printf("cable: %u stored, %u removed, %u bytes%s%s\n",
                    cable.stored, cable.removed, (unsigned)cable.bytes,
                    cable.error ? " - " : "", cable.error ? cable.error : "");
      if (cable.stored || cable.removed) {
        // Read the new content in straight away. Otherwise the device would
        // go on showing yesterday until somebody restarts it, which is a bad
        // way to find out whether the transfer worked.
        contentReady = loadLayout();
        if (contentReady && rtcCurrentSet >= layout.setCount) rtcCurrentSet = 0;
      }
      delay(1500);            // long enough to read the count on the displays
      waitForRelease();
      if (mode == MODE_MENU) drawMenu(); else drawCurrentSet();
      lastActivity = millis();
      menuSince = millis();
      return;
    }
  }

  // The gesture takes precedence - otherwise letting go would count as a press.
  if (menuComboReady()) {
    if (mode == MODE_MENU) leaveMenu(); else enterMenu();
    // Both keys are still being held. Without the wait, the set key would
    // switch again 400 ms later.
    waitForRelease();
    lastActivity = millis();
    menuSince = millis();
    return;
  }
  if (comboSince != 0) {
    lastActivity = millis();
    delay(5);
    return;   // while the countdown runs, nothing else may trigger
  }

  int8_t pressed = pollButtons();
  if (pressed < 0 && pendingKey >= 0) {
    pressed = pendingKey;
    Serial.printf("key %d: was pressed while the last word played\n", pressed + 1);
  }
  pendingKey = -1;

  if (mode == MODE_MENU) {
    if (pressed == SET_BUTTON) {
      leaveMenu();
    } else if (pressed == 0) {
      drawInfo();
      menuSince = millis();
    }
    if (pressed >= 0) {
      lastActivity = millis();
      menuSince = millis();
    }
    // Do not get stuck in the menu: back after a while without input.
    if (millis() - menuSince >= MENU_IDLE_MS) leaveMenu();
    delay(5);
    return;
  }

  if (pressed >= 0) {
    lastActivity = millis();
    if (!contentReady) {
      // Without content there is nothing to switch and nothing to say. The
      // notice stays up, but the device does respond - it is not broken, it
      // is just empty.
      showNoContent();
      return;
    }
    if (pressed == SET_BUTTON) {
      rtcCurrentSet = (uint8_t)((rtcCurrentSet + 1) % layout.setCount);
      drawCurrentSet();
    } else {
      const Slot &slot = layout.sets[rtcCurrentSet].slots[pressed];
      if (slot.hasAudio) {
        char path[2 + HASH_BYTES * 2 + 5];
        hashPath(path, 'a', slot.audio, ".wav");
        Serial.printf("key %d: %s\n", pressed + 1, path);
        playWav(path);
      } else {
        Serial.printf("key %d: nothing to say\n", pressed + 1);
      }
    }
    lastActivity = millis();  // do not count playing time against the timeout
  }

// Overriding the idle timeout is for testing the sleep path, and it is kept
// rather than tidied away: at the real LAYOUT_SLEEP_DEFAULT of 600 s, every
// attempt at a bug that only shows on waking costs ten minutes of waiting,
// which is why that path went untested until it had four seconds of fault in
// it.
//
//   arduino-cli compile --build-property \
//     "compiler.cpp.extra_flags=-DFORCE_SLEEP_S=60" ...
#ifdef FORCE_SLEEP_S
  const uint32_t idle = FORCE_SLEEP_S;
#else
  // layoutIdleSeconds() rather than a `? :` with a number in it. It is in
  // layout_format.h, where a test can include it - this file is the one no
  // test can - and it is what keeps the multiplication below from wrapping.
  const uint32_t idle = layoutIdleSeconds(layout.sleepSeconds);
#endif
  if (millis() - lastActivity >= idle * 1000UL) {
    goToSleep();
  }

  delay(5);
}
