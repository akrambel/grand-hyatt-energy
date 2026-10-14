// JSON payload building, response parsing and sensor value validation.
// Pure C++ (no Arduino headers) so it can be unit-tested on a PC.
#pragma once
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ring_queue.h"

// Plausibility limits: values outside are treated as a sensor fault (never uploaded as data).
inline bool plausibleTemp(float t)     { return !isnan(t) && t >= -40.0f && t <= 85.0f; }
inline bool plausibleHumidity(float h) { return !isnan(h) && h >= 0.0f && h <= 100.0f; }
inline bool plausiblePressure(float p) { return !isnan(p) && p >= 300.0f && p <= 1100.0f; }

inline bool validDeviceId(const char* id) {
  size_t n = id ? strlen(id) : 0;
  if (n < 3 || n > 40) return false;
  for (size_t i = 0; i < n; i++) {
    char c = id[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
  }
  return true;
}

/** Builds a record. A sensor whose values are implausible is flagged "not ok" and its values are zeroed. */
inline SensorRecord makeRecord(uint32_t ts, bool ahtRead, float ahtT, float ahtH, bool bmpRead, float bmpT, float bmpP, uint16_t boot) {
  SensorRecord r;
  memset(&r, 0, sizeof r);
  r.ts = ts; r.boot = boot;
  if (ahtRead && plausibleTemp(ahtT) && plausibleHumidity(ahtH)) {
    r.aht_t = (int16_t)lroundf(ahtT * 100.0f);
    r.aht_h = (uint16_t)lroundf(ahtH * 100.0f);
    r.flags |= FLAG_AHT_OK;
  }
  if (bmpRead && plausibleTemp(bmpT) && plausiblePressure(bmpP)) {
    r.bmp_t = (int16_t)lroundf(bmpT * 100.0f);
    r.bmp_p = (uint16_t)lroundf(bmpP * 10.0f);
    r.flags |= FLAG_BMP_OK;
  }
  return r;
}

// Formats value/100 (or /10) as a decimal without relying on printf("%f") support.
inline int fmtFixed(char* out, size_t cap, long v, int decimals) {
  long div = decimals == 1 ? 10 : 100;
  const char* sign = v < 0 ? "-" : "";
  long a = v < 0 ? -v : v;
  return decimals == 1 ? snprintf(out, cap, "%s%ld.%01ld", sign, a / div, a % div)
                       : snprintf(out, cap, "%s%ld.%02ld", sign, a / div, a % div);
}

/**
 * Writes {"device_id":..,"firmware":..,"readings":[..]} into `out`.
 * Returns the length, or 0 when the buffer is too small.
 */
inline size_t buildPayload(char* out, size_t cap, const char* deviceId, const char* firmware, const SensorRecord* recs, size_t n) {
  size_t len = 0;
  auto add = [&](const char* s) { size_t l = strlen(s); if (len + l + 1 > cap) return false; memcpy(out + len, s, l); len += l; out[len] = 0; return true; };
  char tmp[192], a[24], b[24];
  snprintf(tmp, sizeof tmp, "{\"device_id\":\"%s\",\"firmware\":\"%s\",\"readings\":[", deviceId, firmware);
  if (!add(tmp)) return 0;
  for (size_t i = 0; i < n; i++) {
    const SensorRecord& r = recs[i];
    if (i && !add(",")) return 0;
    snprintf(tmp, sizeof tmp, "{\"ts\":%lu,", (unsigned long)r.ts);
    if (!add(tmp)) return 0;
    if (r.flags & FLAG_AHT_OK) {
      fmtFixed(a, sizeof a, r.aht_t, 2); fmtFixed(b, sizeof b, r.aht_h, 2);
      snprintf(tmp, sizeof tmp, "\"aht20\":{\"temp_c\":%s,\"humidity_pct\":%s,\"ok\":true},", a, b);
    } else snprintf(tmp, sizeof tmp, "\"aht20\":{\"ok\":false},");
    if (!add(tmp)) return 0;
    if (r.flags & FLAG_BMP_OK) {
      fmtFixed(a, sizeof a, r.bmp_t, 2); fmtFixed(b, sizeof b, r.bmp_p, 1);
      snprintf(tmp, sizeof tmp, "\"bmp280\":{\"temp_c\":%s,\"pressure_hpa\":%s,\"ok\":true},", a, b);
    } else snprintf(tmp, sizeof tmp, "\"bmp280\":{\"ok\":false},");
    if (!add(tmp)) return 0;
    snprintf(tmp, sizeof tmp, "\"boot\":%u}", (unsigned)r.boot);
    if (!add(tmp)) return 0;
  }
  if (!add("]}")) return 0;
  return len;
}

struct ServerReply { bool ok; uint32_t serverTime; };

/** Minimal parser for {"ok":true,"server_time":1234,...}. Returns ok=false when the body is not a success reply. */
inline ServerReply parseReply(const char* body) {
  ServerReply r = {false, 0};
  if (!body) return r;
  const char* ok = strstr(body, "\"ok\":");
  if (!ok) return r;
  ok += 5; while (*ok == ' ') ok++;
  r.ok = strncmp(ok, "true", 4) == 0;
  const char* st = strstr(body, "\"server_time\":");
  if (st) r.serverTime = (uint32_t)strtoul(st + 14, nullptr, 10);
  return r;
}

/** Wait before the next upload attempt after `failures` consecutive failures (seconds, capped, with 25 % jitter room). */
inline uint32_t backoffSeconds(uint32_t failures, uint32_t baseSeconds = 15, uint32_t maxSeconds = 600) {
  if (failures == 0) return 0;
  uint32_t s = baseSeconds;
  for (uint32_t i = 1; i < failures && s < maxSeconds; i++) s *= 2;
  return s > maxSeconds ? maxSeconds : s;
}
