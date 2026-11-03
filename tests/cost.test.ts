import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costInRange } from '../src/lib/kpi.ts';
import type { DayTotal, Tariff } from '../src/lib/types.ts';

const day = (date: string, total: number | null): [string, DayTotal] => [date, { date, total, counted: 1, expected: 1 }];
// the electricity bill Akram uses: 4125 kW x 126.5 SAR/kW fixed + 0.29 SAR/kWh
const elec: Tariff = { utility: 'energy', price_per_unit: 0.29, currency: 'SAR', effective_from: '2026-01-01', demand: 4125, demand_unit: 'kW', fixed_rate: 126.5 };

test('cost: a whole month with no consumption is the fixed charge', () => {
  const c = costInRange(new Map(), [elec], 'energy', '2026-11-01', '2026-11-30', '2026-12-05');
  assert.equal(c.fixed, 521812.5);
  assert.equal(c.cost, 521812.5);
  assert.equal(c.variable, null);
});

test('cost: fixed charge + usage, part of a month gets its share, future days not billed', () => {
  const totals = new Map([day('2026-11-01', 1000), day('2026-11-02', 2000)]);
  const c = costInRange(totals, [elec], 'energy', '2026-11-01', '2026-11-30', '2026-11-03');
  assert.equal(c.variable, 870);
  assert.equal(c.fixed, Math.round((521812.5 * 3 / 30) * 100) / 100);
  assert.equal(c.cost, Math.round((870 + c.fixed) * 1000) / 1000);
});

test('cost: no fixed part asked (water sections) and usage-only tariffs behave as before', () => {
  const totals = new Map([day('2026-11-01', 10)]);
  assert.equal(costInRange(totals, [elec], 'energy', '2026-11-01', '2026-11-30').cost, 2.9);
  const gas: Tariff = { utility: 'gas', price_per_unit: 1.05, currency: 'SAR', effective_from: '2026-01-01' };
  assert.equal(costInRange(totals, [gas], 'gas', '2026-11-01', '2026-11-30', '2026-11-30').cost, 10.5);
  assert.equal(costInRange(new Map(), [gas], 'gas', '2026-11-01', '2026-11-30', '2026-11-30').cost, null);
});
