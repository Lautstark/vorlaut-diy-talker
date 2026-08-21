// Stage 6: Wi-Fi.
//
// Gets the device onto the network - the prerequisite for it fetching content
// by itself later. Still without displays and without sound, serial output
// only: whatever goes wrong here should be readable and not guessed at.
//
// If no credentials are stored, the device opens an access point of its own
// ("vorlaut einrichten"). Whoever connects with a phone gets a page for
// entering network and password. So the typing happens on the phone - on a
// 15 mm display it would be hopeless. Afterwards the ESP32 remembers the
// details itself and the portal does not come back.
//
// WHAT SHOULD BE VISIBLE
//
//   - "verbunden" with IP address and signal strength
//   - a status line every five seconds after that
//   - switch the network off: it reports the loss and keeps trying
//
// The portal runs into a time limit and then gives up. A talker that hangs
// during setup no longer speaks - that must not happen.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>

// How long the setup portal stays open before it gives up.
static const unsigned long PORTAL_SECONDS = 180;
static const char *AP_NAME = "vorlaut einrichten";

static uint32_t lastReport = 0;
static bool wasConnected = false;

// Otherwise the portal wears the library's looks. But it is the first thing
// anyone sees of vorlaut - so the same colours as the web interface, the same
// tone of voice.
static const char PORTAL_STYLE[] PROGMEM = R"(
<style>
  :root { --bg:#16181d; --panel:#1f2229; --line:#343a45;
          --text:#eceff4; --muted:#9aa3b2; --accent:#9B7BFF; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,
         BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:420px; }
  h1, h3 { color:var(--text); font-weight:600; }
  button, input[type=submit] { background:var(--accent); color:#16181d;
         border:0; border-radius:10px; font-weight:600; padding:12px; }
  input { background:var(--panel); color:var(--text);
          border:1px solid var(--line); border-radius:10px; padding:12px; }
  a { color:var(--accent); }
  .msg { background:var(--panel); border:1px solid var(--line);
         border-radius:10px; color:var(--muted); }
  .q { filter:invert(1); }
</style>
<div style="padding:18px 0 4px">
  <div style="font-size:22px;font-weight:600">vorlaut</div>
  <div style="color:#9aa3b2;font-size:14px;line-height:1.45;margin-top:6px">
    Damit der Talker neue Inhalte holen kann, braucht er dein WLAN.
    Es bleibt gespeichert, diese Seite kommt also nur einmal.
  </div>
</div>
)";

static void reportConnection() {
  Serial.printf("verbunden mit \"%s\"\n", WiFi.SSID().c_str());
  Serial.print("  IP-Adresse:    ");
  Serial.println(WiFi.localIP());
  Serial.printf("  Signalstaerke: %d dBm\n", WiFi.RSSI());
  Serial.printf("  MAC:           %s\n", WiFi.macAddress().c_str());
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("vorlaut – Stufe 6: WLAN");

  WiFi.mode(WIFI_STA);

  WiFiManager wm;
  wm.setTitle("vorlaut");
  wm.setCustomHeadElement(PORTAL_STYLE);
  // Only what is needed: pick a network, enter the details, done.
  // static, because setMenu takes and keeps the list by reference.
  static std::vector<const char *> menu = {"wifi", "info", "restart"};
  wm.setMenu(menu);
  wm.setConfigPortalTimeout(PORTAL_SECONDS);
  wm.setDarkMode(true);

  Serial.println("Suche gespeichertes Netz ...");
  if (!wm.autoConnect(AP_NAME)) {
    Serial.println("No connection and the portal has timed out.");
    Serial.println("The device keeps running anyway - just without a network.");
    return;
  }

  wasConnected = true;
  reportConnection();
}

void loop() {
  bool now = WiFi.status() == WL_CONNECTED;

  if (now != wasConnected) {
    wasConnected = now;
    if (now) {
      Serial.println();
      reportConnection();
    } else {
      Serial.println();
      Serial.println("Verbindung verloren - versuche es weiter.");
    }
  }

  if (millis() - lastReport >= 5000) {
    lastReport = millis();
    if (now) {
      Serial.printf("verbunden, %d dBm, IP %s\n",
                    WiFi.RSSI(), WiFi.localIP().toString().c_str());
    } else {
      Serial.println("nicht verbunden");
    }
  }
  delay(50);
}
