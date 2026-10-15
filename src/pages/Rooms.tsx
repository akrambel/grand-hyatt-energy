import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { BedDouble } from 'lucide-react';
import { useData } from '../store/data.ts';
import { useCanEnter, useIsAdmin } from '../store/auth.ts';
import { fetchRooms, fetchRoomReadings, addRooms, deleteRoom, roomUnitInfo } from '../store/rooms.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { ChartCard, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Column } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { RoomEntry } from '../components/RoomEntry.tsx';
import { ConfirmDialog, Field, KpiCard, Modal, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { ROOM_STATUSES, ROOM_STATUS_LABEL, analyzeRoomPeriod, compareRooms, computeRoomDays, groupAverage, parseRoomList, roomDayRows, vacantHigh } from '../lib/rooms.ts';
import type { RoomDayRow, RoomReading, RoomStatus } from '../lib/rooms.ts';
import { fmtAuto, fmtNumber, NA } from '../lib/format.ts';
import { formatDate, monthShortName, parseISO } from '../lib/dates.ts';
import { friendlyError } from '../lib/supabase.ts';
import { notify } from '../store/ui.ts';

const COLORS = { occupied: '#14a39b', vacant: '#e8892d', other: '#7a6a66', unknown: '#c9bdb4' } as const;
const STATE_TEXT: Record<string, string> = { ok: 'OK', rollover: 'Rollover', negative: 'Lower than previous day', missing_closing: 'No reading', missing_opening: 'No previous reading', no_reading: 'No data' };

export default function Rooms() {
  const { period, ui, clearButton } = usePeriod('mtd');
  const settings = useData((s) => s.settings);
  const { unit, factor } = roomUnitInfo(settings);
  const canEnter = useCanEnter();
  const admin = useIsAdmin();
  const [rooms, setRooms] = useState<string[]>([]);
  const [readings, setReadings] = useState<RoomReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayPick, setDayPick] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RoomStatus | 'none'>('all');
  const [entry, setEntry] = useState(false);
  const [manage, setManage] = useState(false);
  // 430 rooms × many days is a lot of rows: the page works on up to 93 days at a time.
  const spanDays = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86400000) + 1;
  const tooLong = spanDays > 93;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, rd] = await Promise.all([fetchRooms(), tooLong ? Promise.resolve([] as RoomReading[]) : fetchRoomReadings(period.start, period.end, factor)]);
      setRooms(r.sort(compareRooms)); setReadings(rd);
    } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
  }, [period.start, period.end, factor, tooLong]);
  useEffect(() => { void load(); }, [load]);

  const days = useMemo(() => computeRoomDays(rooms, readings), [rooms, readings]);
  const stats = useMemo(() => analyzeRoomPeriod(readings, days, period.start, period.end), [readings, days, period.start, period.end]);
  const latestDay = useMemo(() => {
    const ds = readings.map((r) => r.date).filter((d) => d >= period.start && d <= period.end);
    return ds.length ? ds.reduce((a, b) => (a > b ? a : b)) : period.end;
  }, [readings, period]);
  const day = dayPick && dayPick >= period.start && dayPick <= period.end ? dayPick : latestDay;
  const dayRows = useMemo(() => roomDayRows(rooms, readings, days, day), [rooms, readings, days, day]);
  const flagged = useMemo(() => vacantHigh(dayRows), [dayRows]);
  const filtered = useMemo(() => dayRows.filter((r) => statusFilter === 'all' || (statusFilter === 'none' ? r.status === null : r.status === statusFilter)), [dayRows, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { none: 0 };
    for (const s of ROOM_STATUSES) c[s] = 0;
    for (const r of dayRows) c[r.status ?? 'none']++;
    return c;
  }, [dayRows]);
  const withReading = dayRows.filter((r) => r.closing !== null).length;
  const withConsumption = dayRows.filter((r) => r.consumption !== null).length;

  const chartDaily = stats.byDay.map((d) => { const { m, d: dd } = parseISO(d.date); return { label: `${dd} ${monthShortName(m)}`, occupied: d.occupied, vacant: d.vacant, other: d.other, unknown: d.unknown, total: d.total }; });
  const avgChart = [
    { name: 'Occupied', value: groupAverage(stats.groups.occupied) }, { name: 'Vacant', value: groupAverage(stats.groups.vacant) },
    { name: 'Out of order / service / house use', value: groupAverage(stats.groups.other) },
  ].filter((a) => a.value !== null);
  const top = [...stats.perRoom.entries()].map(([room, v]) => ({ room, total: Math.round(v.total * 1000) / 1000, days: v.days })).sort((a, b) => b.total - a.total).slice(0, 10);

  const cols: Column<RoomDayRow>[] = [
    { key: 'r', header: 'Room', value: (r) => r.room, render: (r) => <strong>{r.room}</strong> },
    { key: 's', header: 'Status', value: (r) => (r.status ? ROOM_STATUS_LABEL[r.status] : ''), render: (r) => (r.status ? <StatusPill kind={r.status === 'occupied' ? 'ok' : r.status === 'vacant' ? 'info' : 'warn'}>{ROOM_STATUS_LABEL[r.status]}</StatusPill> : <span className="muted">Not set</span>) },
    { key: 'o', header: `Previous reading (${unit})`, num: true, value: (r) => r.opening, render: (r) => fmtNumber(r.opening, 3) },
    { key: 'c', header: `Reading (${unit})`, num: true, value: (r) => r.closing, render: (r) => fmtNumber(r.closing, 3) },
    { key: 'u', header: `Consumption (${unit})`, num: true, value: (r) => r.consumption, render: (r) => fmtNumber(r.consumption, 3) },
    { key: 'f', header: 'Check', value: (r) => (flagged.rooms.has(r.room) ? 'High for a vacant room' : STATE_TEXT[r.state] ?? r.state),
      render: (r) => flagged.rooms.has(r.room) ? <StatusPill kind="bad">High for a vacant room</StatusPill> : r.state === 'ok' ? <span className="muted">OK</span> : <StatusPill kind={r.state === 'negative' ? 'bad' : 'neutral'}>{STATE_TEXT[r.state] ?? r.state}</StatusPill> },
  ];

  const build = () => ({
    title: 'Guest Rooms – Chilled Water', period: period.label,
    filters: [['Day shown', formatDate(day)], ['Status filter', statusFilter === 'all' ? 'All' : statusFilter === 'none' ? 'Not set' : ROOM_STATUS_LABEL[statusFilter]]] as Array<[string, string]>,
    kpis: [
      { label: `Total consumption (${unit})`, value: stats.total === null ? NA : fmtAuto(stats.total) },
      { label: `Avg per occupied room-day (${unit})`, value: fmtNumber(groupAverage(stats.groups.occupied), 3) },
      { label: `Avg per vacant room-day (${unit})`, value: fmtNumber(groupAverage(stats.groups.vacant), 3) },
      { label: 'Rooms with a reading that day', value: `${withReading} of ${rooms.length}` },
    ],
    tables: [
      { title: `Rooms on ${formatDate(day)}`, headers: ['Room', 'Status', `Previous (${unit})`, `Reading (${unit})`, `Consumption (${unit})`, 'Check'],
        rows: filtered.map((r) => [r.room, r.status ? ROOM_STATUS_LABEL[r.status] : 'Not set', r.opening, r.closing, r.consumption, flagged.rooms.has(r.room) ? 'High for a vacant room' : STATE_TEXT[r.state] ?? r.state]), numericCols: [2, 3, 4] },
      { title: 'Average per room-day by status', headers: ['Status', `Average (${unit})`, 'Room-days'], rows: [['Occupied', groupAverage(stats.groups.occupied), stats.groups.occupied.count], ['Vacant', groupAverage(stats.groups.vacant), stats.groups.vacant.count], ['Out of order / service / house use', groupAverage(stats.groups.other), stats.groups.other.count], ['Status not set', groupAverage(stats.groups.unknown), stats.groups.unknown.count]], numericCols: [1, 2] },
    ],
    notes: ['Consumption = reading of the day − reading of the previous day. Missing readings are shown as N/A and never estimated.'],
  });

  return (
    <>
      <PageHead title="Guest Rooms – Chilled Water" subtitle={`${period.label} · one BTU meter per room · unit: ${unit}`}>
        {canEnter && <button className="btn primary" onClick={() => setEntry(true)} disabled={rooms.length === 0}><BedDouble size={16} />Enter readings</button>}
        {admin && <button className="btn" onClick={() => setManage(true)}>Manage rooms</button>}
        <ExportButtons build={build} disabled={rooms.length === 0} />
      </PageHead>
      <div className="filters">{ui}
        <Field label="Day shown in the table"><input className="input" type="date" min={period.start} max={period.end} value={day} onChange={(e) => setDayPick(e.target.value)} /></Field>
        <Field label="Room status"><select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">All statuses</option>{ROOM_STATUSES.map((s) => <option key={s} value={s}>{ROOM_STATUS_LABEL[s]}</option>)}<option value="none">Status not set</option></select></Field>
        {clearButton}<button className="btn" onClick={() => { setDayPick(''); setStatusFilter('all'); }}>Reset day &amp; status</button>
        <button className="btn" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {tooLong && <Note kind="warn"><strong>This period is too long for the room page ({spanDays} days).</strong> Choose MTD, WTD, a month, or a custom range of up to 93 days.</Note>}
      {error && <Note kind="bad"><strong>Could not load room data.</strong> {error} If you just updated the website, the database update (migration 0005) may still need to be applied.</Note>}
      {!error && !loading && !tooLong && rooms.length === 0 && <Note kind="info"><strong>No rooms have been added yet.</strong> {admin ? 'Press “Manage rooms” and paste the room numbers (for example 1101-1130 adds a whole range).' : 'Ask an administrator to add the room numbers.'}</Note>}
      {rooms.length > 0 && rooms.length !== 430 && <Note kind="info">{rooms.length} rooms are configured (the property has 430 keys).</Note>}

      <div className="kpis">
        <KpiCard label="Total consumption" value={stats.total === null ? null : fmtAuto(stats.total)} unit={unit} color="#14a39b" sub={`${rooms.length} rooms · selected period`} />
        <KpiCard label="Avg per occupied room-day" value={groupAverage(stats.groups.occupied) === null ? null : fmtNumber(groupAverage(stats.groups.occupied), 2)} unit={unit} sub={`${stats.groups.occupied.count} room-days`} />
        <KpiCard label="Avg per vacant room-day" value={groupAverage(stats.groups.vacant) === null ? null : fmtNumber(groupAverage(stats.groups.vacant), 2)} unit={unit} sub={`${stats.groups.vacant.count} room-days`} />
        <KpiCard label={`Readings on ${formatDate(day)}`} value={rooms.length ? `${withReading} / ${rooms.length}` : null} sub={`${withConsumption} with valid consumption`} />
        <KpiCard label="Occupied · Vacant" value={rooms.length ? `${counts.occupied} · ${counts.vacant}` : null} sub={`OOO ${counts.out_of_order} · OOS ${counts.out_of_service} · House use ${counts.house_use} · Not set ${counts.none}`} />
        <KpiCard label="Vacant rooms using a lot" value={flagged.occupiedAverage === null ? null : fmtNumber(flagged.rooms.size)} color="#a51a2d"
          sub={flagged.occupiedAverage === null ? 'Needs at least 5 occupied rooms with data that day' : `Vacant rooms at or above the occupied average (${fmtNumber(flagged.occupiedAverage, 2)} ${unit})`} />
      </div>

      <div className="grid g2">
        <ChartCard title={`Daily consumption by room status (${unit})`} chartId="rooms-daily" hasData={chartDaily.some((d) => d.total !== null)}>
          <BarChart data={chartDaily}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Bar dataKey="occupied" name="Occupied" stackId="a" fill={COLORS.occupied} /><Bar dataKey="vacant" name="Vacant" stackId="a" fill={COLORS.vacant} />
            <Bar dataKey="other" name="OOO / OOS / House use" stackId="a" fill={COLORS.other} /><Bar dataKey="unknown" name="Status not set" stackId="a" fill={COLORS.unknown} /></BarChart>
        </ChartCard>
        <ChartCard title={`Average per room-day by status (${unit})`} chartId="rooms-average" hasData={avgChart.length > 0}>
          <BarChart data={avgChart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="name" tick={axisStyle} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" name={unit} fill="#14a39b" /></BarChart>
        </ChartCard>
        <ChartCard title={`Top 10 rooms – total in period (${unit})`} chartId="rooms-top" hasData={top.length > 0}>
          <BarChart data={top} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis type="number" tick={axisStyle} /><YAxis type="category" dataKey="room" tick={axisStyle} width={60} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="total" name={unit} fill="#1f7fb8" /></BarChart>
        </ChartCard>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Rooms on {formatDate(day)}</h3></div>
        <DataTable rows={filtered} columns={cols} rowKey={(r) => r.room} defaultPageSize={50} pageSizes={[25, 50, 100, 500]} rowClass={(r) => flagged.rooms.has(r.room) || r.state === 'negative'} empty="No rooms to show." />
      </div>

      {entry && <RoomEntry rooms={rooms} unit={unit} factor={factor} onClose={() => setEntry(false)} onSaved={(d) => { setDayPick(d >= period.start && d <= period.end ? d : ''); void load(); }} />}
      {manage && <ManageRooms rooms={rooms} onClose={() => setManage(false)} onChanged={() => void load()} />}
    </>
  );
}

function ManageRooms({ rooms, onClose, onChanged }: { rooms: string[]; onClose: () => void; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const parsed = useMemo(() => parseRoomList(text), [text]);
  const fresh = parsed.rooms.filter((r) => !rooms.includes(r));
  const add = async () => {
    setBusy(true);
    try { await addRooms(fresh); notify.success('Rooms added', `${fresh.length} room(s) added.`); setText(''); onChanged(); }
    catch (e) { notify.error('Rooms not added', friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Manage rooms" onClose={onClose} actions={<button className="btn" onClick={onClose}>Close</button>}>
      <Note kind="info">{rooms.length} room(s) are in the system. Paste room numbers separated by spaces, commas or new lines. A range such as <strong>1101-1130</strong> adds every number in it. Rooms that already exist are skipped.</Note>
      <Field label="Room numbers to add"><textarea className="input mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1101-1130\n1201-1230'} /></Field>
      {text.trim() !== '' && <p className="small">{fresh.length} new room(s){parsed.rooms.length - fresh.length > 0 ? ` · ${parsed.rooms.length - fresh.length} already exist` : ''}{parsed.duplicates > 0 ? ` · ${parsed.duplicates} repeated in your list` : ''}{parsed.invalid.length > 0 ? ` · not valid: ${parsed.invalid.slice(0, 6).join(', ')}` : ''}</p>}
      <button className="btn primary" disabled={busy || fresh.length === 0} onClick={() => void add()}>Add {fresh.length || ''} room(s)</button>
      <hr style={{ margin: '18px 0' }} />
      <Field label="Remove a room (also deletes its readings)" hint="Use only for a room that was added by mistake."><input className="input mono" value={del} onChange={(e) => setDel(e.target.value.trim())} placeholder="Room number" /></Field>
      <button className="btn danger" style={{ marginTop: 8 }} disabled={!rooms.includes(del)} onClick={() => setConfirmDel(true)}>Remove room {del}</button>
      {confirmDel && <ConfirmDialog danger title={`Remove room ${del}?`} message="All readings and statuses saved for this room will be deleted. This cannot be undone." confirmLabel="Remove" typeToConfirm={del} onCancel={() => setConfirmDel(false)}
        onConfirm={async () => { try { await deleteRoom(del); notify.success('Room removed', del); setDel(''); onChanged(); } catch (e) { notify.error('Not removed', friendlyError(e)); } setConfirmDel(false); }} />}
    </Modal>
  );
}
