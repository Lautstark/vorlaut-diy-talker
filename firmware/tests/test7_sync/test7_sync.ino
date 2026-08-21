// vorlaut - stage 7: fetch content over Wi-Fi
//
// Does nothing but the sync. No displays, no sound, no sleep - so that when
// something goes wrong here, it is this and not one of six other things at
// the same time. That is what the stages are for.
//
// What it needs: the key from VORLAUT_DEVICE_TOKEN in .env. The address of
// the computer running app.py it finds by itself - one UDP broadcast, and
// whoever answers is the server. See discover.h and discovery.py.
//
//   1. Flash, open the serial monitor at 115200
//   2. Join the "vorlaut einrichten" network with a phone
//   3. Enter the Wi-Fi and the key
//   4. Watch the search and the sync in the monitor
//
// If the search comes back with nothing, the network is not carrying the
// broadcast - a guest network usually does not. Then type an address into the
// portal field after all; it beats the search whenever it is filled in.
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

#include "../../vorlaut/discover.h"
#include "../../vorlaut/sync.h"

static const uint32_t PORTAL_TIMEOUT_S = 180;
static Preferences settings;

static void report(uint16_t done, uint16_t total) {
  Serial.printf("  %u/%u\n", done, total);
}

// Wi-Fi plus the key. WiFiManager puts custom fields straight into its own
// portal, so there is one page instead of two. The address that used to be
// asked for here is found instead - the field is only what to fall back on
// when the search finds nothing.
static bool setUpNetwork(String &fixed, String &token) {
  settings.begin("vorlaut", false);
  fixed = settings.getString("fixed", "");
  token = settings.getString("token", "");

  WiFiManager wm;
  WiFiManagerParameter fixedField("server", "Computer (only if it is not found)",
                                  fixed.c_str(), 46);
  WiFiManagerParameter tokenField("token", "Key (VORLAUT_DEVICE_TOKEN)",
                                  token.c_str(), 64);
  wm.addParameter(&fixedField);
  wm.addParameter(&tokenField);
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);

  if (!wm.autoConnect("vorlaut einrichten")) {
    Serial.println("no connection, and the portal has timed out.");
    return false;
  }

  // Only write when something actually changed - NVS has a limited number of
  // erase cycles, and this runs on every start.
  if (fixed != fixedField.getValue()) {
    fixed = fixedField.getValue();
    settings.putString("fixed", fixed);
  }
  if (token != tokenField.getValue()) {
    token = tokenField.getValue();
    settings.putString("token", token);
  }
  return true;
}

// Typed in beats found, and found beats remembered.
//
// Here this runs at boot, because this sketch has the radio up from the
// start. In the real firmware it runs when somebody asks for a sync - there
// the radio is off the rest of the time, and a talker that brings one up on
// every wake is a talker that keeps its owner waiting.
static void locateServer(const String &fixed, String &host, uint16_t &port) {
  port = 8771;
  if (fixed.length()) {
    parseAddress(fixed, host, port);
    Serial.printf("address typed in: %s:%u\n", host.c_str(), port);
    return;
  }
  Serial.println("asking the network who has the content...");
  if (discoverServer(host, port)) {
    Serial.printf("  found: %s:%u\n", host.c_str(), port);
    // Kept for the next start, in case that one falls into a network where
    // the broadcast goes nowhere. Only on a change - NVS again.
    if (host != settings.getString("host", "")) settings.putString("host", host);
    if (port != settings.getUShort("port", 0)) settings.putUShort("port", port);
    return;
  }
  host = settings.getString("host", "");
  port = settings.getUShort("port", 8771);
  Serial.printf("  nobody answered. Trying the last one: %s:%u\n",
                host.length() ? host.c_str() : "(none yet)", port);
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

  String fixed, token;
  if (!setUpNetwork(fixed, token)) return;
  Serial.printf("Wi-Fi: %s, address %s\n", WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str());

  String host;
  uint16_t port;
  locateServer(fixed, host, port);
  runSync(host, port, token);
  Serial.println();
  Serial.println("Press RESET to sync again - the second run should fetch");
  Serial.println("layout.bin only.");
}

void loop() {
  delay(1000);
}
