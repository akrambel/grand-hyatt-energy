/*
 * Grand Hyatt The Red Sea – ESP32 Environmental Monitor
 * Sensors : AHT20 (temperature + humidity, default ambient value) and BMP280 (pressure + temperature, diagnostics)
 * Transport: HTTPS POST (JSON) to the Supabase Edge Function "ingest", authenticated with a per-device API key.
 *
 * Behaviour
 *  - Time comes from NTP (UTC). No valid time -> no measurement is taken (no wrong timestamps are ever sent).
 *  - A measurement is taken every MEASURE_INTERVAL_S seconds, independent of Wi-Fi/server state.
 *  - If the upload fails (or older data is waiting), readings go to a persistent ring buffer in flash (LittleFS)
 *    and are delivered oldest-first when the connection is back. Duplicates are harmless (server de-duplicates).
 *  - Wi-Fi reconnects automatically (two networks supported); the device reboots after a long outage or when
 *    the sensors stay dead, and a hardware watchdog restarts it if the firmware ever hangs.
 *
 * Libraries (Arduino Library Manager): "Adafruit BMP280 Library", "Adafruit AHTX0" (+ Adafruit BusIO and
 * Adafruit Unified Sensor, installed automatically). Board package: "esp32 by Espressif Systems" 2.0.x or 3.x.
 *
 * Status: written for ESP32 DevKit V1. NOT yet compiled or run on real hardware by the author of this project –
 * see docs/hardware/README.md (section "First-time test checklist").
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include <time.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_AHTX0.h>

#include "config.h"
#include "secrets.h"      // copy of secrets.example.h with your values (git-ignored)
#include "ring_queue.h"
#include "payload.h"

// ------------------------------------------------------------------ storage --
class LittleFsStorage : public QueueStorage {
 public:
  bool ensureSize(size_t total) override {
    if (LittleFS.exists(QUEUE_FILE)) {
      File f = LittleFS.open(QUEUE_FILE, "r");
      size_t sz = f ? f.size() : 0;
      if (f) f.close();
      if (sz == total) return open();
      LittleFS.remove(QUEUE_FILE);              // other capacity: start over
    }
    File w = LittleFS.open(QUEUE_FILE, "w");
    if (!w) return false;
    uint8_t zeros[256] = {0};
    for (size_t done = 0; done < total; done += sizeof zeros) {
      size_t n = total - done < sizeof zeros ? total - done : sizeof zeros;
      if (w.write(zeros, n) != n) { w.close(); return false; }
    }
    w.close();
    return open();
  }
  bool read(size_t off, void* buf, size_t len) override {
    if (!f_ || !f_.seek(off)) return false;
    return f_.read(static_cast<uint8_t*>(buf), len) == len;
  }
  bool write(size_t off, const void* buf, size_t len) override {
    if (!f_ || !f_.seek(off)) return false;
    bool ok = f_.write(static_cast<const uint8_t*>(buf), len) == len;
    f_.flush();
    return ok;
  }
 private:
  bool open() { if (f_) f_.close(); f_ = LittleFS.open(QUEUE_FILE, "r+"); return (bool)f_; }
  File f_;
};

static LittleFsStorage queueStorage;
static RingQueue queue(queueStorage, QUEUE_CAPACITY);
static bool queueOk = false;

// ------------------------------------------------------------------- globals --
static Adafruit_BMP280 bmp;
static Adafruit_AHTX0 aht;
static bool bmpReady = false, ahtReady = false;
static Preferences prefs;
static uint16_t bootCount = 0;

static uint32_t nextMeasureMs = 0;
static uint32_t nextUploadMs = 0;
static uint32_t uploadFailures = 0;
static uint32_t lastWifiAttemptMs = 0;
static uint32_t wifiDownSinceMs = 0;
static uint32_t sensorFailRounds = 0;
static uint32_t lastTs = 0;
static bool wifiUsingSecond = false;

// ------------------------------------------------------------------- helpers --
static void led(bool on) { if (STATUS_LED_PIN >= 0) digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW); }
static void blink(int n, int ms = 120) { for (int i = 0; i < n; i++) { led(true); delay(ms); led(false); delay(ms); } }
static void feedWdt() { esp_task_wdt_reset(); }

static bool timeValid() { return time(nullptr) >= (time_t)MIN_VALID_UNIX_TIME; }

static void startNtp() { configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3); }  // UTC, no DST offsets

static bool waitForTime(uint32_t timeoutS) {
  uint32_t start = millis();
  while (!timeValid() && millis() - start < timeoutS * 1000UL) { delay(250); feedWdt(); }
  return timeValid();
}

static void setupWatchdog() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = WATCHDOG_S * 1000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WATCHDOG_S, true);
#endif
  esp_task_wdt_add(NULL);
}

// --------------------------------------------------------------------- Wi-Fi --
static bool haveSecondNetwork() { return strlen(WIFI_SSID_2) > 0; }

static void beginWifi() {
  const char* ssid = (wifiUsingSecond && haveSecondNetwork()) ? WIFI_SSID_2 : WIFI_SSID_1;
  const char* pass = (wifiUsingSecond && haveSecondNetwork()) ? WIFI_PASSWORD_2 : WIFI_PASSWORD_1;
  Serial.printf("[wifi] connecting to \"%s\"\n", ssid);
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(ssid, pass);
  lastWifiAttemptMs = millis();
}

static bool connectWifiBlocking() {
  beginWifi();
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_S * 1000UL) { delay(250); feedWdt(); }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    wifiDownSinceMs = 0;
    return true;
  }
  if (haveSecondNetwork()) wifiUsingSecond = !wifiUsingSecond;  // try the other network next time
  return false;
}

/** Non-blocking supervision, called every loop. */
static void superviseWifi() {
  if (WiFi.status() == WL_CONNECTED) { wifiDownSinceMs = 0; return; }
  if (wifiDownSinceMs == 0) wifiDownSinceMs = millis() ? millis() : 1;
  if (millis() - wifiDownSinceMs > RESTART_AFTER_OFFLINE_S * 1000UL) {
    Serial.println("[wifi] offline too long -> restarting");
    delay(200);
    ESP.restart();
  }
  if (millis() - lastWifiAttemptMs > WIFI_RETRY_INTERVAL_S * 1000UL) {
    if (haveSecondNetwork()) wifiUsingSecond = !wifiUsingSecond;
    beginWifi();
  }
}

// ------------------------------------------------------------------- sensors --
static bool initSensors() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(100);
  ahtReady = aht.begin();
  bmpReady = bmp.begin(BMP280_ADDR_PRIMARY) || bmp.begin(BMP280_ADDR_SECONDARY);
  if (bmpReady) {
    bmp.setSampling(Adafruit_BMP280::MODE_FORCED, Adafruit_BMP280::SAMPLING_X2, Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X16, Adafruit_BMP280::STANDBY_MS_500);
  }
  Serial.printf("[sensors] AHT20 %s, BMP280 %s\n", ahtReady ? "OK" : "NOT FOUND", bmpReady ? "OK" : "NOT FOUND");
  return ahtReady || bmpReady;
}

static SensorRecord measure(uint32_t ts) {
  float aT = NAN, aH = NAN, bT = NAN, bP = NAN;
  bool aRead = false, bRead = false;
  if (!ahtReady) ahtReady = aht.begin();   // lets a re-plugged sensor come back without a reboot
  if (ahtReady) {
    sensors_event_t hum, temp;
    if (aht.getEvent(&hum, &temp)) { aT = temp.temperature; aH = hum.relative_humidity; aRead = true; }
  }
  if (!bmpReady) bmpReady = bmp.begin(BMP280_ADDR_PRIMARY) || bmp.begin(BMP280_ADDR_SECONDARY);
  if (bmpReady) {
    if (bmp.takeForcedMeasurement()) { bT = bmp.readTemperature(); bP = bmp.readPressure() / 100.0f; bRead = true; }
  }
  SensorRecord r = makeRecord(ts, aRead, aT, aH, bRead, bT, bP, bootCount);
  if (!(r.flags & FLAG_AHT_OK)) ahtReady = false;   // force re-init on the next round
  if (!(r.flags & FLAG_BMP_OK)) bmpReady = false;
  return r;
}

// -------------------------------------------------------------------- upload --
/** Sends up to `n` records. Returns true only when the server confirmed the whole batch. */
static bool sendBatch(const SensorRecord* recs, size_t n, int* httpCode) {
  static char body[4096];
  size_t len = buildPayload(body, sizeof body, DEVICE_ID, FW_VERSION, recs, n);
  if (len == 0) { Serial.println("[upload] payload buffer too small"); *httpCode = -100; return false; }

  WiFiClientSecure client;
#if ALLOW_INSECURE_TLS
  client.setInsecure();
  Serial.println("[tls] WARNING: certificate verification is DISABLED");
#else
  client.setCACert(ROOT_CA);
#endif
  client.setTimeout(HTTP_TIMEOUT_MS / 1000);

  HTTPClient http;
  String url = String("https://") + API_HOST + API_PATH;
  if (!http.begin(client, url)) { *httpCode = -101; return false; }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  feedWdt();
  int code = http.POST((uint8_t*)body, len);
  *httpCode = code;
  String resp = code > 0 ? http.getString() : String();
  http.end();
  feedWdt();

  if (code != 200) {
    Serial.printf("[upload] HTTP %d %s\n", code, code < 0 ? HTTPClient::errorToString(code).c_str() : resp.substring(0, 120).c_str());
    return false;
  }
  ServerReply reply = parseReply(resp.c_str());
  if (!reply.ok) { Serial.println("[upload] server did not confirm the batch"); return false; }
  if (reply.serverTime > MIN_VALID_UNIX_TIME) {
    long diff = (long)time(nullptr) - (long)reply.serverTime;
    if (labs(diff) > CLOCK_DRIFT_RESYNC_S) { Serial.printf("[time] clock off by %ld s -> resync\n", diff); startNtp(); }
  }
  return true;
}

/** Delivers queued records oldest-first. Returns true when the queue is empty afterwards. */
static bool drainQueue() {
  static SensorRecord batch[UPLOAD_BATCH_MAX];
  while (queue.size() > 0) {
    if (WiFi.status() != WL_CONNECTED || !timeValid()) return false;
    uint32_t n = queue.peek(batch, UPLOAD_BATCH_MAX);
    if (n == 0) { queue.pop(queue.size()); return true; }   // unreadable storage: do not loop forever
    int code = 0;
    if (sendBatch(batch, n, &code)) {
      queue.pop(n);
      uploadFailures = 0;
      Serial.printf("[upload] delivered %u buffered reading(s), %u left\n", (unsigned)n, (unsigned)queue.size());
    } else if (code == 400) {
      // The server says this batch can never be accepted (malformed). Drop it so it cannot block newer data.
      Serial.println("[upload] batch rejected as invalid (HTTP 400) -> discarded");
      queue.pop(n);
    } else if (code == 413 && n > 1) {
      // too large for the server: nothing to do here, batches are already small; retry later
      uploadFailures++;
      return false;
    } else {
      uploadFailures++;   // 401/403 (bad key), 5xx, network errors: keep the data and retry with back-off
      return false;
    }
    feedWdt();
  }
  return true;
}

static void deliver(const SensorRecord& rec) {
  bool backlog = queueOk && queue.size() > 0;
  bool canTry = WiFi.status() == WL_CONNECTED && timeValid() && (int32_t)(millis() - nextUploadMs) >= 0;
  if (!backlog && canTry) {
    int code = 0;
    if (sendBatch(&rec, 1, &code)) { uploadFailures = 0; blink(1, 40); return; }
    if (code == 400) { Serial.println("[upload] reading rejected as invalid -> discarded"); return; }
    uploadFailures++;
  }
  if (queueOk) {
    if (!queue.push(rec)) Serial.println("[queue] ERROR: could not store reading");
    else Serial.printf("[queue] buffered (%u waiting, %u overwritten)\n", (unsigned)queue.size(), (unsigned)queue.dropped());
  } else {
    Serial.println("[queue] unavailable – reading lost");
  }
  if (uploadFailures > 0) nextUploadMs = millis() + backoffSeconds(uploadFailures) * 1000UL;
}

// --------------------------------------------------------------------- setup --
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== Environment monitor %s (device %s) ===\n", FW_VERSION, DEVICE_ID);
  if (STATUS_LED_PIN >= 0) pinMode(STATUS_LED_PIN, OUTPUT);
  if (!validDeviceId(DEVICE_ID)) { Serial.println("[config] DEVICE_ID invalid (3-40 letters, digits, - or _)"); }

  setupWatchdog();

  prefs.begin("envmon", false);
  bootCount = (uint16_t)(prefs.getUShort("boots", 0) + 1);
  prefs.putUShort("boots", bootCount);
  prefs.end();

  if (!LittleFS.begin(true)) Serial.println("[fs] LittleFS mount failed");
  else {
    queueOk = queue.begin();
    Serial.printf("[queue] %s, %u reading(s) waiting\n", queueOk ? "ready" : "FAILED", (unsigned)(queueOk ? queue.size() : 0));
  }

  if (!initSensors()) { Serial.println("[sensors] none found – check wiring (see docs/hardware)"); blink(5); }

  if (connectWifiBlocking()) {
    startNtp();
    if (waitForTime(NTP_WAIT_TIMEOUT_S)) Serial.printf("[time] synchronised: %lu\n", (unsigned long)time(nullptr));
    else Serial.println("[time] NTP not available yet – measurements start when the clock is set");
  } else {
    Serial.println("[wifi] not connected – will keep retrying");
  }
  nextMeasureMs = millis();
}

// ---------------------------------------------------------------------- loop --
void loop() {
  feedWdt();
  superviseWifi();

  static bool ntpStarted = false;
  if (WiFi.status() == WL_CONNECTED && !ntpStarted) { startNtp(); ntpStarted = true; }
  if (WiFi.status() != WL_CONNECTED) ntpStarted = false;

  if ((int32_t)(millis() - nextMeasureMs) >= 0) {
    nextMeasureMs += MEASURE_INTERVAL_S * 1000UL;
    if ((int32_t)(millis() - nextMeasureMs) >= 0) nextMeasureMs = millis() + MEASURE_INTERVAL_S * 1000UL;  // we were stalled: do not burst

    if (!timeValid()) {
      Serial.println("[time] clock not synchronised -> measurement skipped");
    } else {
      uint32_t ts = (uint32_t)time(nullptr);
      if (ts != lastTs) {
        lastTs = ts;
        SensorRecord r = measure(ts);
        Serial.printf("[meas] ts=%lu AHT20 %s %.2fC %.1f%%  BMP280 %s %.2fC %.1fhPa\n", (unsigned long)ts,
                      (r.flags & FLAG_AHT_OK) ? "ok" : "FAULT", r.aht_t / 100.0, r.aht_h / 100.0,
                      (r.flags & FLAG_BMP_OK) ? "ok" : "FAULT", r.bmp_t / 100.0, r.bmp_p / 10.0);
        if (r.flags == 0) {
          sensorFailRounds++;
          if (sensorFailRounds >= RESTART_AFTER_SENSOR_FAILS) { Serial.println("[sensors] no valid data for too long -> restarting"); delay(200); ESP.restart(); }
        } else sensorFailRounds = 0;
        // Records without any valid sensor are still sent: the dashboard then shows the fault (sensor status).
        deliver(r);
      }
    }
  }

  // Deliver the backlog whenever possible (independent of new measurements).
  if (queueOk && queue.size() > 0 && WiFi.status() == WL_CONNECTED && timeValid() && (int32_t)(millis() - nextUploadMs) >= 0) {
    if (!drainQueue()) nextUploadMs = millis() + backoffSeconds(uploadFailures ? uploadFailures : 1) * 1000UL;
  }
  delay(50);
}
