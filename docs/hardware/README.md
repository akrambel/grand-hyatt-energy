# Hardware guide – ESP32 + BMP280 + AHT20

> **Status.** The firmware logic that can run on a PC (offline buffer, JSON payload, value checks) is unit-tested, and the JSON it produces is accepted by the server code. The Arduino sketch itself has **not been compiled or run on a real ESP32** by the author of this project. Use the *First-time test checklist* below.

## 1. What you need
See [BILL_OF_MATERIALS.md](BILL_OF_MATERIALS.md). Wiring: [wiring-diagram.svg](wiring-diagram.svg).

| ESP32 pin | AHT20 | BMP280 |
|-----------|-------|--------|
| 3V3 | VIN | VCC |
| GND | GND | GND (and SDO → GND for address 0x76) |
| GPIO 21 | SDA | SDA |
| GPIO 22 | SCL | SCL |

Always use **3.3 V**. Power the ESP32 from USB.

## 2. Backend first
The dashboard must be running with the Supabase backend (see main README, sections 3–5) before the device can send data.

1. Sign in as administrator → **Administration → Devices**.
2. Enter a device ID (for example `esp32-01`), a name and a location → **Register & generate API key**.
3. Copy the key **now** (it is shown once). If lost: *New key*.

## 3. Arduino IDE setup
1. Install **Arduino IDE 2.x**.
2. *File → Preferences → Additional boards manager URLs*: add
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. *Tools → Board → Boards Manager* → install **esp32 by Espressif Systems** (2.0.x or 3.x).
4. *Tools → Manage Libraries* → install **Adafruit BMP280 Library** and **Adafruit AHTX0** (accept the dependencies Adafruit BusIO and Adafruit Unified Sensor).
5. Open `firmware/esp32_environment_monitor/esp32_environment_monitor.ino` (all files in that folder must stay together).
6. Select *Tools → Board → ESP32 Arduino → ESP32 Dev Module*, *Partition Scheme → Default 4MB with spiffs* (LittleFS uses the same partition).

## 4. Configure secrets
1. In the sketch folder copy `secrets.example.h` to **`secrets.h`** (it is git-ignored; never commit it).
2. Fill in: `WIFI_SSID_1`, `WIFI_PASSWORD_1` (2.4 GHz network), optional second network, `API_HOST` (`<project-ref>.supabase.co`), `DEVICE_ID`, `DEVICE_KEY`.
3. Paste the root certificate into `ROOT_CA` (next section).

Other settings (interval, pins, buffer size, timeouts) are in `config.h`.

### Getting the root certificate
The device verifies the server's TLS certificate, so it needs the **root** certificate that signs your Supabase endpoint. Do not use the leaf (server) certificate – it changes every few months.

```bash
openssl s_client -showcerts -servername <ref>.supabase.co -connect <ref>.supabase.co:443 </dev/null 2>/dev/null
```
The output lists the chain. Copy the **last** certificate block (`-----BEGIN CERTIFICATE----- … END`). If its *issuer* differs from its *subject*, it is an intermediate: download the root with that issuer name from your browser's certificate viewer (open the site → certificate → certification path) or from the Mozilla CA list (`https://curl.se/ca/cacert.pem`) and paste that root instead. Verify with:
```bash
openssl x509 -in root.pem -noout -subject -issuer   # subject and issuer must be identical for a root
```
Root certificates are valid for many years, but keep a note of the expiry date. For quick bench tests only, `ALLOW_INSECURE_TLS 1` in `config.h` skips verification – **never use it in production**.

## 5. Upload
1. Connect the ESP32 by USB; select the port in *Tools → Port*.
2. Click **Upload**. If the upload hangs at "Connecting…", hold the **BOOT** button until it starts.
3. Open *Tools → Serial Monitor* at **115200 baud**.

Expected output (example):
```
=== Environment monitor 1.0.0 (device esp32-01) ===
[queue] ready, 0 reading(s) waiting
[sensors] AHT20 OK, BMP280 OK
[wifi] connected, IP 10.x.x.x, RSSI -58 dBm
[time] synchronised: 1760000000
[meas] ts=1760000000 AHT20 ok 27.41C 50.2%  BMP280 ok 27.00C 1008.3hPa
```
The **Live Environment** page should show the values within a minute.

## 6. How the firmware behaves
| Situation | Behaviour |
|-----------|-----------|
| Clock not synchronised (no NTP) | No measurement is taken – wrong timestamps are never sent. |
| Wi-Fi lost | Measurements continue; readings are stored in a flash ring buffer (5 000 readings ≈ 3.5 days at one per minute). Wi-Fi reconnects every 30 s (alternating between two networks if configured). |
| Server/Internet down, wrong key, HTTP 5xx | Readings are buffered; retries use exponential back-off (15 s … 10 min). |
| Connection back | Backlog is sent oldest-first in batches of 20; the server ignores duplicates (unique device + timestamp). |
| Buffer full | The oldest readings are overwritten (counted and printed). |
| Sensor fault / implausible value | The reading is sent with `ok:false` for that sensor and no value; the dashboard shows the fault and shows N/A – never a fake number. A missing sensor can come back without a reboot. |
| Wi-Fi down > 30 min, sensors dead > 30 rounds, firmware hang (watchdog 90 s) | The ESP32 restarts itself. |
| Restart / power cut | Buffered data survives (flash). A reading in progress at the moment of the power cut may be lost. |
| Clock drift | The server replies with its time; a difference > 120 s triggers a new NTP sync. |
| Payload rejected as invalid (HTTP 400) | That batch is discarded so it cannot block newer data. |

Timestamps are UTC (Unix seconds). The website converts them to the property time zone (Asia/Riyadh).

## 7. First-time test checklist (please do these once)
- [ ] The sketch compiles without errors in the Arduino IDE.
- [ ] Serial monitor shows both sensors **OK** and plausible values.
- [ ] Temperature agrees (±1 °C) with a reference thermometer after 30 minutes (sensors away from the ESP32).
- [ ] The **Live Environment** page shows the values and the device **Online**.
- [ ] Unplug the router/Wi-Fi for 10 minutes → serial shows `[queue] buffered`; reconnect → `[upload] delivered … buffered reading(s)`; the chart shows no gap.
- [ ] Power-cycle the ESP32 with data buffered → buffered readings are still delivered.
- [ ] Remove the AHT20 wire → dashboard shows *AHT20 Fault* and N/A for temperature/humidity; reconnect → recovers.
- [ ] Set a temperature threshold just below the current value (Administration → Settings) → one alert appears, not one per minute.
- [ ] Wrong `DEVICE_KEY` → serial shows HTTP 401, dashboard device status stays *offline*.

## 8. Troubleshooting
| Symptom | Likely cause / fix |
|---------|-------------------|
| `[sensors] AHT20 NOT FOUND` | Wiring (SDA/SCL swapped, loose wire), no 3.3 V. Run an I2C scanner sketch: AHT20 must appear at **0x38**. |
| `BMP280 NOT FOUND`, scanner shows **0x76/0x77** | The chip may be a **BME280** (chip ID 0x60). Replace the library call with `Adafruit_BME280` (the pressure/temperature code is identical) or buy a genuine BMP280. |
| Scanner shows nothing | Check 3.3 V/GND, try shorter wires, add 4.7 kΩ pull-ups on SDA and SCL. |
| `Failed to connect` while uploading | Hold BOOT while "Connecting…" appears; use a data USB cable (not charge-only). |
| Wi-Fi never connects | The ESP32 only supports **2.4 GHz**. Check SSID/password (case-sensitive), hidden SSIDs, MAC filtering. |
| `[time] NTP not available` | Network blocks UDP 123. Ask IT to allow NTP, or change `NTP_SERVER_*` to an internal NTP server. |
| `HTTP -1`/`-11` (connection refused/timeout) | No internet, firewall blocks HTTPS (443) to `*.supabase.co`, or wrong `API_HOST`. |
| TLS/handshake error (`-1` right after connect, "certificate verify failed") | Wrong or expired `ROOT_CA`, or the system clock is wrong. Redo section 4 – "Getting the root certificate". |
| `HTTP 401 Invalid device credentials` | Wrong `DEVICE_ID`/`DEVICE_KEY`. Generate a new key in the dashboard (the old one stops working). |
| `HTTP 403 Device is disabled` | Device switched off in Administration → Devices. |
| `HTTP 404` | Edge Function `ingest` is not deployed, or `API_PATH` is wrong. |
| Temperature reads high | Sensor too close to the ESP32/sun, or enclosure without ventilation (see BOM accuracy note). |
| Dashboard shows *Offline* although the unit is running | Check the Serial Monitor; the status changes to offline after the "offline after X minutes" value in Administration → Settings. |
| Frequent resets | Weak USB power supply; use ≥ 1 A and a short cable. |

## 9. Security notes
- `secrets.h` contains the Wi-Fi password and the device key – keep it out of Git, screenshots and chat messages.
- One key per device. If a unit is lost or stolen: *Administration → Devices → New key* (the old key stops working immediately) or switch the device off.
- The device can only *send* readings; the key gives no read access to any data.
