// Persistent FIFO ring buffer for sensor records (offline buffering).
// Pure C++ (no Arduino headers): the storage backend is injected, so the same code is
// compiled for the ESP32 (LittleFS file) and unit-tested on a PC (see firmware/tests).
//
// File layout:  [32-byte header][capacity x 16-byte records]
// Crash safety: a record is written BEFORE the header that publishes it. If power is lost in
// between, that one record is lost – the queue stays consistent. A corrupt header (bad CRC)
// triggers a re-format instead of undefined behaviour.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#pragma pack(push, 1)
struct SensorRecord {
  uint32_t ts;      // Unix time, seconds, UTC
  int16_t  aht_t;   // AHT20 temperature, 0.01 degC
  uint16_t aht_h;   // AHT20 relative humidity, 0.01 %
  int16_t  bmp_t;   // BMP280 temperature, 0.01 degC
  uint16_t bmp_p;   // BMP280 pressure, 0.1 hPa
  uint8_t  flags;   // bit0 = AHT20 ok, bit1 = BMP280 ok
  uint8_t  reserved;
  uint16_t boot;    // boot counter (diagnostics)
};
#pragma pack(pop)
static_assert(sizeof(SensorRecord) == 16, "SensorRecord must be 16 bytes");

constexpr uint8_t FLAG_AHT_OK = 0x01;
constexpr uint8_t FLAG_BMP_OK = 0x02;

class QueueStorage {
 public:
  virtual ~QueueStorage() {}
  virtual bool read(size_t offset, void* buf, size_t len) = 0;
  virtual bool write(size_t offset, const void* buf, size_t len) = 0;
  /** Makes sure the backing store is at least `total` bytes (zero-filled). */
  virtual bool ensureSize(size_t total) = 0;
};

class RingQueue {
 public:
  RingQueue(QueueStorage& storage, uint32_t capacity) : s_(storage), cap_(capacity) {}

  /** Opens the queue; formats it when it does not exist, has another capacity, or is corrupt. */
  bool begin() {
    if (!s_.ensureSize(kHeader + (size_t)cap_ * sizeof(SensorRecord))) return false;
    Header h;
    if (s_.read(0, &h, sizeof h) && valid(h) && h.capacity == cap_ && h.head < cap_ && h.count <= cap_) {
      head_ = h.head; count_ = h.count; dropped_ = h.dropped;
      return true;
    }
    head_ = 0; count_ = 0; dropped_ = 0;
    return writeHeader();
  }

  uint32_t size() const { return count_; }
  uint32_t capacity() const { return cap_; }
  /** Records overwritten because the queue was full (oldest data lost). */
  uint32_t dropped() const { return dropped_; }

  bool push(const SensorRecord& r) {
    if (count_ == cap_) {          // full: overwrite the oldest record
      head_ = (head_ + 1) % cap_;
      count_--;
      dropped_++;
    }
    uint32_t idx = (head_ + count_) % cap_;
    if (!s_.write(kHeader + (size_t)idx * sizeof(SensorRecord), &r, sizeof r)) return false;
    count_++;
    return writeHeader();
  }

  /** Copies up to `max` oldest records (without removing them). Returns how many were copied. */
  uint32_t peek(SensorRecord* out, uint32_t max) {
    uint32_t n = count_ < max ? count_ : max;
    for (uint32_t i = 0; i < n; i++) {
      uint32_t idx = (head_ + i) % cap_;
      if (!s_.read(kHeader + (size_t)idx * sizeof(SensorRecord), &out[i], sizeof(SensorRecord))) return i;
    }
    return n;
  }

  /** Removes the `n` oldest records (call after they were delivered). */
  bool pop(uint32_t n) {
    if (n > count_) n = count_;
    head_ = (head_ + n) % cap_;
    count_ -= n;
    return writeHeader();
  }

 private:
  static constexpr size_t kHeader = 32;
  static constexpr uint32_t kMagic = 0x51525147;  // arbitrary file signature
  struct Header { uint32_t magic, version, capacity, head, count, dropped, reserved, crc; };
  static_assert(sizeof(Header) == kHeader, "header size");

  static uint32_t crc32(const uint8_t* p, size_t n) {
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) {
      c ^= p[i];
      for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
  }
  static bool valid(const Header& h) {
    return h.magic == kMagic && h.version == 1 && h.crc == crc32(reinterpret_cast<const uint8_t*>(&h), sizeof h - sizeof h.crc);
  }
  bool writeHeader() {
    Header h = {kMagic, 1, cap_, head_, count_, dropped_, 0, 0};
    h.crc = crc32(reinterpret_cast<const uint8_t*>(&h), sizeof h - sizeof h.crc);
    return s_.write(0, &h, sizeof h);
  }

  QueueStorage& s_;
  uint32_t cap_;
  uint32_t head_ = 0, count_ = 0, dropped_ = 0;
};
