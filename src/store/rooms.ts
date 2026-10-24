// Guest-room data access. Rooms and their daily readings are kept apart from the main store because
// 430 rooms × 365 days would make every other page slow; they are loaded only for the period shown.
import { supabase, fetchAll, friendlyError } from '../lib/supabase.ts';
import { addDays } from '../lib/dates.ts';
import { ROOM_STATUSES } from '../lib/rooms.ts';
import type { RoomReading, RoomStatus } from '../lib/rooms.ts';
import { toDisplay, toNative, unitFactor } from '../lib/units.ts';
import type { Settings } from '../lib/settings.ts';
import { getSampleContext, useData } from './data.ts';
import { HOTEL_ROOMS } from '../lib/rooms.ts';
import { SAMPLE_BLOCKED, isSampleMode, sampleRoomReadings } from '../lib/sampleData.ts';
import { localToday } from '../lib/dates.ts';

/** Unit shown for the room meters and the factor from the stored unit (displayValue = stored × factor). */
export function roomUnitInfo(settings: Settings): { unit: string; factor: number } {
  const native = settings.roomMeterUnit;
  const factor = unitFactor(native, settings.units.chilled);
  return { unit: native === 'm³' || native === 'L' ? settings.units.chilled : native, factor };
}

export async function fetchRooms(): Promise<string[]> {
  const rows = await fetchAll<{ room_number: string }>((a, b) => supabase.from('rooms').select('room_number').eq('active', true).order('sort_order').order('room_number').range(a, b));
  return rows.map((r) => r.room_number);
}

/** Readings from the day BEFORE `start` (needed as the opening of the first day) up to `end`. */
export async function fetchRoomReadings(start: string, end: string, factor: number): Promise<RoomReading[]> {
  const sample = getSampleContext();
  if (sample) {
    const today = localToday(useData.getState().settings.timezone);
    return sampleRoomReadings(HOTEL_ROOMS, start, end < today ? end : today, factor, sample.metricOf);
  }
  const rows = await fetchAll<Record<string, unknown>>((a, b) => supabase.from('room_readings')
    .select('room_number, reading_date, opening, closing, status, note')
    .gte('reading_date', addDays(start, -1)).lte('reading_date', end).order('reading_date').order('room_number').range(a, b));
  return rows.map((r) => ({
    room: r.room_number as string, date: r.reading_date as string,
    opening: r.opening === null ? null : toDisplay(Number(r.opening), factor),
    closing: r.closing === null ? null : toDisplay(Number(r.closing), factor),
    status: (ROOM_STATUSES as readonly string[]).includes(r.status as string) ? (r.status as RoomStatus) : null,
    note: (r.note as string | null) ?? null,
  }));
}

export interface RoomDayInput { room: string; closing: number | null; status: RoomStatus | null }

/** Saves one day for many rooms. `closing` is typed in the display unit and stored in the meter's own unit. */
export async function saveRoomDay(date: string, rows: RoomDayInput[], factor: number): Promise<number> {
  if (isSampleMode()) throw new Error(SAMPLE_BLOCKED);
  const payload = rows.filter((r) => r.closing !== null || r.status !== null).map((r) => ({
    room_number: r.room, reading_date: date, closing: r.closing === null ? null : toNative(r.closing, factor), status: r.status,
  }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from('room_readings').upsert(payload.slice(i, i + 200), { onConflict: 'room_number,reading_date' });
    if (error) throw new Error(friendlyError(error));
  }
  return payload.length;
}

export async function addRooms(rooms: string[]): Promise<void> {
  const { data: last } = await supabase.from('rooms').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  const base = ((last as Array<{ sort_order: number }> | null)?.[0]?.sort_order ?? 0) + 1;
  for (let i = 0; i < rooms.length; i += 200) {
    const chunk = rooms.slice(i, i + 200).map((room_number, j) => ({ room_number, sort_order: base + i + j }));
    const { error } = await supabase.from('rooms').upsert(chunk, { onConflict: 'room_number', ignoreDuplicates: true });
    if (error) throw new Error(friendlyError(error));
    // a room hidden earlier comes back when its number is added again
    const back = await supabase.from('rooms').update({ active: true }).in('room_number', rooms.slice(i, i + 200)).eq('active', false);
    if (back.error) throw new Error(friendlyError(back.error));
  }
}

/** Hides rooms from every page without deleting them or their readings (rooms.active = false). */
export async function hideRooms(rooms: string[]): Promise<void> {
  for (let i = 0; i < rooms.length; i += 200) {
    const { error } = await supabase.from('rooms').update({ active: false }).in('room_number', rooms.slice(i, i + 200));
    if (error) throw new Error(friendlyError(error));
  }
}

export async function deleteRoom(room: string): Promise<void> {
  const { error } = await supabase.from('rooms').delete().eq('room_number', room);
  if (error) throw new Error(friendlyError(error));
}
