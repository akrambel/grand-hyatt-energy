import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enpiByMonth, enpiTarget } from '../src/lib/kpi.ts';
import { parseSettings } from '../src/lib/settings.ts';
import type { DailyMetric, DayTotal } from '../src/lib/types.ts';

const day = (date: string, total: number | null): [string, DayTotal] => [date, { date, total, counted: 1, expected: 1 }];
const met = (date: string, occupied_rooms: number | null): [string, DailyMetric] => [date, { metric_date: date, avg_temp_c: null, occupancy_rate: null, occupied_rooms, guests: null }];

test('enpiByMonth: kWh per occupied room uses only days with both values', () => {
  const totals = new Map([day('2026-10-01', 3000), day('2026-10-02', 3300), day('2026-10-03', 5000), day('2026-11-01', 2000)]);
  const metrics = new Map([met('2026-10-01', 100), met('2026-10-02', 110), met('2026-10-03', null), met('2026-11-01', 80)]);
  const months = [
    { key: '2026-10', label: 'Oct 2026', start: '2026-10-01', end: '2026-10-31' },
    { key: '2026-11', label: 'Nov 2026', start: '2026-11-01', end: '2026-11-30' },
    { key: '2026-12', label: 'Dec 2026', start: '2026-12-01', end: '2026-12-31' },
  ];
  const rows = enpiByMonth(totals, metrics, months, 25, '2026-11-15');
  assert.equal(rows.length, 2, 'future months are left out');
  assert.equal(rows[0].days, 2);
  assert.equal(rows[0].consumption, 6300);
  assert.equal(rows[0].roomNights, 210);
  assert.equal(rows[0].value, 30);
  assert.equal(rows[0].vsTarget, 0.2);
  assert.equal(rows[1].value, 25);
  assert.equal(rows[1].vsTarget, 0);
  assert.equal(enpiByMonth(totals, metrics, months, null, '2026-11-15')[0].vsTarget, null);
});

test('enpi targets: saved in base units, shown in display units, only positive numbers kept', () => {
  const s = parseSettings([{ key: 'enpi_targets', value: { energy: 32, water: 0.9, gas: -1, chilled: 'x' } }]);
  assert.deepEqual(s.enpiTargets, { energy: 32, water: 0.9, gas: null, chilled: null });
  assert.equal(enpiTarget(s.enpiTargets, 'water', 1000), 900); // m³ target shown in litres
  assert.equal(enpiTarget(s.enpiTargets, 'gas', 1), null);
  assert.deepEqual(parseSettings([]).enpiTargets, { energy: null, water: null, gas: null, chilled: null });
});
