// Pin assignment for the Adafruit ESP32-S3 Feather.
//
// Lives in its own file so the test sketches under firmware/tests/ use the
// same assignment as the firmware - otherwise one ends up checking something
// other than what will later be running.

#pragma once

// The buttons have to sit on GPIO 0..21, only those can bring the chip out
// of deep sleep (EXT1).

static const int8_t PIN_SCK  = 36;  // SCK,  shared
static const int8_t PIN_MOSI = 35;  // MO,   shared
static const int8_t PIN_DC   = 9;   // D9,   shared
static const int8_t PIN_RST  = 10;  // D10,  shared
static const int8_t PIN_BL   = 3;   // SDA,  backlight of all five displays

static const uint8_t DISPLAY_COUNT = 5;
// Order: speech keys 1..4, then the set key.
//
// CS for display 3 sits on 37 (MISO) instead of 13. On the Feather, GPIO 13 is
// the built-in red LED - that should stay free as a sign of life. MISO is not
// needed, the displays are only written to.
static const int8_t PIN_CS[DISPLAY_COUNT]      = { 11, 12, 37, 5, 6 };
static const uint8_t PIN_BUTTON[DISPLAY_COUNT] = { 18, 17, 16, 15, 14 };
static const uint8_t SET_BUTTON = 4;  // index of the set key

static const int8_t PIN_I2S_BCLK = 8;   // A5
static const int8_t PIN_I2S_LRCK = 38;  // RX
static const int8_t PIN_I2S_DIN  = 39;  // TX
static const int8_t PIN_AMP_SD   = 4;   // SCL, MAX98357A SD: LOW = silent

// Some 128x128 panels sit a few pixels off. If a margin remains, correct it
// here - test2_display shows it.
static const int8_t PANEL_COL_OFFSET = 2;
static const int8_t PANEL_ROW_OFFSET = 3;
static const uint8_t PANEL_ROTATION = 0;

// Which ST7735 variant the panels are. The default is the one the real
// ScreenKeys (128x128) should be; if red comes out blue, another variant is
// the answer, and test2_display is what shows it.
//
// Overridable at compile time, so variants can be tried without editing this
// file. Once one of them is right, write it in here - then stages 3 and 4 and
// the firmware all use the answer instead of the guess:
//
//   arduino-cli compile --build-property \
//     "compiler.cpp.extra_flags=-DPANEL_INITR=INITR_BLACKTAB" ...
//
// A macro rather than a constant, because that is what -D can reach. It
// expands where it is used, so Adafruit_ST7735.h only has to be included
// there, not here.
#ifndef PANEL_INITR
#define PANEL_INITR INITR_144GREENTAB
#endif
