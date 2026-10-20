import { useEffect, useMemo, useState } from 'react';
import { Save, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useData, saveReading, deleteReading } from '../store/data.ts';
import { useAuth, useCanEnter, useIsAdmin } from '../store/auth.ts';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { validateEntry } from '../lib/validate.ts';
import type { EntryResult } from '../lib/validate.ts';
import { addDays, formatDate, localToday } from '../lib/dates.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import type { Meter, Utility } from '../lib/types.ts';
import { fmtAuto, fmtNumber } from '../lib/format.ts';
import { notify } from '../store/ui.ts';
import { ConfirmDialog, Field, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Column } from '../components/DataTable.tsx';
import { clsx } from '../lib/format.ts';
import { toDisplay } from '../lib/units.ts';

interface Stored { meter_id: string; reading_date: string; opening: number | null; closing: number | null; entered_by?: string | null }
interface Last { date: string; closing: number }

async function fetchStored(meterIds: string[], dates: string[]): Promise<Stored[]> {
  const { data, error } = await supabase.from('readings').select('meter_id, reading_date, opening, closing, entered_by').in('meter_id', meterIds).in('reading_date', dates);
  if (error) throw new Error(error.message);
  // Stored values are in each meter's native unit; the form works in the display unit chosen in Settings.
  const meters = useData.getState().meterById;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const f = meters.get(r.meter_id as string)?.unitFactor ?? 1;
    return {
      meter_id: r.meter_id as string, reading_date: r.reading_date as string,
      opening: r.opening === null ? null : toDisplay(Number(r.opening), f), closing: r.closing === null ? null : toDisplay(Number(r.closing), f),
      entered_by: (r.entered_by as string | null) ?? null,
    };
  });
}

/**
 * The last closing reading saved BEFORE `date` for each meter, whatever day it was.
 * A meter with no earlier reading is missing from the map: only then is an opening reading asked for.
 */
async function fetchLastBefore(meterIds: string[], date: string): Promise<Map<string, Last>> {
  const out = new Map<string, Last>();
  if (!meterIds.length) return out;
  const meters = useData.getState().meterById;
  const keep = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = r.meter_id as string;
      if (out.has(id) || r.closing === null) continue;
      out.set(id, { date: r.reading_date as string, closing: toDisplay(Number(r.closing), meters.get(id)?.unitFactor ?? 1) as number });
    }
  };
  // most meters were read recently: one query over the last 120 days
  const { data, error } = await supabase.from('readings').select('meter_id, reading_date, closing')
    .in('meter_id', meterIds).lt('reading_date', date).gte('reading_date', addDays(date, -120)).not('closing', 'is', null)
    .order('reading_date', { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  keep((data ?? []) as Array<Record<string, unknown>>);
  // the rest: look further back, one meter at a time
  for (const id of meterIds.filter((m) => !out.has(m))) {
    const r = await supabase.from('readings').select('meter_id, reading_date, closing').eq('meter_id', id).lt('reading_date', date)
      .not('closing', 'is', null).order('reading_date', { ascending: false }).limit(1);
    if (r.error) throw new Error(r.error.message);
    keep((r.data ?? []) as Array<Record<string, unknown>>);
  }
  return out;
}

function recentStats(meterId: string, date: string, meterDays: ReturnType<typeof useData.getState>['meterDays']) {
  const vals: number[] = [];
  for (let i = 1; i <= 14; i++) { const c = meterDays.get(`${meterId}|${addDays(date, -i)}`)?.consumption; if (c !== null && c !== undefined) vals.push(c); }
  return { avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length };
}

function Issues({ r }: { r: EntryResult }) {
  return (
    <>
      {r.errors.length > 0 && <Note kind="bad"><strong>Please fix:</strong><ul>{r.errors.map((e) => <li key={e.code}>{e.message}</li>)}</ul></Note>}
      {r.warnings.length > 0 && <Note kind="warn"><strong>Check:</strong><ul>{r.warnings.map((e) => <li key={e.code}>{e.message}</li>)}</ul></Note>}
    </>
  );
}

export default function DailyEntry() {
  const canEnter = useCanEnter();
  const [mode, setMode] = useState<'single' | 'grid'>('single');
  return (
    <>
      <PageHead title="Daily Consumption Entry" subtitle="Enter the closing reading. The opening is always the last closing reading; it is asked for only once, for a meter’s first reading." />
      {!canEnter && <Note kind="warn"><strong>Read-only access.</strong> Your account is not authorised to enter data. An administrator can enable this in Administration → Users.</Note>}
      <div className="tabs" role="tablist">
        <button className={clsx('tab', mode === 'single' && 'active')} onClick={() => setMode('single')}>Single meter</button>
        <button className={clsx('tab', mode === 'grid' && 'active')} onClick={() => setMode('grid')}>Whole utility (all meters)</button>
      </div>
      {mode === 'single' ? <SingleEntry disabled={!canEnter} /> : <GridEntry disabled={!canEnter} />}
    </>
  );
}

function SingleEntry({ disabled }: { disabled: boolean }) {
  const meters = useData((s) => s.meters);
  const meterDays = useData((s) => s.meterDays);
  const readings = useData((s) => s.readings);
  const settings = useData((s) => s.settings);
  const admin = useIsAdmin();
  const today = localToday(settings.timezone);

  const [date, setDate] = useState(today);
  const [utility, setUtility] = useState<Utility>('water');
  const [area, setArea] = useState('');
  const [meterId, setMeterId] = useState('');
  const [openingText, setOpeningText] = useState('');
  const [closingText, setClosingText] = useState('');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const [confirmed, setConfirmed] = useState({ discontinuity: false, jump: false, overwrite: false });
  const [stored, setStored] = useState<{ prev: number | null; prevDate: string | null; existing: Stored | null; loading: boolean; error: string | null }>({ prev: null, prevDate: null, existing: null, loading: false, error: null });
  const people = useData((s) => s.people);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<string | null>(null);

  const active = useMemo(() => meters.filter((m) => m.active && m.utility === utility), [meters, utility]);
  const areas = useMemo(() => [...new Set(active.map((m) => m.area))], [active]);
  const areaMeters = useMemo(() => active.filter((m) => !area || m.area === area), [active, area]);
  const meter: Meter | undefined = meters.find((m) => m.id === meterId);

  useEffect(() => { if (area && !areas.includes(area)) setArea(''); }, [areas, area]);
  useEffect(() => { if (!areaMeters.some((m) => m.id === meterId)) setMeterId(areaMeters[0]?.id ?? ''); }, [areaMeters, meterId]);

  // authoritative lookup of the previous day's closing and any reading already saved for the date
  useEffect(() => {
    if (!meterId || !date) return;
    let cancelled = false;
    setStored((s) => ({ ...s, loading: true, error: null }));
    Promise.all([fetchStored([meterId], [date]), fetchLastBefore([meterId], date)]).then(([rows, last]) => {
      if (cancelled) return;
      const lastOne = last.get(meterId) ?? null;
      const prev = lastOne?.closing ?? null;
      const existing = rows.find((r) => r.reading_date === date) ?? null;
      setStored({ prev, prevDate: lastOne?.date ?? null, existing, loading: false, error: null });
      setOpeningText(existing?.opening != null ? String(existing.opening) : '');
      // an opening different from the last closing on a saved reading = a meter replacement (administrators)
      setOverride(admin && prev !== null && existing?.opening != null && existing.opening !== prev);
      setClosingText(existing?.closing !== null && existing?.closing !== undefined ? String(existing.closing) : '');
      setConfirmed({ discontinuity: false, jump: false, overwrite: false });
    }).catch((e) => { if (!cancelled) setStored({ prev: null, prevDate: null, existing: null, loading: false, error: friendlyError(e) }); });
    return () => { cancelled = true; };
  }, [meterId, date, admin]);

  const recent = useMemo(() => (meter ? recentStats(meter.id, date, meterDays) : { avg: null, n: 0 }), [meter, date, meterDays]);

  const effectiveOpeningText = override ? openingText : (stored.prev !== null ? String(stored.prev) : openingText);
  const result = useMemo(() => meter ? validateEntry({
    date, meter, openingText: override || stored.prev === null ? openingText : '', closingText,
    prevClosing: stored.prev, prevDate: stored.prevDate, existing: stored.existing ? { opening: stored.existing.opening, closing: stored.existing.closing } : null,
    today, recentAvgDaily: recent.avg, recentSamples: recent.n, jumpFactor: settings.entry.jumpFactor, confirmed,
  }) : null, [meter, date, openingText, closingText, override, stored, today, recent, settings.entry.jumpFactor, confirmed]);

  const submit = async () => {
    if (!meter || !result || !result.canSave || result.closing === null) return;
    setBusy(true);
    try {
      await saveReading({ meter_id: meter.id, reading_date: date, opening: result.storeOpening, closing: result.closing, note: note.trim() || null });
      notify.success('Reading saved', `${meter.name}: ${result.consumption === null ? 'consumption N/A' : `${fmtAuto(result.consumption)} ${meter.unit}`} on ${formatDate(date)}`);
      setClosingText(''); setOverride(false); setOpeningText(''); setNote('');
      // advance to next meter in the list for fast entry
      const i = areaMeters.findIndex((m) => m.id === meter.id);
      if (i >= 0 && i < areaMeters.length - 1) setMeterId(areaMeters[i + 1].id);
      else setStored((s) => ({ ...s, existing: { meter_id: meter.id, reading_date: date, opening: result.storeOpening, closing: result.closing, entered_by: useAuth.getState().profile?.id ?? null } }));
    } catch (e) { notify.error('Reading not saved', friendlyError(e)); } finally { setBusy(false); }
  };

  const confirmNeeds = (code: string) => result?.warnings.some((w) => w.code === code && w.needsConfirm) ?? false;

  // last entries of the selected meter (from the shared store, so this updates for everybody)
  const recentRows = useMemo(() => readings.filter((r) => r.meter_id === meterId).sort((a, b) => (a.reading_date < b.reading_date ? 1 : -1)).slice(0, 60)
    .map((r) => ({ ...r, md: meterDays.get(`${r.meter_id}|${r.reading_date}`) })), [readings, meterId, meterDays]);
  const cols: Array<Column<(typeof recentRows)[number]>> = [
    { key: 'd', header: 'Date', value: (r) => r.reading_date, render: (r) => formatDate(r.reading_date) },
    { key: 'o', header: 'Opening', num: true, value: (r) => r.md?.opening ?? null, render: (r) => fmtNumber(r.md?.opening ?? null, 3) },
    { key: 'c', header: 'Closing', num: true, value: (r) => r.closing, render: (r) => fmtNumber(r.closing, 3) },
    { key: 'u', header: 'Consumption', num: true, value: (r) => r.md?.consumption ?? null, render: (r) => fmtNumber(r.md?.consumption ?? null, 3) },
    { key: 's', header: 'Status', value: (r) => r.md?.status ?? '', render: (r) => <StatusPill kind={r.md?.status === 'ok' || r.md?.status === 'rollover' ? 'ok' : 'warn'}>{r.md?.status ?? 'N/A'}</StatusPill> },
    { key: 'b', header: 'Entered by', value: (r) => (r.entered_by ? people.get(r.entered_by) ?? '' : r.source === 'import' ? 'Import' : ''),
      render: (r) => (r.entered_by ? people.get(r.entered_by) ?? <span className="muted">Unknown</span> : <span className="muted">{r.source === 'import' ? 'Import' : '—'}</span>) },
    ...(admin ? [{ key: 'x', header: '', value: () => '', render: (r: (typeof recentRows)[number]) => <button className="btn sm danger" onClick={() => setDel(r.id ?? null)} aria-label="Delete reading"><Trash2 size={13} /></button> } as Column<(typeof recentRows)[number]>] : []),
  ];

  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h3>New reading</h3>
        <div className="form-grid">
          <Field label="Date"><input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} disabled={disabled} /></Field>
          <Field label="Utility type">
            <select className="input" value={utility} onChange={(e) => setUtility(e.target.value as Utility)} disabled={disabled}>
              {UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label}</option>)}
            </select>
          </Field>
          <Field label="Area">
            <select className="input" value={area} onChange={(e) => setArea(e.target.value)} disabled={disabled}>
              <option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Meter">
            <select className="input" value={meterId} onChange={(e) => setMeterId(e.target.value)} disabled={disabled}>
              {areaMeters.map((m) => <option key={m.id} value={m.id}>{m.name}{m.area && m.area !== m.name ? ` – ${m.area}` : ''}</option>)}
            </select>
          </Field>
        </div>

        {meter && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />
            {stored.error && <Note kind="bad">{stored.error}</Note>}
            {stored.existing && <Note kind="info">A reading for this meter and date is already saved (closing {fmtNumber(stored.existing.closing, 3)} {meter.unit}{stored.existing.entered_by ? `, entered by ${people.get(stored.existing.entered_by) ?? 'another user'}` : ''}). Saving will replace it.</Note>}
            <div className="form-grid">
              <Field label={`Opening reading (${meter.unit})`} hint={override ? 'New meter’s starting value (meter replaced or reset)' : stored.prev !== null ? `Last closing reading – ${formatDate(stored.prevDate)}` : 'First reading of this meter – enter the opening once'}>
                <input className="input mono" inputMode="decimal" value={override || stored.prev === null ? openingText : effectiveOpeningText} readOnly={!override && stored.prev !== null} disabled={disabled}
                  onChange={(e) => setOpeningText(e.target.value)} placeholder="e.g. 500" />
              </Field>
              <Field label={`Closing reading (${meter.unit})`}>
                <input className={clsx('input mono', result && result.errors.some((e) => e.code.startsWith('closing')) && 'invalid')} inputMode="decimal" value={closingText} disabled={disabled}
                  onChange={(e) => { setClosingText(e.target.value); setConfirmed({ discontinuity: false, jump: false, overwrite: false }); }} placeholder="e.g. 583" />
              </Field>
              <Field label="Consumption">
                <div className="input mono" style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  {result?.consumption != null ? `${fmtAuto(result.consumption)} ${meter.unit}` : '—'}
                </div>
              </Field>
            </div>
            {admin && stored.prev !== null && (
              <label className="small" style={{ display: 'inline-flex', gap: 6, marginTop: 8 }}>
                <input type="checkbox" checked={override} disabled={disabled} onChange={(e) => { setOverride(e.target.checked); if (e.target.checked && !openingText) setOpeningText(String(stored.prev)); }} />
                Meter replaced or reset: enter the new opening (administrators only)
              </label>)}
            {meter.rollover_at !== null && <p className="small muted">This meter rolls over at {fmtNumber(meter.rollover_at)} {meter.unit}; a drop in the reading near the limit is calculated as a rollover.</p>}
            <div className="field" style={{ marginTop: 10 }}><label>Note (optional)</label><input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} disabled={disabled} /></div>
            <div style={{ marginTop: 12 }}>{result && closingText.trim() !== '' && <Issues r={result} />}</div>
            <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
              {confirmNeeds('discontinuity') && <label className="small"><input type="checkbox" checked={confirmed.discontinuity} onChange={(e) => setConfirmed({ ...confirmed, discontinuity: e.target.checked })} /> I confirm the different opening reading is intentional.</label>}
              {confirmNeeds('jump') && <label className="small"><input type="checkbox" checked={confirmed.jump} onChange={(e) => setConfirmed({ ...confirmed, jump: e.target.checked })} /> I checked the reading; the high consumption is correct.</label>}
              {confirmNeeds('duplicate') && <label className="small"><input type="checkbox" checked={confirmed.overwrite} onChange={(e) => setConfirmed({ ...confirmed, overwrite: e.target.checked })} /> Replace the existing reading.</label>}
            </div>
            <button className="btn primary" disabled={disabled || busy || !result?.canSave} onClick={() => void submit()}><Save size={16} />{busy ? 'Saving…' : 'Save reading'}</button>
          </>)}
        {!meter && <Note kind="warn">No meters are available for this selection. Import the workbook or add meters in Administration.</Note>}
      </div>

      <div className="card">
        <h3>Recent readings – {meter?.name ?? '—'}</h3>
        <DataTable rows={recentRows} columns={cols} rowKey={(r) => r.id ?? r.reading_date} defaultPageSize={10} pageSizes={[10, 25, 50]}
          rowClass={(r) => !!r.md && r.md.status !== 'ok' && r.md.status !== 'rollover'} empty="No readings saved for this meter in the selected reporting year." />
      </div>
      {del && <ConfirmDialog danger title="Delete reading?" confirmLabel="Delete" message="This permanently removes the reading. Consumption for this day and the next day will be recalculated."
        onCancel={() => setDel(null)} onConfirm={async () => { try { await deleteReading(del); notify.success('Reading deleted'); } catch (e) { notify.error('Delete failed', friendlyError(e)); } setDel(null); }} />}
    </div>
  );
}

function GridEntry({ disabled }: { disabled: boolean }) {
  const meters = useData((s) => s.meters);
  const meterDays = useData((s) => s.meterDays);
  const settings = useData((s) => s.settings);
  const today = localToday(settings.timezone);
  const [date, setDate] = useState(addDays(today, 0));
  const [utility, setUtility] = useState<Utility>('water');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<Record<string, { prev: number | null; prevDate: string | null; existing: Stored | null }>>({});
  const [openings, setOpenings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const rows = useMemo(() => meters.filter((m) => m.active && m.utility === utility), [meters, utility]);

  useEffect(() => {
    if (!rows.length) { setStored({}); return; }
    let cancelled = false;
    setLoading(true);
    const ids = rows.map((m) => m.id);
    Promise.all([fetchStored(ids, [date]), fetchLastBefore(ids, date)]).then(([data, last]) => {
      if (cancelled) return;
      const s: typeof stored = {}; const t: Record<string, string> = {}; const o: Record<string, string> = {};
      for (const m of rows) {
        const l = last.get(m.id) ?? null;
        const existing = data.find((r) => r.meter_id === m.id && r.reading_date === date) ?? null;
        s[m.id] = { prev: l?.closing ?? null, prevDate: l?.date ?? null, existing };
        if (existing?.closing != null) t[m.id] = String(existing.closing);
        if (!l && existing?.opening != null) o[m.id] = String(existing.opening);
      }
      setStored(s); setTexts(t); setOpenings(o); setLoading(false);
    }).catch((e) => { if (!cancelled) { setLoading(false); notify.error('Could not load readings', friendlyError(e)); } });
    return () => { cancelled = true; };
  }, [rows, date]);

  const results = useMemo(() => {
    const out = new Map<string, EntryResult>();
    for (const m of rows) {
      const text = texts[m.id] ?? '';
      if (text.trim() === '') continue;
      const st = stored[m.id];
      const rs = recentStats(m.id, date, meterDays);
      out.set(m.id, validateEntry({
        date, meter: m, openingText: st?.prev == null ? openings[m.id] ?? '' : '', closingText: text, prevClosing: st?.prev ?? null, prevDate: st?.prevDate ?? null,
        existing: st?.existing ? { opening: st.existing.opening, closing: st.existing.closing } : null,
        today, recentAvgDaily: rs.avg, recentSamples: rs.n, jumpFactor: settings.entry.jumpFactor,
        confirmed: { discontinuity: ok, jump: ok, overwrite: true },
      }));
    }
    return out;
  }, [rows, texts, openings, stored, date, today, meterDays, settings.entry.jumpFactor, ok]);

  const savable = [...results.entries()].filter(([, r]) => r.canSave);
  const blocked = [...results.entries()].filter(([, r]) => !r.canSave && !(r.errors.length === 1 && r.errors[0].code === 'duplicate_same'));
  const needsConfirm = [...results.values()].some((r) => r.warnings.some((w) => w.needsConfirm && w.code !== 'duplicate'));

  const saveAll = async () => {
    setBusy(true);
    let saved = 0; const failed: string[] = [];
    for (const [id, r] of savable) {
      try { await saveReading({ meter_id: id, reading_date: date, opening: r.storeOpening, closing: r.closing as number }); saved++; }
      catch (e) { failed.push(`${meters.find((m) => m.id === id)?.name}: ${friendlyError(e)}`); }
    }
    setBusy(false);
    if (saved) notify.success(`${saved} reading${saved === 1 ? '' : 's'} saved`, formatDate(date));
    if (failed.length) notify.error(`${failed.length} reading(s) failed`, failed.slice(0, 3).join('; '));
    setDate((d) => d); // refresh stored values
    setStored((s) => { const n = { ...s }; for (const [id, r] of savable) if (!failed.some((f) => f.startsWith(meters.find((m) => m.id === id)?.name ?? '\0'))) n[id] = { prev: s[id]?.prev ?? null, prevDate: s[id]?.prevDate ?? null, existing: { meter_id: id, reading_date: date, opening: r.storeOpening, closing: r.closing } }; return n; });
  };

  return (
    <div className="card">
      <div className="filters" style={{ border: 0, padding: 0 }}>
        <Field label="Date"><input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} disabled={disabled} /></Field>
        <Field label="Utility type"><select className="input" value={utility} onChange={(e) => setUtility(e.target.value as Utility)} disabled={disabled}>{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label}</option>)}</select></Field>
      </div>
      <p className="small muted">Enter the closing reading for each meter. The opening is the meter’s last closing reading; it is typed only for a meter’s first reading. Empty rows are skipped.</p>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Area</th><th>Meter</th><th className="num">Opening</th><th className="num">Closing ({UTILITY_INFO[utility].unit})</th><th className="num">Consumption</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((m) => {
            const r = results.get(m.id); const st = stored[m.id];
            return (
              <tr key={m.id} className={r && r.errors.length && r.errors[0].code !== 'duplicate_same' ? 'flag' : undefined}>
                <td>{m.area}</td><td>{m.name}</td>
                <td className="num">{st?.prev != null
                  ? <>{fmtNumber(st.prev, 3)}{st.prevDate && st.prevDate !== addDays(date, -1) && <div className="small muted">{formatDate(st.prevDate)}</div>}</>
                  : <input className="input mono" style={{ width: 120, textAlign: 'right' }} inputMode="decimal" placeholder="First reading" value={openings[m.id] ?? ''} disabled={disabled || loading}
                      onChange={(e) => setOpenings({ ...openings, [m.id]: e.target.value })} aria-label={`Opening reading for ${m.name} (first reading)`} />}</td>
                <td className="num"><input className="input mono" style={{ width: 130, textAlign: 'right' }} inputMode="decimal" value={texts[m.id] ?? ''} disabled={disabled || loading}
                  onChange={(e) => setTexts({ ...texts, [m.id]: e.target.value })} aria-label={`Closing reading for ${m.name}`} /></td>
                <td className="num">{r?.consumption != null ? fmtAuto(r.consumption) : '—'}</td>
                <td className="small">{r ? (r.errors.length ? <span style={{ color: 'var(--bad)' }}>{r.errors[0].message}</span> : r.warnings.length ? <span style={{ color: 'var(--warn)' }}>{r.warnings[0].message}</span> : <CheckCircle2 size={14} color="#1d7a52" />) : ''}</td>
              </tr>);
          })}
          {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No meters available for this utility.</td></tr>}
        </tbody>
      </table></div>
      {needsConfirm && <Note kind="warn"><AlertTriangle size={14} /> Some rows have warnings (different opening / unusually high consumption). <label><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I checked these readings and want to save them.</label></Note>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={disabled || busy || savable.length === 0 || (needsConfirm && !ok)} onClick={() => void saveAll()}><Save size={16} />{busy ? 'Saving…' : `Save ${savable.length} reading${savable.length === 1 ? '' : 's'}`}</button>
        {blocked.length > 0 && <span className="small" style={{ color: 'var(--bad)' }}>{blocked.length} row(s) cannot be saved until corrected.</span>}
      </div>
    </div>
  );
}
