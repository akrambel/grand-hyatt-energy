// Details of one guest room: what the room register says about it (type, size, view, connecting room,
// accessibility) and its chilled water in the period shown on the Guest Rooms page.
import { useMemo } from 'react';
import { Accessibility, Link2 } from 'lucide-react';
import { Modal, Note, StatusPill } from './ui.tsx';
import { ACCESSIBLE_LABEL, roomDetail } from '../lib/roomDetails.ts';
import { ROOM_STATUS_LABEL, floorOf, roomKey } from '../lib/rooms.ts';
import type { RoomReading } from '../lib/rooms.ts';
import type { MeterDay } from '../lib/types.ts';
import { eachDay, formatDate } from '../lib/dates.ts';
import { fmtNumber } from '../lib/format.ts';

interface Props {
  room: string;
  inSystem: boolean;
  readings: RoomReading[];
  days: Map<string, MeterDay>;
  start: string;
  end: string;
  periodLabel: string;
  unit: string;
  onOpen: (room: string) => void;
  onClose: () => void;
}

export function RoomDetails({ room, inSystem, readings, days, start, end, periodLabel, unit, onOpen, onClose }: Props) {
  const d = roomDetail(room);
  const rows = useMemo(() => {
    const byDate = new Map(readings.filter((r) => r.room === room).map((r) => [r.date, r]));
    return eachDay(start, end).reverse().map((date) => {
      const r = byDate.get(date);
      return { date, status: r?.status ?? null, closing: r?.closing ?? null, consumption: days.get(roomKey(room, date))?.consumption ?? null };
    }).filter((r) => r.status !== null || r.closing !== null);
  }, [room, readings, days, start, end]);

  const used = rows.filter((r) => r.consumption !== null);
  const total = used.reduce((a, r) => a + (r.consumption ?? 0), 0);
  const avg = (s: string) => { const xs = used.filter((r) => r.status === s); return xs.length ? xs.reduce((a, r) => a + (r.consumption ?? 0), 0) / xs.length : null; };
  const occAvg = avg('occupied');
  const vacAvg = avg('vacant');
  const occupiedDays = rows.filter((r) => r.status === 'occupied').length;

  return (
    <Modal title={`Room ${room}`} onClose={onClose} actions={<button className="btn" onClick={onClose}>Close</button>}>
      {d ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>{d.type} · {d.floor} · {d.view} view</p>
          <dl className="room-facts">
            <div><dt>Room type</dt><dd>{d.type}</dd></div>
            <div><dt>Floor</dt><dd>{d.floor}</dd></div>
            <div><dt>Room size</dt><dd>{d.size} m²</dd></div>
            <div><dt>Balcony</dt><dd>{d.balcony} m²</dd></div>
            <div><dt>View</dt><dd>{d.view}</dd></div>
            <div><dt>Cluster</dt><dd>{d.cluster} · {d.clusterType}</dd></div>
            <div><dt>Connecting room</dt><dd>{d.connecting
              ? <button className="link-btn" onClick={() => onOpen(d.connecting!)}><Link2 size={13} /> {d.connecting} · {roomDetail(d.connecting)?.type}</button>
              : 'Not connecting'}</dd></div>
            <div><dt>Accessibility</dt><dd>{d.accessible ? <span><Accessibility size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{ACCESSIBLE_LABEL[d.accessible]}</span> : 'Standard room'}</dd></div>
          </dl>
        </>
      ) : <Note kind="warn">Room {room} is not in the hotel's room register ({floorOf(room)}).</Note>}

      <h4 style={{ margin: '18px 0 6px' }}>Chilled water · {periodLabel}</h4>
      {!inSystem ? <Note kind="info">This room has no BTU meter set up yet (Guest Rooms › Manage rooms).</Note> : (
        <>
          <dl className="room-facts">
            <div><dt>Total</dt><dd>{used.length ? `${fmtNumber(total, 2)} ${unit}` : 'N/A'}</dd></div>
            <div><dt>Days with consumption</dt><dd>{used.length}</dd></div>
            <div><dt>Occupied days</dt><dd>{occupiedDays}</dd></div>
            <div><dt>Avg occupied day</dt><dd>{occAvg === null ? 'N/A' : `${fmtNumber(occAvg, 2)} ${unit}`}</dd></div>
            <div><dt>Avg vacant day</dt><dd>{vacAvg === null ? 'N/A' : `${fmtNumber(vacAvg, 2)} ${unit}`}</dd></div>
          </dl>
          {rows.length === 0 ? <p className="muted small">No readings for this room in the period.</p> : (
            <div className="table-wrap" style={{ maxHeight: 280, marginTop: 10 }}>
              <table className="data">
                <thead><tr><th>Date</th><th>Status</th><th className="num">Reading ({unit})</th><th className="num">Consumption</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.date}>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.status ? <StatusPill kind={r.status === 'occupied' ? 'ok' : r.status === 'vacant' ? 'info' : 'warn'}>{ROOM_STATUS_LABEL[r.status]}</StatusPill> : <span className="muted">Not set</span>}</td>
                    <td className="num mono">{fmtNumber(r.closing, 3)}</td>
                    <td className="num mono">{fmtNumber(r.consumption, 3)}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>)}
        </>
      )}
    </Modal>
  );
}
