// vorlaut - stage 7: fetch content over Wi-Fi
//
// Does nothing but the pairing and the sync. No displays, no sound, no sleep -
// so that when something goes wrong here, it is this and not one of six other
// things at the same time. That is what the stages are for.
//
// What it needs: the address of the computer running app.py. Not the key -
// the device fetches that itself by pairing, and the five digits it would
// show on its displays go to the serial monitor instead, because at this
// stage there are no displays yet.
//
//   1. Flash, open the serial monitor at 115200
//   2. Join the "vorlaut einrichten" network with a phone
//   3. Enter the Wi-Fi and the server address
//   4. Type the five digits from the monitor into the web interface
//   5. Watch the sync in the monitor
//
// What should happen: the first run fetches everything, the second fetches
// layout.bin only. If it does not, the difference between the two runs says
// where to look - and tests/test_device_sync.py has already proved the server
// side of it. The second run does not pair again either: the key is in NVS
// from the first one.

#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include "../../vorlaut/sync.h"
#include "../../vorlaut/pairing.h"

static const uint32_t PORTAL_TIMEOUT_S = 180;
static Preferences settings;

static void report(uint16_t done, uint16_t total) {
  Serial.printf("  %u/%u\n", done, total);
}

// The real firmware puts one digit on each of the five displays. Here there
// are none, so the monitor has to do - drawn the same way round, so what is
// typed into the web interface sits where it will later sit on the device.
static void showCode(const char *digits) {
  Serial.println();
  Serial.println("  Type these five digits into the web interface:");
  Serial.println();
  Serial.printf("        %c  %c        <- keys 1 and 2\n", digits[0], digits[1]);
  Serial.printf("    %c            <- set key\n", digits[4]);
  Serial.printf("        %c  %c        <- keys 3 and 4\n", digits[2], digits[3]);
  Serial.println();
  Serial.printf("  as one code: %s\n", digits);
  Serial.println();
}

// Wi-Fi plus the address of the computer. The key is no longer a field here:
// pairing brings it in. WiFiManager puts custom fields straight into its own
// portal, so there is one page instead of two.
static bool setUpNetwork(String &host, uint16_t &port) {
  settings.begin("vorlaut", false);
  host = settings.getString("host", "");
  port = settings.getUShort("port", 8771);

  WiFiManager wm;
  WiFiManagerParameter hostField("host", "Computer (IP or name)",
                                 host.c_str(), 40);
  WiFiManagerParameter portField("port", "Port", String(port).c_str(), 6);
  wm.addParameter(&hostField);
  wm.addParameter(&portField);
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);

  if (!wm.autoConnect("vorlaut einrichten")) {
    Serial.println("no connection, and the portal has timed out.");
    return false;
  }

  // Only write when something actually changed - NVS has a limited number of
  // erase cycles, and this runs on every start.
  if (host != hostField.getValue()) {
    host = hostField.getValue();
    settings.putString("host", host);
  }
  if (port != (uint16_t)atoi(portField.getValue())) {
    port = atoi(portField.getValue());
    settings.putUShort("port", port);
  }
  return true;
}

// Only when there is none. The second run of this sketch goes straight past.
static bool haveToken(const String &host, uint16_t port, String &token) {
  token = settings.getString("token", "");
  if (token.length()) {
    Serial.println("a key is already stored - no pairing needed");
    return true;
  }
  Serial.printf("pairing with %s:%u as device %s\n", host.c_str(), port,
                Pairing::deviceId().c_str());
  Pairing pairing(host, port);
  const PairResult result = pairing.run(showCode, nullptr);
  if (!result.ok) {
    Serial.printf("pairing failed: %s\n", result.error);
    return false;
  }
  token = result.token;
  settings.putString("token", token);
  Serial.printf("paired, key stored (%u characters)\n", token.length());
  return true;
}

static void runSync(const String &host, uint16_t port, const String &token) {
  Serial.printf("fetching from %s:%u\n", host.c_str(), port);
  Serial.printf("  version here: %s\n",
                Sync::storedVersion().length() ? Sync::storedVersion().c_str()
                                               : "(nothing yet)");
  Sync sync(host, port, token);
  const uint32_t started = millis();
  const SyncStatus status = sync.run(report);
  const uint32_t took = millis() - started;

  if (!status.ok) {
    Serial.printf("failed: %s\n", status.error);
    return;
  }
  Serial.printf("done in %lu ms: %u fetched, %u already here, %u deleted, "
                "%u bytes\n",
                (unsigned long)took, status.fetched, status.kept,
                status.removed, (unsigned)status.bytes);
  Serial.printf("  version now: %s\n", Sync::storedVersion().c_str());
  Serial.printf("  file system: %u of %u bytes used\n",
                (unsigned)LittleFS.usedBytes(), (unsigned)LittleFS.totalBytes());
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut - stage 7: sync");

  if (!LittleFS.begin(true)) {   // true = format if there is no file system
    Serial.println("LittleFS would not mount, not even after formatting.");
    return;
  }

  String host, token;
  uint16_t port;
  if (!setUpNetwork(host, port)) return;
  Serial.printf("Wi-Fi: %s, address %s\n", WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str());

  if (!haveToken(host, port, token)) return;
  runSync(host, port, token);
  Serial.println();
  Serial.println("Press RESET to sync again - the second run should fetch");
  Serial.println("layout.bin only, and should not ask for a code again.");
}

void loop() {
  delay(1000);
}
