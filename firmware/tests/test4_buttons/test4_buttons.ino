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
static bool was_down[DISPLAY_COUNT];

static void draw(uint8_t i, bool down) {
  Panel *t = display[i];
  t->fillScreen(down ? 0x07E0 : 0x2124);
  t->setTextColor(down ? ST77XX_BLACK : 0x8410);
  t->setTextSize(2);
  t->setCursor(14, 40);
  t->print(i == SET_BUTTON ? "SET" : "KEY");
  t->setTextSize(4);
  t->setCursor(46, 66);
  t->print(down ? "!" : (i == SET_BUTTON ? "S" : String(i + 1)));
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut - stage 4: buttons");

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
    was_down[i] = false;
    draw(i, false);
    Serial.printf("key %u on GPIO %u, display on CS GPIO %d\n",
                  i + 1, PIN_BUTTON[i], PIN_CS[i]);
  }
  Serial.println("Press now. Each display shows its own button.");
}

void loop() {
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    const bool now = digitalRead(PIN_BUTTON[i]) == LOW;
    if (now != was_down[i]) {
      was_down[i] = now;
      draw(i, now);
      Serial.printf("%s %u (GPIO %u) %s\n",
                    i == SET_BUTTON ? "set key" : "key", i + 1,
                    PIN_BUTTON[i], now ? "pressed" : "released");
    }
  }
  delay(20);
}
