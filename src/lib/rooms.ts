// Guest-room chilled water (one BTU meter per room, cumulative reading) combined with the room's
// daily occupancy status. Consumption uses the same rule as every other meter:
//   consumption(day) = reading(day) - reading(day - 1)
// Missing readings stay missing; nothing is estimated.
import { buildMeterDays } from './calc.ts';
import { eachDay } from './dates.ts';
import type { ConsumptionStatus, Meter, MeterDay, Reading } from './types.ts';

export const ROOM_STATUSES = ['occupied', 'vacant', 'out_of_order', 'out_of_service', 'house_use'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  occupied: 'Occupied', vacant: 'Vacant', out_of_order: 'Out of order', out_of_service: 'Out of service', house_use: 'House use',
};

/** One stored row (display units). `status` may be null when only a reading was entered. */
export interface RoomReading {
  room: string;
  date: string;
  opening: number | null;
  closing: number | null;
  status: RoomStatus | null;
  note?: string | null;
}

const STATUS_ALIASES: Record<string, RoomStatus> = {
  occupied: 'occupied', occ: 'occupied', o: 'occupied', 'in house': 'occupied', inhouse: 'occupied', stayover: 'occupied', 'stay over': 'occupied',
  vacant: 'vacant', vac: 'vacant', v: 'vacant', empty: 'vacant', 'vacant clean': 'vacant', 'vacant dirty': 'vacant', vc: 'vacant', vd: 'vacant',
  'out of order': 'out_of_order', ooo: 'out_of_order', out_of_order: 'out_of_order',
  'out of service': 'out_of_service', oos: 'out_of_service', out_of_service: 'out_of_service',
  'house use': 'house_use', hu: 'house_use', house_use: 'house_use', houseuse: 'house_use',
};

/** Reads a status typed or pasted by a user. Returns null for blank or unknown text. */
export function parseStatus(text: unknown): RoomStatus | null {
  const k = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return STATUS_ALIASES[k] ?? null;
}

const ROOM_RE = /^[A-Za-z0-9-]{1,12}$/;
const RANGE_RE = /^(\d{1,6})-(\d{1,6})$/;

export interface RoomListResult { rooms: string[]; invalid: string[]; duplicates: number }

/** Reads a pasted list of room numbers: separated by spaces, commas, semicolons or new lines; "1101-1130" adds a range. */
export function parseRoomList(text: string): RoomListResult {
  const seen = new Set<string>();
  const rooms: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  const add = (r: string) => { if (seen.has(r)) duplicates++; else { seen.add(r); rooms.push(r); } };
  for (const token of text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)) {
    const m = RANGE_RE.exec(token);
    if (m && Number(m[1]) < Number(m[2])) {
      const a = Number(m[1]), b = Number(m[2]);
      if (b - a > 1000) { invalid.push(token); continue; }
      for (let n = a; n <= b; n++) add(String(n));
      continue;
    }
    if (ROOM_RE.test(token)) add(token); else invalid.push(token);
  }
  return { rooms, invalid, duplicates };
}

export const compareRooms = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

export interface RoomDayRow {
  room: string;
  date: string;
  status: RoomStatus | null;
  opening: number | null;
  closing: number | null;
  consumption: number | null;
  /** 'no_reading' = no row stored for that room and day. */
  state: ConsumptionStatus | 'no_reading';
}

const roomMeter = (room: string): Meter => ({
  id: room, code: room, utility: 'chilled', area: 'Guest rooms', name: room, unit: '', sort_order: 0,
  include_in_total: false, rollover_at: null, active: true,
});

/** Computes the consumption of every stored room reading. */
export function computeRoomDays(rooms: string[], readings: RoomReading[]): Map<string, MeterDay> {
  const asReadings: Reading[] = readings.map((r) => ({ meter_id: r.room, reading_date: r.date, opening: r.opening, closing: r.closing }));
  return buildMeterDays(rooms.map(roomMeter), asReadings);
}

export const roomKey = (room: string, date: string): string => `${room}|${date}`;

/** One row per room for a single day (rooms without a stored row are listed as "no reading"). */
export function roomDayRows(rooms: string[], readings: RoomReading[], days: Map<string, MeterDay>, date: string): RoomDayRow[] {
  const byRoom = new Map(readings.filter((r) => r.date === date).map((r) => [r.room, r]));
  return rooms.map((room) => {
    const r = byRoom.get(room);
    const d = days.get(roomKey(room, date));
    return {
      room, date, status: r?.status ?? null, opening: d?.opening ?? r?.opening ?? null, closing: r?.closing ?? null,
      consumption: d?.consumption ?? null, state: r ? (d?.status ?? 'missing_closing') : 'no_reading',
    };
  });
}

export type StatusGroup = 'occupied' | 'vacant' | 'other' | 'unknown';
export const statusGroup = (s: RoomStatus | null): StatusGroup =>
  s === 'occupied' ? 'occupied' : s === 'vacant' ? 'vacant' : s === null ? 'unknown' : 'other';

export interface Bucket { sum: number; count: number }
export interface RoomPeriod {
  /** Daily totals split by occupancy group. */
  byDay: Array<{ date: string; total: number | null; occupied: number | null; vacant: number | null; other: number | null; unknown: number | null; roomsWithData: number }>;
  /** Totals over the whole period per group (sum of consumption and number of room-days). */
  groups: Record<StatusGroup, Bucket>;
  perRoom: Map<string, { total: number; days: number; occupiedDays: number }>;
  total: number | null;
}

export function analyzeRoomPeriod(readings: RoomReading[], days: Map<string, MeterDay>, start: string, end: string): RoomPeriod {
  const groups: Record<StatusGroup, Bucket> = { occupied: { sum: 0, count: 0 }, vacant: { sum: 0, count: 0 }, other: { sum: 0, count: 0 }, unknown: { sum: 0, count: 0 } };
  const perDay = new Map<string, Record<StatusGroup, Bucket> & { rooms: number }>();
  const perRoom = new Map<string, { total: number; days: number; occupiedDays: number }>();
  let total = 0, any = false;
  for (const r of readings) {
    if (r.date < start || r.date > end) continue;
    const c = days.get(roomKey(r.room, r.date))?.consumption ?? null;
    if (c === null) continue;
    const g = statusGroup(r.status);
    groups[g].sum += c; groups[g].count++;
    const d = perDay.get(r.date) ?? { occupied: { sum: 0, count: 0 }, vacant: { sum: 0, count: 0 }, other: { sum: 0, count: 0 }, unknown: { sum: 0, count: 0 }, rooms: 0 };
    d[g].sum += c; d[g].count++; d.rooms++;
    perDay.set(r.date, d);
    const p = perRoom.get(r.room) ?? { total: 0, days: 0, occupiedDays: 0 };
    p.total += c; p.days++; if (g === 'occupied') p.occupiedDays++;
    perRoom.set(r.room, p);
    total += c; any = true;
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const val = (b: Bucket) => (b.count ? r3(b.sum) : null);
  const byDay = eachDay(start, end).map((date) => {
    const d = perDay.get(date);
    return d
      ? { date, total: r3(d.occupied.sum + d.vacant.sum + d.other.sum + d.unknown.sum), occupied: val(d.occupied), vacant: val(d.vacant), other: val(d.other), unknown: val(d.unknown), roomsWithData: d.rooms }
      : { date, total: null, occupied: null, vacant: null, other: null, unknown: null, roomsWithData: 0 };
  });
  return { byDay, groups, perRoom, total: any ? r3(total) : null };
}

/** Average consumption per room-day of a group, null without data. */
export const groupAverage = (b: Bucket): number | null => (b.count ? Math.round((b.sum / b.count) * 1000) / 1000 : null);

/**
 * Vacant rooms that used as much cooling as the average occupied room on the same day.
 * Needs at least `minOccupied` occupied rooms with a valid consumption; otherwise nothing is flagged.
 */
export function vacantHigh(rows: RoomDayRow[], minOccupied = 5): { rooms: Set<string>; occupiedAverage: number | null } {
  const occ = rows.filter((r) => r.status === 'occupied' && r.consumption !== null).map((r) => r.consumption as number);
  if (occ.length < minOccupied) return { rooms: new Set(), occupiedAverage: null };
  const avg = occ.reduce((a, b) => a + b, 0) / occ.length;
  if (!(avg > 0)) return { rooms: new Set(), occupiedAverage: avg };
  const rooms = new Set(rows.filter((r) => r.status === 'vacant' && r.consumption !== null && (r.consumption as number) >= avg).map((r) => r.room));
  return { rooms, occupiedAverage: Math.round(avg * 1000) / 1000 };
}
