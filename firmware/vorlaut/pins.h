// Pin assignment for the Adafruit ESP32-S3 Feather.
//
// Lives in its own file so the test sketches under firmware/tests/ use the
// same assignment as the firmware - otherwise one ends up checking something
// other than what will later be running.

#pragma once

// The buttons have to sit on GPIO 0..21, only those can bring the chip out
// of deep sleep (EXT1).

static const int8_t PIN_SCK  = 36;  // SCK,  gemeinsam
static const int8_t PIN_MOSI = 35;  // MO,   gemeinsam
static const int8_t PIN_DC   = 9;   // D9,   gemeinsam
static const int8_t PIN_RST  = 10;  // D10,  gemeinsam
static const int8_t PIN_BL   = 3;   // SDA,  Hintergrundlicht aller Displays

static const uint8_t DISPLAY_COUNT = 5;
// Order: speech keys 1..4, then the set key.
//
// CS for display 3 sits on 37 (MISO) instead of 13. On the Feather, GPIO 13 is
// the built-in red LED - that should stay free as a sign of life. MISO is not
// needed, the displays are only written to.
static const int8_t PIN_CS[DISPLAY_COUNT]      = { 11, 12, 37, 5, 6 };
static const uint8_t PIN_BUTTON[DISPLAY_COUNT] = { 18, 17, 16, 15, 14 };
static const uint8_t SET_BUTTON = 4;  // Index der Set-Taste

static const int8_t PIN_I2S_BCLK = 8;   // A5
static const int8_t PIN_I2S_LRCK = 38;  // RX
static const int8_t PIN_I2S_DIN  = 39;  // TX
static const int8_t PIN_AMP_SD   = 4;   // SCL, MAX98357A SD: LOW = stumm

// Some 128x128 panels sit a few pixels off. If a margin remains, correct it
// here - test2_display shows it.
static const int8_t PANEL_COL_OFFSET = 2;
static const int8_t PANEL_ROW_OFFSET = 3;
static const uint8_t PANEL_ROTATION = 0;
