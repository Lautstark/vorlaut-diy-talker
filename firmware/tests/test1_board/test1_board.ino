// Stage 1: is the board alive?
//
// Checks the Feather itself only - no displays, no buttons, no sound. If this
// does not run, there is no point looking at the wiring yet.
//
// Expected behaviour:
//   - the red LED next to the USB socket blinks once a second
//   - a line runs through the serial monitor (115200) every two seconds
//
// Tools > USB CDC On Boot has to be "Enabled", otherwise the monitor stays
// silent.

#include <Arduino.h>

static uint32_t zaehler = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  delay(2000);            // give the USB monitor time to connect
  Serial.println();
  Serial.println("vorlaut – Stufe 1: Board");
  Serial.printf("Chip: %s, %u MHz, %u Kerne\n",
                ESP.getChipModel(), ESP.getCpuFreqMHz(), ESP.getChipCores());
  Serial.printf("Flash: %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("Freier Arbeitsspeicher: %u Byte\n", ESP.getFreeHeap());
  Serial.println("If the red LED blinks, stage 1 is done.");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
  if (++zaehler % 2 == 0) {
    Serial.printf("up for %lu s, free memory %u bytes\n",
                  millis() / 1000, ESP.getFreeHeap());
  }
}
