// Pure helpers for the automatic outside weather (see weatherSync.ts). No network or database here.
import { addDays, eachDay } from './dates.ts';

export const WEATHER_START = '2026-10-03';
/** Shura Island (Grand Hyatt The Red Sea), used when no coordinates are saved in Settings. */
export const DEFAULT_SITE = { latitude: 25.50417, longitude: 36.9575 } as const;
export const WEATHER_EVENT = 'ghrs-weather-updated';
/** Recent days are fetched again: the archive fills them a few days late and the forecast values are provisional. */
export const REFRESH_DAYS = 7;

export interface WeatherRow { weather_date: string; avg_temp_c: number; min_temp_c: number | null; max_temp_c: number | null; provider: string }
export interface Daily { time: string[]; temperature_2m_mean: Array<number | null>; temperature_2m_min: Array<number | null>; temperature_2m_max: Array<number | null> }

/** Days that need weather: not stored yet, or among the last REFRESH_DAYS days. */
export function daysToFetch(stored: Set<string>, start: string, today: string): string[] {
  if (start > today) return [];
  const recentFrom = addDays(today, -REFRESH_DAYS + 1);
  return eachDay(start, today).filter((d) => !stored.has(d) || d >= recentFrom);
}

/** Merges the archive (checked data) with the forecast service (recent days); the archive wins when both have a day. */
export function mergeDaily(archive: Daily | null, recent: Daily | null, wanted: Set<string>): WeatherRow[] {
  const out = new Map<string, WeatherRow>();
  for (const [src, provider] of [[recent, 'open-meteo-forecast'], [archive, 'open-meteo']] as const) {
    if (!src) continue;
    src.time.forEach((d, i) => {
      const mean = src.temperature_2m_mean[i];
      if (!wanted.has(d) || mean === null || mean === undefined) return;
      out.set(d, { weather_date: d, avg_temp_c: mean, min_temp_c: src.temperature_2m_min[i] ?? null, max_temp_c: src.temperature_2m_max[i] ?? null, provider });
    });
  }
  return [...out.values()].sort((a, b) => (a.weather_date < b.weather_date ? -1 : 1));
}

