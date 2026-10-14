// Non-secret firmware settings. Secrets (Wi-Fi password, API key) live in secrets.h – see secrets.example.h.
#pragma once

#define FW_VERSION "1.0.0"

// ---- I2C wiring ----
// Classic ESP32 (DevKit V1): SDA = GPIO21, SCL = GPIO22.
// ESP32-C3: that chip has no GPIO22 (using it crashes the board), so SDA = GPIO8, SCL = GPIO9
// (the standard I2C pins of most ESP32-C3 boards). Change the numbers here if you wired other pins.
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  #define PIN_SDA 8
  #define PIN_SCL 9
  #define STATUS_LED_PIN -1       // LED pin differs between C3 boards; disabled for safety
#else
  #define PIN_SDA 21
  #define PIN_SCL 22
  #define STATUS_LED_PIN 2        // on-board LED; set to -1 to disable
#endif

// ---- Sensor addresses ----
#define BMP280_ADDR_PRIMARY   0x76   // SDO -> GND
#define BMP280_ADDR_SECONDARY 0x77   // SDO -> VCC
// AHT20 is fixed at 0x38

// ---- Timing ----
#define MEASURE_INTERVAL_S      60      // one measurement per minute
#define UPLOAD_BATCH_MAX        20      // readings per HTTPS request (server limit is 100)
#define WIFI_CONNECT_TIMEOUT_S  20
#define WIFI_RETRY_INTERVAL_S   30
#define HTTP_TIMEOUT_MS         12000
#define NTP_WAIT_TIMEOUT_S      30
#define CLOCK_DRIFT_RESYNC_S    120     // resync NTP when the server time differs by more than this
#define WATCHDOG_S              90
#define RESTART_AFTER_OFFLINE_S 1800    // reboot if Wi-Fi was down this long (recovers a stuck radio)
#define RESTART_AFTER_SENSOR_FAILS 30   // consecutive measurement rounds without any valid sensor

// ---- Offline buffer (LittleFS) ----
#define QUEUE_FILE      "/queue.bin"
#define QUEUE_CAPACITY  5000            // 5000 x 16 B = 80 KB, about 3.5 days at 1 reading/minute

// ---- Time (UTC only – the dashboard converts to the property time zone) ----
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.google.com"
#define NTP_SERVER_3 "time.cloudflare.com"
#define MIN_VALID_UNIX_TIME 1704067200UL  // 2024-01-01: earlier means the clock is not synchronised

// ---- TLS ----
// 0 (default) = verify the server certificate with ROOT_CA from secrets.h.
// 1 = DO NOT VERIFY (testing only!). Anyone on the network could then read/modify the traffic.
#define ALLOW_INSECURE_TLS 0
