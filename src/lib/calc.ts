// Consumption engine. Reproduces the workbook's "Daily Consumption" rules:
//
//   * Meters hold CUMULATIVE readings, one per day.
//   * Daily consumption = reading(day) - reading(previous calendar day).
//   * A day only counts when BOTH readings exist (workbook: SUMPRODUCT of non-blank pairs).
//   * Daily utility total = sum over meters; blank ("") when no meter has a valid pair.
//
// Extensions on top of the workbook (documented in README):
//   * Optional explicit `opening` (meter replacement / first day) overrides the previous closing.
//   * Optional per-meter rollover value, applied only when plausible.
//   * Negative differences are flagged and EXCLUDED (the workbook would silently subtract them).
//   * `include_in_total = false` meters are excluded from utility totals.

import { addDays } from './dates.ts';
import type { ConsumptionStatus, DayTotal, Meter, MeterDay, Reading, Utility } from './types.ts';
import { UTILITIES } from './types.ts';

export const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function computeMeterDay(
  reading: Pick<Reading, 'meter_id' | 'reading_date' | 'opening' | 'closing'>,
  prevClosing: number | null,
  meter: Pick<Meter, 'rollover_at'>,
): MeterDay {
  const closing = reading.closing;
  const opening = reading.opening ?? prevClosing;
  const discontinuity =
    reading.opening !== null && prevClosing !== null && reading.opening !== prevClosing;
  const base = { meter_id: reading.meter_id, date: reading.reading_date, opening, closing, discontinuity };

  if (closing === null) return { ...base, consumption: null, status: 'missing_closing' };
  if (opening === null) return { ...base, consumption: null, status: 'missing_opening' };

  if (closing >= opening) return { ...base, consumption: round3(closing - opening), status: 'ok' };

  const roll = meter.rollover_at;
  if (roll !== null && roll > 0 && opening <= roll) {
    const viaRollover = closing + roll - opening;
    if (viaRollover <= roll * 0.5) return { ...base, consumption: round3(viaRollover), status: 'rollover' };
  }
  return { ...base, consumption: null, status: 'negative' };
}

export const meterDayKey = (meterId: string, date: string): string => `${meterId}|${date}`;

/** Computes the MeterDay of every stored reading (keyed by meter|date). */
export function buildMeterDays(meters: Meter[], readings: Reading[]): Map<string, MeterDay> {
  const meterById = new Map(meters.map((m) => [m.id, m]));
  const closingByKey = new Map<string, number | null>();
  for (const r of readings) closingByKey.set(meterDayKey(r.meter_id, r.reading_date), r.closing);

  const out = new Map<string, MeterDay>();
  for (const r of readings) {
    const meter = meterById.get(r.meter_id);
    if (!meter) continue;
    const prev = closingByKey.get(meterDayKey(r.meter_id, addDays(r.reading_date, -1))) ?? null;
    out.set(meterDayKey(r.meter_id, r.reading_date), computeMeterDay(r, prev, meter));
  }
  return out;
}

export type UtilityDayTotals = Record<Utility, Map<string, DayTotal>>;

/** Daily totals per utility (only meters flagged include_in_total and active). */
export function dailyTotals(meters: Meter[], meterDays: Map<string, MeterDay>): UtilityDayTotals {
  const meterById = new Map(meters.map((m) => [m.id, m]));
  const expected: Record<Utility, number> = { energy: 0, water: 0, gas: 0, chilled: 0 };
  for (const m of meters) if (m.active && m.include_in_total) expected[m.utility]++;

  const acc: Record<Utility, Map<string, { sum: number; n: number }>> = {
    energy: new Map(), water: new Map(), gas: new Map(), chilled: new Map(),
  };
  for (const md of meterDays.values()) {
    const meter = meterById.get(md.meter_id);
    if (!meter || !meter.active || !meter.include_in_total) continue;
    if (md.consumption === null) continue;
    const slot = acc[meter.utility].get(md.date) ?? { sum: 0, n: 0 };
    slot.sum += md.consumption;
    slot.n += 1;
    acc[meter.utility].set(md.date, slot);
  }
  const out = {} as UtilityDayTotals;
  for (const u of UTILITIES) {
    const map = new Map<string, DayTotal>();
    for (const [date, s] of acc[u]) {
      map.set(date, { date, total: round3(s.sum), counted: s.n, expected: expected[u] });
    }
    out[u] = map;
  }
  return out;
}

/** Sum of daily totals between two dates (inclusive). `null` when there is no data at all. */
export function sumRange(totals: Map<string, DayTotal>, start: string, end: string): { total: number | null; days: number } {
  let sum = 0;
  let days = 0;
  for (const [date, t] of totals) {
    if (date < start || date > end || t.total === null) continue;
    sum += t.total;
    days++;
  }
  return { total: days === 0 ? null : round3(sum), days };
}

/** Per-meter consumption inside a range (for area/meter breakdowns). */
export function meterTotalsInRange(
  meters: Meter[], meterDays: Map<string, MeterDay>, start: string, end: string,
): Map<string, { total: number | null; days: number }> {
  const out = new Map<string, { total: number | null; days: number }>();
  for (const m of meters) out.set(m.id, { total: null, days: 0 });
  for (const md of meterDays.values()) {
    if (md.date < start || md.date > end || md.consumption === null) continue;
    const slot = out.get(md.meter_id);
    if (!slot) continue;
    slot.total = round3((slot.total ?? 0) + md.consumption);
    slot.days++;
  }
  return out;
}
