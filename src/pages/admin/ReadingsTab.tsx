// Find, correct and delete meter readings: filter by dates, utility, area and meter, then edit one
// reading or delete the ones you tick. Every change is recorded in the audit log by the database.
import { useMemo, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { supabase, fetchAll, friendlyError } from '../../lib/supabase.ts';
import { useData, saveReading } from '../../store/data.ts';
import { UTILITIES, UTILITY_INFO } from '../../lib/types.ts';
import type { Meter, Utility } from '../../lib/types.ts';
import { addDays, formatDate, localToday } from '../../lib/dates.ts';
import { fmtAuto } from '../../lib/format.ts';
import { toDisplay } from '../../lib/units.ts';
import { parseReading } from '../../lib/validate.ts';
import { ConfirmDialog, Field, Modal, Note } from '../../components/ui.tsx';
import { notify } from '../../store/ui.ts';

interface Row {
  id: string; meter_id: string; reading_date: string; opening: number | null; closing: number | null;
  note: string | null; source: string | null; entered_by: string | null;
}

const MAX_ROWS = 5000;
const PAGE = 100;

export default function ReadingsTab() {
  const { meters, meterById, meterDays, people, settings, reloadReference } = useData();
  const today = localToday(settings.timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [utility, setUtility] = useState<Utility | ''>('');
  const [area, setArea] = useState('');
  const [meterId, setMeterId] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row[] | null>(null);
  const [page, setPage] = useState(0);

  const utilMeters = useMemo(() => meters.filter((m) => !utility || m.utility === utility), [meters, utility]);
  const areas = useMemo(() => [...new Set(utilMeters.map((m) => m.area).filter(Boolean))].sort(), [utilMeters]);
  const areaMeters = useMemo(() => utilMeters.filter((m) => !area || m.area === area), [utilMeters, area]);
  const rangeOk = !!from && !!to && from <= to;

  const find = async () => {
    if (!rangeOk) return;
    setBusy(true);
    try {
      const ids = meterId ? [meterId] : utility || area ? areaMeters.map((m) => m.id) : null;
      if (ids && ids.length === 0) { setRows([]); return; }
      const data = await fetchAll<Record<string, unknown>>((a, b) => {
        let q = supabase.from('readings').select('id, meter_id, reading_date, opening, closing, note, source, entered_by')
          .gte('reading_date', from).lte('reading_date', to);
        if (ids) q = q.in('meter_id', ids);
        return q.order('reading_date', { ascending: false }).order('meter_id').range(a, b);
      });
      const out = data.slice(0, MAX_ROWS).map((r) => {
        const f = meterById.get(r.meter_id as string)?.unitFactor ?? 1;
        return {
          id: String(r.id), meter_id: r.meter_id as string, reading_date: r.reading_date as string,
          opening: r.opening === null ? null : toDisplay(Number(r.opening), f), closing: r.closing === null ? null : toDisplay(Number(r.closing), f),
          note: (r.note as string | null) ?? null, source: (r.source as string | null) ?? null, entered_by: (r.entered_by as string | null) ?? null,
        };
      });
      out.sort((a, b) => (a.reading_date === b.reading_date ? meterOrder(meterById.get(a.meter_id), meterById.get(b.meter_id)) : a.reading_date < b.reading_date ? 1 : -1));
      setRows(out);
      setPicked(new Set());
      setPage(0);
      if (data.length > MAX_ROWS) notify.info('Showing the first 5,000 readings', 'Narrow the dates or pick an area or meter to see the rest.');
    } catch (e) {
      notify.error('Readings not loaded', friendlyError(e));
    } finally { setBusy(false); }
  };

  const remove = async (list: Row[]) => {
    const ids = list.map((r) => r.id);
    let done = 0;
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const { error, count } = await supabase.from('readings').delete({ count: 'exact' }).in('id', ids.slice(i, i + 200));
        if (error) throw error;
        done += count ?? 0;
      }
      notify.success('Readings deleted', `${done} reading${done === 1 ? '' : 's'}`);
    } catch (e) {
      notify.error('Delete failed', `${done} deleted before the error. ${friendlyError(e)}`);
    }
    setDeleting(null);
    await reloadReference();
    await find();
  };

  const enteredBy = (r: Row) => r.entered_by ? people.get(r.entered_by) ?? 'Deleted user' : r.source === 'import' ? 'Import' : '–';
  const consumption = (r: Row) => meterDays.get(`${r.meter_id}|${r.reading_date}`)?.consumption ?? (r.opening !== null && r.closing !== null ? r.closing - r.opening : null);
  const allPicked = !!rows?.length && rows.every((r) => picked.has(r.id));
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };

  return (
    <div className="grid">
      <div className="card">
        <h3>Find readings</h3>
        <p className="muted small" style={{ marginTop: 4 }}>Choose the dates, then narrow down by utility, area or meter. You can correct one reading or delete the ones you tick.</p>
        <div className="filters" style={{ border: 0, padding: 0, marginTop: 12 }}>
          <Field label="From"><input className="input" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Utility">
            <select className="input" value={utility} onChange={(e) => { setUtility(e.target.value as Utility | ''); setArea(''); setMeterId(''); }}>
              <option value="">All utilities</option>{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label}</option>)}
            </select>
          </Field>
          <Field label="Area">
            <select className="input" value={area} onChange={(e) => { setArea(e.target.value); setMeterId(''); }}>
              <option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Meter">
            <select className="input" value={meterId} onChange={(e) => setMeterId(e.target.value)}>
              <option value="">All meters</option>{areaMeters.map((m) => <option key={m.id} value={m.id}>{m.name}{m.area && m.area !== m.name ? ` – ${m.area}` : ''}</option>)}
            </select>
          </Field>
          <button className="btn primary" disabled={!rangeOk || busy} onClick={() => void find()}><Search size={16} />{busy ? 'Searching…' : 'Find readings'}</button>
        </div>
        {!rangeOk && <Note kind="warn">The "From" date must be on or before the "To" date.</Note>}
      </div>

      {rows && (
        <div className="card">
          <div className="card-head">
            <h3>{rows.length} reading{rows.length === 1 ? '' : 's'} · {formatDate(from)} to {formatDate(to)}</h3>
            <button className="btn danger" disabled={picked.size === 0} onClick={() => setDeleting(rows.filter((r) => picked.has(r.id)))}>
              <Trash2 size={16} />Delete selected ({picked.size})
            </button>
          </div>
          {rows.length === 0 ? <p className="muted">No readings match these filters.</p> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                  <th>Date</th><th>Utility</th><th>Area</th><th>Meter</th><th className="num">Opening</th><th className="num">Closing</th><th className="num">Consumption</th><th>Entered by</th><th />
                </tr></thead>
                <tbody>
                  {rows.slice(page * PAGE, (page + 1) * PAGE).map((r) => {
                    const m = meterById.get(r.meter_id);
                    return (
                      <tr key={r.id} className={picked.has(r.id) ? 'selected' : undefined}>
                        <td><input type="checkbox" aria-label={`Select ${m?.name ?? 'reading'} ${r.reading_date}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                        <td>{formatDate(r.reading_date)}</td>
                        <td>{m ? UTILITY_INFO[m.utility].label : '–'}</td>
                        <td>{m?.area ?? '–'}</td>
                        <td>{m?.name ?? 'Unknown meter'}</td>
                        <td className="num mono">{r.opening === null ? <span className="muted">last closing</span> : fmtAuto(r.opening)}</td>
                        <td className="num mono">{fmtAuto(r.closing)}</td>
                        <td className="num mono">{fmtAuto(consumption(r))} <span className="muted small">{m?.unit}</span></td>
                        <td>{enteredBy(r)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}><span className="actions" style={{ flexWrap: 'nowrap' }}>
                          <button className="btn sm" title="Edit this reading" aria-label={`Edit ${m?.name ?? 'reading'} ${r.reading_date}`} onClick={() => setEditing(r)}><Pencil size={14} /></button>
                          <button className="btn sm danger" title="Delete this reading" aria-label={`Delete ${m?.name ?? 'reading'} ${r.reading_date}`} onClick={() => setDeleting([r])}><Trash2 size={14} /></button>
                        </span></td>
                      </tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > PAGE && (
            <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <span className="muted small">Rows {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}</span>
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn sm" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {editing && <EditReading row={editing} meter={meterById.get(editing.meter_id)} onClose={async (saved) => { setEditing(null); if (saved) await find(); }} />}
      {deleting && (
        <ConfirmDialog danger typeToConfirm={deleting.length > 1 ? 'DELETE' : undefined}
          title={deleting.length === 1 ? 'Delete this reading?' : `Delete ${deleting.length} readings?`}
          message={deleting.length === 1
            ? `${meterById.get(deleting[0].meter_id)?.name ?? 'Meter'} on ${formatDate(deleting[0].reading_date)} (closing ${fmtAuto(deleting[0].closing)}) will be deleted permanently.`
            : `The ${deleting.length} selected readings will be deleted permanently. The deletion is recorded in the audit log.`}
          confirmLabel="Delete" onCancel={() => setDeleting(null)} onConfirm={() => remove(deleting)} />
      )}
    </div>
  );
}

function meterOrder(a?: Meter, b?: Meter): number {
  if (!a || !b) return 0;
  return a.utility === b.utility ? a.sort_order - b.sort_order : UTILITIES.indexOf(a.utility) - UTILITIES.indexOf(b.utility);
}

function EditReading({ row, meter, onClose }: { row: Row; meter?: Meter; onClose: (saved: boolean) => void }) {
  const [opening, setOpening] = useState(row.opening === null ? '' : String(row.opening));
  const [closing, setClosing] = useState(row.closing === null ? '' : String(row.closing));
  const [note, setNote] = useState(row.note ?? '');
  const [busy, setBusy] = useState(false);
  const o = opening.trim() === '' ? null : parseReading(opening);
  const c = parseReading(closing);
  const problem = c === null || !Number.isFinite(c) ? 'Enter the closing reading.'
    : c < 0 || (o !== null && o < 0) ? 'Readings cannot be negative.'
    : o !== null && !Number.isFinite(o) ? 'The opening reading is not a number.'
    : o !== null && c < o && !meter?.rollover_at ? 'The closing reading is lower than the opening reading.'
    : null;

  const save = async () => {
    if (problem || c === null) return;
    setBusy(true);
    try {
      await saveReading({ meter_id: row.meter_id, reading_date: row.reading_date, opening: o, closing: c, note: note.trim() || null });
      notify.success('Reading updated', `${meter?.name ?? 'Meter'} · ${formatDate(row.reading_date)}`);
      onClose(true);
    } catch (e) {
      notify.error('Reading not saved', friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit reading – ${meter?.name ?? 'meter'}`} onClose={() => onClose(false)}
      actions={<><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" disabled={busy || !!problem} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>{formatDate(row.reading_date)} · {meter?.area} · values in {meter?.unit}</p>
      <div className="grid g2">
        <Field label="Opening reading" hint="Leave empty to use the previous day's closing (normal case)."><input className="input mono" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
        <Field label="Closing reading"><input className="input mono" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} autoFocus /></Field>
      </div>
      <div style={{ marginTop: 12 }} /><Field label="Note (optional)"><input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {problem && <Note kind="warn">{problem}</Note>}
    </Modal>
  );
}
