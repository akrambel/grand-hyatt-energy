// Centralised data layer. Every page reads from this store; any save (own or from another user via
// realtime) updates the arrays, and the derived values (consumption per meter/day, utility totals,
// monthly sums …) are recomputed from them, so dashboards, reports and costs always agree.
import { create } from 'zustand';
import { supabase, fetchAll, friendlyError } from '../lib/supabase.ts';
import { buildMeterDays, dailyTotals } from '../lib/calc.ts';
import type { UtilityDayTotals } from '../lib/calc.ts';
import { addDays, fiscalRange, fiscalYearOf, localToday } from '../lib/dates.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings.ts';
import type { Settings } from '../lib/settings.ts';
import type { BudgetRow, DailyMetric, Meter, MeterDay, Reading, Tariff } from '../lib/types.ts';

export interface LpgLevel { id?: string; tank: number; level_fraction: number; recorded_at: string }
export interface AlertRow {
  id: number; created_at: string; kind: string; severity: 'info' | 'warning' | 'critical'; title: string;
  message: string | null; metric: string | null; value: number | null; threshold: number | null;
  device_ref: string | null; dedupe_key: string; acknowledged_at: string | null; resolved_at: string | null;
}
export interface Device {
  id: string; device_id: string; name: string; location: string | null; firmware_version: string | null;
  last_seen_at: string | null; last_reading_at: string | null; last_status: { aht20_ok?: boolean; bmp280_ok?: boolean } | null;
  active: boolean; created_at: string;
}

interface DataState {
  fy: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  loadedAt: number | null;
  meters: Meter[];
  readings: Reading[];
  metrics: DailyMetric[];
  tariffs: Tariff[];
  budgets: BudgetRow[];
  settings: Settings;
  lpgLatest: LpgLevel[];
  lpgHistory: LpgLevel[];
  alerts: AlertRow[];
  devices: Device[];
  // derived
  meterById: Map<string, Meter>;
  meterDays: Map<string, MeterDay>;
  totals: UtilityDayTotals;
  metricsMap: Map<string, DailyMetric>;

  load: (fy?: number) => Promise<void>;
  setFy: (fy: number) => Promise<void>;
  reloadReference: () => Promise<void>;
  reloadAlerts: () => Promise<void>;
  reloadDevices: () => Promise<void>;
  reloadLpg: () => Promise<void>;
  upsertReadingLocal: (r: Reading) => void;
  removeReadingLocal: (id: string) => void;
  upsertMetricLocal: (m: DailyMetric) => void;
  removeMetricLocal: (date: string) => void;
  subscribe: () => () => void;
}

const emptyTotals = (): UtilityDayTotals => ({ energy: new Map(), water: new Map(), gas: new Map(), chilled: new Map() });

function derive(meters: Meter[], readings: Reading[], metrics: DailyMetric[]) {
  const meterDays = buildMeterDays(meters, readings);
  return {
    meterById: new Map(meters.map((m) => [m.id, m])),
    meterDays,
    totals: dailyTotals(meters, meterDays),
    metricsMap: new Map(metrics.map((m) => [m.metric_date, m])),
  };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const toMeter = (r: Record<string, unknown>): Meter => ({
  id: r.id as string, code: r.code as string, utility: r.utility as Meter['utility'], area: r.area as string,
  name: r.name as string, unit: r.unit as string, sort_order: Number(r.sort_order ?? 0),
  include_in_total: r.include_in_total !== false, rollover_at: num(r.rollover_at), active: r.active !== false,
});
const toReading = (r: Record<string, unknown>): Reading => ({
  id: r.id as string, meter_id: r.meter_id as string, reading_date: r.reading_date as string,
  opening: num(r.opening), closing: num(r.closing), note: (r.note as string | null) ?? null,
  source: r.source as string | undefined, entered_by: (r.entered_by as string | null) ?? null, updated_at: r.updated_at as string | undefined,
});
const toMetric = (r: Record<string, unknown>): DailyMetric => ({
  metric_date: r.metric_date as string, avg_temp_c: num(r.avg_temp_c), occupancy_rate: num(r.occupancy_rate),
  occupied_rooms: num(r.occupied_rooms), guests: num(r.guests),
});

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;

export const useData = create<DataState>((set, get) => ({
  fy: fiscalYearOf(localToday(DEFAULT_SETTINGS.timezone)),
  status: 'idle',
  error: null,
  loadedAt: null,
  meters: [], readings: [], metrics: [], tariffs: [], budgets: [],
  settings: DEFAULT_SETTINGS,
  lpgLatest: [], lpgHistory: [], alerts: [], devices: [],
  meterById: new Map(), meterDays: new Map(), totals: emptyTotals(), metricsMap: new Map(),

  load: async (fyArg) => {
    const fy = fyArg ?? get().fy;
    set({ status: 'loading', error: null, fy });
    try {
      // settings first: they define the fiscal calendar and the time zone
      const { data: settingRows, error: sErr } = await supabase.from('app_settings').select('key, value');
      if (sErr) throw new Error(sErr.message);
      const settings = parseSettings((settingRows ?? []) as Array<{ key: string; value: unknown }>);
      const range = fiscalRange(fy, settings.fiscalStartMonth);
      const from = addDays(range.start, -1); // previous day = opening of the first day

      const [meterRows, readingRows, metricRows, tariffRows, budgetRows] = await Promise.all([
        fetchAll<Record<string, unknown>>((a, b) => supabase.from('meters').select('*').order('utility').order('sort_order').range(a, b)),
        fetchAll<Record<string, unknown>>((a, b) => supabase.from('readings')
          .select('id, meter_id, reading_date, opening, closing, note, source, entered_by, updated_at')
          .gte('reading_date', from).lte('reading_date', range.end).order('reading_date').order('meter_id').range(a, b)),
        fetchAll<Record<string, unknown>>((a, b) => supabase.from('daily_metrics').select('*')
          .gte('metric_date', range.start).lte('metric_date', range.end).order('metric_date').range(a, b)),
        fetchAll<Record<string, unknown>>((a, b) => supabase.from('tariffs').select('*').order('effective_from').range(a, b)),
        fetchAll<Record<string, unknown>>((a, b) => supabase.from('budgets').select('*').range(a, b)),
      ]);
      const meters = meterRows.map(toMeter);
      const readings = readingRows.map(toReading);
      const metrics = metricRows.map(toMetric);
      set({
        settings, meters, readings, metrics,
        tariffs: tariffRows.map((t) => ({ utility: t.utility as Tariff['utility'], price_per_unit: Number(t.price_per_unit), currency: t.currency as string, effective_from: t.effective_from as string })),
        budgets: budgetRows.map((b) => ({
          fiscal_year: Number(b.fiscal_year), month: Number(b.month), kind: b.kind as BudgetRow['kind'],
          rooms_sold: num(b.rooms_sold), occupancy_rate: num(b.occupancy_rate), guests: num(b.guests),
          gas: num(b.gas), electricity: num(b.electricity), water: num(b.water),
        })),
        ...derive(meters, readings, metrics),
        status: 'ready', loadedAt: Date.now(),
      });
      await Promise.all([get().reloadLpg(), get().reloadAlerts(), get().reloadDevices()]);
    } catch (e) {
      set({ status: 'error', error: friendlyError(e) });
    }
  },

  setFy: async (fy) => { if (fy !== get().fy) await get().load(fy); },

  reloadReference: async () => { await get().load(get().fy); },

  reloadAlerts: async () => {
    const { data } = await supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(200);
    if (data) set({ alerts: data as AlertRow[] });
  },
  reloadDevices: async () => {
    const { data } = await supabase.from('devices')
      .select('id, device_id, name, location, firmware_version, last_seen_at, last_reading_at, last_status, active, created_at').order('name');
    if (data) set({ devices: data as Device[] });
  },
  reloadLpg: async () => {
    const { data } = await supabase.from('lpg_levels').select('id, tank, level_fraction, recorded_at').order('recorded_at', { ascending: false }).limit(300);
    if (!data) return;
    const rows = (data as Array<Record<string, unknown>>).map((r) => ({ id: r.id as string, tank: Number(r.tank), level_fraction: Number(r.level_fraction), recorded_at: r.recorded_at as string }));
    const latest: LpgLevel[] = [];
    for (const t of [1, 2, 3]) { const hit = rows.find((r) => r.tank === t); if (hit) latest.push(hit); }
    set({ lpgHistory: rows, lpgLatest: latest });
  },

  upsertReadingLocal: (r) => {
    const list = get().readings.slice();
    const i = list.findIndex((x) => (r.id && x.id === r.id) || (x.meter_id === r.meter_id && x.reading_date === r.reading_date));
    if (i >= 0) list[i] = { ...list[i], ...r }; else list.push(r);
    set({ readings: list });
    scheduleRecompute();
  },
  removeReadingLocal: (id) => { set({ readings: get().readings.filter((x) => x.id !== id) }); scheduleRecompute(); },
  upsertMetricLocal: (m) => {
    const list = get().metrics.filter((x) => x.metric_date !== m.metric_date);
    list.push(m);
    set({ metrics: list });
    scheduleRecompute();
  },
  removeMetricLocal: (date) => { set({ metrics: get().metrics.filter((x) => x.metric_date !== date) }); scheduleRecompute(); },

  subscribe: () => {
    const inFy = (date: string) => {
      const r = fiscalRange(get().fy, get().settings.fiscalStartMonth);
      return date >= addDays(r.start, -1) && date <= r.end;
    };
    const channel = supabase.channel('ghrs-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'readings' }, (p: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        if (p.eventType === 'DELETE') { if (p.old?.id) get().removeReadingLocal(p.old.id as string); return; }
        const r = toReading(p.new);
        if (inFy(r.reading_date)) get().upsertReadingLocal(r);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_metrics' }, (p: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        if (p.eventType === 'DELETE') { if (p.old?.metric_date) get().removeMetricLocal(p.old.metric_date as string); return; }
        get().upsertMetricLocal(toMetric(p.new));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { void get().reloadAlerts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lpg_levels' }, () => { void get().reloadLpg(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meters' }, () => { void get().load(); })
      .subscribe();
    const poll = setInterval(() => { void get().reloadDevices(); }, 15000);
    return () => { clearInterval(poll); void supabase.removeChannel(channel); };
  },
}));

function scheduleRecompute() {
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    const { meters, readings, metrics } = useData.getState();
    useData.setState(derive(meters, readings, metrics));
  }, 120);
}

// ---------------------------------------------------------------- mutations --

export interface SaveReadingInput { meter_id: string; reading_date: string; opening: number | null; closing: number; note?: string | null }

export async function saveReading(input: SaveReadingInput): Promise<Reading> {
  const { data, error } = await supabase.from('readings')
    .upsert({ meter_id: input.meter_id, reading_date: input.reading_date, opening: input.opening, closing: input.closing, note: input.note ?? null, source: 'manual' },
      { onConflict: 'meter_id,reading_date' })
    .select('id, meter_id, reading_date, opening, closing, note, source, entered_by, updated_at').single();
  if (error) throw new Error(friendlyError(error));
  const reading = toReading(data as Record<string, unknown>);
  useData.getState().upsertReadingLocal(reading);
  return reading;
}

export async function deleteReading(id: string): Promise<void> {
  const { error } = await supabase.from('readings').delete().eq('id', id);
  if (error) throw new Error(friendlyError(error));
  useData.getState().removeReadingLocal(id);
}

export async function saveMetric(m: Partial<DailyMetric> & { metric_date: string }): Promise<void> {
  const row = {
    metric_date: m.metric_date, avg_temp_c: m.avg_temp_c ?? null, occupancy_rate: m.occupancy_rate ?? null,
    occupied_rooms: m.occupied_rooms ?? null, guests: m.guests ?? null,
  };
  if (row.avg_temp_c === null && row.occupancy_rate === null && row.occupied_rooms === null && row.guests === null) {
    const { error } = await supabase.from('daily_metrics').delete().eq('metric_date', m.metric_date);
    if (error) throw new Error(friendlyError(error));
    useData.getState().removeMetricLocal(m.metric_date);
    return;
  }
  const { error } = await supabase.from('daily_metrics').upsert(row, { onConflict: 'metric_date' });
  if (error) throw new Error(friendlyError(error));
  useData.getState().upsertMetricLocal(row);
}
