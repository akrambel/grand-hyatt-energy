// KPIs, budget-vs-actual and cost calculations. All functions return `null` (shown as
// "N/A") when the underlying data is missing – values are never invented.

import { fiscalMonths, DEFAULT_FISCAL_START_MONTH } from './dates.ts';
import type { BudgetRow, DailyMetric, DayTotal, Tariff, Utility } from './types.ts';
import { round3 } from './calc.ts';
import type { UtilityDayTotals } from './calc.ts';

export interface MetricsSummary {
  roomsSold: number | null; // sum of occupied rooms (room-nights)
  occupancyAvg: number | null; // average of the days that have an occupancy rate
  guests: number | null; // sum of "Hotel Nights / Guests"
  avgTemp: number | null;
  daysWithData: number;
}

const sum = (xs: number[]): number | null => (xs.length ? round3(xs.reduce((a, b) => a + b, 0)) : null);
const avg = (xs: number[]): number | null => (xs.length ? round3(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const present = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Mirrors the "ACTUAL" block of the budget sheet: SUMPRODUCT rooms/guests, AVERAGEIFS occupancy. */
export function summarizeMetrics(metrics: Iterable<DailyMetric>, start: string, end: string): MetricsSummary {
  const rooms: number[] = [], occ: number[] = [], guests: number[] = [], temps: number[] = [];
  let days = 0;
  for (const m of metrics) {
    if (m.metric_date < start || m.metric_date > end) continue;
    let any = false;
    if (present(m.occupied_rooms)) { rooms.push(m.occupied_rooms); any = true; }
    if (present(m.occupancy_rate)) { occ.push(m.occupancy_rate); any = true; }
    if (present(m.guests)) { guests.push(m.guests); any = true; }
    if (present(m.avg_temp_c)) { temps.push(m.avg_temp_c); any = true; }
    if (any) days++;
  }
  return { roomsSold: sum(rooms), occupancyAvg: avg(occ), guests: sum(guests), avgTemp: avg(temps), daysWithData: days };
}

export function ratio(numerator: number | null, denominator: number | null, digits = 3): number | null {
  if (!present(numerator) || !present(denominator) || denominator === 0) return null;
  const f = 10 ** digits;
  return Math.round((numerator / denominator + Number.EPSILON) * f) / f;
}

/**
 * Consumption per guest / per occupied room. Only days that have BOTH a consumption total and the
 * denominator are used, so a missing occupancy entry can never distort the ratio.
 */
export function pairedIntensity(
  totals: Map<string, DayTotal>,
  metrics: Map<string, DailyMetric>,
  field: 'guests' | 'occupied_rooms',
  start: string,
  end: string,
): { value: number | null; days: number; consumption: number | null; denominator: number | null } {
  let c = 0, d = 0, n = 0;
  for (const [date, t] of totals) {
    if (date < start || date > end || t.total === null) continue;
    const den = metrics.get(date)?.[field];
    if (!present(den) || den <= 0) continue;
    c += t.total;
    d += den;
    n++;
  }
  if (n === 0) return { value: null, days: 0, consumption: null, denominator: null };
  return { value: ratio(c, d), days: n, consumption: round3(c), denominator: d };
}

// ------------------------------------------------------- budget vs actual ----

export interface BudgetMonthActual {
  key: string;
  label: string;
  month: number;
  roomsSold: number | null;
  occupancyAvg: number | null;
  guests: number | null;
  gas: number | null;
  electricity: number | null;
  water: number | null;
  /** Workbook "Total": gas (L) + electricity (kWh) + water (m³) – mixed units, kept for parity. */
  total: number | null;
}

export function actualByMonth(
  fy: number,
  totals: UtilityDayTotals,
  metrics: DailyMetric[],
  startMonth = DEFAULT_FISCAL_START_MONTH,
): BudgetMonthActual[] {
  return fiscalMonths(fy, startMonth).map((m) => {
    const s = summarizeMetrics(metrics, m.start, m.end);
    const tot = (u: Utility) => sumInRange(totals[u], m.start, m.end);
    const gas = tot('gas'), electricity = tot('energy'), water = tot('water');
    const parts = [gas, electricity, water].filter(present);
    return {
      key: m.key, label: m.label, month: m.month,
      roomsSold: s.roomsSold, occupancyAvg: s.occupancyAvg, guests: s.guests,
      gas, electricity, water, total: parts.length ? round3(parts.reduce((a, b) => a + b, 0)) : null,
    };
  });
}

function sumInRange(t: Map<string, DayTotal>, start: string, end: string): number | null {
  let s = 0, n = 0;
  for (const [d, v] of t) if (d >= start && d <= end && v.total !== null) { s += v.total; n++; }
  return n ? round3(s) : null;
}

export interface Variance {
  actual: number | null;
  budget: number | null;
  difference: number | null; // actual - budget
  percent: number | null; // (actual - budget) / budget
}

export function variance(actual: number | null, budget: number | null): Variance {
  if (!present(actual) || !present(budget)) return { actual: actual ?? null, budget: budget ?? null, difference: null, percent: null };
  return {
    actual, budget, difference: round3(actual - budget),
    percent: budget === 0 ? null : Math.round(((actual - budget) / budget) * 10000) / 10000,
  };
}

export function budgetFor(rows: BudgetRow[], fy: number, month: number, kind: 'budget' | 'previous'): BudgetRow | null {
  return rows.find((r) => r.fiscal_year === fy && r.month === month && r.kind === kind) ?? null;
}

// ----------------------------------------------------------------- costs -----

/** Latest tariff effective on or before `date`; null when none is configured. */
export function tariffFor(tariffs: Tariff[], utility: Utility, date: string): Tariff | null {
  let best: Tariff | null = null;
  for (const t of tariffs) {
    if (t.utility !== utility || t.effective_from > date) continue;
    if (!best || t.effective_from > best.effective_from) best = t;
  }
  return best;
}

export interface CostResult {
  cost: number | null;
  days: number;
  /** consumption days that had no tariff in effect (cost for those days is unknown) */
  daysWithoutTariff: number;
  currency: string | null;
}

export function costInRange(
  totals: Map<string, DayTotal>, tariffs: Tariff[], utility: Utility, start: string, end: string,
): CostResult {
  let cost = 0, days = 0, missing = 0;
  let currency: string | null = null;
  for (const [date, t] of totals) {
    if (date < start || date > end || t.total === null) continue;
    const tariff = tariffFor(tariffs, utility, date);
    if (!tariff) { missing++; continue; }
    cost += t.total * tariff.price_per_unit;
    currency = tariff.currency;
    days++;
  }
  return { cost: days === 0 ? null : round3(cost), days, daysWithoutTariff: missing, currency };
}

// ------------------------------------------------------- per guest forecast ----

/** Utilities that have a budget (forecast) line in the workbook, and the name of that line. */
export const BUDGET_FIELD = { energy: 'electricity', water: 'water', gas: 'gas' } as const;
export type BudgetedUtility = keyof typeof BUDGET_FIELD;

export interface GuestForecast {
  utility: BudgetedUtility;
  /** Actual consumption per guest night so far this month (days with both a total and a guest count). */
  actual: number | null;
  actualDays: number;
  /** Forecast per guest night: the month's budgeted consumption ÷ budgeted guests (workbook budget block). */
  forecast: number | null;
  /** Same month of the previous year, when the workbook has it. */
  previous: number | null;
  /** (actual − forecast) ÷ forecast. */
  vsForecast: number | null;
  /** Month-end consumption if the average daily consumption so far continues; needs at least 3 days. */
  projected: number | null;
  /** The month's budgeted consumption. */
  budgetTotal: number | null;
}

export function guestForecast(
  utility: BudgetedUtility,
  totals: Map<string, DayTotal>,
  metrics: Map<string, DailyMetric>,
  budgets: BudgetRow[],
  fy: number,
  month: { start: string; end: string; month: number; days: number },
  upTo: string,
): GuestForecast {
  const field = BUDGET_FIELD[utility];
  const end = upTo < month.end ? upTo : month.end;
  const paired = pairedIntensity(totals, metrics, 'guests', month.start, end);
  const b = budgetFor(budgets, fy, month.month, 'budget');
  const p = budgetFor(budgets, fy - 1, month.month, 'previous') ?? budgetFor(budgets, fy, month.month, 'previous');
  const forecast = b ? ratio(b[field], b.guests, 4) : null;
  const previous = p ? ratio(p[field], p.guests, 4) : null;
  let s = 0, n = 0;
  for (const [date, t] of totals) if (date >= month.start && date <= end && t.total !== null) { s += t.total; n++; }
  const projected = n >= 3 ? round3((s / n) * month.days) : null;
  const actual = paired.value === null ? null : ratio(paired.consumption, paired.denominator, 4);
  return {
    utility, actual, actualDays: paired.days, forecast, previous,
    vsForecast: actual !== null && forecast ? Math.round(((actual - forecast) / forecast) * 10000) / 10000 : null,
    projected, budgetTotal: b?.[field] ?? null,
  };
}

// ------------------------------------------------- per occupied room (EnPI) ----

/** Target per occupied room in the display unit (targets are stored per kWh, m³ or L). */
export function enpiTarget(targets: Record<Utility, number | null>, utility: Utility, displayFactor: number): number | null {
  const t = targets[utility];
  return t === null ? null : Math.round(t * displayFactor * 1e6) / 1e6;
}

export interface EnpiMonth {
  key: string; label: string; start: string; end: string;
  /** consumption ÷ occupied room-nights, days with both values only */
  value: number | null;
  consumption: number | null;
  roomNights: number | null;
  days: number;
  /** (value − target) ÷ target */
  vsTarget: number | null;
}

/** Monthly consumption per occupied room (ISO 50001 energy performance indicator) against a target. */
export function enpiByMonth(
  totals: Map<string, DayTotal>, metrics: Map<string, DailyMetric>,
  months: Array<{ key: string; label: string; start: string; end: string }>, target: number | null, upTo: string,
): EnpiMonth[] {
  return months.filter((m) => m.start <= upTo).map((m) => {
    const r = pairedIntensity(totals, metrics, 'occupied_rooms', m.start, m.end < upTo ? m.end : upTo);
    return {
      key: m.key, label: m.label, start: m.start, end: m.end, value: r.value, consumption: r.consumption, roomNights: r.denominator, days: r.days,
      vsTarget: r.value !== null && target ? Math.round(((r.value - target) / target) * 10000) / 10000 : null,
    };
  });
}
