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

// --- Fetching content --------------------------------------------------------
//
// Wi-Fi is off during normal use and only comes up when somebody asks for it
// in the menu. The device wakes on a key press and has to speak immediately;
// bringing up a radio on every wake would cost seconds and most of the
// battery, for something that is needed once a week at most.
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include "sync.h"

// How long the setup portal stays open before the device gives up and goes
// back to being a talker. A device stuck in a portal no longer speaks.
static const uint32_t PORTAL_TIMEOUT_S = 180;
static Preferences settings;

// --- Behaviour ---------------------------------------------------------------

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
    display[i]->initR(INITR_144GREENTAB);  // 128x128
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
static void drawMenu() {
  drawMenuKey(display[0], text().info, nullptr);
  drawMenuKey(display[1], text().fetch1, text().fetch2);
  drawMenuKey(display[2], nullptr, nullptr);
  drawMenuKey(display[3], nullptr, nullptr);
  drawMenuKey(display[SET_BUTTON], text().back, nullptr);
}

// --- Fetching -----------------------------------------------------------
//
// All five displays show the same thing while this runs. It takes seconds,
// and a device that looks switched off during them invites a second press.

static void showOnAll(const char *first, const char *second) {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    drawMenuKey(display[i], first, second);
  }
}

static void syncProgress(uint16_t done, uint16_t total) {
  char count[12];
  snprintf(count, sizeof(count), "%u/%u", done, total);
  showOnAll(text().loading, count);
}

// A reason in one word. The serial monitor gets the English sentence from
// sync.h; this is what fits on a panel.
static const char *reasonFor(SyncError code) {
  switch (code) {
    case SYNC_NO_NETWORK:    return text().noWifi;
    case SYNC_NO_SERVER:     return text().noServer;
    case SYNC_BAD_KEY:       return text().badKey;
    case SYNC_SWITCHED_OFF:  return text().switchedOff;
    default:                 return nullptr;
  }
}

static void fetchContent() {
  showOnAll(text().wifi, nullptr);

  settings.begin("vorlaut", false);
  String host = settings.getString("host", "");
  const uint16_t port = settings.getUShort("port", 8771);
  String token = settings.getString("token", "");

  WiFiManager wm;
  WiFiManagerParameter hostField("host", "Computer (IP or name)",
                                 host.c_str(), 40);
  WiFiManagerParameter portField("port", "Port", String(port).c_str(), 6);
  WiFiManagerParameter tokenField("token", "Key (VORLAUT_DEVICE_TOKEN)",
                                  token.c_str(), 64);
  wm.addParameter(&hostField);
  wm.addParameter(&portField);
  wm.addParameter(&tokenField);
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);

  if (!wm.autoConnect("vorlaut einrichten")) {
    Serial.println("no Wi-Fi, and the portal has timed out.");
    showOnAll(text().failed, text().noWifi);
    delay(3000);
    WiFi.mode(WIFI_OFF);
    return;
  }
  // Only write what changed - NVS has a limited number of erase cycles.
  if (host != hostField.getValue()) {
    host = hostField.getValue();
    settings.putString("host", host);
  }
  if (port != (uint16_t)atoi(portField.getValue())) {
    settings.putUShort("port", (uint16_t)atoi(portField.getValue()));
  }
  if (token != tokenField.getValue()) {
    token = tokenField.getValue();
    settings.putString("token", token);
  }

  Serial.printf("Wi-Fi %s, fetching from %s:%u\n", WiFi.SSID().c_str(),
                host.c_str(), settings.getUShort("port", 8771));
  Sync sync(host, settings.getUShort("port", 8771), token);
  const SyncStatus status = sync.run(syncProgress);
  WiFi.mode(WIFI_OFF);   // straight back off, it costs power

  if (!status.ok) {
    Serial.printf("sync failed: %s\n", status.error);
    showOnAll(text().failed, reasonFor(status.code));
    delay(4000);
    return;
  }
  Serial.printf("sync: %u fetched, %u already here, %u deleted, %u bytes\n",
                status.fetched, status.kept, status.removed,
                (unsigned)status.bytes);
  char count[12];
  snprintf(count, sizeof(count), "%u", status.fetched);
  showOnAll(text().done, count);
  delay(2500);

  // Read the new content in immediately. Otherwise the device would keep
  // showing yesterday until somebody restarts it, which is a bad way to find
  // out whether the sync worked.
  contentReady = loadLayout();
  if (contentReady && rtcCurrentSet >= layout.setCount) rtcCurrentSet = 0;
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
  delay(5);  // let the amplifier wake up

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
  backlight(false);  // switch on only once there is really a picture

  const bool wokeFromSleep =
      esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1;

  setupDisplays();
  setupAudio();

  filesystemReady = LittleFS.begin(false);
  if (!filesystemReady) {
    // Most common cause: the wrong partition scheme. The board's default
    // (tinyuf2) creates the data area as "ffat", but LittleFS looks for a
    // partition called "spiffs". The right one is "Default 8MB".
    Serial.println("LittleFS would not mount.");
    Serial.println("  1. partition scheme \"Default (3MB APP/1.5MB SPIFFS)\"?");
    Serial.println("  2. firmware/vorlaut/data/ uploaded yet?");
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
    return;   // while the countdown runs, nothing else may trigger
  }

  const int8_t pressed = pollButtons();

  if (mode == MODE_MENU) {
    if (pressed == SET_BUTTON) {
      leaveMenu();
    } else if (pressed == 0) {
      drawInfo();
      menuSince = millis();
    } else if (pressed == 1) {
      fetchContent();
      // Whatever happened, the menu is where we came from. Both keys may
      // still be held after minutes at the portal.
      waitForRelease();
      drawMenu();
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
