// Water is split into sections (potable / hot water / irrigation). All sections belong to the water
// utility, so they are INCLUDED in the water total and use the water tariff; this module only
// breaks the total down so each section can be shown on its own.
import { dailyTotals, sumRange } from './calc.ts';
import { costInRange } from './kpi.ts';
import type { CostResult } from './kpi.ts';
import { CATEGORY_LABEL, METER_CATEGORIES } from './types.ts';
import type { DayTotal, Meter, MeterCategory, MeterDay, Tariff } from './types.ts';

export interface WaterSection {
  category: MeterCategory;
  label: string;
  /** Active meters of this section that are counted in the total. */
  meters: number;
  total: number | null;
  days: number;
  /** Share of the water total in %, null when there is no data. */
  share: number | null;
  cost: CostResult;
  daily: Map<string, DayTotal>;
}

export function waterSections(meters: Meter[], meterDays: Map<string, MeterDay>, tariffs: Tariff[], start: string, end: string): WaterSection[] {
  const sections = METER_CATEGORIES.map((category) => {
    const ms = meters.filter((m) => m.utility === 'water' && (m.category ?? 'standard') === category);
    const daily = dailyTotals(ms, meterDays).water;
    const { total, days } = sumRange(daily, start, end);
    return {
      category, label: CATEGORY_LABEL[category], meters: ms.filter((m) => m.active && m.include_in_total).length,
      total, days, share: null as number | null, cost: costInRange(daily, tariffs, 'water', start, end), daily,
    };
  });
  const sum = sections.reduce((a, s) => a + (s.total ?? 0), 0);
  for (const s of sections) s.share = s.total !== null && sum > 0 ? Math.round((s.total / sum) * 1000) / 10 : null;
  return sections;
}
