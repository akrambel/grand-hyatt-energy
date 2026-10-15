// Shared domain types. This file (like the rest of src/lib) only uses erasable
// TypeScript syntax so the unit tests can run directly with `node --test`.

export type Utility = 'energy' | 'water' | 'gas' | 'chilled';

export const UTILITIES: readonly Utility[] = ['energy', 'water', 'gas', 'chilled'];

export interface UtilityInfo {
  key: Utility;
  label: string;
  /** Unit used by the workbook for the daily consumption row. */
  unit: string;
  /** Short label used in sidebars / tabs. */
  short: string;
  /** Name of the matching row in the "Utility Budget & Actual" sheet. */
  budgetLabel: string;
}

export const UTILITY_INFO: Record<Utility, UtilityInfo> = {
  energy: { key: 'energy', label: 'Energy', short: 'Energy', unit: 'kWh', budgetLabel: 'Electricity' },
  water: { key: 'water', label: 'Water', short: 'Water', unit: 'm³', budgetLabel: 'Water' },
  gas: { key: 'gas', label: 'Gas / LPG', short: 'Gas', unit: 'L', budgetLabel: 'Gas' },
  chilled: { key: 'chilled', label: 'Chilled Water', short: 'Chilled', unit: 'm³', budgetLabel: 'Chilled Water' },
};

export type MeterCategory = 'standard' | 'hot_water' | 'irrigation';

export const METER_CATEGORIES: readonly MeterCategory[] = ['standard', 'hot_water', 'irrigation'];

export const CATEGORY_LABEL: Record<MeterCategory, string> = { standard: 'Potable / standard', hot_water: 'Hot water', irrigation: 'Irrigation water' };

export interface Meter {
  id: string;
  code: string;
  utility: Utility;
  area: string;
  name: string;
  unit: string;
  sort_order: number;
  include_in_total: boolean;
  rollover_at: number | null;
  active: boolean;
  /** Section of the utility the meter belongs to (water: potable, hot water, irrigation). Default 'standard'. */
  category?: MeterCategory;
  /** Unit stored in the database; `unit` is the display unit chosen in Settings. */
  nativeUnit?: string;
  /** displayValue = storedValue × unitFactor (1 when no conversion). */
  unitFactor?: number;
}

export interface Reading {
  id?: string;
  meter_id: string;
  reading_date: string; // YYYY-MM-DD (property local calendar)
  opening: number | null;
  closing: number | null;
  note?: string | null;
  source?: string;
  entered_by?: string | null;
  updated_at?: string;
}

export interface DailyMetric {
  metric_date: string;
  avg_temp_c: number | null;
  occupancy_rate: number | null; // 0..1
  occupied_rooms: number | null;
  guests: number | null;
}

export type ConsumptionStatus = 'ok' | 'rollover' | 'negative' | 'missing_closing' | 'missing_opening';

export interface MeterDay {
  meter_id: string;
  date: string;
  opening: number | null; // effective opening
  closing: number | null;
  consumption: number | null;
  status: ConsumptionStatus;
  /** An explicit opening was stored that differs from the previous day's closing. */
  discontinuity: boolean;
}

export interface DayTotal {
  date: string;
  /** null when no meter produced a valid consumption for the day (workbook shows ""). */
  total: number | null;
  counted: number;
  expected: number;
}

export interface Tariff {
  utility: Utility;
  price_per_unit: number;
  currency: string;
  effective_from: string;
}

export interface BudgetRow {
  fiscal_year: number;
  month: number;
  kind: 'budget' | 'previous';
  rooms_sold: number | null;
  occupancy_rate: number | null;
  guests: number | null;
  gas: number | null;
  electricity: number | null;
  water: number | null;
}
