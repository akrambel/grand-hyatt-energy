// Reads / writes the layout of Main_Consumption_Opening_Closing.xlsx WITHOUT depending on a
// spreadsheet library: everything works on a small `CellReader` interface. The ExcelJS
// adapter lives in src/lib/excelAdapter.ts; tests use a reader built from a JSON fixture.
//
// Layout understood (detected from labels, so inserted rows / changed fiscal years still work):
//   "Daily Consumption"        sections ENERGY / WATER / GAS / CHILLED WATER: header row
//                              ("Meter / Area" + one date per column), one row per meter,
//                              then "<UTILITY> DAILY CONSUMPTION" total row (formulas, ignored).
//                              Rows "Average Daily Temperature", "Occupancy Rate",
//                              "Occupied Rooms", "Hotel Nights / Guests" share the date columns.
//   "Utility Budget & Actual"  budget block + "PREVIOUS PERIOD REFERENCE" block (inputs);
//                              the ACTUAL block is formulas and is recomputed by the app.
//   "LPG Dashboard"            "REAL-TIME LEVEL" (fraction 0..1) for tanks 1-3 in columns B, F, J.

import { dateToISOUTC, excelSerialToISO, isISODate } from './dates.ts';
import { parseReading } from './validate.ts';
import type { Utility } from './types.ts';

export type CellValue = number | string | boolean | Date | null;

export interface CellReader {
  sheetNames(): string[];
  get(sheet: string, row: number, col: number): CellValue;
  maxRow(sheet: string): number;
  maxCol(sheet: string): number;
}

export interface CellWrite { sheet: string; row: number; col: number; value: number | string | null }

export interface ImportIssue {
  level: 'error' | 'warning' | 'info';
  sheet: string;
  cell?: string;
  message: string;
}

export interface KnownMeter { code: string; utility: Utility; name: string }

export interface ImportReading { meter_code: string; reading_date: string; closing: number; opening: null }
export interface ImportMetric {
  metric_date: string; avg_temp_c: number | null; occupancy_rate: number | null;
  occupied_rooms: number | null; guests: number | null;
}
export interface ImportBudget {
  fiscal_year: number; month: number; kind: 'budget' | 'previous';
  rooms_sold: number | null; occupancy_rate: number | null; guests: number | null;
  gas: number | null; electricity: number | null; water: number | null;
}
export interface ImportLpg { tank: number; level_fraction: number }
export interface ImportMeter { code: string; utility: Utility; area: string; name: string; unit: string; sort_order: number }

export interface ImportPlan {
  readings: ImportReading[];
  metrics: ImportMetric[];
  budgets: ImportBudget[];
  lpg: ImportLpg[];
  newMeters: ImportMeter[];
  issues: ImportIssue[];
  dateRange: { start: string; end: string } | null;
  fiscalYear: number | null;
  sheetsFound: string[];
}

export const SHEET_DAILY = 'Daily Consumption';
export const SHEET_BUDGET = 'Utility Budget & Actual';
export const SHEET_LPG = 'LPG Dashboard';

const UNITS: Record<Utility, string> = { energy: 'kWh', water: 'm³', gas: 'L', chilled: 'm³' };
const PREFIX: Record<Utility, string> = { energy: 'EN', water: 'WA', gas: 'GA', chilled: 'CW' };

export function colLetter(col: number): string {
  let s = '';
  for (let c = col; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}
export const cellAddress = (row: number, col: number): string => `${colLetter(col)}${row}`;

export const norm = (s: unknown): string => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function findSheet(reader: CellReader, wanted: string): string | null {
  const w = norm(wanted);
  return reader.sheetNames().find((n) => norm(n) === w) ?? null;
}

function asText(v: CellValue): string { return v === null ? '' : v instanceof Date ? '' : String(v).trim(); }

function asISODate(v: CellValue): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dateToISOUTC(v);
  if (typeof v === 'number' && v > 30000 && v < 80000) return excelSerialToISO(v);
  if (typeof v === 'string' && isISODate(v.trim())) return v.trim();
  return null;
}

/** Reads a numeric input cell. Returns {value} | {blank} | {invalid}. */
function readNumber(v: CellValue): { kind: 'blank' } | { kind: 'ok'; value: number } | { kind: 'invalid'; raw: string } {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { kind: 'blank' };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'ok', value: v } : { kind: 'invalid', raw: String(v) };
  if (typeof v === 'string') {
    const p = parseReading(v);
    if (p === null) return { kind: 'blank' };
    return Number.isNaN(p) ? { kind: 'invalid', raw: v } : { kind: 'ok', value: p };
  }
  return { kind: 'invalid', raw: String(v) };
}

// -------------------------------------------------------------- structure ----

export interface DailySection {
  utility: Utility;
  headerRow: number;
  firstMeterRow: number;
  lastMeterRow: number;
  meters: Array<{ row: number; name: string }>;
}

export interface DailyLayout {
  sheet: string;
  sections: DailySection[];
  /** column -> ISO date (from the first section header) */
  dateCols: Map<number, string>;
  metricRows: { temp?: number; occupancy?: number; rooms?: number; guests?: number };
}

const SECTION_TITLES: Array<[Utility, RegExp]> = [
  ['energy', /^energy\b.*meter readings/i],
  ['water', /^water\b.*meter readings/i],
  ['gas', /^gas\b.*meter readings/i],
  ['chilled', /^chilled\b.*meter readings/i],
];

export function detectDailyLayout(reader: CellReader, sheet: string): DailyLayout {
  const maxRow = reader.maxRow(sheet);
  const sections: DailySection[] = [];
  const metricRows: DailyLayout['metricRows'] = {};
  for (let r = 1; r <= maxRow; r++) {
    const a = asText(reader.get(sheet, r, 1));
    if (!a) continue;
    const hit = SECTION_TITLES.find(([, re]) => re.test(a));
    if (hit) {
      let header = -1;
      for (let k = r + 1; k <= Math.min(r + 5, maxRow); k++) {
        if (norm(reader.get(sheet, k, 1)) === 'meter / area') { header = k; break; }
      }
      if (header < 0) continue;
      const meters: Array<{ row: number; name: string }> = [];
      let last = header;
      for (let k = header + 1; k <= maxRow; k++) {
        const name = asText(reader.get(sheet, k, 1));
        if (!name || /daily consumption/i.test(name)) break;
        meters.push({ row: k, name });
        last = k;
      }
      sections.push({ utility: hit[0], headerRow: header, firstMeterRow: header + 1, lastMeterRow: last, meters });
      continue;
    }
    if (/^average daily temperature/i.test(a)) metricRows.temp = r;
    else if (/^occupancy rate/i.test(a)) metricRows.occupancy = r;
    else if (/^occupied rooms/i.test(a)) metricRows.rooms = r;
    else if (/^hotel nights|^guests/i.test(a)) metricRows.guests = r;
  }
  const dateCols = new Map<number, string>();
  const first = sections[0];
  if (first) {
    const maxCol = reader.maxCol(sheet);
    for (let c = 2; c <= maxCol; c++) {
      const v = reader.get(sheet, first.headerRow, c);
      if (typeof v === 'string' && /annual total/i.test(v)) break;
      const iso = asISODate(v);
      if (iso) dateCols.set(c, iso);
    }
  }
  return { sheet, sections, dateCols, metricRows };
}

// ----------------------------------------------------------------- import ----

export interface ParseOptions {
  knownMeters: KnownMeter[];
  today: string; // local today, readings after this date are rejected
}

export function parseWorkbook(reader: CellReader, opts: ParseOptions): ImportPlan {
  const plan: ImportPlan = {
    readings: [], metrics: [], budgets: [], lpg: [], newMeters: [], issues: [],
    dateRange: null, fiscalYear: null, sheetsFound: [],
  };
  const issue = (level: ImportIssue['level'], sheet: string, message: string, cell?: string) =>
    plan.issues.push({ level, sheet, message, cell });

  const daily = findSheet(reader, SHEET_DAILY);
  if (!daily) {
    issue('error', SHEET_DAILY, `The sheet "${SHEET_DAILY}" was not found – this does not look like the consumption workbook.`);
  } else {
    plan.sheetsFound.push(daily);
    parseDaily(reader, daily, opts, plan, issue);
  }
  const budget = findSheet(reader, SHEET_BUDGET);
  if (budget) { plan.sheetsFound.push(budget); parseBudget(reader, budget, plan, issue); }
  const lpg = findSheet(reader, SHEET_LPG);
  if (lpg) { plan.sheetsFound.push(lpg); parseLpg(reader, lpg, plan, issue); }
  return plan;
}

type IssueFn = (level: ImportIssue['level'], sheet: string, message: string, cell?: string) => void;

function parseDaily(reader: CellReader, sheet: string, opts: ParseOptions, plan: ImportPlan, issue: IssueFn) {
  const layout = detectDailyLayout(reader, sheet);
  if (layout.sections.length === 0) { issue('error', sheet, 'No meter-reading sections were found.'); return; }
  if (layout.dateCols.size === 0) { issue('error', sheet, 'No dates were found in the header row of the first section.'); return; }

  const dates = [...layout.dateCols.values()].sort();
  plan.dateRange = { start: dates[0], end: dates[dates.length - 1] };
  const sortedCols = [...layout.dateCols.keys()].sort((a, b) => a - b);

  const byKey = new Map(opts.knownMeters.map((m) => [`${m.utility}|${norm(m.name)}`, m.code]));
  const nextIndex: Record<Utility, number> = { energy: 0, water: 0, gas: 0, chilled: 0 };
  for (const m of opts.knownMeters) {
    const n = Number(m.code.split('-')[1]);
    if (Number.isFinite(n)) nextIndex[m.utility] = Math.max(nextIndex[m.utility], n);
  }

  let futureSkipped = 0;
  for (const sec of layout.sections) {
    let order = 0;
    for (const mt of sec.meters) {
      order++;
      const key = `${sec.utility}|${norm(mt.name)}`;
      let code = byKey.get(key);
      if (!code) {
        nextIndex[sec.utility]++;
        code = `${PREFIX[sec.utility]}-${String(nextIndex[sec.utility]).padStart(2, '0')}`;
        byKey.set(key, code);
        plan.newMeters.push({
          code, utility: sec.utility, area: mt.name.replace(/\s*\([\d.]+\s*kw\)\s*$/i, '').trim(), name: mt.name,
          unit: UNITS[sec.utility], sort_order: order,
        });
        issue('info', sheet, `New meter "${mt.name}" (${sec.utility}) will be created as ${code}.`, cellAddress(mt.row, 1));
      }
      let prev: { date: string; value: number } | null = null;
      for (const col of sortedCols) {
        const date = layout.dateCols.get(col)!;
        const cell = readNumber(reader.get(sheet, mt.row, col));
        if (cell.kind === 'blank') { prev = null; continue; }
        const addr = cellAddress(mt.row, col);
        if (cell.kind === 'invalid') { issue('error', sheet, `"${cell.raw}" is not a valid reading (${mt.name}, ${date}) – skipped.`, addr); prev = null; continue; }
        if (cell.value < 0) { issue('error', sheet, `Negative reading ${cell.value} (${mt.name}, ${date}) – skipped.`, addr); prev = null; continue; }
        if (date > opts.today) { futureSkipped++; continue; }
        const value = Math.round(cell.value * 1000) / 1000;
        if (prev && value < prev.value) {
          issue('warning', sheet, `Reading ${value} is lower than the previous day (${prev.value}) for ${mt.name} on ${date}. Imported, but it will be flagged as invalid consumption.`, addr);
        }
        plan.readings.push({ meter_code: code, reading_date: date, closing: value, opening: null });
        prev = { date, value };
      }
    }
  }
  if (futureSkipped > 0) issue('warning', sheet, `${futureSkipped} reading(s) dated in the future were skipped.`);

  // climate / occupancy rows
  const rows = layout.metricRows;
  for (const col of sortedCols) {
    const date = layout.dateCols.get(col)!;
    if (date > opts.today) continue;
    const m: ImportMetric = { metric_date: date, avg_temp_c: null, occupancy_rate: null, occupied_rooms: null, guests: null };
    const grab = (row: number | undefined, label: string, lo: number, hi: number): number | null => {
      if (!row) return null;
      const c = readNumber(reader.get(sheet, row, col));
      if (c.kind === 'blank') return null;
      if (c.kind === 'invalid') { issue('error', sheet, `"${c.raw}" is not valid for ${label} on ${date} – skipped.`, cellAddress(row, col)); return null; }
      if (c.value < lo || c.value > hi) { issue('error', sheet, `${label} ${c.value} on ${date} is outside ${lo}..${hi} – skipped.`, cellAddress(row, col)); return null; }
      return c.value;
    };
    m.avg_temp_c = grab(rows.temp, 'temperature', -30, 70);
    let occ = rows.occupancy ? (() => {
      const c = readNumber(reader.get(sheet, rows.occupancy!, col));
      if (c.kind !== 'ok') return c.kind === 'invalid' ? (issue('error', sheet, `"${c.raw}" is not a valid occupancy rate on ${date} – skipped.`, cellAddress(rows.occupancy!, col)), null) : null;
      if (c.value > 1 && c.value <= 100) {
        issue('warning', sheet, `Occupancy ${c.value} on ${date} looks like a percentage; interpreted as ${c.value}%.`, cellAddress(rows.occupancy!, col));
        return c.value / 100;
      }
      if (c.value < 0 || c.value > 1) { issue('error', sheet, `Occupancy ${c.value} on ${date} is outside 0..1 – skipped.`, cellAddress(rows.occupancy!, col)); return null; }
      return c.value;
    })() : null;
    m.occupancy_rate = occ;
    const rooms = grab(rows.rooms, 'occupied rooms', 0, 100000);
    const guests = grab(rows.guests, 'hotel nights / guests', 0, 1000000);
    m.occupied_rooms = rooms === null ? null : Math.round(rooms);
    m.guests = guests === null ? null : Math.round(guests);
    if (m.avg_temp_c !== null || m.occupancy_rate !== null || m.occupied_rooms !== null || m.guests !== null) plan.metrics.push(m);
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (v: CellValue): number | null => {
  const t = norm(v).slice(0, 3);
  const i = MONTHS.indexOf(t);
  return i >= 0 && norm(v).length >= 3 ? i + 1 : null;
};

function parseBudget(reader: CellReader, sheet: string, plan: ImportPlan, issue: IssueFn) {
  const maxRow = reader.maxRow(sheet);
  let fy: number | null = null;
  for (let r = 1; r <= maxRow && fy === null; r++) {
    for (let c = 1; c <= 3; c++) {
      const m = /utility budget\s+(\d{4})\s*-\s*\d{2,4}/i.exec(asText(reader.get(sheet, r, c)));
      if (m) { fy = +m[1]; break; }
    }
  }
  if (fy === null) { issue('warning', sheet, 'Could not read the fiscal year from the budget title (e.g. "UTILITY BUDGET 2026-27") – budget import skipped.'); return; }
  plan.fiscalYear = fy;

  // header rows: column B holds the first month name
  const headers: Array<{ row: number; kind: 'budget' | 'actual' | 'previous' }> = [];
  type BlockKind = 'budget' | 'actual' | 'previous';
  let title = 'budget' as BlockKind;
  for (let r = 1; r <= maxRow; r++) {
    const b = asText(reader.get(sheet, r, 2));
    if (/previous period/i.test(b)) title = 'previous';
    else if (/^actual/i.test(b)) title = 'actual';
    else if (/utility budget/i.test(b)) title = 'budget';
    if (monthOf(reader.get(sheet, r, 2)) !== null && monthOf(reader.get(sheet, r, 3)) !== null) headers.push({ row: r, kind: title });
  }
  const labels: Record<string, keyof ImportBudget> = {
    'rooms sold': 'rooms_sold', 'occupancy rate': 'occupancy_rate', 'guests': 'guests',
    'gas': 'gas', 'electricity': 'electricity', 'water': 'water',
  };
  for (let h = 0; h < headers.length; h++) {
    const { row, kind } = headers[h];
    if (kind === 'actual') continue; // formulas – recomputed by the app
    const end = h + 1 < headers.length ? headers[h + 1].row - 1 : maxRow;
    const byMonth = new Map<number, ImportBudget>();
    for (let c = 2; c <= 13; c++) {
      const mo = monthOf(reader.get(sheet, row, c));
      if (mo === null) continue;
      byMonth.set(c, { fiscal_year: fy, month: mo, kind, rooms_sold: null, occupancy_rate: null, guests: null, gas: null, electricity: null, water: null });
    }
    for (let r = row + 1; r <= end; r++) {
      const field = labels[norm(reader.get(sheet, r, 1))];
      if (!field) continue;
      for (const [c, rec] of byMonth) {
        const n = readNumber(reader.get(sheet, r, c));
        if (n.kind === 'invalid') { issue('error', sheet, `"${n.raw}" is not a valid number – skipped.`, cellAddress(r, c)); continue; }
        if (n.kind === 'blank') continue;
        let v = n.value;
        if (field === 'occupancy_rate' && v > 1 && v <= 100) v /= 100;
        if (v < 0 || (field === 'occupancy_rate' && v > 1)) { issue('error', sheet, `Value ${n.value} is out of range – skipped.`, cellAddress(r, c)); continue; }
        (rec as unknown as Record<string, number | null>)[field] = v;
      }
    }
    for (const rec of byMonth.values()) {
      if (rec.rooms_sold !== null || rec.occupancy_rate !== null || rec.guests !== null || rec.gas !== null || rec.electricity !== null || rec.water !== null) plan.budgets.push(rec);
    }
  }
}

function parseLpg(reader: CellReader, sheet: string, plan: ImportPlan, issue: IssueFn) {
  const maxRow = reader.maxRow(sheet);
  for (let r = 1; r <= maxRow; r++) {
    if (norm(reader.get(sheet, r, 1)) !== 'real-time level') continue;
    [2, 6, 10].forEach((col, i) => {
      const n = readNumber(reader.get(sheet, r, col));
      if (n.kind !== 'ok') return;
      let v = n.value;
      if (v > 1 && v <= 100) v /= 100;
      if (v < 0 || v > 1) { issue('error', sheet, `Tank ${i + 1} level ${n.value} is outside 0..100 % – skipped.`, cellAddress(r, col)); return; }
      if (v === 0) { issue('info', sheet, `Tank ${i + 1} level is 0 – treated as "not entered" and not imported.`, cellAddress(r, col)); return; }
      plan.lpg.push({ tank: i + 1, level_fraction: v });
    });
    break;
  }
}

// ----------------------------------------------------------------- export ----

export interface ExportData {
  meters: Array<{ utility: Utility; name: string; code: string }>;
  readings: Array<{ meter_code: string; reading_date: string; closing: number | null; opening: number | null }>;
  metrics: ImportMetric[];
  budgets: ImportBudget[];
  lpg: ImportLpg[]; // latest level per tank
}

export interface ExportPlan { writes: CellWrite[]; warnings: string[] }

/** Computes the cell writes that put the application's data back into the workbook layout. */
export function planExport(reader: CellReader, data: ExportData): ExportPlan {
  const writes: CellWrite[] = [];
  const warnings: string[] = [];
  const daily = findSheet(reader, SHEET_DAILY);
  if (!daily) return { writes, warnings: [`Template has no "${SHEET_DAILY}" sheet.`] };
  const layout = detectDailyLayout(reader, daily);
  const colByDate = new Map([...layout.dateCols].map(([c, d]) => [d, c]));

  const meterByCode = new Map(data.meters.map((m) => [m.code, m]));
  const rowByMeter = new Map<string, number>();
  for (const sec of layout.sections) for (const m of sec.meters) rowByMeter.set(`${sec.utility}|${norm(m.name)}`, m.row);

  let outside = 0, unmatched = new Set<string>(), skippedOpening = 0;
  for (const r of data.readings) {
    const meter = meterByCode.get(r.meter_code);
    if (!meter) continue;
    const row = rowByMeter.get(`${meter.utility}|${norm(meter.name)}`);
    if (!row) { unmatched.add(meter.name); continue; }
    const col = colByDate.get(r.reading_date);
    if (!col) { outside++; continue; }
    if (r.closing === null) continue;
    writes.push({ sheet: daily, row, col, value: r.closing });
    if (r.opening !== null) skippedOpening++;
  }
  if (outside) warnings.push(`${outside} reading(s) are outside the dates of the template and were not exported.`);
  if (unmatched.size) warnings.push(`Meters not present in the template were not exported: ${[...unmatched].join(', ')}.`);
  if (skippedOpening) warnings.push(`${skippedOpening} reading(s) have an explicit opening value (meter replacement / first day). The workbook layout only stores closing readings, so those opening values are not exported.`);

  const rows = layout.metricRows;
  for (const m of data.metrics) {
    const col = colByDate.get(m.metric_date);
    if (!col) continue;
    if (rows.temp && m.avg_temp_c !== null) writes.push({ sheet: daily, row: rows.temp, col, value: m.avg_temp_c });
    if (rows.occupancy && m.occupancy_rate !== null) writes.push({ sheet: daily, row: rows.occupancy, col, value: m.occupancy_rate });
    if (rows.rooms && m.occupied_rooms !== null) writes.push({ sheet: daily, row: rows.rooms, col, value: m.occupied_rooms });
    if (rows.guests && m.guests !== null) writes.push({ sheet: daily, row: rows.guests, col, value: m.guests });
  }

  const budget = findSheet(reader, SHEET_BUDGET);
  if (budget && data.budgets.length) {
    const maxRow = reader.maxRow(budget);
    type BlockKind = 'budget' | 'actual' | 'previous';
    let title = 'budget' as BlockKind;
    const headers: Array<{ row: number; kind: BlockKind }> = [];
    for (let r = 1; r <= maxRow; r++) {
      const b = asText(reader.get(budget, r, 2));
      if (/previous period/i.test(b)) title = 'previous';
      else if (/^actual/i.test(b)) title = 'actual';
      else if (/utility budget/i.test(b)) title = 'budget';
      if (monthOf(reader.get(budget, r, 2)) !== null && monthOf(reader.get(budget, r, 3)) !== null) headers.push({ row: r, kind: title });
    }
    const fieldByLabel: Record<string, keyof ImportBudget> = {
      'rooms sold': 'rooms_sold', 'occupancy rate': 'occupancy_rate', 'guests': 'guests', 'gas': 'gas', 'electricity': 'electricity', 'water': 'water' };
    headers.forEach((h, i) => {
      if (h.kind === 'actual') return;
      const end = i + 1 < headers.length ? headers[i + 1].row - 1 : maxRow;
      for (let c = 2; c <= 13; c++) {
        const mo = monthOf(reader.get(budget, h.row, c));
        if (mo === null) continue;
        const rec = data.budgets.find((b) => b.kind === h.kind && b.month === mo);
        if (!rec) continue;
        for (let r = h.row + 1; r <= end; r++) {
          const f = fieldByLabel[norm(reader.get(budget, r, 1))];
          const v = f ? (rec[f] as number | null) : null;
          if (f && v !== null) writes.push({ sheet: budget, row: r, col: c, value: v });
        }
      }
    });
  }

  const lpg = findSheet(reader, SHEET_LPG);
  if (lpg && data.lpg.length) {
    const maxRow = reader.maxRow(lpg);
    for (let r = 1; r <= maxRow; r++) {
      if (norm(reader.get(lpg, r, 1)) !== 'real-time level') continue;
      for (const t of data.lpg) writes.push({ sheet: lpg, row: r, col: [2, 6, 10][t.tank - 1], value: t.level_fraction });
      break;
    }
  }
  return { writes, warnings };
}

/** In-memory reader built from the JSON fixture (or any sparse cell map). */
export function sparseReader(sheets: Record<string, Record<string, unknown>>): CellReader & { cells: Map<string, Map<string, CellValue>> } {
  const cells = new Map<string, Map<string, CellValue>>();
  const dims = new Map<string, { r: number; c: number }>();
  for (const [name, m] of Object.entries(sheets)) {
    const sm = new Map<string, CellValue>();
    let mr = 0, mc = 0;
    for (const [k, raw] of Object.entries(m)) {
      const [r, c] = k.split(',').map(Number);
      const v = raw && typeof raw === 'object' && '$date' in (raw as object)
        ? new Date(`${(raw as { $date: string }).$date}T00:00:00Z`) : (raw as CellValue);
      sm.set(k, v);
      mr = Math.max(mr, r); mc = Math.max(mc, c);
    }
    cells.set(name, sm); dims.set(name, { r: mr, c: mc });
  }
  return {
    cells,
    sheetNames: () => [...cells.keys()],
    get: (s, r, c) => cells.get(s)?.get(`${r},${c}`) ?? null,
    maxRow: (s) => dims.get(s)?.r ?? 0,
    maxCol: (s) => dims.get(s)?.c ?? 0,
  };
}
