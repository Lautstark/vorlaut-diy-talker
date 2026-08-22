// Stage 2: a single display.
//
// This is where the two unknowns get settled that cannot be worked out on
// paper: the right panel profile and the pixel offset.
//
// Connect display 1 only (CS on D11). The others follow in stage 3.
//
// What should be visible, alternating every three seconds:
//   1. RED      - is the picture really red? The monitor names the colour it
//                 has just sent, so what is on the panel can be compared
//                 against it. If it looks blue, the colour channels are
//                 swapped: try another PANEL_INITR variant (pins.h says how
//                 to do that without editing anything) or set invertDisplay.
//   2. GREEN
//   3. BLUE
//   4. Border   - a white border exactly at the outermost edge, plus a square
//                 in every corner. If all four corners are complete and the
//                 border is equally wide all round, the offset is right.
//                 If something is missing at the top or left and a strip
//                 remains at the bottom or right: adjust PANEL_COL_OFFSET /
//                 PANEL_ROW_OFFSET in pins.h.

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

#include "../../vorlaut/pins.h"

#define BREITE 128
#define HOEHE  128

class Panel : public Adafruit_ST7735 {
 public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void setOffsets(int8_t col, int8_t row) { setColRowStart(col, row); }
};

static Panel *tft = nullptr;
static uint8_t schritt = 0;

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut - stage 2: one display");
  Serial.printf("CS on GPIO %d, DC %d, RST %d, offset %d/%d\n",
                PIN_CS[0], PIN_DC, PIN_RST, PANEL_COL_OFFSET, PANEL_ROW_OFFSET);

  pinMode(PIN_BL, OUTPUT);
  digitalWrite(PIN_BL, HIGH);

  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(10);
  digitalWrite(PIN_RST, LOW);  delay(20);
  digitalWrite(PIN_RST, HIGH); delay(150);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  tft = new Panel(&SPI, PIN_CS[0], PIN_DC, -1);
  tft->initR(PANEL_INITR);
  tft->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
  tft->setRotation(PANEL_ROTATION);
  Serial.println("If it stays black: check the wiring of CLK, DIN, DC, RST and VCC.");
}

static void rahmenBild() {
  tft->fillScreen(ST77XX_BLACK);
  // Border exactly on the outermost pixel
  tft->drawRect(0, 0, BREITE, HOEHE, ST77XX_WHITE);
  // Corners, so one sees whether everything is really there
  const int16_t e = 12;
  tft->fillRect(0, 0, e, e, ST77XX_RED);
  tft->fillRect(BREITE - e, 0, e, e, ST77XX_GREEN);
  tft->fillRect(0, HOEHE - e, e, e, ST77XX_BLUE);
  tft->fillRect(BREITE - e, HOEHE - e, e, e, ST77XX_YELLOW);
  // Crosshair through the centre
  tft->drawFastHLine(0, HOEHE / 2, BREITE, 0x7BEF);
  tft->drawFastVLine(BREITE / 2, 0, HOEHE, 0x7BEF);
}

void loop() {
  switch (schritt) {
    case 0: tft->fillScreen(ST77XX_RED);   Serial.println("RED");   break;
    case 1: tft->fillScreen(ST77XX_GREEN); Serial.println("GREEN"); break;
    case 2: tft->fillScreen(ST77XX_BLUE);  Serial.println("BLUE");  break;
    case 3: rahmenBild();
            Serial.println("Frame: same width all round? All four corners whole?");
            break;
  }
  schritt = (schritt + 1) % 4;
  delay(3000);
}
