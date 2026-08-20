// Stufe 3: Alle fünf Displays.
//
// Erst machen, wenn Stufe 2 mit einem Display sauber lief. Hier klärt sich,
// ob die CS-Leitungen in der richtigen Reihenfolge liegen - und ob das
// gemeinsame RST funktioniert.
//
// Jedes Display zeigt dauerhaft seine Nummer auf eigener Farbe:
//
//   1 rot        oben links im Viererblock
//   2 grün       oben rechts
//   3 blau       unten links
//   4 gelb       unten rechts
//   S violett    die Set-Taste, links unter dem Lautsprecher
//
// Stimmt die Anordnung nicht mit der Zeichnung in docs/hardware.md überein,
// sind die CS-Leitungen vertauscht. Entweder umlöten oder die Reihenfolge in
// pins.h ändern - beides ist richtig, aber es muss zusammenpassen.
//
// Bleibt ein Display schwarz: dessen CS-Leitung prüfen.
// Bleiben ALLE schwarz, obwohl Stufe 2 lief: meist RST oder die Versorgung.

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

#include "../../mitreden/pins.h"

class Panel : public Adafruit_ST7735 {
 public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void setOffsets(int8_t col, int8_t row) { setColRowStart(col, row); }
};

static Panel *display[DISPLAY_COUNT];
static const uint16_t FARBE[DISPLAY_COUNT] = {
  ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_YELLOW, 0x9BDF };
static const char *BESCHRIFTUNG[DISPLAY_COUNT] = { "1", "2", "3", "4", "S" };

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("mitreden – Stufe 3: alle fünf Displays");

  pinMode(PIN_BL, OUTPUT);
  digitalWrite(PIN_BL, HIGH);

  // RST liegt an allen fünf: einmal von Hand pulsen, danach den Treibern -1
  // geben. Sonst würde die Initialisierung von Display 3 die Displays 1 und 2
  // wieder zurücksetzen.
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, HIGH); delay(10);
  digitalWrite(PIN_RST, LOW);  delay(20);
  digitalWrite(PIN_RST, HIGH); delay(150);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  for (uint8_t i = 0; i < DISPLAY_COUNT; i++) {
    Serial.printf("Display %u an CS GPIO %d\n", i + 1, PIN_CS[i]);
    display[i] = new Panel(&SPI, PIN_CS[i], PIN_DC, -1);
    display[i]->initR(INITR_144GREENTAB);
    display[i]->setOffsets(PANEL_COL_OFFSET, PANEL_ROW_OFFSET);
    display[i]->setRotation(PANEL_ROTATION);

    display[i]->fillScreen(FARBE[i]);
    display[i]->setTextColor(ST77XX_BLACK);
    display[i]->setTextSize(6);
    display[i]->setCursor(128 / 2 - 18, 128 / 2 - 24);
    display[i]->print(BESCHRIFTUNG[i]);
  }
  Serial.println("Reihenfolge gegen docs/hardware.md prüfen: 1 2 oben, 3 4 unten, S links.");
}

void loop() {
  delay(1000);
}
