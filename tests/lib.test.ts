import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, daysBetween, fiscalMonths, fiscalRange, fiscalYearOf, fiscalLabel, isISODate, localDateOf, excelSerialToISO } from '../src/lib/dates.ts';
import { computeMeterDay } from '../src/lib/calc.ts';
import { validateEntry, parseReading } from '../src/lib/validate.ts';
import type { EntryInput } from '../src/lib/validate.ts';
import { analyzeSeries } from '../src/lib/anomaly.ts';
import { actualByMonth, costInRange, pairedIntensity, ratio, summarizeMetrics, tariffFor, variance } from '../src/lib/kpi.ts';
import { buildMeterDays, dailyTotals } from '../src/lib/calc.ts';
import type { DailyMetric, Meter, Reading } from '../src/lib/types.ts';

test('fiscal year starts on 1 October', () => {
  assert.equal(fiscalYearOf('2026-10-01'), 2026);
  assert.equal(fiscalYearOf('2026-09-30'), 2025);
  assert.equal(fiscalYearOf('2027-09-30'), 2026);
  assert.equal(fiscalLabel(2026), 'FY2026-27');
  assert.deepEqual(fiscalRange(2026), { start: '2026-10-01', end: '2027-09-30' });
  const m = fiscalMonths(2026);
  assert.equal(m.length, 12);
  assert.equal(m[0].label, 'Oct 2026');
  assert.equal(m[4].days, 28, 'Feb 2027 has 28 days');
  assert.equal(m[11].label, 'Sep 2027');
  assert.equal(daysBetween('2026-10-01', '2027-09-30') + 1, 365);
});

test('date helpers are timezone independent', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.ok(isISODate('2028-02-29') && !isISODate('2027-02-29'));
  assert.equal(localDateOf('2026-10-10T21:10:00Z', 'Asia/Riyadh'), '2026-10-11');
  assert.equal(localDateOf('2026-10-10T20:50:00Z', 'Asia/Riyadh'), '2026-10-10');
  assert.equal(excelSerialToISO(46296), '2026-10-01');
});

test('consumption = closing - opening (spec example 500 L -> 583 L = 83 L)', () => {
  const d = computeMeterDay({ meter_id: 'm', reading_date: '2026-10-02', opening: 500, closing: 583 }, null, { rollover_at: null });
  assert.equal(d.consumption, 83);
  assert.equal(d.status, 'ok');
});

test('rollover and negative handling', () => {
  const roll = { rollover_at: 100000 };
  assert.equal(computeMeterDay({ meter_id: 'm', reading_date: 'd', opening: null, closing: 40 }, 99990, roll).consumption, 50);
  assert.equal(computeMeterDay({ meter_id: 'm', reading_date: 'd', opening: null, closing: 40 }, 99990, { rollover_at: null }).status, 'negative');
  // implausible rollover (would be > half the meter range) is treated as negative
  assert.equal(computeMeterDay({ meter_id: 'm', reading_date: 'd', opening: null, closing: 100 }, 40000, roll).status, 'negative');
  assert.equal(computeMeterDay({ meter_id: 'm', reading_date: 'd', opening: null, closing: 5 }, null, roll).status, 'missing_opening');
});

const baseEntry = (over: Partial<EntryInput> = {}): EntryInput => ({
  date: '2026-10-12', meter: { rollover_at: null, unit: 'm³', name: 'Test' }, openingText: '', closingText: '583',
  prevClosing: 500, existing: null, today: '2026-10-13', recentAvgDaily: null, recentSamples: 0, jumpFactor: 5,
  confirmed: { discontinuity: false, jump: false, overwrite: false }, ...over });

test('entry validation: happy path, missing, future, negative, decreasing', () => {
  const ok = validateEntry(baseEntry());
  assert.equal(ok.consumption, 83); assert.ok(ok.canSave); assert.equal(ok.storeOpening, null);
  assert.ok(!validateEntry(baseEntry({ closingText: '' })).canSave);
  assert.ok(validateEntry(baseEntry({ date: '2026-10-14' })).errors.some((e) => e.code === 'date_future'));
  assert.ok(validateEntry(baseEntry({ closingText: '-4' })).errors.some((e) => e.code === 'closing_negative'));
  assert.ok(validateEntry(baseEntry({ closingText: 'abc' })).errors.some((e) => e.code === 'closing_nan'));
  assert.ok(validateEntry(baseEntry({ closingText: '400' })).errors.some((e) => e.code === 'closing_below_opening'));
  assert.ok(validateEntry(baseEntry({ prevClosing: null })).errors.some((e) => e.code === 'opening_required'));
  assert.ok(validateEntry(baseEntry({ closingText: '583.1234' })).errors.some((e) => e.code === 'too_many_decimals'));
});

test('entry validation: discontinuity, jump, duplicate need confirmation', () => {
  const d = validateEntry(baseEntry({ openingText: '10', closingText: '60' }));
  assert.ok(!d.canSave && d.warnings.some((w) => w.code === 'discontinuity'));
  assert.equal(d.storeOpening, 10);
  assert.ok(validateEntry(baseEntry({ openingText: '10', closingText: '60', confirmed: { discontinuity: true, jump: false, overwrite: false } })).canSave);
  const j = validateEntry(baseEntry({ closingText: '5000', recentAvgDaily: 80, recentSamples: 10 }));
  assert.ok(!j.canSave && j.warnings.some((w) => w.code === 'jump'));
  const dup = validateEntry(baseEntry({ existing: { opening: null, closing: 560 } }));
  assert.ok(!dup.canSave && dup.warnings.some((w) => w.code === 'duplicate'));
  assert.ok(validateEntry(baseEntry({ existing: { opening: null, closing: 583 } })).errors.some((e) => e.code === 'duplicate_same'));
});

test('number parsing accepts thousands separators and Arabic-Indic digits', () => {
  assert.equal(parseReading('1,234.5'), 1234.5);
  assert.equal(parseReading('1.234,5'), 1234.5);
  assert.equal(parseReading('12,5'), 12.5);
  assert.equal(parseReading('1,234'), 1234);
  assert.equal(parseReading('١٢٣٫٥'), 123.5);
  assert.equal(parseReading('  '), null);
  assert.ok(Number.isNaN(parseReading('12a')));
});

test('anomaly detection needs enough history and flags outliers', () => {
  const series = Array.from({ length: 30 }, (_, i) => ({ date: addDays('2026-10-01', i), value: 100 + (i % 3) }));
  series.push({ date: addDays('2026-10-01', 30), value: 400 });
  const res = analyzeSeries(series);
  assert.equal(res[0].state, 'insufficient');
  assert.equal(res[res.length - 1].state, 'anomaly');
  assert.equal(res[res.length - 1].direction, 'high');
  assert.equal(res[20].state, 'normal');
  const sparse = analyzeSeries([{ date: '2026-10-01', value: 5 }, { date: '2026-10-02', value: 500 }]);
  assert.ok(sparse.every((p) => p.state === 'insufficient'), 'no alerts from insufficient data');
});

test('KPIs return null instead of inventing values', () => {
  assert.equal(ratio(10, 0), null);
  assert.equal(ratio(null, 5), null);
  assert.equal(ratio(10, 4, 2), 2.5);
  const s = summarizeMetrics([], '2026-10-01', '2026-10-31');
  assert.equal(s.roomsSold, null); assert.equal(s.occupancyAvg, null);
  assert.deepEqual(variance(null, 5), { actual: null, budget: 5, difference: null, percent: null });
  assert.equal(variance(110, 100).percent, 0.1);
});

test('tariffs and costs: N/A until a tariff exists, then date-aware', () => {
  const totals = new Map([['2026-10-02', { date: '2026-10-02', total: 100, counted: 1, expected: 1 }],
                          ['2026-11-02', { date: '2026-11-02', total: 100, counted: 1, expected: 1 }]]);
  assert.equal(costInRange(totals, [], 'energy', '2026-10-01', '2026-12-31').cost, null);
  const tariffs = [{ utility: 'energy' as const, price_per_unit: 0.2, currency: 'SAR', effective_from: '2026-10-01' },
                   { utility: 'energy' as const, price_per_unit: 0.3, currency: 'SAR', effective_from: '2026-11-01' }];
  assert.equal(tariffFor(tariffs, 'energy', '2026-10-31')?.price_per_unit, 0.2);
  assert.equal(costInRange(totals, tariffs, 'energy', '2026-10-01', '2026-12-31').cost, 50);
  assert.equal(costInRange(totals, tariffs.slice(1), 'energy', '2026-10-01', '2026-12-31').daysWithoutTariff, 1);
});

test('budget "actual" block equals the workbook formulas (rooms, occupancy average, guests, utilities)', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/sample-input.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(readFileSync(new URL('./fixtures/sample-expected.json', import.meta.url), 'utf8'));
  const meters: Meter[] = []; const seen = new Set<string>();
  for (const r of input.readings) { const id = `${r.utility}:${r.meter}`; if (!seen.has(id)) { seen.add(id);
    meters.push({ id, code: id, utility: r.utility, area: '', name: r.meter, unit: '', sort_order: 0, include_in_total: true, rollover_at: null, active: true }); } }
  const readings: Reading[] = input.readings.map((r: any) => ({ meter_id: `${r.utility}:${r.meter}`, reading_date: r.date, opening: null, closing: r.value }));
  const totals = dailyTotals(meters, buildMeterDays(meters, readings));
  const metrics: DailyMetric[] = input.metrics.map((m: any) => ({ metric_date: m.date, avg_temp_c: m.avg_temp_c ?? null,
    occupancy_rate: m.occupancy_rate ?? null, occupied_rooms: m.occupied_rooms ?? null, guests: m.guests ?? null }));
  const oct = actualByMonth(2026, totals, metrics)[0];
  const e = expected.budget_actual;
  assert.equal(oct.roomsSold, e.rooms_sold);
  assert.ok(Math.abs(oct.occupancyAvg! - e.occupancy_avg) < 0.0005);
  assert.equal(oct.guests, e.guests);
  assert.ok(Math.abs(oct.gas! - e.gas) < 0.01 && Math.abs(oct.electricity! - e.electricity) < 0.01 && Math.abs(oct.water! - e.water) < 0.01);
  assert.ok(Math.abs(oct.total! - e.total) < 0.02);
  // paired intensity ignores the day without occupancy data
  const map = new Map(metrics.map((m) => [m.metric_date, m]));
  const pi = pairedIntensity(totals.energy, map, 'guests', '2026-10-01', '2026-10-31');
  assert.ok(pi.value !== null && pi.days > 10);
  assert.ok(!map.get('2026-10-05')?.guests, 'test data has no guests on 5 Oct');
});
