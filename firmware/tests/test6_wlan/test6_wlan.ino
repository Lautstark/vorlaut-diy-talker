// Stufe 6: WLAN.
//
// Bringt das Geraet ins Netz - Voraussetzung dafuer, dass es sich spaeter
// Inhalte selbst holen kann. Noch ohne Displays und ohne Ton, nur serielle
// Ausgabe: was hier schiefgeht, soll man lesen koennen und nicht raten.
//
// Sind keine Zugangsdaten gespeichert, macht das Geraet einen eigenen
// Zugangspunkt auf ("vorlaut einrichten"). Wer sich mit dem Handy verbindet,
// bekommt eine Seite zum Eintragen von WLAN und Passwort. Getippt wird also
// auf dem Handy - auf 15 mm Display waere das nichts. Danach merkt sich der
// ESP32 die Daten selbst, das Portal kommt nicht wieder.
//
// WAS ZU SEHEN SEIN SOLLTE
//
//   - "verbunden" mit IP-Adresse und Signalstaerke
//   - danach alle fuenf Sekunden eine Statuszeile
//   - Netz abschalten: es meldet den Verlust und versucht es weiter
//
// Das Portal laeuft in eine Zeitgrenze und gibt danach auf. Ein Talker, der
// beim Einrichten haengenbleibt, spricht nicht mehr - das darf nicht passieren.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>

// Wie lange das Einrichtungsportal offen bleibt, bevor es aufgibt.
static const unsigned long PORTAL_SECONDS = 180;
static const char *AP_NAME = "vorlaut einrichten";

static uint32_t lastReport = 0;
static bool wasConnected = false;

// Das Portal traegt sonst das Aussehen der Bibliothek. Es ist aber das
// Erste, was jemand von vorlaut zu sehen bekommt - also dieselben Farben
// wie die Weboberflaeche, derselbe Ton.
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
  // Nur was gebraucht wird: Netz aussuchen, Daten eintragen, fertig.
  // static, weil setMenu die Liste per Referenz nimmt und behaelt.
  static std::vector<const char *> menu = {"wifi", "info", "restart"};
  wm.setMenu(menu);
  wm.setConfigPortalTimeout(PORTAL_SECONDS);
  wm.setDarkMode(true);

  Serial.println("Suche gespeichertes Netz ...");
  if (!wm.autoConnect(AP_NAME)) {
    Serial.println("Keine Verbindung und das Portal ist abgelaufen.");
    Serial.println("Das Geraet laeuft trotzdem weiter - nur ohne Netz.");
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
