import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySeries, monthlySeries, areaTotals, coverage, average, change } from '../src/lib/aggregate.ts';
import type { DayTotal, Meter, MeterDay } from '../src/lib/types.ts';

const t = (date: string, total: number | null): [string, DayTotal] => [date, { date, total, counted: 1, expected: 1 }];

test('dailySeries keeps gaps as null', () => {
  const s = dailySeries(new Map([t('2026-10-01', 5), t('2026-10-03', 7)]), '2026-10-01', '2026-10-03');
  assert.deepEqual(s.map((p) => p.value), [5, null, 7]);
});
test('monthlySeries starts in October and ignores empty months', () => {
  const m = monthlySeries(new Map([t('2026-10-01', 5), t('2026-10-02', 7), t('2027-01-15', 3)]), 2026, 10);
  assert.equal(m.length, 12);
  assert.equal(m[0].label.includes('Oct'), true);
  assert.equal(m[0].value, 12);
  assert.equal(m[1].value, null);
  assert.equal(m[3].value, 3);
});
test('areaTotals respects include_in_total and sorts', () => {
  const meters = [
    { id: 'a', utility: 'water', area: 'Spa', active: true, include_in_total: true },
    { id: 'b', utility: 'water', area: 'Villas', active: true, include_in_total: true },
    { id: 'c', utility: 'water', area: 'Main', active: true, include_in_total: false },
  ] as Meter[];
  const md = new Map<string, MeterDay>();
  const add = (id: string, c: number | null) => md.set(`${id}|2026-10-02`, { meter_id: id, date: '2026-10-02', opening: 0, closing: c, consumption: c, status: 'ok', discontinuity: false });
  add('a', 10); add('b', 30); add('c', 999);
  const r = areaTotals(meters, md, 'water', '2026-10-01', '2026-10-31');
  assert.deepEqual(r.map((x) => [x.area, x.total]), [['Villas', 30], ['Spa', 10]]);
});
test('coverage only counts elapsed days', () => {
  const c = coverage(new Map([t('2026-10-01', 1), t('2026-10-03', 1)]), '2026-10-01', '2026-10-31', '2026-10-04');
  assert.equal(c.daysElapsed, 4);
  assert.equal(c.daysWithData, 2);
  assert.deepEqual(c.missing, ['2026-10-02', '2026-10-04']);
  assert.equal(coverage(new Map(), '2026-11-01', '2026-11-30', '2026-10-04').daysElapsed, 0);
});
test('average/change', () => {
  assert.equal(average([{ date: 'x', value: 2 }, { date: 'y', value: null }, { date: 'z', value: 4 }]), 3);
  assert.equal(average([]), null);
  assert.equal(change(110, 100), 0.1);
  assert.equal(change(1, 0), null);
  assert.equal(change(null, 5), null);
});
