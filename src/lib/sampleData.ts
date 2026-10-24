// Sample data preview. Fills the dashboard with made-up but realistic figures (readings of every meter,
// occupancy, guests, temperature, budgets, guest-room meters) so you can see how the pages look with a
// full year of data. Everything is generated in this browser only: nothing is written to the database,
// other users keep seeing the real data, and turning the preview off brings the real data back at once.
import { addDays, eachDay, parseISO } from './dates.ts';
import type { BudgetRow, DailyMetric, Meter, Reading, Utility } from './types.ts';
import type { RoomReading } from './rooms.ts';

const KEY = 'ghrs-sample-v1';
/** Counters start here so a date always gets the same reading, whatever period is loaded. */
const EPOCH = '2024-09-30';

export function isSampleMode(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}
export function setSampleMode(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, 'on'); else localStorage.removeItem(KEY); } catch { /* private window: lasts for this visit */ }
}

/** Repeatable pseudo-random number in [0, 1) for a text key (same key, same number). */
export function rnd(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Red Sea resort profile, by calendar month (Jan … Dec): high season in winter, hot summers.
const OCCUPANCY = [0.80, 0.78, 0.75, 0.70, 0.62, 0.55, 0.58, 0.60, 0.63, 0.68, 0.74, 0.82];
const TEMP_C = [23.5, 24, 26, 29, 32, 34, 35.5, 35.5, 33.5, 31, 28, 25];

const dow = (iso: string): number => { const { y, m, d } = parseISO(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function sampleMetric(date: string, roomCount: number): DailyMetric {
  const m = parseISO(date).m - 1;
  const weekend = dow(date) === 4 || dow(date) === 5 ? 0.06 : 0; // Thursday and Friday nights
  const occ = Math.min(0.98, Math.max(0.3, OCCUPANCY[m] + weekend + (rnd(`occ|${date}`) - 0.5) * 0.08));
  const rooms = Math.round(occ * roomCount);
  return {
    metric_date: date,
    avg_temp_c: Math.round((TEMP_C[m] + (rnd(`t|${date}`) - 0.5) * 2.4) * 10) / 10,
    occupancy_rate: r4(rooms / roomCount),
    occupied_rooms: rooms,
    guests: Math.round(rooms * (1.7 + rnd(`g|${date}`) * 0.35)),
  };
}

/** Consumption relative to an average day: hot days need more cooling, full days more water and cooking. */
function seasonFactor(u: Utility, metric: DailyMetric): number {
  const heat = Math.min(1, Math.max(0, ((metric.avg_temp_c ?? 29) - 23) / 12.5));
  const occ = metric.occupancy_rate ?? 0.7;
  switch (u) {
    case 'energy': return ((0.7 + 0.3 * heat) * (0.8 + 0.3 * occ)) / ((0.7 + 0.15) * (0.8 + 0.21));
    case 'chilled': return (0.45 + 1.1 * heat) / (0.45 + 0.55);
    case 'water': return (0.55 + 0.65 * occ) / (0.55 + 0.455);
    default: return (0.5 + 0.7 * occ) / (0.5 + 0.49);
  }
}

/** One meter's consumption on one day (display unit). Rarely a high day, so alerts and anomalies show too. */
export function sampleUse(meter: Meter, base: number, metric: DailyMetric): number {
  const k = `${meter.id}|${metric.metric_date}`;
  const spike = rnd(`s|${k}`) < 0.006 ? 1.7 : 1;
  return base * seasonFactor(meter.utility, metric) * (0.92 + 0.16 * rnd(k)) * spike;
}

/** Cumulative readings from the day before `start` (opening of the first day) to `end`. */
export function sampleReadings(meters: Meter[], baseOf: (m: Meter) => number, start: string, end: string, metricOf: (d: string) => DailyMetric): Reading[] {
  const out: Reading[] = [];
  const from = addDays(start, -1);
  if (end < from) return out;
  const days = eachDay(EPOCH, end);
  const metrics = days.map(metricOf);
  for (const m of meters) {
    if (!m.active) continue;
    const base = baseOf(m);
    let c = Math.round((500 + rnd(`c0|${m.id}`) * 20000) * (base > 0 ? Math.max(1, base / 50) : 1));
    for (let i = 0; i < days.length; i++) {
      if (i > 0) c += sampleUse(m, base, metrics[i]);
      if (days[i] >= from) out.push({ meter_id: m.id, reading_date: days[i], opening: null, closing: Math.round(c * 1000) / 1000, note: null, source: 'sample', entered_by: null });
    }
  }
  return out;
}

/** Budget and previous-period rows of a reporting year, close to what the sample consumption gives. */
export function sampleBudgets(fy: number, months: Array<{ month: number; start: string; end: string }>, meters: Meter[], baseOf: (m: Meter) => number, metricOf: (d: string) => DailyMetric): BudgetRow[] {
  const counted = meters.filter((m) => m.active && m.include_in_total);
  const rows: BudgetRow[] = [];
  for (const mo of months) {
    const days = eachDay(mo.start, mo.end).map(metricOf);
    const sum: Record<Utility, number> = { energy: 0, water: 0, gas: 0, chilled: 0 };
    for (const d of days) for (const m of counted) sum[m.utility] += sampleUse(m, baseOf(m), d);
    const rooms = days.reduce((a, d) => a + (d.occupied_rooms ?? 0), 0);
    const guests = days.reduce((a, d) => a + (d.guests ?? 0), 0);
    const occ = days.reduce((a, d) => a + (d.occupancy_rate ?? 0), 0) / days.length;
    for (const kind of ['budget', 'previous'] as const) {
      const f = (what: string) => (kind === 'budget' ? 0.95 + rnd(`b|${what}|${fy}|${mo.month}`) * 0.1 : 0.9 + rnd(`p|${what}|${fy}|${mo.month}`) * 0.15);
      rows.push({
        fiscal_year: fy, month: mo.month, kind,
        rooms_sold: Math.round(rooms * f('r')), occupancy_rate: r4(Math.min(1, occ * f('o'))), guests: Math.round(guests * f('g')),
        electricity: Math.round(sum.energy * f('e')), water: Math.round(sum.water * f('w') * 1000) / 1000, gas: Math.round(sum.gas * f('gas') * 1000) / 1000,
      });
    }
  }
  return rows;
}

/** Guest-room meter readings with occupied / vacant status (native unit of the room meters, × factor). */
export function sampleRoomReadings(rooms: string[], start: string, end: string, factor: number, metricOf: (d: string) => DailyMetric): RoomReading[] {
  const out: RoomReading[] = [];
  const from = addDays(start, -1);
  if (end < from) return out;
  const days = eachDay(EPOCH, end);
  const occ = days.map((d) => metricOf(d).occupancy_rate ?? 0.7);
  for (const room of rooms) {
    let c = 100 + rnd(`rc|${room}`) * 400;
    for (let i = 0; i < days.length; i++) {
      const k = `${room}|${days[i]}`;
      const ooo = rnd(`o|${k}`) < 0.01;
      const occupied = !ooo && rnd(`r|${k}`) < occ[i];
      if (i > 0) c += occupied ? 1.6 + rnd(`u|${k}`) * 0.8 : 0.4 + rnd(`u|${k}`) * 0.4;
      if (days[i] >= from) out.push({ room, date: days[i], opening: null, closing: Math.round(c * factor * 1000) / 1000, status: ooo ? 'out_of_order' : occupied ? 'occupied' : 'vacant', note: null });
    }
  }
  return out;
}

/** Message shown when someone tries to save while the preview is on. */
export const SAMPLE_BLOCKED = 'Sample data is shown. Turn it off in Administration › Sample data before entering real data.';
