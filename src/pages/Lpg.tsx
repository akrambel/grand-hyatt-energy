import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { useCanEnter } from '../store/auth.ts';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { lpgStatus } from '../lib/settings.ts';
import { ChartCard, PALETTE, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { Field, KpiCard, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { fmtNumber, fmtPercent } from '../lib/format.ts';
import { formatDateTimeLocal } from '../lib/dates.ts';
import { notify } from '../store/ui.ts';
import { parseReading } from '../lib/validate.ts';

const KIND = { EMPTY: 'bad', CRITICAL: 'bad', LOW: 'warn', NORMAL: 'ok', HIGH: 'ok' } as const;

export default function Lpg() {
  const { lpgLatest, lpgHistory, settings, reloadLpg } = useData();
  const canEnter = useCanEnter();
  const [tank, setTank] = useState(1);
  const [pct, setPct] = useState('');
  const [busy, setBusy] = useState(false);
  const caps = settings.lpg.capacityLitres;

  const submit = async () => {
    const v = parseReading(pct);
    if (v === null || Number.isNaN(v) || v < 0 || v > 100) { notify.error('Invalid level', 'Enter a level between 0 and 100 %.'); return; }
    setBusy(true);
    const { error } = await supabase.from('lpg_levels').insert({ tank, level_fraction: Math.round(v * 100) / 10000 });
    setBusy(false);
    if (error) notify.error('Level not saved', friendlyError(error)); else { notify.success('Tank level saved', `Tank ${tank}: ${v} %`); setPct(''); await reloadLpg(); }
  };

  const chart = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const r of [...lpgHistory].reverse()) {
      const k = r.recorded_at.slice(0, 16);
      const row = byTime.get(k) ?? { t: formatDateTimeLocal(r.recorded_at, settings.timezone) };
      row[`Tank ${r.tank}`] = Math.round(r.level_fraction * 1000) / 10;
      byTime.set(k, row);
    }
    return [...byTime.values()];
  }, [lpgHistory, settings.timezone]);

  const tanks = [1, 2, 3].map((t) => { const l = lpgLatest.find((x) => x.tank === t) ?? null; return { tank: t, level: l?.level_fraction ?? null, at: l?.recorded_at ?? null, litres: l ? l.level_fraction * (caps[t - 1] ?? 0) : null, status: lpgStatus(l?.level_fraction ?? null) }; });

  const build = () => ({
    title: 'LPG Tank Levels', period: `Latest readings`, includeCharts: true,
    kpis: tanks.map((t) => ({ label: `Tank ${t.tank}`, value: t.level === null ? 'N/A' : `${fmtPercent(t.level)} (${fmtNumber(t.litres, 0)} L)` })),
    tables: [{ title: 'Level history', headers: ['Recorded', 'Tank', 'Level %'], rows: lpgHistory.map((r) => [formatDateTimeLocal(r.recorded_at, settings.timezone), r.tank, Math.round(r.level_fraction * 1000) / 10]), numericCols: [1, 2] }],
    notes: [`Tank capacities used for litres: ${caps.join(' / ')} L (configurable in Administration).`],
  });

  return (
    <>
      <PageHead title="LPG Tanks" subtitle="Real-time tank levels (status limits as in the workbook: ≤15 % critical, ≤30 % low)"><ExportButtons build={build} /></PageHead>
      <div className="kpis">
        {tanks.map((t) => (
          <KpiCard key={t.tank} label={`Tank ${t.tank}`} color={PALETTE[t.tank - 1]} value={t.level === null ? null : fmtPercent(t.level)}
            sub={t.level === null ? 'No level recorded' : `${fmtNumber(t.litres, 0)} of ${fmtNumber(caps[t.tank - 1], 0)} L · ${formatDateTimeLocal(t.at, settings.timezone)}`} />
        ))}
      </div>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        {tanks.map((t) => (
          <div className="card" key={t.tank}><div className="card-head"><h3>Tank {t.tank}</h3>{t.status && <StatusPill kind={KIND[t.status]}>{t.status}</StatusPill>}</div>
            <div style={{ height: 18, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)', overflow: 'hidden' }} role="progressbar" aria-valuenow={t.level === null ? undefined : Math.round(t.level * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${(t.level ?? 0) * 100}%`, height: '100%', background: t.status === 'CRITICAL' || t.status === 'EMPTY' ? '#b4500f' : t.status === 'LOW' ? '#c97a10' : '#a51a2d', transition: 'width .5s' }} /></div>
          </div>))}
      </div>
      {canEnter ? (
        <div className="card" style={{ marginBottom: 16 }}><h3>Record tank level</h3>
          <div className="filters" style={{ border: 0, padding: 0, marginBottom: 0 }}>
            <Field label="Tank"><select className="input" value={tank} onChange={(e) => setTank(Number(e.target.value))}>{[1, 2, 3].map((t) => <option key={t} value={t}>Tank {t}</option>)}</select></Field>
            <Field label="Level (%)"><input className="input mono" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 62.5" /></Field>
            <button className="btn primary" disabled={busy || !pct} onClick={() => void submit()}>Save level</button>
          </div></div>
      ) : <Note kind="info">You do not have permission to record tank levels.</Note>}
      <div className="grid g2">
        <ChartCard title="Level history (%)" hasData={chart.length > 0}>
          <LineChart data={chart}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="t" tick={axisStyle} minTickGap={30} /><YAxis tick={axisStyle} domain={[0, 100]} width={40} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            {[1, 2, 3].map((t) => <Line isAnimationActive={false} key={t} type="stepAfter" dataKey={`Tank ${t}`} stroke={PALETTE[t - 1]} dot={chart.length < 40} connectNulls />)}</LineChart>
        </ChartCard>
        <div className="card"><h3>History</h3>
          <DataTable rows={lpgHistory} rowKey={(r) => r.id ?? r.recorded_at + r.tank} initialSort={{ key: 'at', dir: 'desc' }} defaultPageSize={10} columns={[
            { key: 'at', header: 'Recorded', value: (r) => r.recorded_at, render: (r) => formatDateTimeLocal(r.recorded_at, settings.timezone) },
            { key: 't', header: 'Tank', value: (r) => r.tank }, { key: 'l', header: 'Level', num: true, value: (r) => r.level_fraction, render: (r) => fmtPercent(r.level_fraction) }]} />
        </div>
      </div>
    </>
  );
}
