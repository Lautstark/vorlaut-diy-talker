// Fetching content from the web interface over Wi-Fi.
//
// The device asks for a manifest, compares it with what it already holds, and
// fetches only what is missing. That works because a file name always means
// the same content - see docs/software.md. layout.bin is the exception: it
// always has the same name, so it is fetched every time.
//
// No JSON. The manifest arrives as lines (build.manifest_text), because a
// parser on the ESP32 means a library, a heap and a class of failure that a
// fixed line format does not have. Same reasoning as layout.bin being binary.
//
// The protocol was settled before this file existed: tests/test_device_sync.py
// plays it through against the real server, including the mistakes that are
// easy to make here - a version stamp that describes the wrong thing, a second
// sync that transfers everything again, files that should have been deleted.

#pragma once
#include <Arduino.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <WiFi.h>

#define SYNC_TOKEN_HEADER "X-Vorlaut-Token"
#define SYNC_VERSION_FILE "/version"
// A manifest line is "file " + name + " " + size. The names are 34 characters,
// so this is generous on purpose.
#define SYNC_LINE_MAX 96
// A full layout is around 950 KiB over five sets. Anything far beyond that is
// not our server answering.
#define SYNC_MAX_BYTES (2u * 1024u * 1024u)
#define SYNC_TIMEOUT_MS 15000
// Reaching the computer is a different wait from transferring a file. On a
// network where the editor simply is not running - kindergarten, a holiday
// flat - nothing answers, and the default wait is long enough that the device
// looks broken while it happens. A connection on the same network either
// comes about in a moment or not at all.
#define SYNC_CONNECT_MS 4000

// What went wrong, as something the caller can translate. The text next to
// it is for the serial monitor, which is English like the rest of the
// developer side; the display needs short words out of texts.h and cannot use
// a sentence.
enum SyncError {
  SYNC_OK = 0,
  SYNC_NO_NETWORK,
  SYNC_NO_SERVER,
  SYNC_BAD_KEY,
  SYNC_SWITCHED_OFF,
  SYNC_NO_ANSWER,
  SYNC_WRITE_FAILED,
};

struct SyncStatus {
  bool ok;
  SyncError code;
  uint16_t fetched;        // files pulled this time
  uint16_t removed;        // files thrown away this time
  uint16_t kept;           // files that were already there
  uint32_t bytes;
  const char *error;       // nullptr when ok
};

// Called between files so the caller can draw something. done counts from 0.
typedef void (*SyncProgress)(uint16_t done, uint16_t total);

class Sync {
 public:
  Sync(const String &host, uint16_t port, const String &token)
      : host_(host), port_(port), token_(token) {}

  // What the device fetched last time. Kept in a file rather than in NVS: it
  // belongs to the content, and a file system that gets wiped should lose it
  // along with everything else.
  static String storedVersion() {
    File file = LittleFS.open(SYNC_VERSION_FILE, "r");
    if (!file) return String();
    String value = file.readStringUntil('\n');
    file.close();
    value.trim();
    return value;
  }

  SyncStatus run(SyncProgress progress = nullptr) {
    SyncStatus status = {false, SYNC_OK, 0, 0, 0, 0, nullptr};
    if (WiFi.status() != WL_CONNECTED) {
      status.code = SYNC_NO_NETWORK;
      status.error = "no network";
      return status;
    }
    if (host_.length() == 0) {
      status.code = SYNC_NO_SERVER;
      status.error = "no server set";
      return status;
    }

    String manifest;
    if (!fetch("/api/device/manifest", &manifest, nullptr)) {
      status.code = lastCode_;
      status.error = lastError_;
      return status;
    }

    // Two passes over the manifest. The first only counts, so the progress
    // display knows its total before anything is transferred.
    const uint16_t total = countFiles(manifest);
    String version;
    uint16_t done = 0;

    for (int start = 0; start < (int)manifest.length(); ) {
      int end = manifest.indexOf('\n', start);
      if (end < 0) end = manifest.length();
      char line[SYNC_LINE_MAX];
      const int length = min(end - start, (int)sizeof(line) - 1);
      memcpy(line, manifest.c_str() + start, length);
      line[length] = '\0';
      start = end + 1;

      char *space = strchr(line, ' ');
      if (!space) continue;              // a keyword without a value
      *space = '\0';
      const char *value = space + 1;

      if (strcmp(line, "version") == 0) {
        version = value;
      } else if (strcmp(line, "file") == 0) {
        char *second = strchr((char *)value, ' ');
        if (second) *second = '\0';
        const String name = String("/") + value;
        // A name means one content, so anything already here can stay. Only
        // layout.bin keeps its name across changes and is always fetched.
        const bool always = strcmp(value, "layout.bin") == 0;
        if (!always && LittleFS.exists(name)) {
          status.kept++;
        } else {
          uint32_t got = 0;
          if (!fetchToFile(value, &got)) {
            status.code = lastCode_;
            status.error = lastError_;
            return status;
          }
          status.fetched++;
          status.bytes += got;
        }
        if (progress) progress(++done, total);
        keep_ += name + "\n";
      }
      // Anything else is skipped on purpose: a field added later must not
      // stop a device that is already in the field.
    }

    status.removed = sweep();
    if (version.length()) {
      File file = LittleFS.open(SYNC_VERSION_FILE, "w");
      if (file) { file.println(version); file.close(); }
    }
    status.ok = true;
    return status;
  }

 private:
  String host_;
  uint16_t port_;
  String token_;
  String keep_;
  SyncError lastCode_ = SYNC_OK;
  const char *lastError_ = nullptr;

  String url(const char *path) const {
    return "http://" + host_ + ":" + String(port_) + path;
  }

  static uint16_t countFiles(const String &manifest) {
    uint16_t n = 0;
    for (int i = 0; i >= 0 && i < (int)manifest.length();) {
      if (manifest.startsWith("file ", i)) n++;
      const int next = manifest.indexOf('\n', i);
      if (next < 0) break;
      i = next + 1;
    }
    return n;
  }

  bool fetch(const char *path, String *into, File *file) {
    HTTPClient http;
    http.setTimeout(SYNC_TIMEOUT_MS);
    http.setConnectTimeout(SYNC_CONNECT_MS);
    if (!http.begin(url(path))) {
      lastCode_ = SYNC_NO_SERVER;
      lastError_ = "bad address";
      return false;
    }
    // The key goes in a header and never in the address: addresses end up in
    // logs, and behind these endpoints are a child's recordings.
    http.addHeader(SYNC_TOKEN_HEADER, token_);
    const int code = http.GET();
    if (code != HTTP_CODE_OK) {
      lastCode_ = code == 401 ? SYNC_BAD_KEY
                : code == 503 ? SYNC_SWITCHED_OFF
                              : SYNC_NO_ANSWER;
      lastError_ = code == 401 ? "wrong key"
                 : code == 503 ? "sync switched off"
                 : code > 0    ? "server says no"
                               : "no answer";
      http.end();
      return false;
    }
    const int length = http.getSize();
    if (length > (int)SYNC_MAX_BYTES) {
      lastCode_ = SYNC_NO_ANSWER;
      lastError_ = "answer too big";
      http.end();
      return false;
    }
    if (into) {
      *into = http.getString();
    } else if (file) {
      http.writeToStream(file);
    }
    http.end();
    return true;
  }

  // Straight to the file system - a WAV does not fit in RAM twice.
  bool fetchToFile(const char *name, uint32_t *written) {
    const String target = String("/") + name;
    const String temp = "/.part";
    LittleFS.remove(temp);
    File file = LittleFS.open(temp, "w");
    if (!file) {
      lastCode_ = SYNC_WRITE_FAILED;
      lastError_ = "cannot write";
      return false;
    }

    const String path = String("/api/device/file?name=") + name;
    const bool ok = fetch(path.c_str(), nullptr, &file);
    *written = file.size();
    file.close();

    if (!ok) { LittleFS.remove(temp); return false; }
    // Only now under its real name. A transfer that breaks off leaves .part
    // behind and not half a file under a name that promises whole content.
    LittleFS.remove(target);
    if (!LittleFS.rename(temp, target)) {
      LittleFS.remove(temp);
      lastCode_ = SYNC_WRITE_FAILED;
      lastError_ = "cannot rename";
      return false;
    }
    return true;
  }

  // Everything the manifest no longer lists. Without this the file system
  // fills up with content from sets that were switched off long ago.
  uint16_t sweep() {
    uint16_t removed = 0;
    File dir = LittleFS.open("/");
    if (!dir) return 0;
    // Collect first, delete afterwards: deleting while walking the directory
    // is not something LittleFS promises anything about.
    String doomed;
    for (File entry = dir.openNextFile(); entry; entry = dir.openNextFile()) {
      if (entry.isDirectory()) continue;
      const String name = String(entry.name()).startsWith("/")
                        ? String(entry.name())
                        : String("/") + entry.name();
      if (name == SYNC_VERSION_FILE || name == "/.part") continue;
      if (keep_.indexOf(name + "\n") < 0) doomed += name + "\n";
    }
    dir.close();
    for (int start = 0; start < (int)doomed.length();) {
      const int end = doomed.indexOf('\n', start);
      if (end < 0) break;
      if (LittleFS.remove(doomed.substring(start, end))) removed++;
      start = end + 1;
    }
    return removed;
  }
};
