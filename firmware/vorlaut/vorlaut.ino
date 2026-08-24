// vorlaut - small talker with five Screenkey buttons
//
// Four keys speak, the fifth switches the set. While the device is awake all
// five displays are on. After the configured idle time it goes into deep
// sleep and wakes on any of the five keys - that first press deliberately
// triggers nothing.
//
// layout.h and the contents of data/ are produced by build.py.

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
#define TILE_BORDER 6
#define TILE_W (DISPLAY_W - 2 * TILE_BORDER)
#define TILE_H (DISPLAY_H - 2 * TILE_BORDER)

// --- Structure of the content ------------------------------------------------
// How many sets there are, which colours and which file belongs to which key
// is NOT in the firmware but in /layout.bin on the file system. Otherwise a
// new set would have to be flashed over a cable.
//
// Structure and read logic live in layout_format.h - the same file gets
// compiled on the computer by tests/test_layout_format.py and checked against
// a real layout.bin.
#include "layout_format.h"
#define LAYOUT_FILE "/layout.bin"

#include "pins.h"

// Everything the device shows in words, and the way it gets onto a panel
// that only knows code page 437.
#include "texts.h"
#include "panel_text.h"

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
static const uint32_t SAMPLE_RATE = 16000; // the rate build.py writes the WAVs at
static const size_t AUDIO_CHUNK = 1024;
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
};

static Layout layout;

// Builds the file name out of 16 hash bytes: /t<32 hex>.bin or /a....wav
static void hashPath(char *out, char kind, const uint8_t *hash, const char *ext) {
  out[0] = '/';
  out[1] = kind;
  for (uint8_t i = 0; i < HASH_BYTES; i++) {
    sprintf(out + 2 + i * 2, "%02x", hash[i]);
  }
  strcpy(out + 2 + HASH_BYTES * 2, ext);
}

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

static void setupDisplays() {
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
    display[i]->setRotation(PANEL_ROTATION);
    // Without this the font treats bytes above 0x7F as a legacy special case
    // and draws the wrong glyph. With it they are code page 437, which is
    // what panel_text.h converts to.
    display[i]->cp437(true);
    display[i]->fillScreen(ST77XX_BLACK);
  }
}

// Draws the border in the set colour and inside it the symbol area from the
// file (TILE_W x TILE_H, RGB565 big-endian).
//
// The border deliberately is not in the file: that way an image file depends
// on the symbol alone and not on the set. The same symbol in a blue and in a
// green set is therefore one file instead of two.
static void drawTile(Panel *tft, const char *path, uint16_t frame) {
  tft->fillRect(0, 0, DISPLAY_W, TILE_BORDER, frame);
  tft->fillRect(0, DISPLAY_H - TILE_BORDER, DISPLAY_W, TILE_BORDER, frame);
  tft->fillRect(0, TILE_BORDER, TILE_BORDER, TILE_H, frame);
  tft->fillRect(DISPLAY_W - TILE_BORDER, TILE_BORDER, TILE_BORDER, TILE_H, frame);

  static uint16_t line[TILE_W];

  File file = (filesystemReady && path) ? LittleFS.open(path, "r") : File();
  if (!file) {
    if (path) Serial.printf("missing: %s\n", path);
    tft->fillRect(TILE_BORDER, TILE_BORDER, TILE_W, TILE_H, ST77XX_BLACK);
    return;
  }

  tft->startWrite();
  tft->setAddrWindow(TILE_BORDER, TILE_BORDER, TILE_W, TILE_H);
  for (uint16_t y = 0; y < TILE_H; y++) {
    size_t got = file.read((uint8_t *)line, sizeof(line));
    if (got < sizeof(line)) {
      memset((uint8_t *)line + got, 0, sizeof(line) - got);
    }
    // bigEndian = true: the bytes go out exactly as they stand in the file.
    // build.py already writes them in panel order.
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
    drawTile(display[i], path, e.color);
  }
  hashPath(path, 't', e.label, ".bin");
  drawTile(display[SET_BUTTON], path, e.color);
  Serial.printf("set %u: %s\n", (unsigned)(rtcCurrentSet + 1), e.name);
}

// --- Menu --------------------------------------------------------------------
//
// Deliberately without files: text and frame are drawn. That way the menu
// works on a freshly flashed device with nothing on it yet - and that is
// exactly where it is needed first.
//
// Grey frame instead of the set colour: one sees at a glance that this is not
// the talker.
static const uint16_t MENU_FRAME = 0x8410;   // mid grey in RGB565

static void drawMenuKey(Panel *tft, const char *first, const char *second) {
  tft->fillRect(0, 0, DISPLAY_W, TILE_BORDER, MENU_FRAME);
  tft->fillRect(0, DISPLAY_H - TILE_BORDER, DISPLAY_W, TILE_BORDER, MENU_FRAME);
  tft->fillRect(0, TILE_BORDER, TILE_BORDER, TILE_H, MENU_FRAME);
  tft->fillRect(DISPLAY_W - TILE_BORDER, TILE_BORDER, TILE_BORDER, TILE_H,
                MENU_FRAME);
  tft->fillRect(TILE_BORDER, TILE_BORDER, TILE_W, TILE_H, ST77XX_BLACK);
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

// Finds the data chunk in the WAV. Returns false if the file does not fit.
static bool seekToWavData(File &file, uint32_t &dataBytes) {
  char header[12];
  if (file.read((uint8_t *)header, 12) != 12) return false;
  if (memcmp(header, "RIFF", 4) != 0 || memcmp(header + 8, "WAVE", 4) != 0) {
    return false;
  }
  while (file.available() >= 8) {
    char id[4];
    uint32_t size = 0;
    if (file.read((uint8_t *)id, 4) != 4) return false;
    if (file.read((uint8_t *)&size, 4) != 4) return false;  // WAV is little-endian
    if (memcmp(id, "data", 4) == 0) {
      dataBytes = size;
      return true;
    }
    file.seek(file.position() + size + (size & 1));  // chunks have an even length
  }
  return false;
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
  // be a fraction of another and there is no volume control to make up for
  // it. A word that is merely quiet and a word that is silent look identical
  // from the outside, and this is the difference between them.
  int16_t peak = 0;
  const uint32_t sampleBytes = remaining;
  const uint32_t began = millis();

  while (remaining > 0) {
    size_t want = remaining < AUDIO_CHUNK ? remaining : AUDIO_CHUNK;
    size_t got = file.read(chunk, want);
    if (got == 0) break;
    for (size_t i = 0; i + 1 < got; i += 2) {
      int16_t sample = (int16_t)((uint16_t)chunk[i] | ((uint16_t)chunk[i + 1] << 8));
      if (sample == INT16_MIN) sample = INT16_MAX;
      if (sample < 0) sample = (int16_t)-sample;
      if (sample > peak) peak = sample;
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
  // Room for the browser to be ahead of the flash. A push arrives in 4096
  // byte chunks as fast as USB will carry them, and this loop can only take
  // CABLE_CHUNK at a time and then spends tens of milliseconds inside
  // file.write() - during which nothing is read and everything that lands is
  // dropped. USB CDC has no way to say it overflowed, so the loss is silent:
  // the browser reports every chunk written, the device never sees the end of
  // the file, and it times out with "short" pointing at a browser that did
  // nothing wrong. The default 256 bytes is a quarter of one USB frame's
  // worth of that burst.
  //
  // Has to come before begin() - the buffer is allocated there.
  Serial.setRxBufferSize(CABLE_RX_BUFFER);
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
    gpio_deep_sleep_hold_dis();
    gpio_hold_dis((gpio_num_t)PIN_BL);
    gpio_hold_dis((gpio_num_t)PIN_AMP_SD);
  }

  pinMode(PIN_BL, OUTPUT);
  backlight(false);  // switch on only once there is really a picture

  setupDisplays();
  setupAudio();

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
  if (contentReady && rtcCurrentSet >= layout.setCount) rtcCurrentSet = 0;

  drawCurrentSet();
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
  Serial.printf("vorlaut build %s %s (amp wake %u ms, rx buffer %u)\n",
                __DATE__, __TIME__, (unsigned)AMP_WAKE_MS,
                (unsigned)CABLE_RX_BUFFER);
  // How long the press-to-picture gap is. Everything up to here happens with
  // the backlight deliberately off, so this number is exactly how long the
  // device looks broken to somebody who has just pressed a key.
  Serial.printf("  ready %u ms after %s\n", (unsigned)millis(),
                wokeFromSleep ? "waking" : "power-on");

  lastActivity = millis();
}

void loop() {
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

  const uint32_t idle = layout.sleepSeconds ? layout.sleepSeconds : 600;
  if (millis() - lastActivity >= idle * 1000UL) {
    goToSleep();
  }

  delay(5);
}
