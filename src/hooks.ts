import { useMemo } from 'react';
import { useData } from './store/data.ts';
import { sumRange } from './lib/calc.ts';
import { costInRange, pairedIntensity, summarizeMetrics } from './lib/kpi.ts';
import type { CostResult } from './lib/kpi.ts';
import { coverage } from './lib/aggregate.ts';
import { localToday } from './lib/dates.ts';
import { UTILITIES } from './lib/types.ts';
import type { Utility } from './lib/types.ts';

export interface UtilityStats {
  total: number | null;
  days: number;
  avgDaily: number | null;
  perGuest: number | null;
  perRoom: number | null;
  intensityDays: { guest: number; room: number };
  cost: CostResult;
  coverage: ReturnType<typeof coverage>;
}

/** All headline numbers for a period – every page uses this so figures always agree. */
export function usePeriodStats(start: string, end: string) {
  const totals = useData((s) => s.totals);
  const metricsMap = useData((s) => s.metricsMap);
  const metrics = useData((s) => s.metrics);
  const tariffs = useData((s) => s.tariffs);
  const tz = useData((s) => s.settings.timezone);
  return useMemo(() => {
    const today = localToday(tz);
    const byUtility = {} as Record<Utility, UtilityStats>;
    for (const u of UTILITIES) {
      const { total, days } = sumRange(totals[u], start, end);
      const g = pairedIntensity(totals[u], metricsMap, 'guests', start, end);
      const r = pairedIntensity(totals[u], metricsMap, 'occupied_rooms', start, end);
      byUtility[u] = {
        total, days, avgDaily: total !== null && days ? Math.round((total / days) * 1000) / 1000 : null,
        perGuest: g.value, perRoom: r.value, intensityDays: { guest: g.days, room: r.days },
        cost: costInRange(totals[u], tariffs, u, start, end), coverage: coverage(totals[u], start, end, today),
      };
    }
    return { byUtility, metrics: summarizeMetrics(metrics, start, end), today };
  }, [totals, metricsMap, metrics, tariffs, tz, start, end]);
}

export function useTotalCost(stats: Record<Utility, UtilityStats>): { total: number | null; currency: string | null; incomplete: boolean } {
  let sum = 0, any = false, incomplete = false;
  let currency: string | null = null;
  for (const u of UTILITIES) {
    const c = stats[u].cost;
    if (c.cost !== null) { sum += c.cost; any = true; currency = c.currency; }
    if (c.daysWithoutTariff > 0 || (stats[u].days > 0 && c.cost === null)) incomplete = true;
  }
  return { total: any ? Math.round(sum * 100) / 100 : null, currency, incomplete };
}
