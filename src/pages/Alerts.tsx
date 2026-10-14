import { useMemo, useState } from 'react';
import { useData } from '../store/data.ts';
import { useIsAdmin } from '../store/auth.ts';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { DataTable } from '../components/DataTable.tsx';
import { ConfirmDialog, Field, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { analyzeSeries } from '../lib/anomaly.ts';
import { dailySeries, coverage } from '../lib/aggregate.ts';
import { addDays, formatDate, formatDateTimeLocal, localToday } from '../lib/dates.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import { notify } from '../store/ui.ts';
import type { AlertRow } from '../store/data.ts';
import { FilterX } from 'lucide-react';

export default function Alerts() {
  const { alerts, reloadAlerts, totals, settings } = useData();
  const admin = useIsAdmin();
  const [status, setStatus] = useState<'open' | 'all' | 'resolved'>('open');
  const [kind, setKind] = useState('all');
  const [del, setDel] = useState<AlertRow | null>(null);
  const today = localToday(settings.timezone);

  const shown = alerts.filter((a) => (status === 'all' || (status === 'open' ? !a.resolved_at : !!a.resolved_at)) && (kind === 'all' || a.kind === kind));
  const kinds = [...new Set(alerts.map((a) => a.kind))];

  // Derived data-quality findings (computed from the data, never stored)
  const findings = useMemo(() => {
    const out: Array<{ key: string; kind: 'bad' | 'warn' | 'info'; text: string }> = [];
    const start = addDays(today, -14);
    for (const u of UTILITIES) {
      const c = coverage(totals[u], start, today, today);
      const recentMissing = c.missing.filter((d) => d < today); // today is allowed to be incomplete
      if (c.daysElapsed > 0 && recentMissing.length > 0) out.push({ key: `miss-${u}`, kind: 'warn', text: `${UTILITY_INFO[u].label}: no valid consumption on ${recentMissing.length} of the last 14 days (${recentMissing.slice(-4).map(formatDate).join(', ')}${recentMissing.length > 4 ? ', …' : ''}).` });
      if (settings.anomaly.enabled) {
        const series = dailySeries(totals[u], addDays(today, -60), today);
        const an = analyzeSeries(series, settings.anomaly).filter((a) => a.state === 'anomaly' && a.date >= addDays(today, -7));
        for (const a of an) out.push({ key: `an-${u}-${a.date}`, kind: 'bad', text: `${UTILITY_INFO[u].label} on ${formatDate(a.date)}: ${a.value} ${UTILITY_INFO[u].unit} is ${a.direction === 'high' ? 'unusually high' : 'unusually low'} (typical ${a.baseline}, z = ${a.z}).` });
      }
    }
    return out;
  }, [totals, settings.anomaly, today]);

  const ack = async (a: AlertRow) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('alerts').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: u.user?.id ?? null }).eq('id', a.id);
    if (error) notify.error('Could not acknowledge', friendlyError(error)); else { notify.success('Alert acknowledged'); await reloadAlerts(); }
  };
  const remove = async (a: AlertRow) => {
    const { error } = await supabase.from('alerts').delete().eq('id', a.id);
    if (error) notify.error('Delete failed', friendlyError(error)); else { notify.success('Alert deleted'); await reloadAlerts(); }
    setDel(null);
  };

  const build = () => ({ title: 'Alerts', period: `Generated ${today}`, filters: [['Status', status], ['Type', kind]] as Array<[string, string]>, includeCharts: false,
    tables: [{ title: 'Alerts', headers: ['Raised', 'Type', 'Severity', 'Title', 'Message', 'State'], rows: shown.map((a) => [formatDateTimeLocal(a.created_at, settings.timezone), a.kind, a.severity, a.title, a.message, a.resolved_at ? 'Resolved' : a.acknowledged_at ? 'Acknowledged' : 'Open']) }] });

  return (
    <>
      <PageHead title="Alerts & Data Quality" subtitle="Sensor threshold alerts, device status and consumption checks"><ExportButtons build={build} /></PageHead>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Data quality (last 14 days)</h3>
        {findings.length === 0 ? <p className="muted">No missing data or abnormal consumption detected. Abnormal-consumption checks need at least {settings.anomaly.minSamples} valid previous days of history; with less, nothing is flagged.</p>
          : findings.map((f) => <Note key={f.key} kind={f.kind}>{f.text}</Note>)}
      </div>
      <div className="filters">
        <Field label="State"><select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></Field>
        <Field label="Type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All types</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <button className="btn" onClick={() => { setStatus('open'); setKind('all'); }}><FilterX size={16} />Clear filters</button>
      </div>
      <div className="card"><DataTable rows={shown} rowKey={(r) => String(r.id)} initialSort={{ key: 't', dir: 'desc' }} empty="No alerts." columns={[
        { key: 't', header: 'Raised', value: (r) => r.created_at, render: (r) => formatDateTimeLocal(r.created_at, settings.timezone) },
        { key: 'k', header: 'Type', value: (r) => r.kind },
        { key: 's', header: 'Severity', value: (r) => r.severity, render: (r) => <StatusPill kind={r.severity === 'critical' ? 'bad' : r.severity === 'warning' ? 'warn' : 'info'}>{r.severity}</StatusPill> },
        { key: 'a', header: 'Alert', value: (r) => r.title + ' ' + (r.message ?? ''), render: (r) => <div><strong>{r.title}</strong><div className="small muted">{r.message}</div></div> },
        { key: 'st', header: 'State', value: (r) => (r.resolved_at ? 'Resolved' : r.acknowledged_at ? 'Acknowledged' : 'Open') },
        { key: 'x', header: '', value: () => '', render: (r) => <span className="actions">{!r.acknowledged_at && !r.resolved_at && <button className="btn sm" onClick={() => void ack(r)}>Acknowledge</button>}{admin && <button className="btn sm danger" onClick={() => setDel(r)}>Delete</button>}</span> },
      ]} /></div>
      {del && <ConfirmDialog danger title="Delete alert?" message={`“${del.title}” will be removed permanently.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => remove(del)} />}
    </>
  );
}
