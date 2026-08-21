// Getting a token onto the device without anybody typing one.
//
// What this replaces: VORLAUT_DEVICE_TOKEN is 32 characters out of
// secrets.token_urlsafe(24), and it used to be generated on the computer,
// pasted into .env and then typed character by character into a captive
// portal on a phone. Every mistake in it looks the same from the device -
// "wrong key" - and the only way to find the missing character was to type
// the whole thing again.
//
// Instead the device shows five digits, one per display, and whoever is
// standing in front of it types them into the web interface. The five digits
// are the proof of physical presence: the device has no shared secret yet, so
// it cannot prove anything to the server, but somebody who can read its
// displays is in the room with it. That is why the device makes the code up
// and the browser confirms it, and not the other way round.
//
//   1. device -> POST /api/device/pair       here is my id, my code, my secret
//   2. displays show the code                one digit each, in key order
//   3. browser -> POST /api/pair/confirm     somebody typed those five digits
//   4. device -> POST /api/device/pair/poll  and now gets the real token
//
// The secret in step 1 is not shown anywhere and is not the code. Without it
// the poll would be authenticated by the device id alone - and that is the
// Wi-Fi MAC, which anybody on the network can read off an ARP table. They
// could then poll along and take the token in the moment it is confirmed. The
// secret costs 16 random bytes and closes that.
//
// The token that comes back is NOT tied to a server address. The device is
// meant to keep working when it is carried to another network where the
// computer has a different address: then only the address changes, and
// nothing has to be paired again.
//
// The wire format itself sits in pair_format.h, without any Arduino
// dependency, so tests/test_pair_format.py can check it on the computer.

#pragma once
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <esp_random.h>
#include <esp_mac.h>

#include "pair_format.h"

// One request. Short on purpose: this runs while five displays show a code
// and somebody is waiting in front of them.
#define PAIR_HTTP_TIMEOUT_MS 10000

// How long the device keeps a code on the displays, whatever the server says.
// The agreement is about three minutes; this is the device's own end of it,
// so a server that answers with a year cannot park the device in a pairing
// for a year. Same reasoning as the portal timeout: a device that hangs in
// setup no longer speaks.
#define PAIR_WINDOW_MAX_S 200
#define PAIR_WINDOW_DEFAULT_S 180

// And the same from below for the polling, so a server asking for every 100 ms
// cannot turn the device into a load generator.
#define PAIR_POLL_MIN_S 2
#define PAIR_POLL_MAX_S 10
#define PAIR_POLL_DEFAULT_S 3

// How often the cancel key is looked at while waiting between two polls.
#define PAIR_CANCEL_STEP_MS 50

enum PairError {
  PAIR_OK = 0,
  PAIR_NO_NETWORK,     // no Wi-Fi
  PAIR_NO_SERVER,      // no address, or nothing answering at it
  PAIR_SWITCHED_OFF,   // the server has no token to hand out (503)
  PAIR_TOO_LATE,       // the code expired before anybody typed it
  PAIR_DENIED,         // too many wrong attempts, or somebody said no
  PAIR_CANCELLED,      // the set key, here at the device
  PAIR_NO_ANSWER,      // something else - see error for the monitor
};

struct PairResult {
  bool ok;
  PairError code;
  String token;        // only when ok
  const char *error;   // English sentence for the serial monitor, nullptr when ok
};

// Called once, as soon as the server has accepted the request - so nobody
// reads a code off the displays that never arrived anywhere. digits is
// PAIR_CODE_DIGITS characters plus the zero.
typedef void (*PairShowCode)(const char *digits);

// Asked between polls. true means: stop, somebody here wants out.
typedef bool (*PairCancelled)();

class Pairing {
 public:
  Pairing(const String &host, uint16_t port) : host_(host), port_(port) {}

  // The Wi-Fi MAC as twelve hex characters. Stable, and it costs no NVS entry
  // that a reflash could lose.
  static String deviceId() {
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char out[PAIR_DEVICE_CHARS + 1];
    for (uint8_t i = 0; i < 6; i++) sprintf(out + i * 2, "%02x", mac[i]);
    return String(out);
  }

  PairResult run(PairShowCode show, PairCancelled cancelled) {
    PairResult result = {false, PAIR_OK, String(), nullptr};
    if (WiFi.status() != WL_CONNECTED) {
      result.code = PAIR_NO_NETWORK;
      result.error = "no network";
      return result;
    }
    if (host_.length() == 0) {
      result.code = PAIR_NO_SERVER;
      result.error = "no server set";
      return result;
    }

    char code[PAIR_CODE_DIGITS + 1];
    makeCode(code);
    const String secret = makeSecret();
    const String device = deviceId();

    String body = "device " + device + "\n"
                  "code " + String(code) + "\n"
                  "secret " + secret + "\n";
    String answerText;
    if (!post("/api/device/pair", body, &answerText)) {
      result.code = lastCode_;
      result.error = lastError_;
      return result;
    }

    PairAnswer answer;
    pairAnswerClear(&answer);
    pairParse(answerText.c_str(), &answer);
    if (!answer.accepted) {
      // The server answered 200 but did not say "ok 1". Better to stop here
      // than to put a code on the displays that leads nowhere.
      result.code = PAIR_NO_ANSWER;
      result.error = "server did not accept the pairing";
      return result;
    }

    const uint32_t window = clampSeconds(answer.expires, PAIR_WINDOW_DEFAULT_S,
                                         1, PAIR_WINDOW_MAX_S);
    const uint32_t every = clampSeconds(answer.interval, PAIR_POLL_DEFAULT_S,
                                        PAIR_POLL_MIN_S, PAIR_POLL_MAX_S);
    Serial.printf("pairing as %s, code %s, %lu s\n", device.c_str(), code,
                  (unsigned long)window);
    if (show) show(code);

    return waitForConfirmation(device, secret, window, every, cancelled);
  }

 private:
  String host_;
  uint16_t port_;
  PairError lastCode_ = PAIR_OK;
  const char *lastError_ = nullptr;

  String url(const char *path) const {
    return "http://" + host_ + ":" + String(port_) + path;
  }

  // Draws again until the number is one that maps evenly onto five digits -
  // see PAIR_CODE_LIMIT. esp_random() is a real random source here because
  // the radio is up: pairing only happens on a connected device.
  static void makeCode(char *out) {
    uint32_t drawn = esp_random();
    // Bounded on purpose. The chance of even one redraw is about 1 in 4000,
    // so a loop that cannot end is not a risk worth carrying.
    for (uint8_t tries = 0; tries < 8 && !pairCodeUsable(drawn); tries++) {
      drawn = esp_random();
    }
    pairCodeFrom(drawn, out);
  }

  static String makeSecret() {
    char out[PAIR_SECRET_CHARS + 1];
    for (uint8_t i = 0; i < PAIR_SECRET_BYTES; i++) {
      sprintf(out + i * 2, "%02x", (unsigned)(esp_random() & 0xFF));
    }
    return String(out);
  }

  static uint32_t clampSeconds(uint16_t asked, uint32_t fallback,
                               uint32_t low, uint32_t high) {
    const uint32_t value = asked ? (uint32_t)asked : fallback;
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  PairResult waitForConfirmation(const String &device, const String &secret,
                                 uint32_t window, uint32_t every,
                                 PairCancelled cancelled) {
    PairResult result = {false, PAIR_OK, String(), nullptr};
    const String body = "device " + device + "\n" "secret " + secret + "\n";
    const uint32_t started = millis();

    while (millis() - started < window * 1000UL) {
      if (!waitBetweenPolls(every, cancelled)) {
        result.code = PAIR_CANCELLED;
        result.error = "cancelled at the device";
        return result;
      }
      // The window may have run out while we were waiting.
      if (millis() - started >= window * 1000UL) break;

      String answerText;
      if (!post("/api/device/pair/poll", body, &answerText)) {
        if (lastCode_ == PAIR_TOO_LATE || lastCode_ == PAIR_DENIED ||
            lastCode_ == PAIR_SWITCHED_OFF) {
          result.code = lastCode_;
          result.error = lastError_;
          return result;
        }
        // Anything else is worth another go: a single lost answer should not
        // cost somebody the code they have already read off the displays.
        Serial.printf("  poll: %s, trying again\n", lastError_);
        continue;
      }

      PairAnswer answer;
      pairAnswerClear(&answer);
      pairParse(answerText.c_str(), &answer);

      if (pairAnswerComplete(&answer)) {
        result.ok = true;
        result.token = answer.token;
        return result;
      }
      if (answer.state == PAIR_STATE_EXPIRED) {
        result.code = PAIR_TOO_LATE;
        result.error = "the code expired";
        return result;
      }
      if (answer.state == PAIR_STATE_DENIED) {
        result.code = PAIR_DENIED;
        result.error = "pairing refused";
        return result;
      }
      // PAIR_STATE_WAITING, and anything this firmware does not know, means
      // keep waiting. A newer server must not be able to end a pairing early
      // by saying something an older device cannot read.
    }

    result.code = PAIR_TOO_LATE;
    result.error = "nobody typed the code";
    return result;
  }

  // Sits out the gap between two polls, but looks at the cancel key every
  // PAIR_CANCEL_STEP_MS. Returns false when somebody wants out.
  static bool waitBetweenPolls(uint32_t seconds, PairCancelled cancelled) {
    const uint32_t until = millis() + seconds * 1000UL;
    while ((int32_t)(millis() - until) < 0) {
      if (cancelled && cancelled()) return false;
      delay(PAIR_CANCEL_STEP_MS);
    }
    return !(cancelled && cancelled());
  }

  bool post(const char *path, const String &body, String *into) {
    HTTPClient http;
    http.setTimeout(PAIR_HTTP_TIMEOUT_MS);
    if (!http.begin(url(path))) {
      lastCode_ = PAIR_NO_SERVER;
      lastError_ = "bad address";
      return false;
    }
    // Lines, like the manifest. The token comes back in the body and never in
    // an address: addresses end up in logs.
    http.addHeader("Content-Type", "text/plain");
    const int code = http.POST(body);
    if (code != HTTP_CODE_OK) {
      switch (code) {
        case 503: lastCode_ = PAIR_SWITCHED_OFF;
                  lastError_ = "pairing switched off on the server"; break;
        case 404:
        case 410: lastCode_ = PAIR_TOO_LATE;
                  lastError_ = "the server has forgotten this pairing"; break;
        case 429: lastCode_ = PAIR_DENIED;
                  lastError_ = "too many attempts"; break;
        default:  lastCode_ = PAIR_NO_ANSWER;
                  lastError_ = code > 0 ? "server says no" : "no answer"; break;
      }
      http.end();
      return false;
    }
    if (into) *into = http.getString();
    http.end();
    return true;
  }
};
