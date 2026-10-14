import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectDailyLayout, parseWorkbook, planExport, sparseReader, SHEET_DAILY } from '../src/lib/workbook.ts';
import type { ExportData, KnownMeter } from '../src/lib/workbook.ts';

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const template = load('template-cells.json');
const sample = load('sample-input.json');
const fresh = () => sparseReader(structuredClone(template));
const PREFIX: any = { energy: 'EN', water: 'WA', gas: 'GA', chilled: 'CW' };

function knownFrom(reader: ReturnType<typeof fresh>): KnownMeter[] {
  const lay = detectDailyLayout(reader, SHEET_DAILY);
  return lay.sections.flatMap((s) => s.meters.map((m, i) => ({ code: `${PREFIX[s.utility]}-${String(i + 1).padStart(2, '0')}`, utility: s.utility, name: m.name })));
}
function fill(reader: ReturnType<typeof fresh>) {
  const lay = detectDailyLayout(reader, SHEET_DAILY);
  const colOf = new Map([...lay.dateCols].map(([c, d]) => [d, c]));
  const rowOf = new Map<string, number>();
  for (const s of lay.sections) for (const m of s.meters) rowOf.set(`${s.utility}|${m.name}`, m.row);
  const cells = reader.cells.get(SHEET_DAILY)!;
  for (const r of sample.readings) cells.set(`${rowOf.get(`${r.utility}|${r.meter}`)},${colOf.get(r.date)}`, r.value);
  for (const m of sample.metrics) {
    const c = colOf.get(m.date)!;
    if (m.avg_temp_c !== undefined) cells.set(`${lay.metricRows.temp},${c}`, m.avg_temp_c);
    if (m.occupancy_rate !== undefined) { cells.set(`${lay.metricRows.occupancy},${c}`, m.occupancy_rate); cells.set(`${lay.metricRows.rooms},${c}`, m.occupied_rooms); cells.set(`${lay.metricRows.guests},${c}`, m.guests); }
  }
}

test('template layout is detected: 4 sections, 84 meters, 365 date columns, metric rows', () => {
  const r = fresh();
  const lay = detectDailyLayout(r, SHEET_DAILY);
  assert.deepEqual(lay.sections.map((s) => [s.utility, s.meters.length]), [['energy', 10], ['water', 10], ['gas', 9], ['chilled', 55]]);
  assert.equal(lay.dateCols.size, 365);
  assert.equal([...lay.dateCols.values()][0], '2026-10-01');
  assert.equal([...lay.dateCols.values()].at(-1), '2027-09-30');
  assert.deepEqual(lay.metricRows, { temp: 110, occupancy: 112, rooms: 113, guests: 114 });
});

test('empty template imports no data and no errors (workbook is not filled yet)', () => {
  const r = fresh();
  const plan = parseWorkbook(r, { knownMeters: knownFrom(r), today: '2026-10-13' });
  assert.equal(plan.readings.length, 0);
  assert.equal(plan.issues.filter((i) => i.level === 'error').length, 0);
  assert.equal(plan.newMeters.length, 0);
  assert.equal(plan.fiscalYear, 2026);
});

test('filled template: readings, metrics and budgets are imported; future dates rejected', () => {
  const r = fresh(); fill(r);
  const lay = detectDailyLayout(r, SHEET_DAILY);
  const planAll = parseWorkbook(r, { knownMeters: knownFrom(r), today: '2026-10-20' });
  assert.equal(planAll.readings.length, sample.readings.length);
  assert.equal(planAll.metrics.length, 20);
  assert.equal(planAll.issues.filter((i) => i.level === 'error').length, 0);
  const plan = parseWorkbook(r, { knownMeters: knownFrom(r), today: '2026-10-13' });
  assert.equal(plan.readings.length, sample.readings.filter((x: any) => x.date <= '2026-10-13').length);
  assert.ok(plan.issues.some((i) => /future/.test(i.message)));
  assert.equal(plan.metrics.length, 13);
  assert.ok(lay.dateCols.size > 0);
});

test('unknown meters are proposed as new meters with fresh codes', () => {
  const r = fresh(); fill(r);
  const known = knownFrom(r).filter((m) => m.code !== 'EN-10');
  const plan = parseWorkbook(r, { knownMeters: known, today: '2026-10-20' });
  assert.equal(plan.newMeters.length, 1);
  assert.equal(plan.newMeters[0].code, 'EN-10');
  assert.equal(plan.newMeters[0].unit, 'kWh');
});

test('bad cells are reported with their address and never imported', () => {
  const r = fresh();
  const lay = detectDailyLayout(r, SHEET_DAILY);
  const cells = r.cells.get(SHEET_DAILY)!;
  const row = lay.sections[0].meters[0].row;
  cells.set(`${row},2`, 100); cells.set(`${row},3`, 'abc'); cells.set(`${row},4`, -5); cells.set(`${row},5`, '1,250.5'); cells.set(`${row},6`, 90);
  cells.set(`${lay.metricRows.occupancy},2`, 85); cells.set(`${lay.metricRows.temp},2`, 120);
  const plan = parseWorkbook(r, { knownMeters: knownFrom(r), today: '2026-12-31' });
  assert.deepEqual(plan.readings.map((x) => x.closing), [100, 1250.5, 90]);
  assert.ok(plan.issues.some((i) => i.level === 'error' && i.cell === 'C7'));
  assert.ok(plan.issues.some((i) => i.level === 'error' && i.cell === 'D7'));
  assert.ok(plan.issues.some((i) => i.level === 'warning' && /lower than the previous day/.test(i.message)));
  assert.equal(plan.metrics[0].occupancy_rate, 0.85, '85 is read as 85 %');
  assert.equal(plan.metrics[0].avg_temp_c, null, '120 °C rejected');
});

test('export plan writes closings into the right cells and round-trips through the importer', () => {
  const r = fresh(); fill(r);
  const known = knownFrom(r);
  const plan = parseWorkbook(r, { knownMeters: known, today: '2026-10-20' });
  const data: ExportData = {
    meters: known.map((k) => ({ utility: k.utility, name: k.name, code: k.code })),
    readings: plan.readings.map((x) => ({ meter_code: x.meter_code, reading_date: x.reading_date, closing: x.closing, opening: null })),
    metrics: plan.metrics, budgets: [], lpg: [{ tank: 1, level_fraction: 0.45 }, { tank: 3, level_fraction: 0.8 }],
  };
  const target = fresh();
  const ex = planExport(target, data);
  assert.equal(ex.warnings.length, 0);
  for (const w of ex.writes) target.cells.get(w.sheet)!.set(`${w.row},${w.col}`, w.value);
  const back = parseWorkbook(target, { knownMeters: known, today: '2026-10-20' });
  const key = (x: any) => `${x.meter_code}|${x.reading_date}|${x.closing}`;
  assert.deepEqual(back.readings.map(key).sort(), plan.readings.map(key).sort());
  assert.deepEqual(back.metrics, plan.metrics);
  assert.deepEqual(back.lpg, [{ tank: 1, level_fraction: 0.45 }, { tank: 3, level_fraction: 0.8 }]);
});

test('export warns about explicit openings and meters missing from the template', () => {
  const r = fresh();
  const ex = planExport(r, { meters: [{ utility: 'energy', name: 'Brand new meter', code: 'EN-99' }, { utility: 'energy', name: 'Main Kitchen', code: 'EN-03' }],
    readings: [{ meter_code: 'EN-99', reading_date: '2026-10-02', closing: 5, opening: null }, { meter_code: 'EN-03', reading_date: '2026-10-02', closing: 7, opening: 3 },
               { meter_code: 'EN-03', reading_date: '2030-01-01', closing: 7, opening: null }], metrics: [], budgets: [], lpg: [] });
  assert.equal(ex.writes.length, 1);
  assert.equal(ex.warnings.length, 3);
});
