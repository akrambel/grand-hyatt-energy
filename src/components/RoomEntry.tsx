import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, Field, Modal, Note } from './ui.tsx';
import { addDays, localToday } from '../lib/dates.ts';
import { fmtNumber } from '../lib/format.ts';
import { ROOM_STATUSES, ROOM_STATUS_LABEL, parseStatus } from '../lib/rooms.ts';
import type { RoomReading, RoomStatus } from '../lib/rooms.ts';
import { parseCsv, parseRoomSheet } from '../lib/roomImport.ts';
import { parseReading } from '../lib/validate.ts';
import { fetchRoomReadings, saveRoomDay } from '../store/rooms.ts';
import { notify } from '../store/ui.ts';
import { useData } from '../store/data.ts';
import { friendlyError } from '../lib/supabase.ts';

interface Row { closing: string; status: RoomStatus | '' }

/** Daily entry for all rooms: reading + occupancy status, by hand, by Excel/CSV upload, or both. */
export function RoomEntry({ rooms, unit, factor, onClose, onSaved }: { rooms: string[]; unit: string; factor: number; onClose: () => void; onSaved: (date: string) => void }) {
  const tz = useData((s) => s.settings.timezone);
  const today = localToday(tz);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [stored, setStored] = useState<Map<string, RoomReading>>(new Map());
  const [prev, setPrev] = useState<Map<string, number | null>>(new Map());
  const [prevStatus, setPrevStatus] = useState<Map<string, RoomStatus | null>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // load what is already saved for the day (and the day before, for the opening values)
  useEffect(() => {
    let off = false;
    setLoading(true);
    fetchRoomReadings(date, date, factor).then((list) => {
      if (off) return;
      const cur = new Map(list.filter((r) => r.date === date).map((r) => [r.room, r]));
      const before = list.filter((r) => r.date === addDays(date, -1));
      setStored(cur);
      setPrev(new Map(before.map((r) => [r.room, r.closing])));
      setPrevStatus(new Map(before.map((r) => [r.room, r.status])));
      setRows(Object.fromEntries(rooms.map((room) => { const r = cur.get(room); return [room, { closing: r?.closing != null ? String(r.closing) : '', status: r?.status ?? '' }]; })));
      setProblems([]);
    }).catch((e) => { if (!off) notify.error('Could not load the day', friendlyError(e)); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [date, rooms, factor]);

  const set = (room: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [room]: { ...r[room], ...patch } }));

  const analysis = useMemo(() => {
    let invalid = 0, negative = 0, changed = 0, filled = 0;
    const bad = new Set<string>(), neg = new Set<string>();
    for (const room of rooms) {
      const r = rows[room]; if (!r) continue;
      const n = r.closing.trim() === '' ? null : parseReading(r.closing);
      if (n !== null && (Number.isNaN(n) || n < 0)) { invalid++; bad.add(room); }
      const p = prev.get(room) ?? null;
      if (n !== null && !Number.isNaN(n) && p !== null && n < p) { negative++; neg.add(room); }
      const s = stored.get(room);
      const same = (s?.closing ?? null) === (n === null || Number.isNaN(n) ? null : n) && (s?.status ?? null) === (r.status || null);
      if (!same) changed++;
      if (r.closing.trim() !== '' || r.status !== '') filled++;
    }
    return { invalid, negative, changed, filled, bad, neg };
  }, [rows, prev, stored, rooms]);

  const applyUpload = async (file: File) => {
    try {
      let table: unknown[][];
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') table = parseCsv(await file.text());
      else {
        const { loadWorkbook } = await import('../lib/excelAdapter.ts');
        const wb = await loadWorkbook(await file.arrayBuffer());
        const ws = wb.worksheets.filter(Boolean)[0];
        if (!ws) throw new Error('The workbook has no sheet.');
        table = [];
        ws.eachRow({ includeEmpty: false }, (row: { values: unknown }) => {
          const vals = (row.values as unknown[]).slice(1).map((v) => (v !== null && typeof v === 'object' ? ((v as { result?: unknown; text?: unknown }).result ?? (v as { text?: unknown }).text ?? '') : v));
          table.push(vals);
        });
      }
      const res = parseRoomSheet(table, new Set(rooms));
      setRows((r) => {
        const next = { ...r };
        for (const e of res.entries) next[e.room] = { closing: e.closing !== null ? String(e.closing) : next[e.room]?.closing ?? '', status: e.status ?? next[e.room]?.status ?? '' };
        return next;
      });
      setProblems(res.problems);
      notify.success('File read', `${res.entries.length} room(s) filled in. Check the list, then press Save.`);
    } catch (e) { notify.error('Could not read the file', friendlyError(e)); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = rooms.map((room) => {
        const r = rows[room];
        const n = r.closing.trim() === '' ? null : (parseReading(r.closing) as number);
        return { room, closing: n, status: (r.status || null) as RoomStatus | null };
      }).filter((p) => {
        const s = stored.get(p.room);
        return (p.closing !== null || p.status !== null) && ((s?.closing ?? null) !== p.closing || (s?.status ?? null) !== p.status);
      });
      const n = await saveRoomDay(date, payload, factor);
      notify.success('Rooms saved', `${n} room(s) saved for ${date}.`);
      onSaved(date);
      onClose();
    } catch (e) { notify.error('Not saved', friendlyError(e)); } finally { setBusy(false); setConfirm(false); }
  };

  const shown = rooms.filter((r) => filter.trim() === '' || r.toLowerCase().includes(filter.trim().toLowerCase()));
  const canSave = !busy && !loading && analysis.invalid === 0 && analysis.changed > 0 && date <= today;

  return (
    <Modal title="Enter guest-room readings" onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!canSave} onClick={() => (analysis.negative > 0 ? setConfirm(true) : void save())}>Save {analysis.changed} changed room(s)</button></>}>
      <div className="form-grid" style={{ alignItems: 'end' }}>
        <Field label="Date"><input className="input" type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <Field label="Find room"><input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Room number" /></Field>
        <Field label="Set status for all rooms shown">
          <select className="input" value="" onChange={(e) => { const s = parseStatus(e.target.value); if (s) setRows((r) => { const n = { ...r }; for (const room of shown) n[room] = { ...n[room], status: s }; return n; }); }}>
            <option value="">Choose…</option>{ROOM_STATUSES.map((s) => <option key={s} value={s}>{ROOM_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
        <button className="btn sm" onClick={() => setRows((r) => { const n = { ...r }; for (const room of rooms) { const s = prevStatus.get(room); if (s && !n[room]?.status) n[room] = { ...n[room], status: s }; } return n; })}>Copy yesterday’s status (empty rooms)</button>
        <button className="btn sm" onClick={() => fileRef.current?.click()}>Upload Excel / CSV</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void applyUpload(f); }} />
      </div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>File columns: <strong>Room</strong>, <strong>Reading</strong> (cumulative, in {unit}), <strong>Status</strong> (Occupied, Vacant, OOO, OOS, House use). Only filled cells change the list below; nothing is saved until you press Save.</p>
      {problems.length > 0 && <Note kind="warn"><strong>File notes:</strong><ul>{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}{problems.length > 8 && <li>… and {problems.length - 8} more</li>}</ul></Note>}
      {rooms.length === 0 && <Note kind="info">No rooms yet. An administrator can add the room numbers with “Manage rooms”.</Note>}
      {analysis.invalid > 0 && <Note kind="bad">{analysis.invalid} reading(s) are not valid numbers (highlighted). Please correct them.</Note>}
      {analysis.negative > 0 && <Note kind="warn">{analysis.negative} room(s) have a reading lower than the previous day (highlighted). Such rooms are excluded from the totals until corrected.</Note>}
      <div style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid var(--line, #e9dfd6)', borderRadius: 10 }}>
        <table className="data">
          <thead><tr><th>Room</th><th className="num">Previous ({unit})</th><th className="num">Reading ({unit})</th><th className="num">Consumption</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((room) => {
              const r = rows[room] ?? { closing: '', status: '' };
              const n = r.closing.trim() === '' ? null : parseReading(r.closing);
              const p = prev.get(room) ?? null;
              const c = n !== null && !Number.isNaN(n) && p !== null && n >= p ? Math.round((n - p) * 1000) / 1000 : null;
              return (
                <tr key={room} className={analysis.bad.has(room) || analysis.neg.has(room) ? 'flag' : undefined}>
                  <td><strong>{room}</strong></td>
                  <td className="num mono">{p === null ? '—' : fmtNumber(p, 3)}</td>
                  <td className="num"><input className={analysis.bad.has(room) || analysis.neg.has(room) ? 'input mono invalid' : 'input mono'} style={{ width: 130, textAlign: 'right' }} inputMode="decimal" aria-label={`Reading room ${room}`} value={r.closing} onChange={(e) => set(room, { closing: e.target.value })} /></td>
                  <td className="num mono">{c === null ? '—' : fmtNumber(c, 3)}</td>
                  <td><select className="input" aria-label={`Status room ${room}`} value={r.status} onChange={(e) => set(room, { status: e.target.value as RoomStatus | '' })}>
                    <option value="">—</option>{ROOM_STATUSES.map((s) => <option key={s} value={s}>{ROOM_STATUS_LABEL[s]}</option>)}</select></td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">{loading ? 'Loading saved values…' : `${analysis.filled} of ${rooms.length} rooms filled · ${stored.size} already saved for this date`}</p>
      {confirm && <ConfirmDialog title="Readings lower than yesterday" confirmLabel="Save anyway" message={`${analysis.negative} room(s) have a reading lower than the previous day. They will be saved but excluded from the totals until corrected. Save anyway?`} onCancel={() => setConfirm(false)} onConfirm={() => save()} />}
    </Modal>
  );
}
