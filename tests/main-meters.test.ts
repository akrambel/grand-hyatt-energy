// Main meters as the utility total from a given day (migration 0015): history keeps the old sub-meter totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeterDays, countedLabel, countsInTotal, dailyTotals } from '../src/lib/calc.ts';
import { areaTotals } from '../src/lib/aggregate.ts';
import type { Meter, Reading } from '../src/lib/types.ts';

const meter = (id: string, area: string, extra: Partial<Meter>): Meter => ({
  id, code: id, utility: 'energy', area, name: area, unit: 'kWh', sort_order: 0, include_in_total: true, rollover_at: null, active: true, ...extra,
});
const main = meter('EN-MAIN', 'Main Incomer', { counted_from: '2026-11-12', in_area_chart: false });
const mdb1 = meter('EN-MDB1', 'MDB 1', { include_in_total: false, in_area_chart: true });
const mdb2 = meter('EN-MDB2', 'MDB 2', { include_in_total: false, in_area_chart: true });
const outlet = meter('EN-01', 'Embers', { counted_until: '2026-11-11', in_area_chart: false });
const meters = [main, mdb1, mdb2, outlet];
const r = (m: Meter, d: string, closing: number, opening: number | null = null): Reading => ({ meter_id: m.id, reading_date: d, opening, closing, note: null });
const readings: Reading[] = [
  r(outlet, '2026-11-10', 100, 90), r(outlet, '2026-11-11', 130), r(outlet, '2026-11-12', 170),
  r(main, '2026-11-12', 1500, 1000), r(mdb1, '2026-11-12', 300, 0), r(mdb2, '2026-11-12', 200, 0),
];
const totals = dailyTotals(meters, buildMeterDays(meters, readings)).energy;

test('before the switch day the total is the old outlet meters', () => {
  assert.deepEqual(totals.get('2026-11-11'), { date: '2026-11-11', total: 30, counted: 1, expected: 1 });
  assert.equal(countsInTotal(main, '2026-11-11'), false);
});

test('from the switch day the total is the main meter only (MDBs and outlets not added twice)', () => {
  assert.deepEqual(totals.get('2026-11-12'), { date: '2026-11-12', total: 500, counted: 1, expected: 1 });
  assert.equal(countsInTotal(outlet, '2026-11-12'), false);
});

test('area chart shows the MDBs, not the main meter or outlets', () => {
  const areas = areaTotals(meters, buildMeterDays(meters, readings), 'energy', '2026-11-01', '2026-11-30');
  assert.deepEqual(areas.map((a) => [a.area, a.total]), [['MDB 1', 300], ['MDB 2', 200]]);
});

test('meter list labels', () => {
  assert.equal(countedLabel(main), 'Yes, from 2026-11-12');
  assert.equal(countedLabel(outlet), 'Yes, until 2026-11-11');
  assert.equal(countedLabel(mdb1), 'No');
  assert.equal(countedLabel(meter('W', 'x', {})), 'Yes');
});
