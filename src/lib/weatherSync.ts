// Automatic outside weather (Open-Meteo, free and open data) for the hotel's location.
// It fills public.external_weather from WEATHER_START to today, so the dashboard has a daily outside
// temperature for every day the ESP32 sensor was offline. Runs quietly when a user who may write
// weather opens the website (at most every few hours per browser); nothing to click.
import { supabase } from './supabase.ts';
import { localToday } from './dates.ts';
import type { Settings } from './settings.ts';

import { daysToFetch, mergeDaily, DEFAULT_SITE, WEATHER_EVENT, WEATHER_START } from './weather.ts';
import type { Daily } from './weather.ts';

export { DEFAULT_SITE, WEATHER_EVENT, WEATHER_START };
const LAST_SYNC_KEY = 'ghrs-weather-sync-v1';
const EVERY_MS = 3 * 3600_000;

async function getDaily(url: string): Promise<Daily | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { daily?: Daily };
    return j.daily ?? null;
  } catch { return null; }
}

/** Downloads the missing days and stores them. Returns the number of days saved (0 when nothing was needed). */
export async function syncOutsideWeather(settings: Settings, force = false): Promise<number> {
  try {
    if (!force) {
      const last = Number(localStorage.getItem(LAST_SYNC_KEY) ?? 0);
      if (Date.now() - last < EVERY_MS) return 0;
    }
  } catch { /* storage blocked: sync anyway */ }
  const tz = settings.timezone;
  const today = localToday(tz);
  const { data, error } = await supabase.from('external_weather').select('weather_date').gte('weather_date', WEATHER_START);
  if (error) return 0;
  const stored = new Set((data ?? []).map((r) => (r as { weather_date: string }).weather_date));
  const days = daysToFetch(stored, WEATHER_START, today);
  if (!days.length) { try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())); } catch { /* ignore */ } return 0; }

  const lat = settings.site.latitude ?? DEFAULT_SITE.latitude;
  const lon = settings.site.longitude ?? DEFAULT_SITE.longitude;
  const q = `latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean,temperature_2m_min,temperature_2m_max&timezone=${encodeURIComponent(tz)}`;
  const first = days[0];
  const [archive, recent] = await Promise.all([
    getDaily(`https://archive-api.open-meteo.com/v1/archive?${q}&start_date=${first}&end_date=${today}`),
    getDaily(`https://api.open-meteo.com/v1/forecast?${q}&past_days=14&forecast_days=1`),
  ]);
  const rows = mergeDaily(archive, recent, new Set(days)).filter((r) => r.weather_date <= today);
  if (!rows.length) return 0;
  const { error: e2 } = await supabase.from('external_weather').upsert(rows, { onConflict: 'weather_date' });
  if (e2) return 0;
  try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())); } catch { /* ignore */ }
  window.dispatchEvent(new Event(WEATHER_EVENT));
  return rows.length;
}
