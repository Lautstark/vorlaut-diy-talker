// Stage 3: all five displays.
//
// Only do this once stage 2 ran cleanly with a single display. What gets
// settled here is whether the CS lines are in the right order - and whether
// the shared RST works.
//
// Each display permanently shows its number on its own colour:
//
//   1 red        top left in the block of four
//   2 green      top right
//   3 blue       bottom left
//   4 yellow     bottom right
//   S violet     the set key, left below the speaker
//
// If the arrangement does not match the drawing in docs/hardware.md, the CS
// lines are swapped. Either resolder or change the order in pins.h - both are
// right, but they have to agree.
//
// If one display stays black: check its CS line.
// If ALL stay black although stage 2 ran: usually RST or the power supply.

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
static const uint16_t FARBE[DISPLAY_COUNT] = {
  ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_YELLOW, 0x9BDF };
static const char *LABEL[DISPLAY_COUNT] = { "1", "2", "3", "4", "S" };

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut - stage 3: all five displays");

  pinMode(PIN_BL, OUTPUT);
  digitalWrite(PIN_BL, HIGH);

  // RST is common to all five: pulse it once by hand, then hand the drivers
  // -1. Otherwise initialising display 3 would reset displays 1 and 2 again.
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(10);
  digitalWrite(PIN_RST, LOW);  delay(20);
  digitalWrite(PIN_RST, HIGH); delay(150);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    Serial.printf("display %u on CS GPIO %d\n", i + 1, PIN_CS[i]);
    display[i] = new Panel(&SPI, PIN_CS[i], PIN_DC, -1);
    display[i]->initR(PANEL_INITR);
    display[i]->invertDisplay(PANEL_INVERT);
    display[i]->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
    display[i]->setRotation(PANEL_ROTATION);

    display[i]->fillScreen(FARBE[i]);
    display[i]->setTextColor(ST77XX_BLACK);
    display[i]->setTextSize(6);
    display[i]->setCursor(128 / 2 - 18, 128 / 2 - 24);
    display[i]->print(LABEL[i]);
  }
  Serial.println("Check the order against docs/hardware.md: 1 2 top, 3 4 bottom, S left.");
}

void loop() {
  delay(1000);
}
