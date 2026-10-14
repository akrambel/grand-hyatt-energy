// Verifies the TypeScript consumption engine against the numbers computed by the
// workbook's OWN formulas (LibreOffice recalculation of the uploaded template filled
// with deterministic TEST DATA – see scripts/make_fixtures.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMeterDays, dailyTotals, sumRange } from '../src/lib/calc.ts';
import type { Meter, Reading, Utility } from '../src/lib/types.ts';

const input = JSON.parse(readFileSync(new URL('./fixtures/sample-input.json', import.meta.url), 'utf8'));
const expected = JSON.parse(readFileSync(new URL('./fixtures/sample-expected.json', import.meta.url), 'utf8'));

const meters: Meter[] = [];
const idOf = new Map<string, string>();
for (const r of input.readings) {
  const key = `${r.utility}:${r.meter}`;
  if (!idOf.has(key)) {
    idOf.set(key, key);
    meters.push({ id: key, code: key, utility: r.utility, area: r.meter, name: r.meter, unit: '', sort_order: 0,
      include_in_total: true, rollover_at: null, active: true });
  }
}
const readings: Reading[] = input.readings.map((r: any) => ({
  meter_id: `${r.utility}:${r.meter}`, reading_date: r.date, opening: null, closing: r.value }));

const totals = dailyTotals(meters, buildMeterDays(meters, readings));

test('daily totals equal the workbook formulas for every utility and day', () => {
  let compared = 0;
  for (const u of Object.keys(expected.daily) as Utility[]) {
    for (const [date, exp] of Object.entries<number | null>(expected.daily[u])) {
      const got = totals[u].get(date)?.total ?? null;
      if (exp === null) assert.equal(got, null, `${u} ${date} should be blank`);
      else assert.ok(Math.abs((got as number) - exp) < 0.0051, `${u} ${date}: got ${got}, workbook ${exp}`);
      compared++;
    }
  }
  assert.equal(compared, 80);
});

test('October month totals equal the "Oct 2026" sheet', () => {
  for (const u of ['energy', 'water', 'gas', 'chilled'] as Utility[]) {
    const { total } = sumRange(totals[u], '2026-10-01', '2026-10-31');
    assert.ok(Math.abs((total as number) - expected.month_oct[u]) < 0.01, `${u}: ${total} vs ${expected.month_oct[u]}`);
  }
});

test('Monthly Summary "All Utilities" (mixed-unit sum) equals the sum of the four months', () => {
  let all = 0;
  for (const u of ['energy', 'water', 'gas', 'chilled'] as Utility[]) all += sumRange(totals[u], '2026-10-01', '2026-10-31').total ?? 0;
  assert.ok(Math.abs(all - expected.summary_oct.all) < 0.02);
});

test('partial data: a meter without a valid pair does not contribute (workbook behaviour)', () => {
  // test data: energy meter #3 has no reading on 3 Oct -> no pair on the 3rd and none on the 4th
  assert.equal(totals.energy.get('2026-10-03')!.counted, 9);
  assert.equal(totals.energy.get('2026-10-04')!.counted, 9);
  assert.equal(totals.energy.get('2026-10-05')!.counted, 10);
  assert.equal(totals.energy.get('2026-10-05')!.expected, 10);
  // water meter #2 only starts on 4 Oct -> first valid pair on 5 Oct
  assert.equal(totals.water.get('2026-10-04')!.counted, 9);
  assert.equal(totals.water.get('2026-10-05')!.counted, 10);
});
