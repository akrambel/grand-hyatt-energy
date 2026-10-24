import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rnd, sampleMetric, sampleReadings } from '../src/lib/sampleData.ts';
import type { Meter } from '../src/lib/types.ts';

const meter = { id: 'm1', code: 'EN-1', utility: 'energy', area: 'A', name: 'A', unit: 'kWh', sort_order: 1, include_in_total: true, rollover_at: null, active: true, category: 'standard' } as Meter;

test('sample data: the same date always gives the same figures', () => {
  assert.equal(rnd('x|2026-01-01'), rnd('x|2026-01-01'));
  assert.deepEqual(sampleMetric('2026-01-15', 430), sampleMetric('2026-01-15', 430));
  const m = sampleMetric('2026-07-15', 430);
  assert.ok(m.occupied_rooms! <= 430 && m.occupancy_rate! >= 0.3 && m.occupancy_rate! <= 0.98);
});

test('sample readings: rising counters, opening day included, same values whatever range is asked', () => {
  const metricOf = (d: string) => sampleMetric(d, 430);
  const a = sampleReadings([meter], () => 100, '2025-10-01', '2025-10-31', metricOf);
  assert.equal(a.length, 32);
  assert.equal(a[0].reading_date, '2025-09-30');
  for (let i = 1; i < a.length; i++) assert.ok(a[i].closing! > a[i - 1].closing!);
  const b = sampleReadings([meter], () => 100, '2025-10-15', '2025-10-20', metricOf);
  assert.equal(b[0].closing, a.find((r) => r.reading_date === '2025-10-14')!.closing);
  const use = a[a.length - 1].closing! - a[0].closing!;
  assert.ok(use > 31 * 60 && use < 31 * 160, `October use ${use}`);
});
