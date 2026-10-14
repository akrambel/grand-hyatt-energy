// Number / text formatting. Missing values always render as "N/A" – nothing is invented.
export const NA = 'N/A';

export function fmtNumber(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** Adaptive precision: big numbers without decimals, small with up to 2. */
export function fmtAuto(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  const a = Math.abs(v);
  return fmtNumber(v, a >= 1000 ? 0 : a >= 100 ? 1 : 2);
}

export function fmtWithUnit(v: number | null | undefined, unit: string, digits?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return `${digits === undefined ? fmtAuto(v) : fmtNumber(v, digits)} ${unit}`;
}

export function fmtPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return NA;
  return `${(fraction * 100).toFixed(digits)} %`;
}

export function fmtSigned(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return `${v > 0 ? '+' : ''}${fmtNumber(v, digits)}`;
}

export function fmtMoney(v: number | null | undefined, currency = 'SAR'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return `${fmtNumber(v, 2)} ${currency}`;
}

export const clsx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
