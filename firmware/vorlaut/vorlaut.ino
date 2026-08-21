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
#include <esp_sleep.h>

// --- Anzeige ----------------------------------------------------------------
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

// --- Verhalten ---------------------------------------------------------------

static const uint32_t DEBOUNCE_MS = 80;    // so lange muss gedrückt bleiben
// The set key needs longer. An accidental switch takes away the word she was
// about to say, and she first has to find her way back - that is more annoying
// than hitting the wrong word.
static const uint32_t SET_HOLD_MS = 400;
// The menu is reached only by two keys at once, held for five seconds. Those
// two sit diagonally furthest apart - hard to hit with a child's hand. While
// holding, a countdown runs; whoever lets go
// bricht ab.
static const uint32_t MENU_HOLD_MS = 5000;
static const uint8_t MENU_KEY_A = SET_BUTTON;   // Set-Taste
static const uint8_t MENU_KEY_B = 1;            // Taste 2, diagonal gegenüber
// Back to normal operation without input. A device stuck in the menu no
// longer speaks - that must not happen.
static const uint32_t MENU_IDLE_MS = 30000;
static const uint32_t SAMPLE_RATE = 16000; // wie build.py die WAVs schreibt
static const size_t AUDIO_CHUNK = 1024;

// --- Zustand -----------------------------------------------------------------

// setColRowStart is protected in the library. This subclass makes the panel
// offset reachable without touching the library.
class Panel : public Adafruit_ST7735 {
 public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void setOffsets(int8_t col, int8_t row) { setColRowStart(col, row); }
};

static Layout layout;

// Aus 16 Hash-Bytes den Dateinamen bauen: /t<32 hex>.bin bzw. /a….wav
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
  uint32_t downSince;  // 0 = losgelassen
  bool reported;       // Druck wurde schon behandelt
};
static ButtonState button[DISPLAY_COUNT];

static uint32_t lastActivity = 0;
static bool filesystemReady = false;
static bool contentReady = true;

enum Mode { MODE_NORMAL, MODE_MENU };
static Mode mode = MODE_NORMAL;
static uint32_t menuSince = 0;
static uint32_t comboSince = 0;   // seit wann beide Menütasten gehalten werden
static int8_t countdownShown = -1;

// --- Inhalte laden -----------------------------------------------------------

// Reads /layout.bin and hands it to parseLayout from layout_format.h. If the
// file is missing or does not fit, there simply is no content yet - that is
// not an error but the state after the first flash.
static bool loadLayout() {
  if (!filesystemReady) return false;
  File file = LittleFS.open(LAYOUT_FILE, "r");
  if (!file) {
    Serial.println("layout.bin fehlt - noch keine Inhalte auf dem Gerät.");
    return false;
  }
  static uint8_t puffer[LAYOUT_MAX_BYTES];
  const size_t gelesen = file.read(puffer, sizeof(puffer));
  file.close();

  const LayoutResult ergebnis = parseLayout(puffer, (uint32_t)gelesen, layout);
  if (ergebnis != LAYOUT_OK) {
    Serial.printf("layout.bin unbrauchbar (Grund %d, %u Byte)\n",
                  (int)ergebnis, (unsigned)gelesen);
    return false;
  }
  Serial.printf("layout.bin: %u Set(s), Schlafzeit %u s\n",
                layout.setCount, layout.sleepSeconds);
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
    display[i]->initR(INITR_144GREENTAB);  // 128x128
    display[i]->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
    display[i]->setRotation(PANEL_ROTATION);
    display[i]->fillScreen(ST77XX_BLACK);
  }
}

// Draws the border in the set colour and inside it the symbol area from the
// Datei (TILE_W x TILE_H, RGB565 big-endian).
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
    if (path) Serial.printf("fehlt: %s\n", path);
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
static void drawMessage(Panel *tft, const char *zeile1, const char *zeile2) {
  tft->fillScreen(ST77XX_BLACK);
  tft->setTextColor(ST77XX_WHITE);
  const uint8_t groesse = 2;
  tft->setTextSize(groesse);
  const int16_t zeichen = 6 * groesse, hoehe = 8 * groesse;
  for (uint8_t i = 0; i < 2; i++) {
    const char *text = i == 0 ? zeile1 : zeile2;
    if (!text || !*text) continue;
    int16_t breite = (int16_t)strlen(text) * zeichen;
    tft->setCursor((DISPLAY_W - breite) / 2,
                   DISPLAY_H / 2 - hoehe + i * (hoehe + 4));
    tft->print(text);
  }
}

// All five displays with the same notice, so it cannot be missed.
static void showNoContent() {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    drawMessage(display[i], "keine", "Inhalte");
  }
  Serial.println("Keine Inhalte auf dem Gerät.");
  Serial.println("  Inhalte bauen und aufspielen - siehe docs/firmware.md");
}

static void drawCurrentSet() {
  if (!contentReady) {
    showNoContent();
    return;
  }
  const SetEntry &e = layout.sets[rtcCurrentSet];
  char pfad[2 + HASH_BYTES * 2 + 5];
  for (uint8_t i = 0; i < SLOT_COUNT && i < DISPLAY_COUNT - 1; i++) {
    hashPath(pfad, 't', e.slots[i].image, ".bin");
    drawTile(display[i], pfad, e.color);
  }
  hashPath(pfad, 't', e.label, ".bin");
  drawTile(display[SET_BUTTON], pfad, e.color);
  Serial.printf("Set %u: %s\n", (unsigned)(rtcCurrentSet + 1), e.name);
}

// --- Menu --------------------------------------------------------------------
//
// Deliberately without files: text and frame are drawn. That way the menu
// works on a freshly flashed device with nothing on it yet - and that is
// exactly where it is needed first.
//
// Grey frame instead of the set colour: one sees at a glance that this is not
// the talker.
static const uint16_t MENU_FRAME = 0x8410;   // mittleres Grau in RGB565

static void drawMenuKey(Panel *tft, const char *zeile1, const char *zeile2) {
  tft->fillRect(0, 0, DISPLAY_W, TILE_BORDER, MENU_FRAME);
  tft->fillRect(0, DISPLAY_H - TILE_BORDER, DISPLAY_W, TILE_BORDER, MENU_FRAME);
  tft->fillRect(0, TILE_BORDER, TILE_BORDER, TILE_H, MENU_FRAME);
  tft->fillRect(DISPLAY_W - TILE_BORDER, TILE_BORDER, TILE_BORDER, TILE_H,
                MENU_FRAME);
  tft->fillRect(TILE_BORDER, TILE_BORDER, TILE_W, TILE_H, ST77XX_BLACK);
  if (!zeile1 && !zeile2) return;   // unbelegte Taste bleibt leer

  tft->setTextColor(ST77XX_WHITE);
  tft->setTextSize(2);
  const int16_t zeichen = 12, hoehe = 16;
  for (uint8_t i = 0; i < 2; i++) {
    const char *text = i == 0 ? zeile1 : zeile2;
    if (!text || !*text) continue;
    int16_t breite = (int16_t)strlen(text) * zeichen;
    tft->setCursor((DISPLAY_W - breite) / 2,
                   DISPLAY_H / 2 - hoehe + i * (hoehe + 4));
    tft->print(text);
  }
}

// Only show what actually exists. Entries appear once the function behind
// them exists - not before.
static void drawMenu() {
  drawMenuKey(display[0], "Info", nullptr);
  drawMenuKey(display[1], nullptr, nullptr);
  drawMenuKey(display[2], nullptr, nullptr);
  drawMenuKey(display[3], nullptr, nullptr);
  drawMenuKey(display[SET_BUTTON], "zurück", nullptr);
}

static void drawInfo() {
  char zeile[24];
  drawMenuKey(display[0], "Sets", nullptr);
  snprintf(zeile, sizeof(zeile), "%u", (unsigned)(contentReady ? layout.setCount : 0));
  drawMenuKey(display[1], zeile, nullptr);

  drawMenuKey(display[2], "Datei-", "system");
  drawMenuKey(display[3], filesystemReady ? "da" : "fehlt", nullptr);
  drawMenuKey(display[SET_BUTTON], "zurück", nullptr);

  if (filesystemReady) {
    Serial.printf("LittleFS: %u von %u Byte belegt\n",
                  (unsigned)LittleFS.usedBytes(), (unsigned)LittleFS.totalBytes());
  }
}

static void enterMenu() {
  mode = MODE_MENU;
  menuSince = millis();
  countdownShown = -1;
  Serial.println("Menü geöffnet");
  drawMenu();
}

static void leaveMenu() {
  mode = MODE_NORMAL;
  countdownShown = -1;
  Serial.println("Menü verlassen");
  drawCurrentSet();
}

static void backlight(bool on) {
  digitalWrite(PIN_BL, on ? HIGH : LOW);
}

// --- Ton ---------------------------------------------------------------------

static void setupAudio() {
  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);  // Verstärker aus, bis wirklich etwas kommt

  i2s.setPins(PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DIN);
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_MONO)) {
    Serial.println("I2S ließ sich nicht starten.");
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
    if (file.read((uint8_t *)&size, 4) != 4) return false;  // WAV ist little-endian
    if (memcmp(id, "data", 4) == 0) {
      dataBytes = size;
      return true;
    }
    file.seek(file.position() + size + (size & 1));  // Chunks sind gerade lang
  }
  return false;
}

static void playWav(const char *path) {
  // A slot without text has no audio file - then it stays silent.
  if (!filesystemReady || !path) return;
  File file = LittleFS.open(path, "r");
  if (!file) {
    Serial.printf("kein Ton: %s\n", path);
    return;
  }
  uint32_t remaining = 0;
  if (!seekToWavData(file, remaining)) {
    Serial.printf("kein gültiges WAV: %s\n", path);
    file.close();
    return;
  }

  static uint8_t chunk[AUDIO_CHUNK];
  digitalWrite(PIN_AMP_SD, HIGH);
  delay(5);  // Verstärker kurz wach werden lassen

  while (remaining > 0) {
    size_t want = remaining < AUDIO_CHUNK ? remaining : AUDIO_CHUNK;
    size_t got = file.read(chunk, want);
    if (got == 0) break;
    i2s.write(chunk, got);
    remaining -= got;
  }

  // Push a little silence after it, otherwise it clicks on switch-off.
  memset(chunk, 0, AUDIO_CHUNK);
  for (uint8_t i = 0; i < 8; i++) i2s.write(chunk, AUDIO_CHUNK);
  digitalWrite(PIN_AMP_SD, LOW);
  file.close();
}

// --- Tasten ------------------------------------------------------------------

static bool isDown(uint8_t index) {
  return digitalRead(PIN_BUTTON[index]) == LOW;  // Taster gegen GND
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

// Both menu keys held? Shows the countdown and reports when the five
// Sekunden voll sind. Loslassen bricht ab, ohne dass etwas passiert.
static bool menuComboReady() {
  const uint32_t jetzt = millis();
  if (!(isDown(MENU_KEY_A) && isDown(MENU_KEY_B))) {
    if (comboSince != 0 && countdownShown >= 0) {
      // Cancelled: back to whatever was on screen before.
      countdownShown = -1;
      if (mode == MODE_MENU) drawMenu(); else drawCurrentSet();
    }
    comboSince = 0;
    return false;
  }
  if (comboSince == 0) comboSince = jetzt;
  const uint32_t gehalten = jetzt - comboSince;
  if (gehalten >= MENU_HOLD_MS) {
    comboSince = 0;
    countdownShown = -1;
    return true;
  }
  const int8_t rest = (int8_t)((MENU_HOLD_MS - gehalten) / 1000) + 1;
  if (rest != countdownShown) {
    countdownShown = rest;
    char zahl[4];
    snprintf(zahl, sizeof(zahl), "%d", rest);
    for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
      drawMenuKey(display[i], "Menü", zahl);
    }
  }
  return false;
}

// Liefert den Index einer frisch erkannten Taste oder -1.
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

// --- Schlafen ----------------------------------------------------------------

static void goToSleep() {
  Serial.println("schlafen");
  Serial.flush();

  backlight(false);
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    display[i]->fillScreen(ST77XX_BLACK);
    display[i]->sendCommand(ST77XX_DISPOFF);
    display[i]->sendCommand(ST77XX_SLPIN);
  }

  digitalWrite(PIN_AMP_SD, LOW);
  i2s.end();

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
  Serial.begin(115200);

  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    pinMode(PIN_BUTTON[i], INPUT_PULLUP);
  }
  pinMode(PIN_BL, OUTPUT);
  backlight(false);  // erst einschalten, wenn wirklich ein Bild steht

  const bool wokeFromSleep =
      esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1;

  setupDisplays();
  setupAudio();

  filesystemReady = LittleFS.begin(false);
  if (!filesystemReady) {
    // Most common cause: the wrong partition scheme. The default of the
    // Boards (tinyuf2) legt den Datenbereich als "ffat" an, LittleFS sucht
    // but a partition called "spiffs". The right one is "Default 8MB".
    Serial.println("LittleFS ließ sich nicht einhängen.");
    Serial.println("  1. Partition Scheme \"Default (3MB APP/1.5MB SPIFFS)\"?");
    Serial.println("  2. firmware/vorlaut/data/ schon hochgeladen?");
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

  lastActivity = millis();
}

void loop() {
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
    return;   // während des Countdowns nichts anderes auslösen
  }

  const int8_t pressed = pollButtons();

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
        char pfad[2 + HASH_BYTES * 2 + 5];
        hashPath(pfad, 'a', slot.audio, ".wav");
        Serial.printf("Taste %d: %s\n", pressed + 1, pfad);
        playWav(pfad);
      } else {
        Serial.printf("Taste %d: kein Ton hinterlegt\n", pressed + 1);
      }
    }
    lastActivity = millis();  // Spielzeit nicht auf den Timeout anrechnen
  }

  const uint32_t schlaf = layout.sleepSeconds ? layout.sleepSeconds : 600;
  if (millis() - lastActivity >= schlaf * 1000UL) {
    goToSleep();
  }

  delay(5);
}
