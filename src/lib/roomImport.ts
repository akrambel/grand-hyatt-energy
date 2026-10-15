// Reads a daily room sheet (Excel or CSV rows) into entries: Room | Reading | Status.
import { parseReading } from './validate.ts';
import { parseStatus } from './rooms.ts';
import type { RoomStatus } from './rooms.ts';

export interface RoomSheetEntry { room: string; closing: number | null; status: RoomStatus | null }
export interface RoomSheetResult { entries: RoomSheetEntry[]; problems: string[] }

const ROOM_RE = /^[A-Za-z0-9-]{1,12}$/;
const cell = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * First row with a "room" heading is the header. Without a header: column 1 = room, 2 = reading, 3 = status.
 * Unknown rooms and unreadable numbers are reported as problems; nothing is guessed.
 */
export function parseRoomSheet(rows: unknown[][], knownRooms: Set<string>): RoomSheetResult {
  const problems: string[] = [];
  const entries: RoomSheetEntry[] = [];
  let roomCol = 0, readingCol = 1, statusCol = 2, start = 0;
  const headerAt = rows.findIndex((r) => r.some((c) => /^room/i.test(cell(c))));
  if (headerAt >= 0) {
    const h = rows[headerAt].map((c) => cell(c).toLowerCase());
    roomCol = h.findIndex((x) => /^room/.test(x));
    const rc = h.findIndex((x) => /(closing|reading|meter|btu|value|consumption)/.test(x));
    const sc = h.findIndex((x) => /(status|occupan|state)/.test(x));
    readingCol = rc >= 0 ? rc : -1;
    statusCol = sc >= 0 ? sc : -1;
    start = headerAt + 1;
  }
  const seen = new Set<string>();
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const room = cell(r[roomCol]);
    if (room === '') continue;
    const line = i + 1;
    if (!ROOM_RE.test(room)) { problems.push(`Row ${line}: "${room}" is not a valid room number.`); continue; }
    if (!knownRooms.has(room)) { problems.push(`Row ${line}: room ${room} is not in the room list.`); continue; }
    if (seen.has(room)) { problems.push(`Row ${line}: room ${room} appears twice – the first row is used.`); continue; }
    seen.add(room);
    let closing: number | null = null;
    if (readingCol >= 0 && cell(r[readingCol]) !== '') {
      const n = parseReading(cell(r[readingCol]));
      if (n === null || Number.isNaN(n) || n < 0) { problems.push(`Row ${line}: room ${room} has an unreadable reading "${cell(r[readingCol])}".`); continue; }
      closing = n;
    }
    let status: RoomStatus | null = null;
    if (statusCol >= 0 && cell(r[statusCol]) !== '') {
      status = parseStatus(r[statusCol]);
      if (status === null) problems.push(`Row ${line}: room ${room} has an unknown status "${cell(r[statusCol])}" (status left empty).`);
    }
    if (closing === null && status === null) continue;
    entries.push({ room, closing, status });
  }
  return { entries, problems };
}

/** Splits CSV text (comma, semicolon or tab separated, simple quotes) into rows. */
export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const delim = [',', ';', '\t'].map((d) => [d, lines[0]?.split(d).length ?? 0] as const).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((line) => {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}
