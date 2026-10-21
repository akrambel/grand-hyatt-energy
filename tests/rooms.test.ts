import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRoomPeriod, computeRoomDays, groupAverage, parseRoomList, parseStatus, roomDayRows, vacantHigh } from '../src/lib/rooms.ts';
import type { RoomReading } from '../src/lib/rooms.ts';
import { BASE_UNITS, normalizeUnit, parseUnits, priceFromDisplay, priceToDisplay, toDisplay, toNative, unitFactor } from '../src/lib/units.ts';
import { waterSections } from '../src/lib/waterSections.ts';
import { buildMeterDays } from '../src/lib/calc.ts';
import type { Meter, Reading, Tariff } from '../src/lib/types.ts';

test('parseStatus understands common hotel codes and ignores unknown text', () => {
  assert.equal(parseStatus('OCC'), 'occupied');
  assert.equal(parseStatus(' Vacant '), 'vacant');
  assert.equal(parseStatus('OOO'), 'out_of_order');
  assert.equal(parseStatus('out of service'), 'out_of_service');
  assert.equal(parseStatus('House Use'), 'house_use');
  assert.equal(parseStatus(''), null);
  assert.equal(parseStatus('sleeping'), null);
});

test('parseRoomList: lists, ranges, duplicates and invalid entries', () => {
  const r = parseRoomList('1101, 1102\n1103;1101 1110-1113 bad!room 12345678901234');
  assert.deepEqual(r.rooms, ['1101', '1102', '1103', '1110', '1111', '1112', '1113']);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.invalid, ['bad!room', '12345678901234']);
  assert.equal(parseRoomList('1-5000').invalid.length, 1); // absurd range rejected
  assert.deepEqual(parseRoomList('A-12').rooms, ['A-12']);  // hyphenated names stay literal
});

const rr = (room: string, date: string, closing: number | null, status: RoomReading['status']): RoomReading => ({ room, date, opening: null, closing, status });

test('room consumption = closing - previous closing; missing days stay missing', () => {
  const data = [rr('101', '2026-10-01', 500, 'occupied'), rr('101', '2026-10-02', 583, 'occupied'), rr('101', '2026-10-04', 600, 'vacant')];
  const days = computeRoomDays(['101'], data);
  assert.equal(days.get('101|2026-10-02')?.consumption, 83);
  assert.equal(days.get('101|2026-10-01')?.consumption, null);       // first day: no opening
  assert.equal(days.get('101|2026-10-04')?.consumption, null);       // previous day missing: never estimated
});

test('negative differences are flagged and excluded', () => {
  const days = computeRoomDays(['101'], [rr('101', '2026-10-01', 500, 'occupied'), rr('101', '2026-10-02', 400, 'occupied')]);
  assert.equal(days.get('101|2026-10-02')?.status, 'negative');
  assert.equal(days.get('101|2026-10-02')?.consumption, null);
});

test('period analysis splits consumption by occupancy status', () => {
  const data = [
    rr('101', '2026-10-01', 0, 'occupied'), rr('101', '2026-10-02', 10, 'occupied'), rr('101', '2026-10-03', 30, 'occupied'),
    rr('102', '2026-10-01', 0, 'vacant'), rr('102', '2026-10-02', 2, 'vacant'), rr('102', '2026-10-03', 3, 'vacant'),
    rr('103', '2026-10-01', 0, 'out_of_order'), rr('103', '2026-10-02', 1, 'out_of_order'),
  ];
  const days = computeRoomDays(['101', '102', '103'], data);
  const p = analyzeRoomPeriod(data, days, '2026-10-01', '2026-10-03');
  assert.equal(p.total, 10 + 20 + 2 + 1 + 1);
  assert.equal(groupAverage(p.groups.occupied), 15);
  assert.equal(groupAverage(p.groups.vacant), 1.5);
  assert.equal(p.groups.other.count, 1);
  assert.equal(p.byDay[0].total, null);                    // 1 Oct: no opening yet
  assert.equal(p.byDay[1].total, 13);                      // 10 + 2 + 1
  assert.equal(p.perRoom.get('101')?.total, 30);
  assert.equal(analyzeRoomPeriod([], new Map(), '2026-10-01', '2026-10-03').total, null);
});

test('day rows list every room and flag vacant rooms using as much as an occupied room', () => {
  const rooms = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const d1 = rooms.map((r) => rr(r, '2026-10-01', 100, r === '8' ? 'vacant' : 'occupied'));
  const d2 = rooms.map((r) => rr(r, '2026-10-02', r === '8' ? 110 : r === '7' ? 102 : 110, r === '8' ? 'vacant' : r === '7' ? 'vacant' : 'occupied'));
  const days = computeRoomDays(rooms, [...d1, ...d2]);
  const rows = roomDayRows([...rooms, '9'], [...d1, ...d2], days, '2026-10-02');
  assert.equal(rows.length, 9);
  assert.equal(rows.find((r) => r.room === '9')?.state, 'no_reading');
  const v = vacantHigh(rows);
  assert.deepEqual([...v.rooms], ['8']);                    // 10 >= average 10 ; room 7 used only 2
  assert.equal(vacantHigh(rows.slice(0, 4)).rooms.size, 0); // too few occupied rooms: no judgement
});

test('unit conversion: normalisation, factors and round trips', () => {
  assert.equal(normalizeUnit('m3'), 'm³');
  assert.equal(normalizeUnit('Litres'), 'L');
  assert.equal(normalizeUnit('kWh'), 'kWh');
  assert.equal(unitFactor('m³', 'L'), 1000);
  assert.equal(unitFactor('L', 'm³'), 0.001);
  assert.equal(unitFactor('m³', 'm³'), 1);
  assert.equal(unitFactor('kWh', 'L'), 1);                  // never converts non-volume meters
  assert.equal(toDisplay(1.2345, 1000), 1234.5);
  assert.equal(toNative(1234.5, 1000), 1.2345);
  assert.equal(toDisplay(0.1 + 0.2, 1000), 300);            // no floating-point noise
  assert.equal(toDisplay(null, 1000), null);
  assert.deepEqual(parseUnits({ water: 'L', gas: 'bogus' }), { water: 'L', gas: 'L', chilled: 'm³' });
  assert.deepEqual(parseUnits(null), { water: 'm³', gas: 'L', chilled: 'm³' });
});

test('tariffs follow the display unit so costs stay identical', () => {
  const f = unitFactor(BASE_UNITS.water, 'L');              // 1 m³ = 1000 L
  const pricePerL = priceToDisplay(6, f);                   // 6 SAR / m³ = 0.006 SAR / L
  assert.equal(pricePerL, 0.006);
  assert.equal(priceFromDisplay(pricePerL, f), 6);
  assert.equal(83 * 1000 * pricePerL, 83 * 6);              // 83 m³ shown as 83,000 L costs the same
});

const M = (id: string, category: Meter['category'], extra: Partial<Meter> = {}): Meter => ({
  id, code: id, utility: 'water', area: 'A', name: id, unit: 'm³', sort_order: 0, include_in_total: true, rollover_at: null, active: true, category, ...extra,
});
const R = (meter_id: string, reading_date: string, closing: number): Reading => ({ meter_id, reading_date, opening: null, closing });

test('water sections add up to the water total and share the water tariff', () => {
  const meters = [M('p1', 'standard'), M('h1', 'hot_water'), M('i1', 'irrigation'), M('i2', 'irrigation', { include_in_total: false })];
  const readings = [
    R('p1', '2026-10-01', 100), R('p1', '2026-10-02', 160), R('h1', '2026-10-01', 10), R('h1', '2026-10-02', 30),
    R('i1', '2026-10-01', 0), R('i1', '2026-10-02', 10), R('i2', '2026-10-01', 0), R('i2', '2026-10-02', 999),
  ];
  const days = buildMeterDays(meters, readings);
  const tariffs: Tariff[] = [{ utility: 'water', price_per_unit: 5, currency: 'SAR', effective_from: '2026-10-01' }];
  const s = waterSections(meters, days, tariffs, '2026-10-01', '2026-10-02');
  const by = Object.fromEntries(s.map((x) => [x.category, x]));
  assert.equal(by.standard.total, 60);
  assert.equal(by.hot_water.total, 20);
  assert.equal(by.irrigation.total, 10);                    // the meter not counted in the total is ignored
  assert.equal(by.irrigation.meters, 1);
  assert.equal(by.standard.share, 66.7);
  assert.equal(by.hot_water.cost.cost, 100);                // same tariff as potable water
  assert.equal(s.reduce((a, x) => a + (x.total ?? 0), 0), 90);
});

test('a water section without meters shows N/A, never zero', () => {
  const s = waterSections([M('p1', 'standard')], new Map(), [], '2026-10-01', '2026-10-31');
  assert.equal(s.find((x) => x.category === 'hot_water')?.total, null);
  assert.equal(s.find((x) => x.category === 'hot_water')?.meters, 0);
});

import { parseCsv, parseRoomSheet } from '../src/lib/roomImport.ts';

test('room sheet: header detection, status codes, problems reported', () => {
  const known = new Set(['101', '102', '103']);
  const rows = [['Hotel report'], ['Room', 'BTU reading', 'Status'], ['101', '1,234.5', 'OCC'], ['102', '', 'Vacant'], ['103', 'abc', 'OCC'], ['999', '5', 'OCC'], ['101', '9', 'OCC'], ['', '', '']];
  const r = parseRoomSheet(rows, known);
  assert.deepEqual(r.entries, [{ room: '101', closing: 1234.5, status: 'occupied' }, { room: '102', closing: null, status: 'vacant' }]);
  assert.equal(r.problems.length, 3);
});

test('room sheet without header uses columns 1-3; CSV with semicolons and quotes', () => {
  const csv = '101;500;occupied\n102;40;"out of order"\n';
  const r = parseRoomSheet(parseCsv(csv), new Set(['101', '102']));
  assert.deepEqual(r.entries, [{ room: '101', closing: 500, status: 'occupied' }, { room: '102', closing: 40, status: 'out_of_order' }]);
});

test('hotel room list: 430 rooms, matching the room register', async () => {
  const { HOTEL_ROOMS, FLOOR_COUNTS, floorOf, isHotelRoom } = await import('../src/lib/rooms.ts');
  const { ROOM_DETAILS, roomDetail } = await import('../src/lib/roomDetails.ts');
  assert.equal(HOTEL_ROOMS.length, 430);
  assert.deepEqual(FLOOR_COUNTS, { L00: 90, L01: 94, L02: 75, L03: 63, L04: 36, 'Tail L01': 37, 'Tail L02': 25, 'Beach villas': 10 });
  assert.deepEqual([...HOTEL_ROOMS].sort(), ROOM_DETAILS.map((d) => d.room).sort());
  for (const d of ROOM_DETAILS) assert.equal(floorOf(d.room), d.floor, d.room);
  assert.equal(HOTEL_ROOMS[0], '001');
  assert.ok(!HOTEL_ROOMS.includes('053') && !HOTEL_ROOMS.includes('155') && HOTEL_ROOMS.includes('363'));
  assert.equal(floorOf('701'), 'Tail L01'); assert.equal(floorOf('825'), 'Tail L02'); assert.equal(floorOf('905'), 'Beach villas');
  assert.equal(floorOf('055'), 'Other'); assert.equal(floorOf('738'), 'Other');
  assert.ok(isHotelRoom('910') && !isHotelRoom('911') && !isHotelRoom('1'));
  // connecting rooms point at each other
  for (const d of ROOM_DETAILS) if (d.connecting) assert.equal(roomDetail(d.connecting)?.connecting, d.room, d.room);
  assert.equal(ROOM_DETAILS.filter((d) => d.accessible).length, 13);
});

test('parseRoomList keeps leading zeros in ranges', () => {
  assert.deepEqual(parseRoomList('001-003').rooms, ['001', '002', '003']);
  assert.deepEqual(parseRoomList('098-101').rooms, ['098', '099', '100', '101']);
});
