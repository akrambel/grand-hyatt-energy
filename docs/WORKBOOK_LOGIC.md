# How the workbook logic is reproduced

Source: `Main_Consumption_Opening_Closing.xlsx` (copy in `public/templates/`, used as export template).

## Sheets → website pages
| Workbook sheet | Website |
|---|---|
| Menu | Sidebar navigation |
| Daily Consumption | **Daily Entry** (input) and **Daily Consumption** (table) |
| Daily Comparison | **Daily Comparison** |
| Utility Budget & Actual | **Budget vs Actual** |
| Monthly Summary | **Annual Summary** |
| LPG Dashboard | **LPG Tanks** |
| Oct 2026 … Sep 2027 (12 sheets) | **Monthly Reports** – one page with a month selector (reporting year starts 1 October) |
| (no sheet – derived) | Energy / Water / Gas / Chilled Water pages, Costs, Climate & Occupancy, Live Environment, Alerts, Administration |

## Rules taken from the formulas
1. Meters hold **cumulative readings**, one per day.
2. **Daily consumption of a meter = reading(day) − reading(previous calendar day)** (opening = previous closing; the first day of the year has no opening, so no consumption unless an opening is entered).
3. A day counts **only if both readings exist** (workbook: `SUMPRODUCT(--(x<>""),--(y<>""),y-x)`). Missing readings are never treated as zero.
4. **Daily utility total = sum over meters** of the valid differences; blank when no meter has a valid pair (`IF(COUNT(...)=0,"",...)`). Partial sums are kept, as in the workbook, and the UI shows "meters counted n / N".
5. Units: energy kWh, water m³, gas L, chilled water m³.
6. Climate inputs per day: average temperature, occupancy rate (0–1), occupied rooms, hotel nights/guests.
7. Budget sheet **ACTUAL** block: rooms sold = sum of occupied rooms, occupancy = average of daily rates (days with data), guests = sum, gas/electricity/water = month totals. "Total" mixes units (L + kWh + m³) in the workbook; the app keeps the same column only for parity and does not use it for analysis.
8. LPG status limits: ≤ 15 % critical, ≤ 30 % low, ≤ 60 % normal, above = high.

## Extensions added by the application (documented, not in the workbook)
- Optional explicit **opening reading** (meter replacement/reset). Stored separately; a warning asks for confirmation when it differs from the previous closing.
- Optional per-meter **rollover value**. Applied only if the opening is ≤ the rollover value and the rolled-over consumption is ≤ 50 % of the rollover range; otherwise the negative difference is flagged.
- **Negative differences are flagged and excluded** (the workbook would silently subtract them).
- Per-meter flag **"Counted in total"** (default: yes, as in the workbook).
- **Costs** need tariffs (the workbook has none). Cost = daily consumption × tariff valid that day.
- Anomaly detection (median/MAD robust z-score on the previous 28 days, needs ≥ 14 valid days).

## Items to confirm with the engineering team
1. **LPG main meter.** The Gas section has a main meter plus sub-meters; the workbook adds all nine, which probably counts the same gas twice. The app copies this (flag *Counted in total* = yes). If the main meter is a check meter, switch it off in Administration → Meters.
2. **LPG tank capacity.** The workbook uses different capacities in different formulas (4 000 L and 5 000 L). The app uses 4 000 L per tank until you set the real values (Administration → Settings).
3. **Chilled-water areas.** The sheet has no area column for the 55 BTU meters; areas were derived from the meter code (`BTU-60-…` → *Zone 60*). Edit in Administration → Meters if needed.
4. **Tariffs** for all four utilities.
5. **Number of rooms** is not used anywhere (occupied rooms come from your daily input).
