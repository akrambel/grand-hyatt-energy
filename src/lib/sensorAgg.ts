// Groups per-day sensor statistics into week / month / year buckets (weighted by sample count).
import { parseISO, daysBetween, addDays } from './dates.ts';

export interface DailyStatLike {
  day: string; samples: number;
  aht20_temp_avg: number | null; aht20_temp_min: number | null; aht20_temp_max: number | null;
  humidity_avg: number | null; humidity_min: number | null; humidity_max: number | null;
  bmp280_temp_avg: number | null; bmp280_temp_min: number | null; bmp280_temp_max: number | null;
  pressure_avg: number | null; pressure_min: number | null; pressure_max: number | null;
}

export type Grain = 'day' | 'week' | 'month' | 'year';

/** ISO-8601 week key, e.g. 2026-W41 (weeks start on Monday). */
export function isoWeekKey(iso: string): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow + 3); // Thursday of this week
  const wy = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(wy, 0, 4));
  const week = 1 + Math.round(((dt.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${wy}-W${String(week).padStart(2, '0')}`;
}

export function grainKey(iso: string, grain: Grain): string {
  switch (grain) {
    case 'day': return iso;
    case 'week': return isoWeekKey(iso);
    case 'month': return iso.slice(0, 7);
    case 'year': return iso.slice(0, 4);
  }
}

export interface Agg {
  key: string; days: number; samples: number;
  tempMin: number | null; tempAvg: number | null; tempMax: number | null;
  humMin: number | null; humAvg: number | null; humMax: number | null;
  bmpAvg: number | null;
  pMin: number | null; pAvg: number | null; pMax: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function wavg(parts: Array<[number | null, number]>): number | null {
  let s = 0, w = 0;
  for (const [v, n] of parts) if (v !== null) { s += v * n; w += n; }
  return w ? r2(s / w) : null;
}
const mn = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; };
const mx = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.max(...v) : null; };

/** Combines several devices' rows of the same day first (caller passes all rows; they are merged by bucket). */
export function groupStats(rows: DailyStatLike[], grain: Grain): Agg[] {
  const buckets = new Map<string, DailyStatLike[]>();
  for (const r of rows) { const k = grainKey(r.day, grain); buckets.set(k, [...(buckets.get(k) ?? []), r]); }
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, rs]) => ({
    key, days: new Set(rs.map((r) => r.day)).size, samples: rs.reduce((a, r) => a + r.samples, 0),
    tempMin: mn(rs.map((r) => r.aht20_temp_min)), tempMax: mx(rs.map((r) => r.aht20_temp_max)), tempAvg: wavg(rs.map((r) => [r.aht20_temp_avg, r.samples])),
    humMin: mn(rs.map((r) => r.humidity_min)), humMax: mx(rs.map((r) => r.humidity_max)), humAvg: wavg(rs.map((r) => [r.humidity_avg, r.samples])),
    bmpAvg: wavg(rs.map((r) => [r.bmp280_temp_avg, r.samples])),
    pMin: mn(rs.map((r) => r.pressure_min)), pMax: mx(rs.map((r) => r.pressure_max)), pAvg: wavg(rs.map((r) => [r.pressure_avg, r.samples])),
  }));
}

/** Number of days between two ISO dates, inclusive (used to decide the default grain). */
export function spanDays(from: string, to: string): number { return daysBetween(from, to) + 1; }
export const defaultGrain = (from: string, to: string): Grain => { const n = spanDays(from, to); return n <= 31 ? 'day' : n <= 120 ? 'week' : n <= 800 ? 'month' : 'year'; };
export { addDays };
