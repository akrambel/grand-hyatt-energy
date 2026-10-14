// Anomaly detection with a robust (median / MAD) rolling baseline.
// Alerts are only produced when there are enough valid prior days; otherwise the point
// is reported as "insufficient" so the UI can say so instead of guessing.

import { addDays } from './dates.ts';

export interface AnomalyOptions {
  zThreshold: number; // e.g. 3
  minSamples: number; // e.g. 14 valid prior days required
  windowDays: number; // e.g. 28 calendar days of history
}

export const DEFAULT_ANOMALY: AnomalyOptions = { zThreshold: 3, minSamples: 14, windowDays: 28 };

export type PointState = 'insufficient' | 'normal' | 'anomaly';

export interface PointAnalysis {
  date: string;
  value: number;
  state: PointState;
  baseline: number | null; // median of the window
  z: number | null;
  direction: 'high' | 'low' | null;
  samples: number;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Scaled median absolute deviation (comparable to a standard deviation for normal data). */
export function scaledMad(xs: number[], med = median(xs)): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

export function analyzeSeries(
  series: Array<{ date: string; value: number | null }>,
  opts: AnomalyOptions = DEFAULT_ANOMALY,
): PointAnalysis[] {
  const byDate = new Map<string, number>();
  for (const p of series) if (p.value !== null && Number.isFinite(p.value)) byDate.set(p.date, p.value);

  const out: PointAnalysis[] = [];
  for (const p of series) {
    if (p.value === null || !Number.isFinite(p.value)) continue;
    const window: number[] = [];
    for (let i = 1; i <= opts.windowDays; i++) {
      const v = byDate.get(addDays(p.date, -i));
      if (v !== undefined) window.push(v);
    }
    if (window.length < opts.minSamples) {
      out.push({ date: p.date, value: p.value, state: 'insufficient', baseline: null, z: null, direction: null, samples: window.length });
      continue;
    }
    const med = median(window);
    // floor the scale so a perfectly flat history does not flag every tiny change
    const scale = Math.max(scaledMad(window, med), Math.abs(med) * 0.02, 1e-9);
    const z = (p.value - med) / scale;
    const isAnomaly = Math.abs(z) >= opts.zThreshold;
    out.push({
      date: p.date, value: p.value, state: isAnomaly ? 'anomaly' : 'normal', baseline: med,
      z: Math.round(z * 100) / 100, direction: isAnomaly ? (z > 0 ? 'high' : 'low') : null, samples: window.length,
    });
  }
  return out;
}
