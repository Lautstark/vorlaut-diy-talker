// vorlaut - stage 7: fetch content over Wi-Fi
//
// Does nothing but the pairing and the sync. No displays, no sound, no sleep -
// so that when something goes wrong here, it is this and not one of six other
// things at the same time. That is what the stages are for.
//
// What it needs: nothing typed in but the Wi-Fi. The address of the computer
// running app.py it finds by itself - one UDP broadcast, and whoever answers
// is the server. The key it fetches by pairing, and the five digits it would
// show on its displays go to the serial monitor instead, because at this
// stage there are no displays yet.
//
//   1. Flash, open the serial monitor at 115200
//   2. Join the "vorlaut einrichten" network with a phone
//   3. Enter the Wi-Fi
//   4. Type the five digits from the monitor into the web interface
//   5. Watch the search and the sync in the monitor
//
// If the search comes back with nothing, the network is not carrying the
// broadcast - a guest network usually does not. Then type an address into the
// portal field after all; it beats the search whenever it is filled in.
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

#include "../../vorlaut/discover.h"
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

// Wi-Fi, and nothing else that has to be typed. The address is found and the
// key comes from pairing; the field below is only what to fall back on when
// the search finds nothing. WiFiManager puts custom fields straight into its
// own portal, so there is one page instead of two.
static bool setUpNetwork(String &fixed) {
  settings.begin("vorlaut", false);
  fixed = settings.getString("fixed", "");

  WiFiManager wm;
  WiFiManagerParameter fixedField("server", "Computer (only if it is not found)",
                                  fixed.c_str(), 46);
  wm.addParameter(&fixedField);
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

  String fixed;
  if (!setUpNetwork(fixed)) return;
  Serial.printf("Wi-Fi: %s, address %s\n", WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str());

  String host, token;
  uint16_t port;
  locateServer(fixed, host, port);
  if (!haveToken(host, port, token)) return;
  runSync(host, port, token);
  Serial.println();
  Serial.println("Press RESET to sync again - the second run should fetch");
  Serial.println("layout.bin only, and should not ask for a code again.");
}

void loop() {
  delay(1000);
}
