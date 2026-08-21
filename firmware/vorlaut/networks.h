// The Wi-Fi networks the device knows.
//
// The talker travels: kindergarten, the grandparents, holiday. Speaking works
// everywhere because the content sits on the file system, but fetching new
// content needs a network - and there used to be exactly one, entered once in
// the setup portal and replaceable only by wiping the device.
//
// The ESP32 stores exactly one set of credentials, and WiFiManager hands it
// exactly one. So the list lives here, in the same Preferences namespace as
// the address of the computer, and WiFiMulti does the choosing: it scans, and
// out of the networks that are really in the air it takes the strongest one
// it knows. A network that is somewhere else costs nothing - it is simply not
// in the scan.
//
// Most recently used first. That is the order entries fall out in once the
// list is full, and after four places the one nobody has seen for months is
// the right one to lose.

#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiMulti.h>

// Home, kindergarten, the grandparents, one more. Every slot costs two NVS
// keys whether it is used or not, so this is a limit and not a target.
#define NETWORK_MAX 4

// How long the one network the scan picked gets to answer. The whole attempt
// is this plus the scan - it is not multiplied by NETWORK_MAX, because
// WiFiMulti only ever tries what it has just seen.
#define NETWORK_CONNECT_MS 8000

struct StoredNetwork {
  String ssid;
  String pass;
};

class Networks {
 public:
  // Reads the list into an array of NETWORK_MAX and says how many are in use.
  // The slots are filled from the front, so the first one without a name ends
  // the list.
  static uint8_t load(Preferences &settings, StoredNetwork *list) {
    uint8_t n = 0;
    for (uint8_t i = 0; i < NETWORK_MAX; i++) {
      char nameKey[6], passKey[6];
      const String ssid = settings.getString(key(nameKey, 's', i), "");
      if (ssid.length() == 0) break;
      list[n].ssid = ssid;
      list[n].pass = settings.getString(key(passKey, 'p', i), "");
      n++;
    }
    return n;
  }

  // Puts a network at the front of the list, with the password it was
  // entered with. An open network has none - that is an entry like any other
  // and not a missing password, which is why this does not treat the two the
  // same. Kindergarten guest networks are usually open.
  static void remember(Preferences &settings, const String &ssid,
                       const String &pass) {
    insert(settings, ssid, pass, false);
  }

  // Moves a network that is already stored to the front, without needing its
  // password again. Connecting is what makes a network recent - not the day
  // somebody typed it in - and the list is dropped from the back.
  static void promote(Preferences &settings, const String &ssid) {
    insert(settings, ssid, String(), true);
  }

  // Brings up whichever known network is in the air here. Deliberately
  // bounded: a device that hangs looking for a network is no longer a talker.
  // false means there is nothing to connect to right here - not an error, and
  // nothing the caller has to make a fuss about.
  static bool connect(Preferences &settings) {
    StoredNetwork list[NETWORK_MAX];
    const uint8_t n = load(settings, list);
    if (n == 0) return false;

    WiFi.mode(WIFI_STA);
    WiFiMulti multi;
    for (uint8_t i = 0; i < n; i++) {
      multi.addAP(list[i].ssid.c_str(), list[i].pass.c_str());
    }
    Serial.printf("looking for %u known network(s)\n", n);
    if (multi.run(NETWORK_CONNECT_MS) != WL_CONNECTED) {
      Serial.println("none of them is here.");
      return false;
    }
    promote(settings, WiFi.SSID());
    return true;
  }

 private:
  // The one place the list is reordered. keepStored is what tells the two
  // callers apart: promote() has no password to offer and must not overwrite
  // the stored one with nothing, remember() has one and means it.
  static void insert(Preferences &settings, const String &ssid,
                     const String &pass, bool keepStored) {
    if (ssid.length() == 0) return;

    StoredNetwork list[NETWORK_MAX];
    uint8_t n = load(settings, list);

    int8_t found = -1;
    for (uint8_t i = 0; i < n; i++) {
      if (list[i].ssid == ssid) { found = (int8_t)i; break; }
    }
    // Nothing to promote: an entry without a password that nobody stored
    // could not connect anyway, and would push out one that can.
    if (found < 0 && keepStored) return;

    StoredNetwork entry;
    entry.ssid = ssid;
    entry.pass = (found >= 0 && keepStored) ? list[found].pass : pass;
    if (found < 0) {
      if (n < NETWORK_MAX) n++;
      else found = NETWORK_MAX - 1;   // the oldest one falls off the end
    }
    // Everything above the gap moves down one place. The gap is where this
    // network was, or the end of the list.
    const uint8_t gap = found >= 0 ? (uint8_t)found : (uint8_t)(n - 1);
    for (uint8_t i = gap; i > 0; i--) list[i] = list[i - 1];
    list[0] = entry;
    save(settings, list, n);
  }

  // "s0".."s3" and "p0".."p3". Short on purpose: an NVS key is at most 15
  // characters, and these sit in the namespace with host, port and token.
  static const char *key(char *out, char kind, uint8_t index) {
    out[0] = kind;
    out[1] = (char)('0' + index);
    out[2] = '\0';
    return out;
  }

  // Only what really changed - NVS has a limited number of erase cycles, and
  // this gets written on every successful connection.
  static void save(Preferences &settings, const StoredNetwork *list, uint8_t n) {
    for (uint8_t i = 0; i < NETWORK_MAX; i++) {
      char nameKey[6], passKey[6];
      const String ssid = i < n ? list[i].ssid : String();
      const String pass = i < n ? list[i].pass : String();
      key(nameKey, 's', i);
      key(passKey, 'p', i);
      if (settings.getString(nameKey, "") != ssid) settings.putString(nameKey, ssid);
      if (settings.getString(passKey, "") != pass) settings.putString(passKey, pass);
    }
  }
};
