import test from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekKey, groupStats, defaultGrain } from '../src/lib/sensorAgg.ts';
import type { DailyStatLike } from '../src/lib/sensorAgg.ts';

const row = (day: string, samples: number, avg: number, min: number, max: number): DailyStatLike => ({
  day, samples, aht20_temp_avg: avg, aht20_temp_min: min, aht20_temp_max: max, humidity_avg: 50, humidity_min: 40, humidity_max: 60,
  bmp280_temp_avg: avg + 0.5, bmp280_temp_min: min, bmp280_temp_max: max, pressure_avg: 1010, pressure_min: 1008, pressure_max: 1012,
});

test('ISO week keys', () => {
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2024-12-30'), '2025-W01');
  assert.equal(isoWeekKey('2021-01-03'), '2020-W53');
  assert.equal(isoWeekKey('2026-10-12'), '2026-W42');
});
test('groupStats weights averages by samples and keeps true min/max', () => {
  const g = groupStats([row('2026-10-01', 100, 30, 25, 35), row('2026-10-02', 300, 34, 28, 40)], 'month');
  assert.equal(g.length, 1);
  assert.equal(g[0].tempAvg, 33);
  assert.equal(g[0].tempMin, 25);
  assert.equal(g[0].tempMax, 40);
  assert.equal(g[0].samples, 400);
  assert.equal(g[0].days, 2);
});
test('grouping by week / year', () => {
  const rows = [row('2026-10-05', 10, 30, 30, 30), row('2026-10-11', 10, 32, 32, 32), row('2026-10-12', 10, 34, 34, 34)];
  assert.equal(groupStats(rows, 'week').length, 2);
  assert.equal(groupStats(rows, 'year').length, 1);
});
test('default grain', () => {
  assert.equal(defaultGrain('2026-10-01', '2026-10-31'), 'day');
  assert.equal(defaultGrain('2026-10-01', '2027-01-15'), 'week');
  assert.equal(defaultGrain('2026-10-01', '2027-09-30'), 'month');
});
