import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterX } from 'lucide-react';
import { useData } from '../store/data.ts';
import { addDays, fiscalMonths, fiscalRange, formatDate, localToday, parseISO, toISO } from '../lib/dates.ts';
import { Field } from './ui.tsx';

export type PeriodMode = 'fy' | 'month' | 'range' | 'mtd' | 'wtd';

/** Week starts on Sunday (Saudi Arabia working week). */
export const WEEK_STARTS_ON = 0; // 0 = Sunday, 1 = Monday
export function weekStartOf(iso: string): string {
  const { y, m, d } = parseISO(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(iso, -((dow - WEEK_STARTS_ON + 7) % 7));
}

export interface Period { start: string; end: string; label: string; mode: PeriodMode; monthKey: string | null }

/** Year / month / custom range selection shared by all report pages. `Clear filters` resets to the whole reporting year. */
export function usePeriod(defaultMode: PeriodMode = 'fy') {
  const fy = useData((s) => s.fy);
  const settings = useData((s) => s.settings);
  const months = useMemo(() => fiscalMonths(fy, settings.fiscalStartMonth), [fy, settings.fiscalStartMonth]);
  const range = useMemo(() => fiscalRange(fy, settings.fiscalStartMonth), [fy, settings.fiscalStartMonth]);
  const today = localToday(settings.timezone);
  const currentMonth = months.find((m) => today >= m.start && today <= m.end)?.key ?? months[0].key;

  // A link such as /#/energy?period=mtd (used by the global search) opens the page with that period.
  const [sp] = useSearchParams();
  const urlMode = sp.get('period');
  const fromUrl: PeriodMode | null = urlMode === 'mtd' || urlMode === 'wtd' ? urlMode : null;
  const [mode, setMode] = useState<PeriodMode>(fromUrl ?? defaultMode);
  useEffect(() => { if (fromUrl) setMode(fromUrl); }, [fromUrl]);
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const todayInYear = today >= range.start && today <= range.end;
  const mk = monthKey && months.some((m) => m.key === monthKey) ? monthKey : currentMonth;
  const period: Period = useMemo(() => {
    if (mode === 'month') {
      const m = months.find((x) => x.key === mk) ?? months[0];
      return { start: m.start, end: m.end, label: m.label, mode, monthKey: m.key };
    }
    if (mode === 'mtd' && todayInYear) {
      const { y, m } = parseISO(today);
      const start = toISO(y, m, 1);
      return { start, end: today, label: `Month to date (${formatDate(start)} – ${formatDate(today)})`, mode, monthKey: null };
    }
    if (mode === 'wtd' && todayInYear) {
      const start = weekStartOf(today);
      return { start: start < range.start ? range.start : start, end: today, label: `Week to date (${formatDate(start)} – ${formatDate(today)})`, mode, monthKey: null };
    }
    if (mode === 'range' && from && to && from <= to) return { start: from, end: to, label: `${formatDate(from)} – ${formatDate(to)}`, mode, monthKey: null };
    return { start: range.start, end: range.end, label: `Reporting year ${fy}-${String(fy + 1).slice(2)} (${formatDate(range.start)} – ${formatDate(range.end)})`, mode: 'fy', monthKey: null };
  }, [mode, mk, from, to, months, range, fy, today, todayInYear]);

  const clear = () => { setMode(defaultMode); setMonthKey(null); setFrom(''); setTo(''); };
  const invalidRange = mode === 'range' && from !== '' && to !== '' && from > to;

  const ui = (
    <>
      <Field label="Period">
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)}>
          <option value="fy">Whole reporting year</option>
          <option value="mtd" disabled={!todayInYear}>MTD – Month to date</option>
          <option value="wtd" disabled={!todayInYear}>WTD – Week to date</option>
          <option value="month">Month</option>
          <option value="range">Custom date range</option>
        </select>
      </Field>
      {mode === 'month' && (
        <Field label="Month">
          <select className="input" value={mk} onChange={(e) => setMonthKey(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </Field>
      )}
      {mode === 'range' && (<>
        <Field label="From"><input className={invalidRange ? 'input invalid' : 'input'} type="date" min={range.start} max={range.end} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" hint={invalidRange ? 'End date is before start date' : undefined}><input className={invalidRange ? 'input invalid' : 'input'} type="date" min={range.start} max={range.end} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </>)}
    </>
  );
  const clearButton = <button className="btn" onClick={clear}><FilterX size={16} />Clear filters</button>;
  return { period, ui, clear, clearButton, setMode, setMonthKey };
}
