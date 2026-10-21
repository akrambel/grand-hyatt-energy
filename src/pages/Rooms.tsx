import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { BedDouble, Search } from 'lucide-react';
import { useData } from '../store/data.ts';
import { useCanEnter, useIsAdmin } from '../store/auth.ts';
import { fetchRooms, fetchRoomReadings, addRooms, deleteRoom, hideRooms, roomUnitInfo } from '../store/rooms.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { ChartCard, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Column } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { RoomEntry } from '../components/RoomEntry.tsx';
import { RoomDetails } from '../components/RoomDetails.tsx';
import { roomDetail } from '../lib/roomDetails.ts';
import { ConfirmDialog, Field, KpiCard, Modal, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { FLOORS, FLOOR_COUNTS, HOTEL_ROOMS, OTHER_FLOOR, ROOM_STATUSES, ROOM_STATUS_LABEL, analyzeRoomPeriod, compareRooms, computeRoomDays, floorOf, groupAverage, isHotelRoom, parseRoomList, roomDayRows, vacantHigh } from '../lib/rooms.ts';
import type { RoomDayRow, RoomReading, RoomStatus } from '../lib/rooms.ts';
import { fmtAuto, fmtNumber, NA } from '../lib/format.ts';
import { formatDate, monthShortName, parseISO } from '../lib/dates.ts';
import { friendlyError } from '../lib/supabase.ts';
import { notify } from '../store/ui.ts';

const COLORS = { occupied: '#a51a2d', vacant: '#ecb3ba', other: '#a8998f', unknown: '#efe7df' } as const;
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
  const [floorFilter, setFloorFilter] = useState('all');
  const [entry, setEntry] = useState(false);
  const [manage, setManage] = useState(false);
  const [params, setParams] = useSearchParams();
  const [openRoom, setOpenRoomState] = useState<string | null>(params.get('room'));
  // ?room=905 (from the global search) opens that room
  useEffect(() => { const r = params.get('room'); if (r) setOpenRoomState(r); }, [params]);
  const setOpenRoom = (r: string | null) => { setOpenRoomState(r); if (!r && params.has('room')) { params.delete('room'); setParams(params, { replace: true }); } };
  const [find, setFind] = useState('');
  const findRoom = () => {
    const t = find.trim();
    if (!t) return;
    const room = /^\d{1,3}$/.test(t) ? t.padStart(3, '0') : t;
    if (isHotelRoom(room) || rooms.includes(room)) { setOpenRoom(room); setFind(''); }
    else notify.error('Room not found', `${t} is not in the hotel's room list.`);
  };
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
  const filtered = useMemo(() => dayRows.filter((r) => (statusFilter === 'all' || (statusFilter === 'none' ? r.status === null : r.status === statusFilter))
    && (floorFilter === 'all' || floorOf(r.room) === floorFilter)), [dayRows, statusFilter, floorFilter]);
  const missingRooms = useMemo(() => { const have = new Set(rooms); return HOTEL_ROOMS.filter((r) => !have.has(r)); }, [rooms]);
  const extraRooms = useMemo(() => rooms.filter((r) => !isHotelRoom(r)), [rooms]);

  // One row per floor: rooms, the day's readings and occupancy, and the period's consumption.
  const floors = useMemo(() => {
    const labels = [...FLOORS.map((f) => f.label), ...(extraRooms.length ? [OTHER_FLOOR] : [])];
    return labels.map((label) => {
      const rs = dayRows.filter((r) => floorOf(r.room) === label);
      let total = 0, days = 0;
      for (const r of rs) { const p = stats.perRoom.get(r.room); if (p) { total += p.total; days += p.days; } }
      return {
        label, configured: rs.length, expected: FLOOR_COUNTS[label] ?? null,
        read: rs.filter((r) => r.closing !== null).length, occupied: rs.filter((r) => r.status === 'occupied').length,
        total: days ? Math.round(total * 1000) / 1000 : null, perRoomDay: days ? Math.round((total / days) * 1000) / 1000 : null,
      };
    });
  }, [dayRows, stats, extraRooms.length]);

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
    { key: 'r', header: 'Room', value: (r) => r.room, render: (r) => <button className="link-btn" title="Show room details" onClick={() => setOpenRoom(r.room)}><strong>{r.room}</strong></button> },
    { key: 't', header: 'Type', value: (r) => roomDetail(r.room)?.type ?? '', render: (r) => <span className="small">{roomDetail(r.room)?.type ?? '–'}</span> },
    { key: 's', header: 'Status', value: (r) => (r.status ? ROOM_STATUS_LABEL[r.status] : ''), render: (r) => (r.status ? <StatusPill kind={r.status === 'occupied' ? 'ok' : r.status === 'vacant' ? 'info' : 'warn'}>{ROOM_STATUS_LABEL[r.status]}</StatusPill> : <span className="muted">Not set</span>) },
    { key: 'o', header: `Previous reading (${unit})`, num: true, value: (r) => r.opening, render: (r) => fmtNumber(r.opening, 3) },
    { key: 'c', header: `Reading (${unit})`, num: true, value: (r) => r.closing, render: (r) => fmtNumber(r.closing, 3) },
    { key: 'u', header: `Consumption (${unit})`, num: true, value: (r) => r.consumption, render: (r) => fmtNumber(r.consumption, 3) },
    { key: 'f', header: 'Check', value: (r) => (flagged.rooms.has(r.room) ? 'High for a vacant room' : STATE_TEXT[r.state] ?? r.state),
      render: (r) => flagged.rooms.has(r.room) ? <StatusPill kind="bad">High for a vacant room</StatusPill> : r.state === 'ok' ? <span className="muted">OK</span> : <StatusPill kind={r.state === 'negative' ? 'bad' : 'neutral'}>{STATE_TEXT[r.state] ?? r.state}</StatusPill> },
  ];

  const build = () => ({
    title: 'Guest Rooms', period: period.label,
    filters: [['Day shown', formatDate(day)], ['Floor', floorFilter === 'all' ? 'All floors' : floorFilter], ['Status filter', statusFilter === 'all' ? 'All' : statusFilter === 'none' ? 'Not set' : ROOM_STATUS_LABEL[statusFilter]]] as Array<[string, string]>,
    kpis: [
      { label: `Total consumption (${unit})`, value: stats.total === null ? NA : fmtAuto(stats.total) },
      { label: `Avg per occupied room-day (${unit})`, value: fmtNumber(groupAverage(stats.groups.occupied), 3) },
      { label: `Avg per vacant room-day (${unit})`, value: fmtNumber(groupAverage(stats.groups.vacant), 3) },
      { label: 'Rooms with a reading that day', value: `${withReading} of ${rooms.length}` },
    ],
    tables: [
      { title: `Rooms on ${formatDate(day)}`, headers: ['Room', 'Status', `Previous (${unit})`, `Reading (${unit})`, `Consumption (${unit})`, 'Check'],
        rows: filtered.map((r) => [r.room, r.status ? ROOM_STATUS_LABEL[r.status] : 'Not set', r.opening, r.closing, r.consumption, flagged.rooms.has(r.room) ? 'High for a vacant room' : STATE_TEXT[r.state] ?? r.state]), numericCols: [2, 3, 4] },
      { title: 'By floor', headers: ['Floor', 'Rooms', 'Read that day', 'Occupied that day', `Consumption in period (${unit})`, `Average per room-day (${unit})`],
        rows: floors.map((f) => [f.label, f.expected === null ? f.configured : `${f.configured} of ${f.expected}`, f.read, f.occupied, f.total, f.perRoomDay]), numericCols: [2, 3, 4, 5] },
      { title: 'Average per room-day by status', headers: ['Status', `Average (${unit})`, 'Room-days'], rows: [['Occupied', groupAverage(stats.groups.occupied), stats.groups.occupied.count], ['Vacant', groupAverage(stats.groups.vacant), stats.groups.vacant.count], ['Out of order / service / house use', groupAverage(stats.groups.other), stats.groups.other.count], ['Status not set', groupAverage(stats.groups.unknown), stats.groups.unknown.count]], numericCols: [1, 2] },
    ],
    notes: ['Consumption = reading of the day − reading of the previous day. Missing readings are shown as N/A and never estimated.'],
  });

  return (
    <>
      <PageHead title="Guest Rooms" subtitle={`${period.label} · ${HOTEL_ROOMS.length} rooms: 5 floors, the Tail and 10 beach villas · chilled water, one BTU meter per room · unit: ${unit}`}>
        {canEnter && <button className="btn primary" onClick={() => setEntry(true)} disabled={rooms.length === 0}><BedDouble size={16} />Enter readings</button>}
        {admin && <button className="btn" onClick={() => setManage(true)}>Manage rooms</button>}
        <ExportButtons build={build} disabled={rooms.length === 0} />
      </PageHead>
      <div className="filters">
        <Field label="Find a room"><span className="actions" style={{ flexWrap: 'nowrap' }}>
          <input className="input" style={{ width: 120 }} list="hotel-rooms" inputMode="numeric" placeholder="e.g. 905" value={find}
            onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') findRoom(); }} aria-label="Room number" />
          <button className="btn" onClick={findRoom} disabled={!find.trim()}><Search size={15} />Open</button></span>
          <datalist id="hotel-rooms">{HOTEL_ROOMS.map((r) => <option key={r} value={r}>{roomDetail(r)?.type}</option>)}</datalist></Field>
      </div>
      <div className="filters">{ui}
        <Field label="Day shown in the table"><input className="input" type="date" min={period.start} max={period.end} value={day} onChange={(e) => setDayPick(e.target.value)} /></Field>
        <Field label="Floor"><select className="input" value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
          <option value="all">All floors</option>{FLOORS.map((f) => <option key={f.key} value={f.label}>{f.label} ({FLOOR_COUNTS[f.label]} rooms)</option>)}
          {extraRooms.length > 0 && <option value={OTHER_FLOOR}>Not in the hotel list ({extraRooms.length})</option>}</select></Field>
        <Field label="Room status"><select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">All statuses</option>{ROOM_STATUSES.map((s) => <option key={s} value={s}>{ROOM_STATUS_LABEL[s]}</option>)}<option value="none">Status not set</option></select></Field>
        {clearButton}<button className="btn" onClick={() => { setDayPick(''); setStatusFilter('all'); setFloorFilter('all'); }}>Reset day, floor &amp; status</button>
        <button className="btn" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {tooLong && <Note kind="warn"><strong>This period is too long for the room page ({spanDays} days).</strong> Choose MTD, WTD, a month, or a custom range of up to 93 days.</Note>}
      {error && <Note kind="bad"><strong>Could not load room data.</strong> {error} If you just updated the website, the database update (migration 0005) may still need to be applied.</Note>}
      {!error && !loading && !tooLong && rooms.length === 0 && <Note kind="info"><strong>No rooms have been added yet.</strong> {admin ? `Press “Manage rooms”, then “Add the hotel's ${HOTEL_ROOMS.length} rooms”.` : 'Ask an administrator to add the room numbers.'}</Note>}
      {rooms.length > 0 && (missingRooms.length > 0 || extraRooms.length > 0) && (
        <Note kind="info">{rooms.length} rooms are set up; the hotel list has {HOTEL_ROOMS.length}.
          {missingRooms.length > 0 && <> {missingRooms.length} hotel room{missingRooms.length === 1 ? ' is' : 's are'} missing{admin ? ' (Manage rooms adds them in one click)' : ''}.</>}
          {extraRooms.length > 0 && <> {extraRooms.length} room number{extraRooms.length === 1 ? ' is' : 's are'} not in the hotel list: {extraRooms.slice(0, 8).join(', ')}{extraRooms.length > 8 ? '…' : ''}.{admin ? ' Manage rooms can hide them.' : ''}</>}
        </Note>)}

      <div className="kpis">
        <KpiCard label="Total consumption" value={stats.total === null ? null : fmtAuto(stats.total)} unit={unit} sub={`${rooms.length} rooms · selected period`} />
        <KpiCard label="Avg per occupied room-day" value={groupAverage(stats.groups.occupied) === null ? null : fmtNumber(groupAverage(stats.groups.occupied), 2)} unit={unit} sub={`${stats.groups.occupied.count} room-days`} />
        <KpiCard label="Avg per vacant room-day" value={groupAverage(stats.groups.vacant) === null ? null : fmtNumber(groupAverage(stats.groups.vacant), 2)} unit={unit} sub={`${stats.groups.vacant.count} room-days`} />
        <KpiCard label={`Readings on ${formatDate(day)}`} value={rooms.length ? `${withReading} / ${rooms.length}` : null} sub={`${withConsumption} with valid consumption`} />
        <KpiCard label="Occupied · Vacant" value={rooms.length ? `${counts.occupied} · ${counts.vacant}` : null} sub={`OOO ${counts.out_of_order} · OOS ${counts.out_of_service} · House use ${counts.house_use} · Not set ${counts.none}`} />
        <KpiCard label="Vacant rooms using a lot" value={flagged.occupiedAverage === null ? null : fmtNumber(flagged.rooms.size)} color="#a51a2d"
          sub={flagged.occupiedAverage === null ? 'Needs at least 5 occupied rooms with data that day' : `Vacant rooms at or above the occupied average (${fmtNumber(flagged.occupiedAverage, 2)} ${unit})`} />
      </div>

      <div className="grid g2">
        <ChartCard title={`Daily consumption by room status (${unit})`} chartId="rooms-daily" hasData={chartDaily.some((d) => d.total !== null)}>
          <BarChart data={chartDaily}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Bar isAnimationActive={false} dataKey="occupied" name="Occupied" stackId="a" fill={COLORS.occupied} /><Bar isAnimationActive={false} dataKey="vacant" name="Vacant" stackId="a" fill={COLORS.vacant} />
            <Bar isAnimationActive={false} dataKey="other" name="OOO / OOS / House use" stackId="a" fill={COLORS.other} /><Bar isAnimationActive={false} dataKey="unknown" name="Status not set" stackId="a" fill={COLORS.unknown} /></BarChart>
        </ChartCard>
        <ChartCard title={`Average per room-day by status (${unit})`} chartId="rooms-average" hasData={avgChart.length > 0}>
          <BarChart data={avgChart}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="name" tick={axisStyle} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Bar isAnimationActive={false} dataKey="value" name={unit} fill="#a51a2d" radius={[6, 6, 2, 2]} maxBarSize={72} /></BarChart>
        </ChartCard>
        <div className="card">
          <div className="card-head"><h3>By floor</h3><span className="meta">Rooms read and occupied on {formatDate(day)}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data overview-table">
              <thead><tr><th>Floor</th><th className="num">Rooms</th><th className="num">Read</th><th className="num">Occupied</th><th className="num">Period ({unit})</th><th className="num">Per room-day</th></tr></thead>
              <tbody>
                {floors.map((f) => (
                  <tr key={f.label}>
                    <td><button className="link-btn" onClick={() => setFloorFilter(f.label)}>{f.label}</button></td>
                    <td className="num">{f.configured}{f.expected !== null && f.configured !== f.expected && <span className="muted"> of {f.expected}</span>}</td>
                    <td className="num">{f.read}</td>
                    <td className="num">{f.occupied}</td>
                    <td className="num">{f.total === null ? <span className="na">—</span> : fmtAuto(f.total)}</td>
                    <td className="num">{f.perRoomDay === null ? <span className="na">—</span> : fmtNumber(f.perRoomDay, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <ChartCard title={`Top 10 rooms – total in period (${unit})`} chartId="rooms-top" hasData={top.length > 0}>
          <BarChart data={top} layout="vertical" margin={{ left: 20 }}><CartesianGrid horizontal={false} stroke="#efe7df" /><XAxis type="number" tick={axisStyle} /><YAxis type="category" interval={0} dataKey="room" tick={axisStyle} width={60} /><Tooltip contentStyle={tooltipStyle} /><Bar isAnimationActive={false} dataKey="total" name={unit} fill="#a51a2d" radius={[2, 6, 6, 2]} cursor="pointer" onClick={(b: { room?: string }) => { if (b.room) setOpenRoom(b.room); }} /></BarChart>
        </ChartCard>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Rooms on {formatDate(day)}{floorFilter !== 'all' && ` · ${floorFilter}`}</h3></div>
        <DataTable rows={filtered} columns={cols} rowKey={(r) => r.room} defaultPageSize={50} pageSizes={[25, 50, 100, 500]} rowClass={(r) => flagged.rooms.has(r.room) || r.state === 'negative'} empty="No rooms to show." />
      </div>

      {entry && <RoomEntry rooms={rooms} unit={unit} factor={factor} onClose={() => setEntry(false)} onSaved={(d) => { setDayPick(d >= period.start && d <= period.end ? d : ''); void load(); }} />}
      {openRoom && <RoomDetails room={openRoom} inSystem={rooms.includes(openRoom)} readings={readings} days={days} start={period.start} end={period.end}
        periodLabel={period.label} unit={unit} onOpen={setOpenRoom} onClose={() => setOpenRoom(null)} />}
      {manage && <ManageRooms rooms={rooms} onClose={() => setManage(false)} onChanged={() => void load()} />}
    </>
  );
}

function ManageRooms({ rooms, onClose, onChanged }: { rooms: string[]; onClose: () => void; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const parsed = useMemo(() => parseRoomList(text), [text]);
  const fresh = parsed.rooms.filter((r) => !rooms.includes(r));
  const missing = HOTEL_ROOMS.filter((r) => !rooms.includes(r));
  const extra = rooms.filter((r) => !isHotelRoom(r));
  const add = async (list: string[]) => {
    setBusy(true);
    try { await addRooms(list); notify.success('Rooms added', `${list.length} room(s) added.`); setText(''); onChanged(); }
    catch (e) { notify.error('Rooms not added', friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Manage rooms" onClose={onClose} actions={<button className="btn" onClick={onClose}>Close</button>}>
      <h3>Hotel room list</h3>
      <p className="small muted" style={{ margin: '4px 0 10px' }}>{FLOORS.map((f) => `${f.label} ${FLOOR_COUNTS[f.label]}`).join(' · ')} · {HOTEL_ROOMS.length} rooms in total. L00 has no rooms 053 to 057 and L01 has no room 155.</p>
      {missing.length === 0
        ? <Note kind="ok">All {HOTEL_ROOMS.length} hotel rooms are in the system.</Note>
        : <button className="btn primary" disabled={busy} onClick={() => void add(missing)}>Add the hotel's {HOTEL_ROOMS.length} rooms{missing.length !== HOTEL_ROOMS.length ? ` (${missing.length} missing)` : ''}</button>}
      {extra.length > 0 && <>
        <Note kind="warn"><strong>{extra.length} room number{extra.length === 1 ? ' is' : 's are'} not in the hotel list</strong>, so the page counts {rooms.length} rooms instead of {HOTEL_ROOMS.length}: {extra.slice(0, 40).join(', ')}{extra.length > 40 ? ` … and ${extra.length - 40} more` : ''}.</Note>
        <button className="btn danger" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirmHide(true)}>Hide the {extra.length} rooms not in the hotel list</button>
      </>}
      {confirmHide && <ConfirmDialog title={`Hide ${extra.length} rooms?`} confirmLabel="Hide rooms" onCancel={() => setConfirmHide(false)}
        message={`These rooms disappear from every page and from the totals, so the page shows the hotel's ${HOTEL_ROOMS.length} rooms. Nothing is deleted: their readings stay in the database and a room can be shown again by adding its number.`}
        onConfirm={async () => { setBusy(true); try { await hideRooms(extra); notify.success('Rooms hidden', `${extra.length} room(s)`); onChanged(); } catch (e) { notify.error('Rooms not hidden', friendlyError(e)); } finally { setBusy(false); setConfirmHide(false); } }} />}
      <hr style={{ margin: '18px 0' }} />
      <Field label="Other room numbers to add" hint="Separated by spaces, commas or new lines. A range such as 101-130 adds every number in it; 001-010 keeps the zeros. Rooms that already exist are skipped."><textarea className="input mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={'101-130'} /></Field>
      {text.trim() !== '' && <p className="small">{fresh.length} new room(s){parsed.rooms.length - fresh.length > 0 ? ` · ${parsed.rooms.length - fresh.length} already exist` : ''}{parsed.duplicates > 0 ? ` · ${parsed.duplicates} repeated in your list` : ''}{parsed.invalid.length > 0 ? ` · not valid: ${parsed.invalid.slice(0, 6).join(', ')}` : ''}</p>}
      <button className="btn" style={{ marginTop: 8 }} disabled={busy || fresh.length === 0} onClick={() => void add(fresh)}>Add {fresh.length || ''} room(s)</button>
      <hr style={{ margin: '18px 0' }} />
      <Field label="Remove a room (also deletes its readings)" hint="Use only for a room that was added by mistake."><input className="input mono" value={del} onChange={(e) => setDel(e.target.value.trim())} placeholder="Room number" /></Field>
      <button className="btn danger" style={{ marginTop: 8 }} disabled={!rooms.includes(del)} onClick={() => setConfirmDel(true)}>Remove room {del}</button>
      {confirmDel && <ConfirmDialog danger title={`Remove room ${del}?`} message="All readings and statuses saved for this room will be deleted. This cannot be undone." confirmLabel="Remove" typeToConfirm={del} onCancel={() => setConfirmDel(false)}
        onConfirm={async () => { try { await deleteRoom(del); notify.success('Room removed', del); setDel(''); onChanged(); } catch (e) { notify.error('Not removed', friendlyError(e)); } setConfirmDel(false); }} />}
    </Modal>
  );
}
