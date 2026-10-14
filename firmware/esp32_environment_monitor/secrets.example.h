// Copy this file to "secrets.h" and fill in your values. secrets.h is git-ignored – NEVER commit it.
#pragma once

// ---- Wi-Fi (2.4 GHz only; the ESP32 does not support 5 GHz) ----
#define WIFI_SSID_1      "YOUR-WIFI-NAME"
#define WIFI_PASSWORD_1  "YOUR-WIFI-PASSWORD"
// Optional backup network (leave both empty strings if unused)
#define WIFI_SSID_2      ""
#define WIFI_PASSWORD_2  ""

// ---- Backend ----
// Host of your Supabase project (no https://, no path): abcdefghijkl.supabase.co
#define API_HOST     "YOUR-PROJECT-REF.supabase.co"
#define API_PATH     "/functions/v1/ingest"

// Device ID and API key come from the dashboard: Administration -> Devices -> Register.
// The key is shown only once. It looks like: ghrs_0123456789abcdef...
#define DEVICE_ID    "esp32-01"
#define DEVICE_KEY   "ghrs_PASTE-THE-KEY-HERE"

// ---- TLS root certificate (PEM) of the server ----
// Paste the ROOT certificate that signs your Supabase endpoint (see docs/hardware/README.md,
// section "Getting the root certificate"). Keep the BEGIN/END lines.
static const char ROOT_CA[] PROGMEM = R"EOF_CERT(
-----BEGIN CERTIFICATE-----
PASTE-THE-ROOT-CERTIFICATE-HERE
-----END CERTIFICATE-----
)EOF_CERT";
