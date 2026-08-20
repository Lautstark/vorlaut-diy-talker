// Stufe 1: Lebt das Board?
//
// Prüft nur den Feather selbst - keine Displays, keine Taster, kein Ton.
// Wenn das hier nicht läuft, muss man an der Verkabelung gar nicht suchen.
//
// Erwartetes Verhalten:
//   - die rote LED neben der USB-Buchse blinkt im Sekundentakt
//   - im seriellen Monitor (115200) läuft alle zwei Sekunden eine Zeile durch
//
// Werkzeuge > USB CDC On Boot muss "Enabled" sein, sonst bleibt der Monitor
// stumm.

#include <Arduino.h>

static uint32_t zaehler = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  delay(2000);            // dem USB-Monitor Zeit geben, sich zu verbinden
  Serial.println();
  Serial.println("vorlaut – Stufe 1: Board");
  Serial.printf("Chip: %s, %u MHz, %u Kerne\n",
                ESP.getChipModel(), ESP.getCpuFreqMHz(), ESP.getChipCores());
  Serial.printf("Flash: %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("Freier Arbeitsspeicher: %u Byte\n", ESP.getFreeHeap());
  Serial.println("Wenn die rote LED blinkt, ist Stufe 1 geschafft.");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
  if (++zaehler % 2 == 0) {
    Serial.printf("läuft seit %lu s, Arbeitsspeicher %u Byte\n",
                  millis() / 1000, ESP.getFreeHeap());
  }
}
