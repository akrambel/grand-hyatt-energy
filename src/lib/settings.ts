import { DEFAULT_ANOMALY } from './anomaly.ts';
import type { AnomalyOptions } from './anomaly.ts';

export interface ThresholdSetting { enabled: boolean; min: number | null; max: number | null }

export interface Settings {
  timezone: string;
  fiscalStartMonth: number;
  site: { name: string; latitude: number | null; longitude: number | null };
  deviceOfflineMinutes: number;
  alertCooldownMinutes: number;
  thresholds: { temperature: ThresholdSetting; humidity: ThresholdSetting; pressure: ThresholdSetting };
  anomaly: AnomalyOptions & { enabled: boolean };
  entry: { jumpFactor: number };
  lpg: { capacityLitres: number[] };
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'Asia/Riyadh',
  fiscalStartMonth: 10,
  site: { name: 'Grand Hyatt The Red Sea', latitude: null, longitude: null },
  deviceOfflineMinutes: 10,
  alertCooldownMinutes: 60,
  thresholds: {
    temperature: { enabled: false, min: 18, max: 30 },
    humidity: { enabled: false, min: 30, max: 70 },
    pressure: { enabled: false, min: 980, max: 1040 },
  },
  anomaly: { enabled: true, ...DEFAULT_ANOMALY },
  entry: { jumpFactor: 5 },
  lpg: { capacityLitres: [4000, 4000, 4000] },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown, d: number | null): number | null => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : d);

function threshold(v: unknown, d: ThresholdSetting): ThresholdSetting {
  if (!isObj(v)) return d;
  return { enabled: v.enabled === true, min: numOrNull(v.min, d.min), max: numOrNull(v.max, d.max) };
}

/** Builds Settings from `app_settings` rows, falling back to defaults for anything missing or malformed. */
export function parseSettings(rows: Array<{ key: string; value: unknown }>): Settings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_SETTINGS;
  const site = m.get('site');
  const th = m.get('thresholds');
  const an = m.get('anomaly');
  const en = m.get('entry');
  const lpg = m.get('lpg');
  const caps = isObj(lpg) && Array.isArray(lpg.capacityLitres) ? (lpg.capacityLitres as unknown[]).map((c) => numOr(c, 4000)).slice(0, 3) : d.lpg.capacityLitres;
  while (caps.length < 3) caps.push(4000);
  return {
    timezone: typeof m.get('timezone') === 'string' ? (m.get('timezone') as string) : d.timezone,
    fiscalStartMonth: Math.min(12, Math.max(1, numOr(m.get('fiscal_start_month'), d.fiscalStartMonth))),
    site: isObj(site)
      ? { name: typeof site.name === 'string' ? site.name : d.site.name, latitude: numOrNull(site.latitude, null), longitude: numOrNull(site.longitude, null) }
      : d.site,
    deviceOfflineMinutes: numOr(m.get('device_offline_minutes'), d.deviceOfflineMinutes),
    alertCooldownMinutes: numOr(m.get('alert_cooldown_minutes'), d.alertCooldownMinutes),
    thresholds: {
      temperature: threshold(isObj(th) ? th.temperature : null, d.thresholds.temperature),
      humidity: threshold(isObj(th) ? th.humidity : null, d.thresholds.humidity),
      pressure: threshold(isObj(th) ? th.pressure : null, d.thresholds.pressure),
    },
    anomaly: isObj(an)
      ? { enabled: an.enabled !== false, zThreshold: numOr(an.zThreshold, 3), minSamples: numOr(an.minSamples, 14), windowDays: numOr(an.windowDays, 28) }
      : d.anomaly,
    entry: { jumpFactor: isObj(en) ? numOr(en.jumpFactor, 5) : d.entry.jumpFactor },
    lpg: { capacityLitres: caps },
  };
}

/** LPG tank status – same thresholds as the workbook (<=15 % critical, <=30 % low, <=60 % normal). */
export type LpgStatus = 'EMPTY' | 'CRITICAL' | 'LOW' | 'NORMAL' | 'HIGH';
export function lpgStatus(fraction: number | null): LpgStatus | null {
  if (fraction === null) return null;
  if (fraction <= 0) return 'EMPTY';
  if (fraction <= 0.15) return 'CRITICAL';
  if (fraction <= 0.3) return 'LOW';
  if (fraction <= 0.6) return 'NORMAL';
  return 'HIGH';
}
