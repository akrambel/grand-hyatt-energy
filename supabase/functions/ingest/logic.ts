// Pure validation / alert-evaluation logic for the sensor ingest endpoint.
// No Deno- or Supabase-specific imports so it can be unit tested with Node.

export interface SensorValues {
  temp_c?: number | null;
  humidity_pct?: number | null;
  pressure_hpa?: number | null;
  ok?: boolean;
}
export interface RawReading {
  ts?: number | string; // unix seconds (UTC) or ISO-8601 string
  aht20?: SensorValues | null;
  bmp280?: SensorValues | null;
  boot?: number;
}
export interface Payload {
  device_id: string;
  firmware?: string;
  readings: RawReading[];
}
export interface CleanReading {
  measured_at: string; // ISO UTC
  aht20_temp_c: number | null;
  aht20_humidity_pct: number | null;
  bmp280_temp_c: number | null;
  bmp280_pressure_hpa: number | null;
  aht20_ok: boolean;
  bmp280_ok: boolean;
  boot_count: number | null;
}

export const LIMITS = {
  maxBatch: 100,
  maxBodyBytes: 64 * 1024,
  minValidTs: Date.UTC(2024, 0, 1),
  maxFutureMs: 5 * 60 * 1000,
  temp: [-40, 85] as const,
  humidity: [0, 100] as const,
  pressure: [300, 1100] as const,
  /** Readings older than this never raise threshold alerts (buffered backlog). */
  alertFreshMs: 15 * 60 * 1000,
};

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,40}$/;

export function validatePayload(body: unknown): { ok: true; payload: Payload } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  if (typeof b.device_id !== 'string' || !DEVICE_ID_RE.test(b.device_id)) return { ok: false, error: 'device_id is missing or invalid.' };
  if (!Array.isArray(b.readings) || b.readings.length === 0) return { ok: false, error: 'readings must be a non-empty array.' };
  if (b.readings.length > LIMITS.maxBatch) return { ok: false, error: `At most ${LIMITS.maxBatch} readings per request.` };
  const firmware = typeof b.firmware === 'string' ? b.firmware.slice(0, 40) : undefined;
  return { ok: true, payload: { device_id: b.device_id, firmware, readings: b.readings as RawReading[] } };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const inRange = (v: number | null, [lo, hi]: readonly [number, number]): number | null =>
  v !== null && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null;

export function parseTimestamp(ts: unknown): number | null {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts > 1e11 ? Math.round(ts) : Math.round(ts * 1000);
  if (typeof ts === 'string') {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export type CleanResult = { ok: true; reading: CleanReading } | { ok: false; reason: string };

export function cleanReading(raw: RawReading, nowMs: number): CleanResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not_an_object' };
  const t = parseTimestamp(raw.ts);
  if (t === null) return { ok: false, reason: 'missing_timestamp' };
  if (t < LIMITS.minValidTs) return { ok: false, reason: 'timestamp_not_synchronised' };
  if (t > nowMs + LIMITS.maxFutureMs) return { ok: false, reason: 'timestamp_in_future' };

  const aht = raw.aht20 ?? null;
  const bmp = raw.bmp280 ?? null;
  const aTemp = inRange(num(aht?.temp_c), LIMITS.temp);
  const aHum = inRange(num(aht?.humidity_pct), LIMITS.humidity);
  const bTemp = inRange(num(bmp?.temp_c), LIMITS.temp);
  const bPress = inRange(num(bmp?.pressure_hpa), LIMITS.pressure);
  // A sensor is "ok" only if the device says so AND the values are plausible.
  const aht20_ok = aht?.ok !== false && aTemp !== null && aHum !== null;
  const bmp280_ok = bmp?.ok !== false && bTemp !== null && bPress !== null;
  return {
    ok: true,
    reading: {
      measured_at: new Date(t).toISOString(),
      aht20_temp_c: aht20_ok ? aTemp : null,
      aht20_humidity_pct: aht20_ok ? aHum : null,
      bmp280_temp_c: bmp280_ok ? bTemp : null,
      bmp280_pressure_hpa: bmp280_ok ? bPress : null,
      aht20_ok,
      bmp280_ok,
      boot_count: typeof raw.boot === 'number' && Number.isInteger(raw.boot) ? raw.boot : null,
    },
  };
}

// ------------------------------------------------------------- thresholds ----

export interface Threshold { enabled?: boolean; min?: number | null; max?: number | null }
export interface Thresholds { temperature?: Threshold; humidity?: Threshold; pressure?: Threshold }

export interface AlertSpec {
  dedupe_key: string;
  kind: 'temperature' | 'humidity' | 'pressure' | 'sensor_fault';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  metric: string;
  value: number | null;
  threshold: number | null;
}

export interface Evaluation {
  raise: AlertSpec[];
  /** dedupe keys whose condition is currently NOT violated -> resolve any open alert */
  resolve: string[];
}

/** Evaluates the newest reading against the configured thresholds. */
export function evaluate(reading: CleanReading, deviceId: string, thresholds: Thresholds, nowMs: number): Evaluation {
  const raise: AlertSpec[] = [];
  const resolve: string[] = [];
  if (nowMs - Date.parse(reading.measured_at) > LIMITS.alertFreshMs) return { raise, resolve }; // stale backlog

  const check = (
    kind: 'temperature' | 'humidity' | 'pressure', label: string, unit: string,
    value: number | null, th: Threshold | undefined, sensorOk: boolean,
  ) => {
    const lowKey = `${deviceId}:${kind}:low`, highKey = `${deviceId}:${kind}:high`;
    if (!th?.enabled || !sensorOk || value === null) return; // no data -> no alert, nothing resolved
    const { min, max } = th;
    if (typeof max === 'number' && value > max) {
      raise.push({ dedupe_key: highKey, kind, severity: 'warning', title: `${label} above limit`,
        message: `${label} is ${value} ${unit} (limit ${max} ${unit}).`, metric: kind, value, threshold: max });
    } else resolve.push(highKey);
    if (typeof min === 'number' && value < min) {
      raise.push({ dedupe_key: lowKey, kind, severity: 'warning', title: `${label} below limit`,
        message: `${label} is ${value} ${unit} (limit ${min} ${unit}).`, metric: kind, value, threshold: min });
    } else resolve.push(lowKey);
  };
  check('temperature', 'Temperature (AHT20)', '°C', reading.aht20_temp_c, thresholds.temperature, reading.aht20_ok);
  check('humidity', 'Relative humidity', '%', reading.aht20_humidity_pct, thresholds.humidity, reading.aht20_ok);
  check('pressure', 'Atmospheric pressure', 'hPa', reading.bmp280_pressure_hpa, thresholds.pressure, reading.bmp280_ok);

  for (const [name, ok] of [['AHT20', reading.aht20_ok], ['BMP280', reading.bmp280_ok]] as const) {
    const key = `${deviceId}:fault:${name}`;
    if (!ok) {
      raise.push({ dedupe_key: key, kind: 'sensor_fault', severity: 'critical', title: `${name} sensor fault`,
        message: `The ${name} sensor is reporting errors or implausible values.`, metric: name.toLowerCase(), value: null, threshold: null });
    } else resolve.push(key);
  }
  return { raise, resolve };
}

// ------------------------------------------------------------------ crypto ---

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
