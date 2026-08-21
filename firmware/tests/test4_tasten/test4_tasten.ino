// Stage 4: the buttons.
//
// Shows on each display whether its own button is currently pressed: dark =
// open, bright with a check mark = pressed. Plus a line in the serial monitor
// on every change.
//
// What to check:
//   - Does pressing light up the display ON THAT SAME key? If another one
//     reacts, KEY lines and CS lines are sorted differently.
//   - Does a key not react at all: check the KEY line and GND.
//   - Do all react at once: GND is probably not connected.
//
// The resting state has to be "open". If a key permanently shows "pressed"
// without anyone touching it, the input sits hard on GND.

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

#include "../../vorlaut/pins.h"

class Panel : public Adafruit_ST7735 {
 public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void setOffsets(int8_t col, int8_t row) { setColRowStart(col, row); }
};

static Panel *display[DISPLAY_COUNT];
static bool zuletzt[DISPLAY_COUNT];

static void zeichne(uint8_t i, bool gedrueckt) {
  Panel *t = display[i];
  t->fillScreen(gedrueckt ? 0x07E0 : 0x2124);
  t->setTextColor(gedrueckt ? ST77XX_BLACK : 0x8410);
  t->setTextSize(2);
  t->setCursor(14, 40);
  t->print(i == SET_BUTTON ? "SET" : "Taste");
  t->setTextSize(4);
  t->setCursor(46, 66);
  t->print(gedrueckt ? "!" : (i == SET_BUTTON ? "S" : String(i + 1)));
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut – Stufe 4: Taster");

  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) pinMode(PIN_BUTTON[i], INPUT_PULLUP);

  pinMode(PIN_BL, OUTPUT);
  digitalWrite(PIN_BL, HIGH);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(10);
  digitalWrite(PIN_RST, LOW);  delay(20);
  digitalWrite(PIN_RST, HIGH); delay(150);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    display[i] = new Panel(&SPI, PIN_CS[i], PIN_DC, -1);
    display[i]->initR(INITR_144GREENTAB);
    display[i]->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
    display[i]->setRotation(PANEL_ROTATION);
    zuletzt[i] = false;
    zeichne(i, false);
    Serial.printf("Taste %u an GPIO %u, Display an CS GPIO %d\n",
                  i + 1, PIN_BUTTON[i], PIN_CS[i]);
  }
  Serial.println("Jetzt drücken. Jedes Display zeigt seinen eigenen Taster.");
}

void loop() {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    const bool jetzt = digitalRead(PIN_BUTTON[i]) == LOW;
    if (jetzt != zuletzt[i]) {
      zuletzt[i] = jetzt;
      zeichne(i, jetzt);
      Serial.printf("%s %u (GPIO %u) %s\n",
                    i == SET_BUTTON ? "SET-Taste" : "Taste", i + 1,
                    PIN_BUTTON[i], jetzt ? "gedrückt" : "losgelassen");
    }
  }
  delay(20);
}
