// vorlaut - stage 7: fetch content over Wi-Fi
//
// Does nothing but the sync. No displays, no sound, no sleep - so that when
// something goes wrong here, it is this and not one of six other things at
// the same time. That is what the stages are for.
//
// What it needs: the address of the computer running app.py, and the key from
// VORLAUT_DEVICE_TOKEN in .env. Both are asked for in the Wi-Fi portal on the
// first start and kept in NVS afterwards, so this survives a reflash.
//
//   1. Flash, open the serial monitor at 115200
//   2. Join the "vorlaut einrichten" network with a phone
//   3. Enter the Wi-Fi, the server address and the key
//   4. Watch the sync in the monitor
//
// What should happen: the first run fetches everything, the second fetches
// layout.bin only. If it does not, the difference between the two runs says
// where to look - and tests/test_device_sync.py has already proved the server
// side of it.

#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include "../../vorlaut/sync.h"

static const uint32_t PORTAL_TIMEOUT_S = 180;
static Preferences settings;

static void report(uint16_t done, uint16_t total) {
  Serial.printf("  %u/%u\n", done, total);
}

// Wi-Fi plus the two things the sync needs. WiFiManager puts custom fields
// straight into its own portal, so there is one page instead of two.
static bool setUpNetwork(String &host, uint16_t &port, String &token) {
  settings.begin("vorlaut", false);
  host = settings.getString("host", "");
  port = settings.getUShort("port", 8771);
  token = settings.getString("token", "");

  WiFiManager wm;
  WiFiManagerParameter hostField("host", "Computer (IP or name)",
                                 host.c_str(), 40);
  WiFiManagerParameter portField("port", "Port", String(port).c_str(), 6);
  WiFiManagerParameter tokenField("token", "Key (VORLAUT_DEVICE_TOKEN)",
                                  token.c_str(), 64);
  wm.addParameter(&hostField);
  wm.addParameter(&portField);
  wm.addParameter(&tokenField);
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
  if (token != tokenField.getValue()) {
    token = tokenField.getValue();
    settings.putString("token", token);
  }
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
  if (!setUpNetwork(host, port, token)) return;
  Serial.printf("Wi-Fi: %s, address %s\n", WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str());

  runSync(host, port, token);
  Serial.println();
  Serial.println("Press RESET to sync again - the second run should fetch");
  Serial.println("layout.bin only.");
}

void loop() {
  delay(1000);
}
