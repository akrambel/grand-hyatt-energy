# Bill of materials – Environmental monitor (one unit)

| # | Item | Qty | Notes |
|---|------|-----|-------|
| 1 | ESP32 DevKit V1 (ESP32-WROOM-32, 30 pins, USB micro/USB-C) | 1 | Any ESP32 board works; pin numbers in `config.h` must then be adjusted. |
| 2 | AHT20 temperature/humidity breakout (I2C, 3.3 V) | 1 | Address 0x38. Modules combined as "AHT20 + BMP280" boards are fine. |
| 3 | BMP280 pressure breakout (I2C, 3.3 V) | 1 | Address 0x76 (SDO to GND) or 0x77. **Check that the chip is really a BMP280** – many cheap boards sold as BMP280 are BME280 (different chip ID, see Troubleshooting). |
| 4 | Dupont jumper wires, female–female, 15–20 cm | 4–8 | For the sensor cable use thin 4-core cable ≤ 1 m for a remote sensor. |
| 5 | USB cable + 5 V / 1 A USB power adapter | 1 | Use a good quality adapter; a weak supply causes Wi-Fi resets. |
| 6 | Enclosure with ventilation slots | 1 | Mount the sensors **outside or away from the ESP32** (see accuracy note). |
| 7 | Optional: 2 × 4.7 kΩ resistors | 2 | Only if your breakouts have no I2C pull-ups and the cable is longer than ~30 cm (SDA→3V3, SCL→3V3). |
| 8 | Optional: mounting plate, cable glands, labels | – | Label the unit with the device ID. |

**Accuracy note.** The ESP32 Wi-Fi radio and regulator warm up the board by several °C. If the sensors sit right next to it, the measured temperature is too high and humidity too low. Put the sensor breakouts on a 10–30 cm cable away from the ESP32 and out of direct sunlight, or ventilate the enclosure. Compare the first readings with a reference thermometer.

Approximate cost: a few USD per unit (prices vary by supplier – no prices are quoted here because they were not verified).
