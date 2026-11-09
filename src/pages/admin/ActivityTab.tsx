// Owner only (Akram): who has the website open right now, who signed in, and who added, changed or
// deleted what. The database refuses these lists to every other account (migration 0012).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { useData } from '../../store/data.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Field, Note, StatusPill } from '../../components/ui.tsx';
import { formatDate, formatDateTimeLocal, timeAgo } from '../../lib/dates.ts';
import { UTILITY_INFO } from '../../lib/types.ts';
import type { Utility } from '../../lib/types.ts';
import { clsx, fmtNumber } from '../../lib/format.ts';

interface Person {
  user_id: string; username: string; display_name: string; role: string; active: boolean;
  last_seen_at: string | null; page: string | null; device: string | null; last_sign_in_at: string | null; sign_ins_30d: number;
}
interface SignIn { id: number; at: string; username: string | null; device: string | null }
interface Change { id: number; at: string; username: string | null; action: string; table_name: string; record_id: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }

/** Seen within the last 2 minutes = online (the website reports every minute while it is open). */
const ONLINE_MS = 2 * 60 * 1000;
const isOnline = (p: Person, now: number) => !!p.last_seen_at && now - new Date(p.last_seen_at).getTime() < ONLINE_MS;

const WHAT: Record<string, string> = {
  readings: 'Meter reading', daily_metrics: 'Occupancy & climate', meters: 'Meter', tariffs: 'Tariff', budgets: 'Budget',
  lpg_levels: 'LPG level', app_settings: 'Setting', profiles: 'User account', room_readings: 'Guest-room reading', rooms: 'Room',
  monthly_reports: 'Monthly PDF report',
};
const ROLE: Record<string, string> = { admin: 'Administrator', user: 'User', recorder: 'Recorder' };
/** already shown in the "What" column */
const IN_TITLE = new Set(['meter_id', 'reading_date', 'room_number', 'month_key']);
const HIDDEN = new Set(['id', 'updated_at', 'created_at', 'updated_by', 'entered_by', 'created_by', 'fetched_by', 'temp_source']);

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return fmtNumber(v, Number.isInteger(v) ? 0 : 3);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^-?\d+\.\d+$/.test(v)) return fmtNumber(Number(v), 3);
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  const j = JSON.stringify(v);
  return j.length > 40 ? `${j.slice(0, 40)}…` : j;
};

export default function ActivityTab() {
  const { settings, meterById } = useData();
  const [people, setPeople] = useState<Person[]>([]);
  const [signIns, setSignIns] = useState<SignIn[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [who, setWho] = useState('');
  const [kind, setKind] = useState('');

  const load = useCallback(async () => {
    const [p, s, c] = await Promise.all([
      supabase.rpc('owner_people'),
      supabase.from('sign_in_log').select('id, at, username, device').order('at', { ascending: false }).limit(300),
      supabase.from('audit_log').select('id, at, username, action, table_name, record_id, old_data, new_data').order('at', { ascending: false }).limit(1000),
    ]);
    if (p.error) setError(friendlyError(p.error));
    else {
      setError(null);
      setPeople(((p.data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...(r as unknown as Person), sign_ins_30d: Number(r.sign_ins_30d ?? 0) })));
    }
    if (!s.error) setSignIns((s.data ?? []) as SignIn[]);
    if (!c.error) setChanges((c.data ?? []) as Change[]);
    setNow(Date.now());
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000); // "online now" stays current while the page is open
    return () => window.clearInterval(t);
  }, [load]);

  const online = people.filter((p) => isOnline(p, now));
  const nameOf = useMemo(() => new Map(people.map((p) => [p.username, p.display_name || p.username])), [people]);

  /** One line saying what the change was about, and what changed. */
  const describe = useCallback((c: Change): { what: string; details: string } => {
    const d = (c.new_data ?? c.old_data ?? {}) as Record<string, unknown>;
    const o = (c.old_data ?? {}) as Record<string, unknown>;
    const n = (c.new_data ?? {}) as Record<string, unknown>;
    if (c.action === 'DELETE_USER') return { what: `User account · ${show(o.display_name ?? o.username)}`, details: 'Account deleted' };
    let what = WHAT[c.table_name] ?? c.table_name;
    const date = (k: string) => (typeof d[k] === 'string' ? formatDate(d[k] as string) : '');
    switch (c.table_name) {
      case 'readings': {
        const m = meterById.get(String(d.meter_id));
        what = `${m ? `${m.name} (${m.code})` : 'Meter reading'} · ${date('reading_date')}`;
        const unit = m?.nativeUnit ?? m?.unit ?? '';
        if (c.action === 'UPDATE') return { what, details: `Closing ${show(o.closing)} → ${show(n.closing)} ${unit}${o.opening !== n.opening ? ` · opening ${show(o.opening)} → ${show(n.opening)}` : ''}` };
        return { what, details: `Closing ${show(d.closing)} ${unit}${d.opening != null ? ` · opening ${show(d.opening)}` : ''}${d.note ? ` · note "${show(d.note)}"` : ''}` };
      }
      case 'daily_metrics': what = `Occupancy & climate · ${date('metric_date')}`; break;
      case 'meters': what = `Meter · ${show(d.name)} (${show(d.code)})`; break;
      case 'tariffs': what = `Tariff · ${UTILITY_INFO[d.utility as Utility]?.label ?? show(d.utility)} from ${date('effective_from')}`; break;
      case 'budgets': what = `Budget · ${show(d.kind)} ${show(d.month)}/${show(d.fiscal_year)}`; break;
      case 'profiles': what = `User account · ${show(d.display_name ?? d.username)}`; break;
      case 'app_settings': what = `Setting · ${show(d.key)}`; break;
      case 'room_readings': what = `Room ${show(d.room_number)} · ${date('reading_date')}`; break;
      case 'rooms': what = `Room ${show(d.room_number)}`; break;
      case 'monthly_reports': what = `Monthly PDF · ${show(d.label)}`; break;
      case 'lpg_levels': what = `LPG tank ${show(d.tank)}`; break;
    }
    if (c.action === 'UPDATE') {
      const diff = Object.keys(n).filter((k) => !HIDDEN.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
      const parts = diff.slice(0, 4).map((k) => `${k.replace(/_/g, ' ')}: ${k === 'role' ? ROLE[String(o[k])] ?? show(o[k]) : show(o[k])} → ${k === 'role' ? ROLE[String(n[k])] ?? show(n[k]) : show(n[k])}`);
      return { what, details: parts.length ? parts.join(' · ') + (diff.length > 4 ? ` · +${diff.length - 4} more` : '') : 'Saved again, no value changed' };
    }
    const keys = Object.keys(d).filter((k) => !HIDDEN.has(k) && !IN_TITLE.has(k) && d[k] !== null && d[k] !== '').slice(0, 4);
    return { what, details: keys.map((k) => `${k.replace(/_/g, ' ')} ${show(d[k])}`).join(' · ') };
  }, [meterById]);

  const kinds = useMemo(() => [...new Set(changes.map((c) => c.table_name))].sort(), [changes]);
  const users = useMemo(() => [...new Set(changes.map((c) => c.username ?? ''))].filter(Boolean).sort(), [changes]);
  const rows = useMemo(() => changes
    .filter((c) => (!who || c.username === who) && (!kind || c.table_name === kind))
    .map((c) => ({ ...c, ...describe(c) })), [changes, who, kind, describe]);

  if (error) {
    return <Note kind="warn"><strong>The activity page is not available yet.</strong> {/function|does not exist|schema cache/i.test(error) ? 'Run migration 0012_owner_activity.sql in the Supabase SQL Editor, then refresh.' : error}</Note>;
  }

  return (
    <div className="grid">
      <Note kind="info">Only your account sees this page. The website reports every minute while it is open, so “online” means seen in the last 2 minutes. Every addition, change and deletion is recorded with the person and the time; bulk imports are listed once in Audit &amp; maintenance.</Note>

      <div className="card">
        <div className="card-head">
          <h3>Online now · {online.length}</h3>
          <button className="btn sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} />Refresh</button>
        </div>
        {online.length === 0
          ? <p className="muted" style={{ margin: 0 }}>{loading ? 'Loading…' : 'Nobody else has the website open right now.'}</p>
          : (
            <ul className="online-list">
              {online.map((p) => (
                <li key={p.user_id}>
                  <span className="online-dot" aria-hidden="true" />
                  <div><strong>{p.display_name || p.username}</strong><span>{ROLE[p.role] ?? p.role} · {p.page ?? '—'}</span></div>
                  <small>{p.device ?? ''}<br />active {timeAgo(p.last_seen_at)}</small>
                </li>))}
            </ul>)}
      </div>

      <div className="card">
        <h3>All accounts</h3>
        <DataTable searchable={false} rows={people} rowKey={(r) => r.user_id} pageSizes={[10, 25]} defaultPageSize={10} empty="No accounts." columns={[
          { key: 'n', header: 'Name', value: (r) => r.display_name, render: (r) => <><strong>{r.display_name || r.username}</strong> <span className="muted small">@{r.username}</span></> },
          { key: 'r', header: 'Role', value: (r) => ROLE[r.role] ?? r.role },
          { key: 's', header: 'Status', value: (r) => (isOnline(r, now) ? 0 : r.last_seen_at ? 1 : 2), render: (r) => (!r.active ? <StatusPill kind="neutral">Deactivated</StatusPill> : isOnline(r, now) ? <StatusPill kind="ok">Online</StatusPill> : <span className="muted">{r.last_seen_at ? `seen ${timeAgo(r.last_seen_at)}` : 'never seen'}</span>) },
          { key: 'p', header: 'Last page', value: (r) => r.page },
          { key: 'd', header: 'Device', value: (r) => r.device },
          { key: 'l', header: 'Last sign-in', value: (r) => r.last_sign_in_at, render: (r) => (r.last_sign_in_at ? formatDateTimeLocal(r.last_sign_in_at, settings.timezone) : <span className="muted">—</span>) },
          { key: 'c', header: 'Sign-ins (30 days)', num: true, value: (r) => r.sign_ins_30d },
        ]} />
      </div>

      <div className="card">
        <h3>Who changed what</h3>
        <div className="filters">
          <Field label="Person"><select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Everybody</option>{users.map((u) => <option key={u} value={u}>{nameOf.get(u) ?? u}</option>)}</select></Field>
          <Field label="Type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Everything</option>{kinds.map((k) => <option key={k} value={k}>{WHAT[k] ?? k}</option>)}</select></Field>
        </div>
        <DataTable rows={rows} rowKey={(r) => String(r.id)} initialSort={{ key: 'at', dir: 'desc' }} empty="No changes recorded yet." columns={[
          { key: 'at', header: 'When', value: (r) => r.at, render: (r) => formatDateTimeLocal(r.at, settings.timezone) },
          { key: 'u', header: 'Who', value: (r) => (r.username ? nameOf.get(r.username) ?? r.username : 'System') },
          { key: 'a', header: 'Action', value: (r) => r.action, render: (r) => <StatusPill kind={r.action === 'INSERT' ? 'ok' : r.action === 'UPDATE' ? 'info' : 'bad'}>{r.action === 'INSERT' ? 'Added' : r.action === 'UPDATE' ? 'Changed' : 'Deleted'}</StatusPill> },
          { key: 'w', header: 'What', value: (r) => r.what },
          { key: 'd', header: 'Details', value: (r) => r.details, render: (r) => <span className={clsx('small', 'change-details')}>{r.details}</span> },
        ]} />
        <p className="small muted" style={{ marginBottom: 0 }}>Latest 1,000 changes. Reading values are in each meter's own unit.</p>
      </div>

      <div className="card">
        <h3>Sign-ins</h3>
        <DataTable rows={signIns} rowKey={(r) => String(r.id)} pageSizes={[10, 25, 50]} defaultPageSize={10} empty="No sign-ins recorded yet (they are recorded from now on)." columns={[
          { key: 'at', header: 'When', value: (r) => r.at, render: (r) => formatDateTimeLocal(r.at, settings.timezone) },
          { key: 'u', header: 'Who', value: (r) => (r.username ? nameOf.get(r.username) ?? r.username : '—') },
          { key: 'd', header: 'Device', value: (r) => r.device },
        ]} />
      </div>
    </div>
  );
}
