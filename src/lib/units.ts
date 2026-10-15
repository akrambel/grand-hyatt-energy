// Display units for volume-based utilities (water, gas, chilled water).
//
// Rules
//   * The database always keeps the NATIVE unit of each meter (for example m³ or L).
//   * The administrator chooses the DISPLAY unit per utility in Settings. When data is loaded, every
//     reading, rollover value, tariff and budget is converted once, so all pages, charts, reports and
//     exports use the same unit.
//   * When a reading is saved, the value typed in the display unit is converted back to the meter's
//     native unit. Nothing is ever stored twice or in two units.
//   * Meters whose unit is not a volume (for example kWh) are never converted.

export type VolumeUnit = 'm³' | 'L';
export type UnitUtility = 'water' | 'gas' | 'chilled';

export interface UnitSettings { water: VolumeUnit; gas: VolumeUnit; chilled: VolumeUnit }

export const DEFAULT_UNITS: UnitSettings = { water: 'm³', gas: 'L', chilled: 'm³' };
export const UNIT_CHOICES: readonly VolumeUnit[] = ['m³', 'L'];
export const UNIT_UTILITIES: readonly UnitUtility[] = ['water', 'gas', 'chilled'];

/** Unit in which tariffs and the budget sheet are expressed (the workbook's units). */
export const BASE_UNITS: Record<UnitUtility, VolumeUnit> = { water: 'm³', gas: 'L', chilled: 'm³' };

const LITRE_ALIASES = new Set(['l', 'lt', 'ltr', 'liter', 'litre', 'liters', 'litres']);
const CUBIC_ALIASES = new Set(['m3', 'm³', 'm^3', 'cbm', 'cubic meter', 'cubic metre', 'cubic meters', 'cubic metres']);

/** Normalises spelling variants ("m3", "Litres" ...) to 'm³' or 'L'. Other units are returned trimmed. */
export function normalizeUnit(unit: string | null | undefined): string {
  const t = String(unit ?? '').trim();
  const k = t.toLowerCase();
  if (CUBIC_ALIASES.has(k)) return 'm³';
  if (LITRE_ALIASES.has(k)) return 'L';
  return t;
}

export const isVolumeUnit = (unit: string | null | undefined): unit is VolumeUnit => {
  const n = normalizeUnit(unit);
  return n === 'm³' || n === 'L';
};

/** displayValue = nativeValue × factor. Returns 1 when either unit is not a volume. */
export function unitFactor(nativeUnit: string | null | undefined, displayUnit: string | null | undefined): number {
  const from = normalizeUnit(nativeUnit);
  const to = normalizeUnit(displayUnit);
  if (!isVolumeUnit(from) || !isVolumeUnit(to) || from === to) return 1;
  return from === 'm³' ? 1000 : 0.001; // m³ → L, or L → m³
}

/** Rounds away binary floating-point noise (for example 0.1 × 3) without losing real precision. */
export const tidy = (n: number): number => Math.round((n + Number.EPSILON) * 1e9) / 1e9;

export const toDisplay = (nativeValue: number | null, factor: number): number | null =>
  nativeValue === null ? null : tidy(nativeValue * factor);

export const toNative = (displayValue: number, factor: number): number => tidy(displayValue / factor);

/** Price per display unit when the tariff is stored per base unit (for example SAR/m³ → SAR/L). */
export const priceToDisplay = (pricePerBaseUnit: number, baseToDisplayFactor: number): number => tidy(pricePerBaseUnit / baseToDisplayFactor);
export const priceFromDisplay = (pricePerDisplayUnit: number, baseToDisplayFactor: number): number => tidy(pricePerDisplayUnit * baseToDisplayFactor);

export function parseUnits(value: unknown): UnitSettings {
  const out: UnitSettings = { ...DEFAULT_UNITS };
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const u of UNIT_UTILITIES) {
      const n = normalizeUnit(typeof v[u] === 'string' ? (v[u] as string) : '');
      if (n === 'm³' || n === 'L') out[u] = n;
    }
  }
  return out;
}
