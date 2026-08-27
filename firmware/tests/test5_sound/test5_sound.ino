// Stage 5: sound.
//
// Alternates between a tone at 440 Hz and a slow sweep from 200 to 2000 Hz.
// In between the amplifier is muted.
//
// What to check:
//   - Does anything come out at all? If not: check BCLK, LRC, DIN and the
//     supply of the MAX98357A, plus SD - if that sits LOW it stays silent.
//   - Is it clean or distorted? Distortion points to too high a level or too
//     weak a supply.
//   - Does it click when the amplifier is switched on and off? Then lengthen
//     the quiet before switching off in the firmware.
//   - Does the speaker carry inside the case? The sweep shows where it gets
//     thin - small speakers can do little at the bottom end.
//
// The volume cannot be adjusted here, the device has no control. What comes
// out is what comes out - which is why this test matters.

#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>

#include "../../vorlaut/pins.h"

static const uint32_t ABTASTRATE = 16000;   // WAV_SAMPLE_RATE, and DEVICE_SAMPLE_RATE in loader/src/audio_format.ts
static const size_t BLOCK = 512;

// How hard the tone is driven, 0..1. Not a taste setting: it is here so that
// this stage sounds like the finished device rather than like a test. Speech
// is normalised to about -16 LUFS, and a sine at that RMS has an amplitude of
// roughly 0.22 - a good 7 dB below the 0.5 this ran at until the first real
// hardware said it was alarmingly loud. At 0.5 the stage frightens whoever is
// holding the speaker and still says nothing about the talker.
//
// Overridable, to hear the difference without editing:
//
//   arduino-cli compile --build-property \
//     "compiler.cpp.extra_flags=-DAMPLITUDE=0.5f" ...
#ifndef AMPLITUDE
#define AMPLITUDE 0.22f
#endif

static I2SClass i2s;
static int16_t puffer[BLOCK];

// Generates a sine wave and pushes it out. amplitude 0..1
static void ton(float frequenz, uint32_t dauer_ms, float amplitude = AMPLITUDE) {
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
  Serial.println("vorlaut - stage 5: sound");
  Serial.printf("BCLK GPIO %d, LRC %d, DIN %d, SD %d\n",
                PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DIN, PIN_AMP_SD);

  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);       // silent until something is really coming

  i2s.setPins(PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DIN);
  if (!i2s.begin(I2S_MODE_STD, ABTASTRATE, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_MONO)) {
    Serial.println("I2S would not start - something is wrong already.");
  }
}

void loop() {
  Serial.println("amplifier on, 440 Hz for two seconds");
  digitalWrite(PIN_AMP_SD, HIGH);
  delay(5);
  stille(50);                 // listen for a click as it switches on
  ton(440.0f, 2000);
  stille(60);
  digitalWrite(PIN_AMP_SD, LOW);
  Serial.println("amplifier off. Does it click here?");
  delay(1500);

  Serial.println("sweep 200 to 2000 Hz");
  digitalWrite(PIN_AMP_SD, HIGH);
  delay(5);
  for (float hz = 200.0f; hz <= 2000.0f; hz *= 1.06f) ton(hz, 60);
  stille(60);
  digitalWrite(PIN_AMP_SD, LOW);
  Serial.println("Where did it get thin? That is the speaker's lower limit.");
  delay(2500);
}
