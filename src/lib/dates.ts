// Date helpers. Calendar dates are plain "YYYY-MM-DD" strings (property local calendar);
// no Date-with-timezone arithmetic is used for them, so results never depend on the
// browser's time zone. Instants (sensor timestamps) are ISO strings in UTC and are only
// converted to local time for display, using Intl with the configured IANA time zone.

export const DEFAULT_TZ = 'Asia/Riyadh';
export const DEFAULT_FISCAL_START_MONTH = 10;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseISO(s: string): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(s);
  if (!m) throw new Error(`Invalid ISO date: ${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toISO(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const pa = parseISO(a), pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

export function monthLongName(m: number): string {
  return MONTH_LONG[m - 1];
}

export function monthShortName(m: number): string {
  return MONTH_SHORT[m - 1];
}

/** Excel serial date (1900 system, as used by xlsx files) -> ISO date. */
export function excelSerialToISO(serial: number): string {
  const t = new Date(Math.round((serial - 25569) * 86400000));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** JS Date coming from a spreadsheet reader (UTC midnight) -> ISO date, using UTC parts. */
export function dateToISOUTC(d: Date): string {
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// ------------------------------------------------------------------ fiscal ---

/** Calendar year in which the fiscal year containing `iso` starts (2026 for 2026-10-13). */
export function fiscalYearOf(iso: string, startMonth = DEFAULT_FISCAL_START_MONTH): number {
  const { y, m } = parseISO(iso);
  return m >= startMonth ? y : y - 1;
}

export function fiscalLabel(fy: number, startMonth = DEFAULT_FISCAL_START_MONTH): string {
  if (startMonth === 1) return `FY${fy}`;
  return `FY${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

export function fiscalRange(fy: number, startMonth = DEFAULT_FISCAL_START_MONTH): { start: string; end: string } {
  const start = toISO(fy, startMonth, 1);
  const endMonthIdx = startMonth - 1; // month before the next start
  const endYear = startMonth === 1 ? fy : fy + 1;
  const endMonth = endMonthIdx === 0 ? 12 : endMonthIdx;
  return { start, end: toISO(endYear, endMonth, daysInMonth(endYear, endMonth)) };
}

export interface FiscalMonth {
  key: string; // '2026-10'
  year: number;
  month: number;
  label: string; // 'Oct 2026'
  start: string;
  end: string;
  days: number;
  index: number; // 0..11 within the fiscal year
}

export function fiscalMonths(fy: number, startMonth = DEFAULT_FISCAL_START_MONTH): FiscalMonth[] {
  const out: FiscalMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m0 = startMonth - 1 + i;
    const year = fy + Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    const days = daysInMonth(year, month);
    out.push({
      key: `${year}-${pad(month)}`, year, month, label: `${MONTH_SHORT[month - 1]} ${year}`,
      start: toISO(year, month, 1), end: toISO(year, month, days), days, index: i,
    });
  }
  return out;
}

export function clampToRange(iso: string, start: string, end: string): string {
  return iso < start ? start : iso > end ? end : iso;
}

// ------------------------------------------------------------ time zones -----

/** Local calendar date (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function localDateOf(instant: Date | string | number, tz = DEFAULT_TZ): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function localToday(tz = DEFAULT_TZ, now: Date = new Date()): string {
  return localDateOf(now, tz);
}

export function formatDateTimeLocal(instant: Date | string | number | null | undefined, tz = DEFAULT_TZ): string {
  if (instant === null || instant === undefined || instant === '') return 'N/A';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
}

export function formatTimeLocal(instant: Date | string | number, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant instanceof Date ? instant : new Date(instant));
}

/** '2026-10-01' -> '01 Oct 2026' */
export function formatDate(iso: string | null | undefined): string {
  if (!iso || !isISODate(iso)) return 'N/A';
  const { y, m, d } = parseISO(iso);
  return `${pad(d)} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** Human "5 min ago" style text. */
export function timeAgo(instant: Date | string | number | null | undefined, now: Date = new Date()): string {
  if (instant === null || instant === undefined) return 'never';
  const t = (instant instanceof Date ? instant : new Date(instant)).getTime();
  if (Number.isNaN(t)) return 'never';
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
