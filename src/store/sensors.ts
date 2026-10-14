import { create } from 'zustand';
import { supabase, fetchAll } from '../lib/supabase.ts';
import type { SensorRow } from '../lib/sensor.ts';

const COLS = 'id, device_ref, measured_at, received_at, aht20_temp_c, aht20_humidity_pct, bmp280_temp_c, bmp280_pressure_hpa, aht20_ok, bmp280_ok, boot_count';

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const toSensorRow = (r: Record<string, unknown>): SensorRow => ({
  id: r.id as number, device_ref: r.device_ref as string, measured_at: r.measured_at as string, received_at: r.received_at as string,
  aht20_temp_c: n(r.aht20_temp_c), aht20_humidity_pct: n(r.aht20_humidity_pct),
  bmp280_temp_c: n(r.bmp280_temp_c), bmp280_pressure_hpa: n(r.bmp280_pressure_hpa),
  aht20_ok: r.aht20_ok !== false, bmp280_ok: r.bmp280_ok !== false, boot_count: n(r.boot_count),
});

interface SensorState {
  latest: Record<string, SensorRow>; // by device uuid
  recent: SensorRow[]; // newest first, last ~200
  live: boolean;
  loadLatest: () => Promise<void>;
  subscribe: () => () => void;
}

export const useSensors = create<SensorState>((set, get) => ({
  latest: {}, recent: [], live: false,

  loadLatest: async () => {
    const { data } = await supabase.from('sensor_readings').select(COLS).order('measured_at', { ascending: false }).limit(200);
    if (!data) return;
    const rows = (data as Array<Record<string, unknown>>).map(toSensorRow);
    const latest: Record<string, SensorRow> = {};
    for (const r of rows) if (!latest[r.device_ref]) latest[r.device_ref] = r;
    set({ recent: rows, latest });
  },

  subscribe: () => {
    void get().loadLatest();
    const channel = supabase.channel('ghrs-sensors')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_readings' }, (p: { new: Record<string, unknown> }) => {
        const r = toSensorRow(p.new);
        const cur = get().latest[r.device_ref];
        const latest = !cur || r.measured_at >= cur.measured_at ? { ...get().latest, [r.device_ref]: r } : get().latest;
        const recent = [r, ...get().recent.filter((x) => x.id !== r.id)].sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1)).slice(0, 200);
        set({ latest, recent });
      })
      .subscribe((status: string) => set({ live: status === 'SUBSCRIBED' }));
    // polling fallback: if realtime is blocked, the page still updates
    const poll = setInterval(() => { void get().loadLatest(); }, 20000);
    return () => { clearInterval(poll); void supabase.removeChannel(channel); set({ live: false }); };
  },
}));

export async function fetchSensorRange(fromIso: string, toIso: string, deviceRef?: string): Promise<SensorRow[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) => {
    let q = supabase.from('sensor_readings').select(COLS).gte('measured_at', fromIso).lt('measured_at', toIso)
      .order('measured_at', { ascending: false }).range(a, b);
    if (deviceRef) q = q.eq('device_ref', deviceRef);
    return q;
  });
  return rows.map(toSensorRow);
}

export interface Bucket {
  bucket: string; samples: number; aht20_temp_avg: number | null; aht20_temp_min: number | null; aht20_temp_max: number | null;
  humidity_avg: number | null; bmp280_temp_avg: number | null; pressure_avg: number | null;
}
export async function fetchBuckets(fromIso: string, toIso: string, bucketSeconds: number, deviceRef?: string): Promise<Bucket[]> {
  const { data, error } = await supabase.rpc('sensor_bucketed', { p_from: fromIso, p_to: toIso, p_bucket_seconds: bucketSeconds, p_device: deviceRef ?? null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    bucket: r.bucket as string, samples: Number(r.samples), aht20_temp_avg: n(r.aht20_temp_avg), aht20_temp_min: n(r.aht20_temp_min),
    aht20_temp_max: n(r.aht20_temp_max), humidity_avg: n(r.humidity_avg), bmp280_temp_avg: n(r.bmp280_temp_avg), pressure_avg: n(r.pressure_avg),
  }));
}

export interface DailyStat {
  day: string; device_ref: string; samples: number;
  aht20_temp_avg: number | null; aht20_temp_min: number | null; aht20_temp_max: number | null;
  humidity_avg: number | null; humidity_min: number | null; humidity_max: number | null;
  bmp280_temp_avg: number | null; bmp280_temp_min: number | null; bmp280_temp_max: number | null;
  pressure_avg: number | null; pressure_min: number | null; pressure_max: number | null;
}
export async function fetchDailyStats(from: string, to: string, deviceRef?: string): Promise<DailyStat[]> {
  const { data, error } = await supabase.rpc('sensor_daily_stats', { p_from: from, p_to: to, p_device: deviceRef ?? null, p_tz: null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    day: r.day as string, device_ref: r.device_ref as string, samples: Number(r.samples),
    aht20_temp_avg: n(r.aht20_temp_avg), aht20_temp_min: n(r.aht20_temp_min), aht20_temp_max: n(r.aht20_temp_max),
    humidity_avg: n(r.humidity_avg), humidity_min: n(r.humidity_min), humidity_max: n(r.humidity_max),
    bmp280_temp_avg: n(r.bmp280_temp_avg), bmp280_temp_min: n(r.bmp280_temp_min), bmp280_temp_max: n(r.bmp280_temp_max),
    pressure_avg: n(r.pressure_avg), pressure_min: n(r.pressure_min), pressure_max: n(r.pressure_max),
  }));
}
