// Monthly PDF report, built without opening a page: used to save each finished month's report in the
// website (first administrator visit of a new month) and for "Create now" on Monthly Reports.
import { buildPdf } from './pdf.ts';
import type { PdfReport } from './pdf.ts';
import { sumRange } from './calc.ts';
import { budgetFor, costInRange, enpiTarget, pairedIntensity, summarizeMetrics } from './kpi.ts';
import { addDays, eachDay, fiscalMonths, fiscalYearOf, formatDate } from './dates.ts';
import { UTILITIES, UTILITY_INFO } from './types.ts';
import type { Utility } from './types.ts';
import { BASE_UNITS, unitFactor } from './units.ts';
import { fmtMoney, fmtNumber, fmtPercent, NA } from './format.ts';
import { loadRangeData, useData } from '../store/data.ts';
import { ENV } from '../config/env.ts';

export interface ReportMonth { key: string; label: string; start: string; end: string; month: number; fy: number }

/** The calendar month containing `iso`, as a fiscal month. */
export function monthOf(iso: string, fiscalStartMonth: number): ReportMonth {
  const fy = fiscalYearOf(iso, fiscalStartMonth);
  const m = fiscalMonths(fy, fiscalStartMonth).find((x) => iso >= x.start && iso <= x.end)!;
  return { key: m.key, label: m.label, start: m.start, end: m.end, month: m.month, fy };
}

/** The month before the one containing `iso`. */
export const previousMonth = (iso: string, fiscalStartMonth: number): ReportMonth => monthOf(addDays(monthOf(iso, fiscalStartMonth).start, -1), fiscalStartMonth);

export async function buildMonthlyPdf(month: ReportMonth, upTo: string, user: string): Promise<Blob> {
  const st = useData.getState();
  const end = month.end < upTo ? month.end : upTo;
  const { totals, metricsMap, metrics } = await loadRangeData(month.start, month.end);
  const unit = (u: Utility) => UTILITY_INFO[u].unit;
  const factor = (u: Utility) => (u === 'energy' ? 1 : unitFactor(BASE_UNITS[u], st.settings.units[u]));
  const bud = budgetFor(st.budgets, month.fy, month.month, 'budget');
  const budgetOf: Record<Utility, number | null> = { energy: bud?.electricity ?? null, water: bud?.water ?? null, gas: bud?.gas ?? null, chilled: null };

  const rows = UTILITIES.map((u) => {
    const { total, days } = sumRange(totals[u], month.start, end);
    const g = pairedIntensity(totals[u], metricsMap, 'guests', month.start, end);
    const r = pairedIntensity(totals[u], metricsMap, 'occupied_rooms', month.start, end);
    const cost = costInRange(totals[u], st.tariffs, u, month.start, end);
    const target = enpiTarget(st.settings.enpiTargets, u, factor(u));
    return { u, total, days, perGuest: g.value, perRoom: r.value, target, cost, budget: budgetOf[u] };
  });
  const m = summarizeMetrics(metrics, month.start, end);
  const costParts = rows.map((r) => r.cost.cost).filter((c): c is number => c !== null);
  const currency = rows.find((r) => r.cost.currency)?.cost.currency ?? 'SAR';
  const dayCount = eachDay(month.start, end).length;
  const daily = eachDay(month.start, end).map((d) => {
    const mm = metricsMap.get(d);
    return [d, ...UTILITIES.map((u) => totals[u].get(d)?.total ?? null), mm?.occupied_rooms ?? null, mm?.guests ?? null, mm?.occupancy_rate == null ? null : Math.round(mm.occupancy_rate * 1000) / 10];
  });

  const report: PdfReport = {
    title: `Monthly Report – ${month.label}`,
    period: `${formatDate(month.start)} – ${formatDate(end)}${end < month.end ? ' (month to date)' : ''}`,
    landscape: true,
    kpis: [
      ...rows.map((r) => ({ label: `${UTILITY_INFO[r.u].label} (${unit(r.u)})`, value: r.total === null ? NA : fmtNumber(r.total, 2) })),
      { label: 'Total cost', value: costParts.length ? fmtMoney(costParts.reduce((a, b) => a + b, 0), currency) : NA },
      { label: 'Energy per occupied room', value: rows[0].perRoom === null ? NA : `${fmtNumber(rows[0].perRoom, 2)} kWh${rows[0].target !== null ? ` (target ${fmtNumber(rows[0].target, 2)})` : ''}` },
      { label: 'Average occupancy', value: fmtPercent(m.occupancyAvg) },
      { label: 'Occupied room-nights', value: m.roomsSold === null ? NA : fmtNumber(m.roomsSold) },
    ],
    tables: [
      { title: 'Month summary', headers: ['Utility', 'Total', 'Unit', 'Days with data', 'Per guest', 'Per occupied room', 'Target / POR', 'Budget', 'Cost'],
        rows: rows.map((r) => [UTILITY_INFO[r.u].label, r.total, unit(r.u), `${r.days}/${dayCount}`, r.perGuest, r.perRoom, r.target, r.budget, r.cost.cost === null ? null : fmtNumber(r.cost.cost, 2)]),
        numericCols: [1, 4, 5, 6, 7, 8] },
      { title: 'Daily values', headers: ['Date', ...UTILITIES.map((u) => `${UTILITY_INFO[u].short ?? UTILITY_INFO[u].label} ${unit(u)}`), 'Occupied rooms', 'Guests', 'Occupancy %'],
        rows: daily, numericCols: [1, 2, 3, 4, 5, 6, 7] },
    ],
    notes: [
      'Values are calculated from saved meter readings only. Missing readings are shown as N/A and are never estimated.',
      'Per occupied room (EnPI) = consumption ÷ occupied room-nights, using days that have both values. Cost = daily consumption × tariff in force that day.',
    ],
    user, property: ENV.propertyName, timezone: st.settings.timezone,
    filename: `monthly-report-${month.key}.pdf`, noDownload: true,
  };
  return buildPdf(report);
}
