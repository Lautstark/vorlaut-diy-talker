// Stufe 2: Ein einzelnes Display.
//
// Hier klären sich die zwei Unbekannten, die sich nicht ausrechnen lassen:
// das richtige Panel-Profil und der Pixelversatz.
//
// Nur Display 1 anschließen (CS an D11). Die anderen kommen in Stufe 3.
//
// Was zu sehen sein sollte, im Wechsel alle drei Sekunden:
//   1. ROT      - ist das Bild wirklich rot? Erscheint es blau, sind die
//                 Farbkanäle vertauscht: initR(INITR_144GREENTAB) gegen eine
//                 andere Variante tauschen oder invertDisplay setzen.
//   2. GRÜN
//   3. BLAU
//   4. Rahmen   - ein weißer Rahmen genau am äußersten Bildrand, dazu in
//                 jeder Ecke ein Quadrat. Sind alle vier Ecken vollständig
//                 und der Rahmen ringsum gleich breit, stimmt der Versatz.
//                 Fehlt oben oder links etwas und unten oder rechts bleibt
//                 ein Streifen: PANEL_COL_OFFSET / PANEL_ROW_OFFSET in
//                 pins.h anpassen.

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
  Serial.println("vorlaut – Stufe 2: ein Display");
  Serial.printf("CS auf GPIO %d, DC %d, RST %d, Versatz %d/%d\n",
                PIN_CS[0], PIN_DC, PIN_RST, PANEL_COL_OFFSET, PANEL_ROW_OFFSET);

  pinMode(PIN_BL, OUTPUT);
  digitalWrite(PIN_BL, HIGH);

  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(10);
  digitalWrite(PIN_RST, LOW);  delay(20);
  digitalWrite(PIN_RST, HIGH); delay(150);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  tft = new Panel(&SPI, PIN_CS[0], PIN_DC, -1);
  tft->initR(INITR_144GREENTAB);
  tft->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
  tft->setRotation(PANEL_ROTATION);
  Serial.println("Bleibt es schwarz: Verkabelung von CLK, DIN, DC, RST und VCC prüfen.");
}

static void rahmenBild() {
  tft->fillScreen(ST77XX_BLACK);
  // Rahmen genau auf dem äußersten Pixel
  tft->drawRect(0, 0, BREITE, HOEHE, ST77XX_WHITE);
  // Ecken, damit man sieht ob wirklich alles da ist
  const int16_t e = 12;
  tft->fillRect(0, 0, e, e, ST77XX_RED);
  tft->fillRect(BREITE - e, 0, e, e, ST77XX_GREEN);
  tft->fillRect(0, HOEHE - e, e, e, ST77XX_BLUE);
  tft->fillRect(BREITE - e, HOEHE - e, e, e, ST77XX_YELLOW);
  // Fadenkreuz durch die Mitte
  tft->drawFastHLine(0, HOEHE / 2, BREITE, 0x7BEF);
  tft->drawFastVLine(BREITE / 2, 0, HOEHE, 0x7BEF);
}

void loop() {
  switch (schritt) {
    case 0: tft->fillScreen(ST77XX_RED);   Serial.println("ROT");   break;
    case 1: tft->fillScreen(ST77XX_GREEN); Serial.println("GRÜN");  break;
    case 2: tft->fillScreen(ST77XX_BLUE);  Serial.println("BLAU");  break;
    case 3: rahmenBild();
            Serial.println("Rahmen: ringsum gleich breit? Alle vier Ecken ganz?");
            break;
  }
  schritt = (schritt + 1) % 4;
  delay(3000);
}
