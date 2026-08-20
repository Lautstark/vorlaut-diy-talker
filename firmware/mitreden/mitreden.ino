// mitreden - kleiner Talker mit fünf Screenkey-Tasten
//
// Vier Tasten sprechen, die fünfte schaltet das Set um. Solange das Gerät
// wach ist, sind alle fünf Displays an. Nach SLEEP_TIMEOUT_SECONDS ohne
// Eingabe geht es in den Deep Sleep und wacht durch jede der fünf Tasten
// wieder auf - dieser erste Druck löst bewusst nichts aus.
//
// layout.h und der Inhalt von data/ werden von build.py erzeugt.

#include <Arduino.h>
#include <SPI.h>
#include <LittleFS.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <ESP_I2S.h>
#include <driver/rtc_io.h>
#include <esp_sleep.h>

#include "layout.h"

// --- Pinbelegung (Adafruit ESP32-S3 Feather) --------------------------------
// Die Taster müssen auf GPIO 0..21 liegen, nur die können den Chip aus dem
// Deep Sleep holen (EXT1).

static const int8_t PIN_SCK  = 36;  // SCK,  gemeinsam
static const int8_t PIN_MOSI = 35;  // MO,   gemeinsam
static const int8_t PIN_DC   = 9;   // D9,   gemeinsam
static const int8_t PIN_RST  = 10;  // D10,  gemeinsam
static const int8_t PIN_BL   = 3;   // SDA,  Hintergrundlicht aller Displays

static const uint8_t DISPLAY_COUNT = 5;
// Reihenfolge: Sprechtaste 1..4, dann die Set-Taste.
static const int8_t PIN_CS[DISPLAY_COUNT]     = { 11, 12, 13, 5, 6 };
static const uint8_t PIN_BUTTON[DISPLAY_COUNT] = { 18, 17, 16, 15, 14 };
static const uint8_t SET_BUTTON = 4;  // Index der Set-Taste

static const int8_t PIN_I2S_BCLK = 8;   // A5
static const int8_t PIN_I2S_LRCK = 38;  // RX
static const int8_t PIN_I2S_DIN  = 39;  // TX
static const int8_t PIN_AMP_SD   = 4;   // SCL, MAX98357A SD: LOW = stumm

// Manche 128x128-Panels sitzen um ein paar Pixel versetzt. Falls ein Rand
// stehen bleibt, hier korrigieren.
static const int8_t PANEL_COL_OFFSET = 2;
static const int8_t PANEL_ROW_OFFSET = 3;
static const uint8_t PANEL_ROTATION = 0;

// --- Verhalten ---------------------------------------------------------------

static const uint32_t DEBOUNCE_MS = 80;    // so lange muss gedrückt bleiben
// Die Set-Taste braucht länger. Ein versehentlicher Wechsel nimmt ihr das
// Wort weg, das sie gerade sagen wollte, und sie muss erst wiederfinden, wo
// sie ist - das ist ärgerlicher als ein falsch getroffenes Wort.
static const uint32_t SET_HOLD_MS = 400;
static const uint32_t SAMPLE_RATE = 16000; // wie build.py die WAVs schreibt
static const size_t AUDIO_CHUNK = 1024;

// --- Zustand -----------------------------------------------------------------

// setColRowStart ist in der Bibliothek protected. Diese Ableitung macht den
// Panel-Versatz zugänglich, ohne die Bibliothek anzufassen.
class Panel : public Adafruit_ST7735 {
 public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void setOffsets(int8_t col, int8_t row) { setColRowStart(col, row); }
};

// Ueberlebt den Deep Sleep: sie soll im selben Set aufwachen.
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

// --- Displays ----------------------------------------------------------------

static void setupDisplays() {
  // RST hängt an allen fünf Panels. Deshalb einmal von Hand pulsen und den
  // Treibern -1 geben - sonst würde die Initialisierung von Display 3 die
  // Displays 1 und 2 wieder zurücksetzen.
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

// Zeichnet den Rahmen in der Set-Farbe und darin die Symbolfläche aus der
// Datei (TILE_W x TILE_H, RGB565 big-endian).
//
// Der Rahmen steht bewusst nicht in der Datei: so hängt eine Bilddatei nur am
// Symbol und nicht am Set. Dasselbe Symbol in einem blauen und einem grünen
// Set ist damit eine Datei statt zweien.
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
    // bigEndian = true: die Bytes gehen genau so raus, wie sie in der Datei
    // stehen. build.py schreibt sie bereits in Panel-Reihenfolge.
    tft->writePixels(line, TILE_W, true, true);
  }
  tft->endWrite();
  file.close();
}

static void drawCurrentSet() {
#if SET_COUNT > 0
  const uint8_t s = rtcCurrentSet;
  const uint16_t frame = SET_COLORS[s];
  for (uint8_t i = 0; i < SLOT_COUNT && i < DISPLAY_COUNT - 1; i++) {
    drawTile(display[i], SLOT_IMAGE[s][i], frame);
  }
  drawTile(display[SET_BUTTON], SET_LABEL_IMAGE[s], frame);
  Serial.printf("Set %u: %s\n", (unsigned)(s + 1), SET_NAMES[s]);
#else
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) display[i]->fillScreen(ST77XX_BLACK);
  Serial.println("layout.h enthält keine Sets.");
#endif
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

// Sucht den data-Chunk im WAV. Liefert false, wenn die Datei nicht passt.
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
  // Ein Slot ohne Text hat keine Tondatei - dann bleibt es still.
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

  // Etwas Stille nachschieben, sonst knackt es beim Abschalten.
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

// Nach dem Aufwachen: warten, bis wirklich keine Taste mehr gedrückt ist.
// Der Druck, der geweckt hat, darf nichts auslösen - sie drückt ja blind.
static void waitForRelease() {
  while (anyDown()) delay(10);
  delay(DEBOUNCE_MS);
  clearButtonStates();
}

// Wie lange diese Taste gehalten werden muss, bevor sie auslöst.
static uint32_t holdTime(uint8_t index) {
  return index == SET_BUTTON ? SET_HOLD_MS : DEBOUNCE_MS;
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

  // Pull-ups müssen im Schlaf aktiv bleiben, sonst floaten die Eingänge.
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
    // Häufigste Ursache: falsches Partitionsschema. Die Voreinstellung des
    // Boards (tinyuf2) legt den Datenbereich als "ffat" an, LittleFS sucht
    // aber eine Partition namens "spiffs". Richtig ist "Default 8MB".
    Serial.println("LittleFS ließ sich nicht einhängen.");
    Serial.println("  1. Partitionsschema \"Default (3MB APP/1.5MB SPIFFS)\"?");
    Serial.println("  2. firmware/mitreden/data/ schon hochgeladen?");
  }

#if SET_COUNT > 0
  if (rtcCurrentSet >= SET_COUNT) rtcCurrentSet = 0;
#endif

  drawCurrentSet();
  backlight(true);

  clearButtonStates();
  if (wokeFromSleep) {
    // Weckdruck verfällt: nur die Displays gehen an, sonst nichts.
    waitForRelease();
  }

  lastActivity = millis();
}

void loop() {
  const int8_t pressed = pollButtons();

  if (pressed >= 0) {
    lastActivity = millis();
#if SET_COUNT > 0
    if (pressed == SET_BUTTON) {
      rtcCurrentSet = (uint8_t)((rtcCurrentSet + 1) % SET_COUNT);
      drawCurrentSet();
    } else {
      Serial.printf("Taste %d: %s\n", pressed + 1,
                    SLOT_TEXT[rtcCurrentSet][pressed]);
      playWav(SLOT_AUDIO[rtcCurrentSet][pressed]);
    }
#endif
    lastActivity = millis();  // Spielzeit nicht auf den Timeout anrechnen
  }

  if (millis() - lastActivity >= (uint32_t)SLEEP_TIMEOUT_SECONDS * 1000UL) {
    goToSleep();
  }

  delay(5);
}
