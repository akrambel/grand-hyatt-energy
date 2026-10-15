# Grand Hyatt The Red Sea – Energy, Utilities & Environmental Monitoring Platform

A web dashboard that reproduces the logic of the engineering workbook `Main_Consumption_Opening_Closing.xlsx`
(daily opening/closing meter readings → consumption, monthly/annual reports, budget, LPG tanks) and adds
**shared data entry**, **secure login**, **live temperature / humidity / pressure** from an **ESP32 + AHT20 + BMP280**,
alerts, and **PDF / Excel export**.

```
 Browser (React, GitHub Pages)  ──HTTPS──►  Supabase (Postgres + Auth + Realtime)  ◄──HTTPS──  Edge Function "ingest"  ◄──  ESP32
        static files only                    all data, users, roles (RLS)                      checks device key               AHT20 + BMP280
```

* **GitHub Pages** only hosts the static website. It cannot do secure login or store data – so all of that lives in **Supabase** (free tier is enough to start).
* Passwords are hashed and verified by Supabase Auth on the server. No password or secret is in this repository or in the website code. The only key in the website is Supabase's public *anon* key (safe by design; every table is protected by Row Level Security).

---
## 1. Honest status – what is verified and what is not

| Area | What exists | How it was checked |
|---|---|---|
| Calculation engine (opening/closing, rollover, totals, month sums) | `src/lib/calc.ts`, `kpi.ts`, `aggregate.ts`, `validate.ts` | **Automated tests** (`npm test`): results compared with the workbook's own formulas recalculated in LibreOffice; 57 tests pass |
| Excel import / export logic | `src/lib/workbook.ts` (+ ExcelJS adapter) | Logic tested on fixtures (import plan, export plan round trip). **The ExcelJS file reading/writing and the Admin screens were not run** (no npm in the build sandbox) |
| Database (tables, RLS, functions, import, alerts) | `supabase/migrations/*.sql` | **Tested on a real PostgreSQL 16** (`npm run test:db`, 72 checks: permissions per role, validation, import modes, alert de-duplication, audit). Not yet run on a live Supabase project |
| Edge Functions (`ingest`, `admin-users`) | `supabase/functions/*` | Handler logic unit-tested with fake databases. **Not deployed/run on Supabase** |
| ESP32 firmware | `firmware/esp32_environment_monitor/` | The offline buffer, JSON building, value checks run in PC tests (`firmware/tests/run.sh`) and the JSON is accepted by the server code. **The Arduino sketch has not been compiled or run on a real ESP32** |
| Website (React/TypeScript) | `src/**` | Type-checked against *stub* typings only. **`vite build`, the UI in a browser, charts, PDF/Excel download, login against a real backend were NOT run** because package downloads are blocked where this project was prepared. Expect to fix small issues on first build – see "First run" below |
| GitHub Actions / Pages deployment | `.github/workflows/*` | Written, **not run** |
| Test data | `supabase/optional/test-data.sql` (+ `-remove.sql`) | Load/removal verified on PostgreSQL |

Nothing in this table is claimed as working unless the "How it was checked" column says it was run.

---
## 2. Folder structure
```
├─ src/                    website (React + TypeScript)
│   ├─ lib/                calculation engine, validation, workbook, PDF/Excel, sensor helpers (unit-tested)
│   ├─ store/              data layer (single source for every page), auth, UI, sensors
│   ├─ pages/ components/  screens
├─ supabase/
│   ├─ migrations/         0001 schema · 0002 security (RLS) · 0003 functions · 0004 meters + defaults
│   ├─ functions/          ingest (ESP32 endpoint) · admin-users (create users / reset passwords)
│   └─ optional/           test data, offline-device watchdog (pg_cron)
├─ firmware/               ESP32 sketch + host tests
├─ docs/                   hardware guide (wiring, BOM, troubleshooting) · workbook logic
├─ public/                 Grand Hyatt logo, resort photos, Excel template
├─ scripts/                seed-users.mjs, test fixture generator
├─ tests/                  automated tests (node, PostgreSQL)
└─ .github/workflows/      CI, GitHub Pages deploy, manual Supabase deploy
```

---
## 3. Requirements
* **Node.js 22.12 or newer** (https://nodejs.org) – includes npm
* A free **Supabase** account (https://supabase.com) and a free **GitHub** account
* **Supabase CLI** (https://supabase.com/docs/guides/cli) – or use the web SQL editor (alternative given below)
* For the hardware: Arduino IDE 2.x (see `docs/hardware/README.md`)

---
## 4. Set up the backend (Supabase) – once
1. **Create a project** at supabase.com (choose the available region closest to Saudi Arabia). Save the database password.
2. **Authentication → Providers → Email**: keep *Enable email provider* on, switch **off** "Confirm email" and **off** "Allow new users to sign up" (accounts are created by the administrator only).
3. **Apply the database** – choose one:
   * *CLI (recommended)*
     ```bash
     npm install
     npx supabase login
     npx supabase link --project-ref YOUR-PROJECT-REF
     npx supabase db push
     ```
   * *Web editor*: Supabase → SQL Editor → run `supabase/migrations/0001_schema.sql`, `0002_rls.sql`, `0003_functions.sql`, `0004_seed.sql` **in this order**.
4. **Deploy the Edge Functions**
   ```bash
   npx supabase functions deploy ingest --no-verify-jwt
   npx supabase functions deploy admin-users --no-verify-jwt
   npx supabase secrets set AUTH_EMAIL_DOMAIN=energy.ghrs.app
   npx supabase secrets set ALLOWED_ORIGIN=https://YOUR-GITHUB-USER.github.io
   ```
   (`--no-verify-jwt`: the ESP32 uses its own device key; `admin-users` checks the administrator itself.) `SUPABASE_URL` and the service key are provided to functions automatically – never put them anywhere else.
5. **Collect three values** (Project Settings → API): *Project URL*, *anon public key* (goes into the website), *service_role key* (**secret**, only used in step 6 on your own PC).
6. **Create the user accounts** (on your own computer):
   ```bash
   cp .env.seed.example .env.seed      # then edit .env.seed – it is git-ignored
   npm run seed:users
   ```
   Fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the three `SEED_PASSWORD_…` lines with the passwords you choose (min. 10 characters, 3 of: lower/upper/digit/symbol). Accounts: **Akram** (Administrator), **Abdessamad** and **Arvind** (Users, view/filter/export; data entry only if an administrator enables it).
   > ⚠ The passwords were pasted into a chat / project description when this project was requested. **Change all three after the first login** (My Account → Change password) or choose new ones in `.env.seed`.
7. *(Optional)* Offline-device watchdog every minute: run `supabase/optional/enable-offline-check.sql` (needs the `pg_cron` extension: Database → Extensions).
8. *(Optional)* Try everything with synthetic data: run `supabase/optional/test-data.sql` in the SQL editor (clearly marked TEST DATA). Remove it with `test-data-remove.sql` before real use.

---
## 5. Run the website on your computer
```bash
npm install                  # creates package-lock.json – commit it to Git
cp .env.example .env         # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5173
```
Sign in with a username (e.g. `Akram`) and the password. Then, as administrator, **Administration → Import** and choose your workbook to load the existing data.

### First run – checklist
`npm run verify` runs type check, tests and the production build in one go. If something fails on the first build, it is most likely a small typing/import mismatch – the error message names the file and line.

---
## 6. Publish on GitHub Pages
1. Create a GitHub repository and push this folder (the `.gitignore` already excludes secrets).
2. Repository → **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** (not Secrets – these values are public in any website): add
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and optionally `VITE_AUTH_EMAIL_DOMAIN`, `VITE_PROPERTY_NAME`, `VITE_APP_NAME`, `VITE_LOGO_PATH`, `PAGES_BASE` (use `/` only for a custom domain).
4. Push to `main` → the workflow *Deploy website to GitHub Pages* runs tests, builds and publishes. The address is `https://<user>.github.io/<repository>/`.
5. Refreshing any page works because the app uses hash routing (`#/monthly`). Set `ALLOWED_ORIGIN` (step 4.4 above) to your Pages address.
6. Supabase changes later: Actions → *Deploy Supabase backend (manual)* (needs secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`) or repeat the CLI commands.

Environment variables summary

| Name | Where | Secret? | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` / GitHub **variables** | No (public) | Website → backend |
| `VITE_AUTH_EMAIL_DOMAIN` | same | No | Internal e-mail domain for usernames (default `energy.ghrs.app`) |
| `VITE_PROPERTY_NAME`, `VITE_APP_NAME`, `VITE_LOGO_PATH` | same | No | Branding |
| `VITE_BASE` / `PAGES_BASE` | build | No | Sub-path on GitHub Pages |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.seed` on your PC only | **YES** | Creating users |
| `AUTH_EMAIL_DOMAIN`, `ALLOWED_ORIGIN` | Supabase function secrets | No | Edge Functions |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | GitHub **secrets** | **YES** | Optional manual backend deploy |
| `WIFI_*`, `DEVICE_KEY`, `ROOT_CA` | `firmware/…/secrets.h` | **YES** | ESP32 (git-ignored) |

**Branding.** The Grand Hyatt The Red Sea logo and resort photos are in `public/brand/` (`logo.png` is used in the header, login page and PDF reports; `hero-island.jpg` and `hero-wide.jpg` are the login and overview images). To change them, replace those files and keep the same names. Colours come from the logo (Hyatt red `#a51a2d`) plus lagoon, coral and sand tones from the resort photos, and are defined at the top of `src/styles/app.css`.

---
## 7. Hardware (ESP32 + AHT20 + BMP280)
Everything is in [`docs/hardware/README.md`](docs/hardware/README.md): wiring diagram, bill of materials, Arduino IDE setup, key/certificate handling, behaviour table (Wi-Fi loss, buffering, restarts), first-time test checklist and troubleshooting.
Short version: Administration → Devices → *Register* (copy the key once) → copy `secrets.example.h` to `secrets.h` and fill it → upload → open **Live Environment**.

Why HTTPS instead of MQTT: it needs no extra server, works with the free Supabase tier and passes through most hotel firewalls (port 443). MQTT is not implemented.

---
## 8. Using the application
| Page | Who | What |
|---|---|---|
| Overview | all | KPIs for energy, water, gas, chilled water, cost, per guest / per occupied room, occupancy, temperature, live sensor; charts; PDF/Excel |
| Daily Entry | admins and authorised users | Single meter or whole utility. Opening = previous day's closing (override possible); consumption shown live; checks: dates, numbers, duplicates, drops (rollover/replacement), unusual jumps; saved to the shared database |
| Daily Consumption, Energy, Water, Gas, Chilled Water | all | Tables with search/sort/pagination, filters (period, utility, area, meter) and **Clear filters**; area charts; anomaly highlighting |
| Monthly Reports | all | One page, month selector (October first), all KPIs/tables/charts update |
| Annual Summary, Budget vs Actual, Costs, LPG Tanks, Daily Comparison | all | As in the workbook; costs appear once tariffs exist |
| Climate & Occupancy | all (entry: authorised) | Manual temperature/occupancy, live sensor daily min/avg/max and external weather (Open-Meteo, needs site coordinates) – **kept separate and labelled** |
| Live Environment | all | Latest values, both temperatures, last measurement / last communication, device and sensor status, history by hour/day/week/month/year |
| Alerts | all | Sensor threshold alerts, device offline, missing data, abnormal consumption |
| Administration | admin | Users (enable data entry, reset password), Import, Export, Meters, Tariffs, Settings & thresholds, Devices, Audit/maintenance |

| Guest Rooms (Chilled) | all (entry: authorised, room list: admin) | One BTU meter per room (430 keys): cumulative reading + daily room status (Occupied, Vacant, Out of order, Out of service, House use). Consumption by status, top rooms, vacant rooms using as much as an occupied one. Daily entry by hand or Excel/CSV upload (Room, Reading, Status). Works on up to 93 days at a time |

**Period menu:** every report page offers *MTD – Month to date* and *WTD – Week to date* (week starts Sunday). The search box also understands `mtd`, `wtd`, `mtd energy` …

**Display units (Administration → Settings):** water (including hot and irrigation), gas and chilled water can be shown in m³ or litres. The database keeps each meter's own unit; values, tariffs, budgets and daily entry are converted automatically. Tariffs stay per m³ (water, chilled) and per litre (gas).

**Water sections:** water meters have a *Water section* (Potable / Hot water / Irrigation water, set in Administration → Meters). All sections are **included in the water total** and use the **water tariff**; the Water page and the Overview show them separately. No hot-water or irrigation meters are pre-loaded – add the real meters first.

Missing data is shown as **N/A / "No data available"** and never estimated. Reporting year starts on **1 October**.

---
## 9. Tests
```bash
npm test                       # 73 logic tests (Node 22)
npm run test:db                # needs DATABASE_URL of an EMPTY scratch PostgreSQL (never production)
bash firmware/tests/run.sh     # firmware core on your PC (needs g++)
npm run verify                 # typecheck + tests + production build
```

---
## 10. Security summary
* Login is verified by Supabase Auth (server side, bcrypt hashing). Self-registration is disabled.
* All tables use Row Level Security. Users can read; only authorised users can write readings; only administrators can delete, import, change settings, meters, tariffs, users.
* Devices use a per-device key (only its SHA-256 is stored; shown once; can be rotated). The key can only *send* readings.
* Secrets stay in git-ignored files, GitHub secrets and Supabase function secrets. The website bundle contains only the public URL and anon key.
* Every change to important tables is written to an audit log.
* Back up: Supabase free tier has no automatic backups – export regularly (Administration → Export) or enable paid backups.
* Free-tier note: a free Supabase project is paused after about a week of no activity; the ESP32 uploading keeps it active.

## 11. Known limitations / decisions for you
* Items needing confirmation: LPG main-meter double counting, tank capacity (4 000 vs 5 000 L), chilled-water areas, tariffs – see [`docs/WORKBOOK_LOGIC.md`](docs/WORKBOOK_LOGIC.md).
* The workbook export writes closing readings only (the workbook layout has no opening cells) and keeps all formulas.
* Previous-month comparison on *Monthly Reports* works inside the loaded reporting year (for October it shows nothing).
* Notifications are in-app only (no e-mail/SMS/push).
* The monthly workbook sheets (Oct 2026 … Sep 2027) are not imported – they contain formulas derived from *Daily Consumption*; the app recalculates the same figures.
* Users enter readings per day; there is no mobile-offline mode.
