// Stufe 5: Ton.
//
// Spielt abwechselnd einen Ton bei 440 Hz und einen langsamen Durchlauf von
// 200 bis 2000 Hz. Dazwischen wird der Verstärker stummgeschaltet.
//
// Zu prüfen:
//   - Kommt überhaupt etwas? Wenn nicht: BCLK, LRC, DIN und die Versorgung
//     des MAX98357A prüfen, dazu SD - liegt der auf LOW, bleibt es still.
//   - Ist es sauber oder verzerrt? Verzerrung deutet auf zu hohen Pegel oder
//     eine zu schwache Versorgung hin.
//   - Knackt es beim Ein- und Ausschalten des Verstärkers? Dann in der
//     Firmware die Ruhe vor dem Abschalten verlängern.
//   - Trägt der Lautsprecher im Gehäuse? Der Durchlauf zeigt, wo er dünn
//     wird - kleine Lautsprecher können unten herum wenig.
//
// Die Lautstärke lässt sich hier nicht regeln, das Gerät hat keinen Regler.
// Was ankommt, ist was ankommt - deshalb ist dieser Test wichtig.

#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>

#include "../../vorlaut/pins.h"

static const uint32_t ABTASTRATE = 16000;   // wie build.py die WAVs schreibt
static const size_t BLOCK = 512;

static I2SClass i2s;
static int16_t puffer[BLOCK];

// Erzeugt eine Sinuswelle und schiebt sie heraus. amplitude 0..1
static void ton(float frequenz, uint32_t dauer_ms, float amplitude = 0.5f) {
  static float phase = 0.0f;
  const float schritt = 2.0f * (float)M_PI * frequenz / (float)ABTASTRATE;
  const uint32_t bis = millis() + dauer_ms;
  while (millis() < bis) {
    for (size_t i = 0; i < BLOCK; i++) {
      puffer[i] = (int16_t)(sinf(phase) * 32767.0f * amplitude);
      phase += schritt;
      if (phase > 2.0f * (float)M_PI) phase -= 2.0f * (float)M_PI;
    }
    i2s.write((uint8_t *)puffer, sizeof(puffer));
  }
}

static void stille(uint32_t dauer_ms) {
  memset(puffer, 0, sizeof(puffer));
  const uint32_t bis = millis() + dauer_ms;
  while (millis() < bis) i2s.write((uint8_t *)puffer, sizeof(puffer));
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut – Stufe 5: Ton");
  Serial.printf("BCLK GPIO %d, LRC %d, DIN %d, SD %d\n",
                PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DIN, PIN_AMP_SD);

  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);       // stumm, bis wirklich etwas kommt

  i2s.setPins(PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DIN);
  if (!i2s.begin(I2S_MODE_STD, ABTASTRATE, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_MONO)) {
    Serial.println("I2S ließ sich nicht starten - hier ist schon etwas falsch.");
  }
}

void loop() {
  Serial.println("Verstärker an, 440 Hz für zwei Sekunden");
  digitalWrite(PIN_AMP_SD, HIGH);
  delay(5);
  stille(50);                 // Einschaltknacken beobachten
  ton(440.0f, 2000);
  stille(60);
  digitalWrite(PIN_AMP_SD, LOW);
  Serial.println("Verstärker aus. Knackt es hier?");
  delay(1500);

  Serial.println("Durchlauf 200 bis 2000 Hz");
  digitalWrite(PIN_AMP_SD, HIGH);
  delay(5);
  for (float hz = 200.0f; hz <= 2000.0f; hz *= 1.06f) ton(hz, 60);
  stille(60);
  digitalWrite(PIN_AMP_SD, LOW);
  Serial.println("Wo wurde er dünn? Das ist die untere Grenze des Lautsprechers.");
  delay(2500);
}
