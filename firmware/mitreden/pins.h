// Pinbelegung für den Adafruit ESP32-S3 Feather.
//
// Liegt in einer eigenen Datei, damit die Testsketche unter firmware/tests/
// dieselbe Belegung benutzen wie die Firmware - sonst prüft man am Ende etwas
// anderes, als man später betreibt.

#pragma once

// Die Taster müssen auf GPIO 0..21 liegen, nur die können den Chip aus dem
// Deep Sleep holen (EXT1).

static const int8_t PIN_SCK  = 36;  // SCK,  gemeinsam
static const int8_t PIN_MOSI = 35;  // MO,   gemeinsam
static const int8_t PIN_DC   = 9;   // D9,   gemeinsam
static const int8_t PIN_RST  = 10;  // D10,  gemeinsam
static const int8_t PIN_BL   = 3;   // SDA,  Hintergrundlicht aller Displays

static const uint8_t DISPLAY_COUNT = 5;
// Reihenfolge: Sprechtaste 1..4, dann die Set-Taste.
//
// CS für Display 3 liegt auf 37 (MISO) statt auf 13. GPIO 13 ist beim Feather
// die eingebaute rote LED - die soll als Lebenszeichen frei bleiben. MISO wird
// nicht gebraucht, die Displays werden nur beschrieben.
static const int8_t PIN_CS[DISPLAY_COUNT]      = { 11, 12, 37, 5, 6 };
static const uint8_t PIN_BUTTON[DISPLAY_COUNT] = { 18, 17, 16, 15, 14 };
static const uint8_t SET_BUTTON = 4;  // Index der Set-Taste

static const int8_t PIN_I2S_BCLK = 8;   // A5
static const int8_t PIN_I2S_LRCK = 38;  // RX
static const int8_t PIN_I2S_DIN  = 39;  // TX
static const int8_t PIN_AMP_SD   = 4;   // SCL, MAX98357A SD: LOW = stumm

// Manche 128x128-Panels sitzen um ein paar Pixel versetzt. Falls ein Rand
// stehen bleibt, hier korrigieren - test2_display zeigt es.
static const int8_t PANEL_COL_OFFSET = 2;
static const int8_t PANEL_ROW_OFFSET = 3;
static const uint8_t PANEL_ROTATION = 0;
