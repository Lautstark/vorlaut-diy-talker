// Finding the computer that runs app.py, instead of being told where it is.
//
// The device shouts one small UDP packet into the local network and takes the
// first sensible answer. What that replaces is the address field in the setup
// portal, which was only ever right until the router handed out a different
// number - or until the device was carried into another network, where it was
// never right at all.
//
// The answer does not contain an address. It arrives from one, and that is
// the one address that is certainly reachable from here, which is more than
// the server could promise about any address it named itself. So: the port
// comes out of the answer, the host out of the envelope.
//
// The other side is discovery.py. The port below is the one number both sides
// have to agree on in advance; everything else is asked for.
//
// Nothing here may hang. Three attempts, a fraction of a second each, and
// then it gives up and says so - the caller still has the address that worked
// last time, and a typed address still overrides everything. A search that
// finds nothing is a no-op, never a wait.

#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>

#define DISCOVER_PORT 8771
#define DISCOVER_QUERY "vorlaut? 1"
#define DISCOVER_TRIES 3
#define DISCOVER_WAIT_MS 400
// "vorlaut 1", "port 8771", "name vorlaut" and room for whatever gets added
// later. Anything longer than this is not our server answering.
#define DISCOVER_ANSWER_MAX 192

// Splits "192.168.1.5" or "192.168.1.5:8798" into the two halves. Without a
// colon the port stays at whatever the caller put in - the default belongs to
// the caller, not here.
static void parseAddress(const String &text, String &host, uint16_t &port) {
  const int colon = text.lastIndexOf(':');
  if (colon < 0) {
    host = text;
    return;
  }
  host = text.substring(0, colon);
  const int number = text.substring(colon + 1).toInt();
  if (number > 0 && number < 65536) port = (uint16_t)number;
}

// Fills host and port from the first usable answer. false means nobody
// answered - not an error, just a network that does not carry broadcasts, or
// a server that is switched off.
static bool discoverServer(String &host, uint16_t &port) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiUDP udp;
  if (!udp.begin(0)) return false;   // any free local port will do
  // The subnet broadcast, not 255.255.255.255: some access points pass the
  // one and drop the other.
  const IPAddress target = WiFi.broadcastIP();

  for (uint8_t attempt = 0; attempt < DISCOVER_TRIES; attempt++) {
    udp.beginPacket(target, DISCOVER_PORT);
    udp.print(DISCOVER_QUERY);
    udp.endPacket();

    // Subtracting first, so the wait survives the millis() wrap-around.
    const uint32_t started = millis();
    while (millis() - started < DISCOVER_WAIT_MS) {
      const int size = udp.parsePacket();
      if (size <= 0) {
        delay(10);
        continue;
      }
      char answer[DISCOVER_ANSWER_MAX];
      const int got = udp.read(answer, sizeof(answer) - 1);
      answer[got > 0 ? got : 0] = '\0';

      // Same line format as the manifest, and read the same way: keyword,
      // space, value, and anything unknown is skipped. A field added to the
      // answer later must not upset a device that is already in a drawer.
      bool ours = false;
      uint16_t said = 0;
      for (char *line = strtok(answer, "\n"); line; line = strtok(nullptr, "\n")) {
        if (strncmp(line, "vorlaut ", 8) == 0) ours = true;
        else if (strncmp(line, "port ", 5) == 0) said = (uint16_t)atoi(line + 5);
      }
      if (ours && said) {
        host = udp.remoteIP().toString();
        port = said;
        udp.stop();
        return true;
      }
      // Something else on the port. Keep listening until the time is up.
    }
  }

  udp.stop();
  return false;
}
