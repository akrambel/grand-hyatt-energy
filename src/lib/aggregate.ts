// Aggregations used by dashboards / reports. Pure functions; missing data stays null.
import { eachDay, fiscalMonths } from './dates.ts';
import { round3 } from './calc.ts';
import type { DayTotal, Meter, MeterDay } from './types.ts';

export interface DayPoint { date: string; value: number | null }

export function dailySeries(totals: Map<string, DayTotal>, start: string, end: string): DayPoint[] {
  return eachDay(start, end).map((date) => ({ date, value: totals.get(date)?.total ?? null }));
}

export interface MonthPoint { key: string; label: string; month: number; start: string; end: string; value: number | null; days: number }

export function monthlySeries(totals: Map<string, DayTotal>, fy: number, startMonth: number): MonthPoint[] {
  return fiscalMonths(fy, startMonth).map((m) => {
    let sum = 0, days = 0;
    for (const [d, t] of totals) if (d >= m.start && d <= m.end && t.total !== null) { sum += t.total; days++; }
    return { key: m.key, label: m.label, month: m.month, start: m.start, end: m.end, value: days ? round3(sum) : null, days };
  });
}

export interface AreaPoint { area: string; total: number | null; days: number; meters: number }

export function areaTotals(meters: Meter[], meterDays: Map<string, MeterDay>, utility: string, start: string, end: string): AreaPoint[] {
  const byId = new Map(meters.filter((m) => m.utility === utility && m.active && m.include_in_total).map((m) => [m.id, m]));
  const acc = new Map<string, { sum: number; days: Set<string>; meters: Set<string> }>();
  for (const md of meterDays.values()) {
    const m = byId.get(md.meter_id);
    if (!m || md.date < start || md.date > end || md.consumption === null) continue;
    const a = acc.get(m.area) ?? { sum: 0, days: new Set(), meters: new Set() };
    a.sum += md.consumption; a.days.add(md.date); a.meters.add(m.id);
    acc.set(m.area, a);
  }
  return [...acc.entries()].map(([area, a]) => ({ area, total: round3(a.sum), days: a.days.size, meters: a.meters.size }))
    .sort((x, y) => (y.total ?? 0) - (x.total ?? 0));
}

export interface Coverage { daysInPeriod: number; daysElapsed: number; daysWithData: number; missing: string[] }

/** Data completeness: days in [start, min(end, today)] without any valid consumption total. */
export function coverage(totals: Map<string, DayTotal>, start: string, end: string, today: string): Coverage {
  const last = end < today ? end : today;
  const all = eachDay(start, end);
  const elapsed = start > last ? [] : eachDay(start, last);
  const missing = elapsed.filter((d) => (totals.get(d)?.total ?? null) === null);
  return { daysInPeriod: all.length, daysElapsed: elapsed.length, daysWithData: elapsed.length - missing.length, missing };
}

export function average(points: DayPoint[]): number | null {
  const xs = points.filter((p) => p.value !== null).map((p) => p.value as number);
  return xs.length ? round3(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/** Percentage change from `base` to `value` (fraction); null if either is missing or base is zero. */
export function change(value: number | null, base: number | null): number | null {
  if (value === null || base === null || base === 0) return null;
  return (value - base) / base;
}
