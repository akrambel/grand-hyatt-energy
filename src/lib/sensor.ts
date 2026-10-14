// Pure helpers for live-sensor data (no framework imports, unit-tested).

export interface SensorRow {
  id?: number;
  device_ref: string;
  measured_at: string; // ISO UTC
  received_at?: string;
  aht20_temp_c: number | null;
  aht20_humidity_pct: number | null;
  bmp280_temp_c: number | null;
  bmp280_pressure_hpa: number | null;
  aht20_ok: boolean;
  bmp280_ok: boolean;
  boot_count?: number | null;
}

export type DeviceState = 'online' | 'delayed' | 'offline' | 'never';

/**
 * online  : last communication within `offlineMinutes`
 * delayed : within 2x the limit (a few missed uploads)
 * offline : older than that
 * never   : the device has never sent anything
 */
export function deviceState(lastSeenAt: string | null | undefined, offlineMinutes: number, now: Date = new Date()): DeviceState {
  if (!lastSeenAt) return 'never';
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return 'never';
  const ageMin = (now.getTime() - t) / 60000;
  if (ageMin <= offlineMinutes) return 'online';
  if (ageMin <= offlineMinutes * 2) return 'delayed';
  return 'offline';
}

/** Default ambient temperature = AHT20 (per project requirement). BMP280 stays a diagnostic value. */
export function ambientTemp(r: Pick<SensorRow, 'aht20_temp_c' | 'aht20_ok'> | null): number | null {
  if (!r || !r.aht20_ok || r.aht20_temp_c === null || r.aht20_temp_c === undefined) return null;
  return r.aht20_temp_c;
}

/** Difference between both temperature sensors (AHT20 - BMP280); large values suggest a sensor problem. */
export function sensorTempDelta(r: Pick<SensorRow, 'aht20_temp_c' | 'bmp280_temp_c'> | null): number | null {
  if (!r || r.aht20_temp_c === null || r.bmp280_temp_c === null) return null;
  return Math.round((r.aht20_temp_c - r.bmp280_temp_c) * 100) / 100;
}

export interface Stat { min: number | null; avg: number | null; max: number | null; n: number }

export function stat(values: Array<number | null | undefined>): Stat {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!xs.length) return { min: null, avg: null, max: null, n: 0 };
  let min = xs[0], max = xs[0], sum = 0;
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; sum += x; }
  return { min, max, avg: Math.round((sum / xs.length) * 100) / 100, n: xs.length };
}

/** Gap detection: returns intervals longer than `gapMinutes` between consecutive readings. */
export function findGaps(timesIso: string[], gapMinutes: number): Array<{ from: string; to: string; minutes: number }> {
  const ts = timesIso.map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  const out: Array<{ from: string; to: string; minutes: number }> = [];
  for (let i = 1; i < ts.length; i++) {
    const m = (ts[i] - ts[i - 1]) / 60000;
    if (m > gapMinutes) out.push({ from: new Date(ts[i - 1]).toISOString(), to: new Date(ts[i]).toISOString(), minutes: Math.round(m) });
  }
  return out;
}

/** Chooses a chart bucket size so that a range produces roughly <= 400 points. */
export function bucketSecondsFor(fromMs: number, toMs: number): number {
  const spanSec = Math.max(60, (toMs - fromMs) / 1000);
  const steps = [60, 300, 900, 1800, 3600, 10800, 21600, 86400];
  for (const s of steps) if (spanSec / s <= 400) return s;
  return 86400;
}

export type Threshold = { enabled: boolean; min: number | null; max: number | null };

/** Classifies a value against a configured threshold: 'low' | 'high' | 'ok' | 'off'. */
export function thresholdState(v: number | null, t: Threshold): 'low' | 'high' | 'ok' | 'off' {
  if (!t.enabled || v === null) return 'off';
  if (t.min !== null && v < t.min) return 'low';
  if (t.max !== null && v > t.max) return 'high';
  return 'ok';
}
