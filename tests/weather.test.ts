import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysToFetch, mergeDaily } from '../src/lib/weather.ts';

test('only missing days and the last 7 days are fetched', () => {
  const stored = new Set(['2026-10-03', '2026-10-04', '2026-10-06', '2026-10-09']);
  assert.deepEqual(daysToFetch(stored, '2026-10-03', '2026-10-12'),
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.deepEqual(daysToFetch(new Set(), '2026-10-03', '2026-10-01'), []);
});

test('archive values win over the forecast service; empty days are skipped', () => {
  const archive = { time: ['2026-11-01', '2026-11-02'], temperature_2m_mean: [30.1, null], temperature_2m_min: [26, null], temperature_2m_max: [34, null] };
  const recent = { time: ['2026-11-01', '2026-11-02', '2026-11-03'], temperature_2m_mean: [29, 28.5, 27], temperature_2m_min: [25, 24, 23], temperature_2m_max: [33, 32, 31] };
  const rows = mergeDaily(archive, recent, new Set(['2026-11-01', '2026-11-02']));
  assert.deepEqual(rows.map((r) => [r.weather_date, r.avg_temp_c, r.provider]), [['2026-11-01', 30.1, 'open-meteo'], ['2026-11-02', 28.5, 'open-meteo-forecast']]);
});
