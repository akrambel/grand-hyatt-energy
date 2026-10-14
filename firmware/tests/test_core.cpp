// Host-side unit tests for the firmware's pure logic (offline ring buffer, payload, validation).
// Build/run: bash firmware/tests/run.sh
#include <cassert>
#include <cstdio>
#include <string>
#include <vector>
#include "../esp32_environment_monitor/payload.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

struct MemStorage : QueueStorage {
  std::vector<uint8_t> data;
  bool failWrites = false;
  bool ensureSize(size_t total) override { if (data.size() != total) data.assign(total, 0); return true; }
  bool read(size_t o, void* b, size_t n) override { if (o + n > data.size()) return false; memcpy(b, &data[o], n); return true; }
  bool write(size_t o, const void* b, size_t n) override { if (failWrites || o + n > data.size()) return false; memcpy(&data[o], b, n); return true; }
};

static SensorRecord rec(uint32_t ts) { return makeRecord(ts, true, 27.41f, 50.25f, true, 27.0f, 1008.34f, 7); }

static void testQueueOrderAndPersistence() {
  MemStorage st;
  { RingQueue q(st, 8); CHECK(q.begin()); CHECK(q.size() == 0);
    for (uint32_t i = 1; i <= 5; i++) CHECK(q.push(rec(1760000000 + i)));
    CHECK(q.size() == 5);
    SensorRecord out[3]; CHECK(q.peek(out, 3) == 3);
    CHECK(out[0].ts == 1760000001 && out[2].ts == 1760000003);
    CHECK(q.pop(2)); CHECK(q.size() == 3); }
  // "reboot": new queue object over the same storage
  { RingQueue q(st, 8); CHECK(q.begin()); CHECK(q.size() == 3);
    SensorRecord out[8]; CHECK(q.peek(out, 8) == 3); CHECK(out[0].ts == 1760000003 && out[2].ts == 1760000005);
    CHECK(q.pop(10)); CHECK(q.size() == 0); }
}

static void testQueueWrapAndOverflow() {
  MemStorage st; RingQueue q(st, 4); CHECK(q.begin());
  for (uint32_t i = 1; i <= 10; i++) CHECK(q.push(rec(1760000000 + i)));
  CHECK(q.size() == 4); CHECK(q.dropped() == 6);
  SensorRecord out[4]; CHECK(q.peek(out, 4) == 4);
  CHECK(out[0].ts == 1760000007 && out[3].ts == 1760000010);   // newest 4 kept, order preserved across the wrap
  CHECK(q.pop(2)); CHECK(q.push(rec(1760000011)));
  CHECK(q.peek(out, 4) == 3 && out[0].ts == 1760000009 && out[2].ts == 1760000011);
}

static void testQueueCorruption() {
  MemStorage st; { RingQueue q(st, 4); q.begin(); q.push(rec(1760000001)); }
  st.data[9] ^= 0xFF;   // damage the header
  RingQueue q(st, 4); CHECK(q.begin()); CHECK(q.size() == 0);        // reformatted, no crash
  CHECK(q.push(rec(1760000002))); CHECK(q.size() == 1);
  RingQueue other(st, 6); CHECK(other.begin()); CHECK(other.size() == 0);   // capacity change -> reformat
}

static void testQueueWriteFailure() {
  MemStorage st; RingQueue q(st, 4); q.begin();
  st.failWrites = true; CHECK(!q.push(rec(1760000001)));
  st.failWrites = false; CHECK(q.push(rec(1760000002)));
  SensorRecord out[2]; CHECK(q.peek(out, 2) >= 1);
}

static void testRecordValidation() {
  SensorRecord r = rec(1760000000);
  CHECK(r.flags == (FLAG_AHT_OK | FLAG_BMP_OK)); CHECK(r.aht_t == 2741); CHECK(r.aht_h == 5025); CHECK(r.bmp_t == 2700); CHECK(r.bmp_p == 10083);
  SensorRecord bad = makeRecord(1760000000, true, 140.0f, 50, true, 27, 1008, 1);          // impossible AHT20 temperature
  CHECK(!(bad.flags & FLAG_AHT_OK)); CHECK(bad.aht_t == 0); CHECK(bad.flags & FLAG_BMP_OK);
  SensorRecord nan = makeRecord(1760000000, true, NAN, NAN, false, 0, 0, 1);
  CHECK(nan.flags == 0);
  SensorRecord neg = makeRecord(1760000000, true, -5.5f, 99.0f, true, -5.4f, 1013.2f, 1);
  CHECK(neg.aht_t == -550);
  CHECK(!plausiblePressure(250.0f) && plausiblePressure(1013.0f) && !plausibleHumidity(100.5f));
  CHECK(validDeviceId("esp32-01") && !validDeviceId("ab") && !validDeviceId("bad id") && !validDeviceId("x\"y\"z"));
}

static void testPayload() {
  SensorRecord rs[3] = { rec(1760000001), makeRecord(1760000002, false, 0, 0, true, -5.4f, 1013.25f, 7), makeRecord(1760000003, true, NAN, NAN, true, 27, 5000, 7) };
  char buf[2048];
  size_t n = buildPayload(buf, sizeof buf, "esp32-01", "1.0.0", rs, 3);
  CHECK(n > 0 && n == strlen(buf));
  std::string s(buf);
  CHECK(s.find("\"device_id\":\"esp32-01\"") != std::string::npos);
  CHECK(s.find("\"temp_c\":27.41,\"humidity_pct\":50.25,\"ok\":true") != std::string::npos);
  CHECK(s.find("\"temp_c\":-5.40,\"pressure_hpa\":1013.3") != std::string::npos || s.find("\"temp_c\":-5.40,\"pressure_hpa\":1013.2") != std::string::npos);
  CHECK(s.find("\"aht20\":{\"ok\":false}") != std::string::npos);
  CHECK(s.find("\"bmp280\":{\"ok\":false}") != std::string::npos);
  char small[40]; CHECK(buildPayload(small, sizeof small, "esp32-01", "1.0.0", rs, 3) == 0);
  FILE* f = fopen("../../tests/fixtures/firmware-payload.json", "w"); if (f) { fputs(buf, f); fclose(f); }
  // max batch must fit the 4096-byte buffer used by the sketch
  std::vector<SensorRecord> many(20, rec(1760000000));
  static char big[4096]; CHECK(buildPayload(big, sizeof big, "esp32-01", "1.0.0", many.data(), many.size()) > 0);
}

static void testReplyAndBackoff() {
  ServerReply a = parseReply("{\"ok\":true,\"server_time\":1700000123,\"accepted\":1}");
  CHECK(a.ok && a.serverTime == 1700000123);
  CHECK(!parseReply("{\"ok\":false,\"error\":\"x\"}").ok);
  CHECK(!parseReply("<html>").ok); CHECK(!parseReply(nullptr).ok);
  CHECK(backoffSeconds(0) == 0 && backoffSeconds(1) == 15 && backoffSeconds(2) == 30 && backoffSeconds(3) == 60);
  CHECK(backoffSeconds(50) == 600);
}

int main() {
  testQueueOrderAndPersistence(); testQueueWrapAndOverflow(); testQueueCorruption(); testQueueWriteFailure();
  testRecordValidation(); testPayload(); testReplyAndBackoff();
  if (failures) { printf("%d check(s) FAILED\n", failures); return 1; }
  printf("firmware core: all checks passed\n");
  return 0;
}
