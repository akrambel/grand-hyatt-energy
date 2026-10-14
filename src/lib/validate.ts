// Validation of a daily meter-reading entry (opening / closing).
// Pure function: the UI passes everything it knows and shows the returned issues.

import { isISODate } from './dates.ts';
import { computeMeterDay, round3 } from './calc.ts';
import type { ConsumptionStatus, Meter, Reading } from './types.ts';

export interface Issue {
  code: string;
  message: string;
  /** Warnings with `needsConfirm` must be acknowledged by the user before saving. */
  needsConfirm?: boolean;
}

export interface EntryInput {
  date: string;
  meter: Pick<Meter, 'rollover_at' | 'unit' | 'name'>;
  openingText: string;
  closingText: string;
  /** Closing reading of the previous calendar day for the same meter (null when none). */
  prevClosing: number | null;
  /** Reading already stored for this meter and date (duplicate detection). */
  existing: Pick<Reading, 'opening' | 'closing'> | null;
  today: string;
  /** Average daily consumption of recent valid days (null when unknown). */
  recentAvgDaily: number | null;
  recentSamples: number;
  jumpFactor: number;
  /** Set by the user when they deliberately entered a different opening (meter replaced / reset). */
  confirmed: { discontinuity: boolean; jump: boolean; overwrite: boolean };
  /** Fiscal year range; dates outside produce a warning (not an error). */
  fiscalStart?: string;
  fiscalEnd?: string;
}

export interface EntryResult {
  errors: Issue[];
  warnings: Issue[];
  opening: number | null; // effective opening
  closing: number | null;
  consumption: number | null;
  status: ConsumptionStatus | null;
  /** Value to store in `readings.opening` (null = follow the previous day's closing). */
  storeOpening: number | null;
  canSave: boolean;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Parses "1,234.50", "1 234,5", "١٢٣٫٤" … -> number. Returns null when empty, NaN when invalid. */
export function parseReading(text: string): number | null {
  let t = (text ?? '').trim();
  if (t === '') return null;
  t = t.replace(/[٠-٩]/g, (c) => String(ARABIC_INDIC.indexOf(c)))
       .replace(/[۰-۹]/g, (c) => String(PERSIAN.indexOf(c)))
       .replace(/٫/g, '.').replace(/٬/g, ',').replace(/[\s  ]/g, '');
  // decide decimal separator: if both exist, the last one is the decimal separator
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    t = lastDot > lastComma ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    // "1,234" (thousands) vs "12,5" (decimal)
    const frac = t.length - lastComma - 1;
    t = frac === 3 && /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

function decimals(text: string): number {
  const m = /[.,٫](\d+)\s*$/.exec(text.trim());
  return m ? m[1].length : 0;
}

export function validateEntry(i: EntryInput): EntryResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string, needsConfirm = false) => warnings.push({ code, message, needsConfirm });

  if (!i.date || !isISODate(i.date)) err('date_invalid', 'Select a valid date.');
  else if (i.date > i.today) err('date_future', 'The reading date cannot be in the future.');
  else if (i.fiscalStart && i.fiscalEnd && (i.date < i.fiscalStart || i.date > i.fiscalEnd)) {
    warn('date_outside_fy', 'This date is outside the selected reporting year.');
  }

  const openingParsed = parseReading(i.openingText);
  const closingParsed = parseReading(i.closingText);

  if (Number.isNaN(openingParsed)) err('opening_nan', 'Opening reading must be a number.');
  if (Number.isNaN(closingParsed)) err('closing_nan', 'Closing reading must be a number.');
  if (closingParsed === null) err('closing_required', 'Closing reading is required.');
  if (typeof openingParsed === 'number' && openingParsed < 0) err('opening_negative', 'Opening reading cannot be negative.');
  if (typeof closingParsed === 'number' && closingParsed < 0) err('closing_negative', 'Closing reading cannot be negative.');
  if (decimals(i.openingText) > 3 || decimals(i.closingText) > 3) err('too_many_decimals', 'Use at most 3 decimal places.');
  if ((typeof openingParsed === 'number' && openingParsed > 1e12) || (typeof closingParsed === 'number' && closingParsed > 1e12)) {
    err('too_large', 'The reading is unrealistically large – please check the value.');
  }

  const opening = typeof openingParsed === 'number' && !Number.isNaN(openingParsed) ? openingParsed : null;
  const closing = typeof closingParsed === 'number' && !Number.isNaN(closingParsed) ? closingParsed : null;
  const effectiveOpening = opening ?? i.prevClosing;

  if (opening === null && i.prevClosing === null && closing !== null) {
    err('opening_required', 'No reading exists for the previous day, so the opening reading must be entered.');
  }

  let consumption: number | null = null;
  let status: ConsumptionStatus | null = null;
  if (closing !== null && effectiveOpening !== null && errors.length === 0) {
    const day = computeMeterDay(
      { meter_id: 'x', reading_date: i.date, opening, closing }, i.prevClosing, i.meter);
    consumption = day.consumption;
    status = day.status;
    if (day.status === 'negative') {
      err('closing_below_opening',
        `Closing reading (${closing}) is lower than the opening reading (${effectiveOpening}). ` +
        'If the meter was replaced or reset, enter the new meter’s starting value as the opening reading.');
    } else if (day.status === 'rollover') {
      warn('rollover', `Meter rollover detected: consumption of ${consumption} ${i.meter.unit} was calculated across the rollover value.`);
    }
    // discontinuity: explicit opening differs from yesterday's closing
    if (opening !== null && i.prevClosing !== null && opening !== i.prevClosing && day.status !== 'negative') {
      warn('discontinuity',
        `The opening reading (${opening}) differs from the previous day’s closing reading (${i.prevClosing}). ` +
        'Confirm this is intentional (for example a meter replacement).', true);
    }
    // sudden jump versus recent history
    if (consumption !== null && i.recentAvgDaily !== null && i.recentSamples >= 7 && i.recentAvgDaily > 0
        && consumption > i.recentAvgDaily * i.jumpFactor) {
      warn('jump',
        `Consumption of ${consumption} ${i.meter.unit} is ${round3(consumption / i.recentAvgDaily)}× the recent daily average ` +
        `(${round3(i.recentAvgDaily)} ${i.meter.unit}). Please double-check the reading.`, true);
    }
    if (consumption === 0) warn('zero', 'Consumption is zero – confirm the meter was really not running.');
  }

  const storeOpening = opening !== null && opening !== i.prevClosing ? opening : null;
  if (i.existing) {
    const same = i.existing.closing === closing && (i.existing.opening ?? null) === storeOpening;
    if (same) err('duplicate_same', 'This exact reading is already saved.');
    else warn('duplicate', 'A reading for this meter and date already exists and will be replaced.', true);
  }

  const unconfirmed = warnings.some((w) => w.needsConfirm && !(
    (w.code === 'discontinuity' && i.confirmed.discontinuity) ||
    (w.code === 'jump' && i.confirmed.jump) ||
    (w.code === 'duplicate' && i.confirmed.overwrite)));

  return {
    errors, warnings, opening: effectiveOpening, closing, consumption, status, storeOpening,
    canSave: errors.length === 0 && !unconfirmed && closing !== null,
  };
}
