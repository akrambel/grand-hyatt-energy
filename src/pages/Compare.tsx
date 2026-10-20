import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { ChartCard, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Field, Note, PageHead } from '../components/ui.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import type { Utility } from '../lib/types.ts';
import { addDays, formatDate, localToday } from '../lib/dates.ts';
import { change } from '../lib/aggregate.ts';
import { fmtAuto, fmtNumber, fmtSigned, NA } from '../lib/format.ts';

export default function Compare() {
  const { totals, settings, metricsMap } = useData();
  const today = localToday(settings.timezone);
  const [a, setA] = useState(addDays(today, -1));
  const [b, setB] = useState(addDays(today, -2));
  const rows = useMemo(() => UTILITIES.map((u: Utility) => {
    const va = totals[u].get(a)?.total ?? null, vb = totals[u].get(b)?.total ?? null;
    return { u, label: UTILITY_INFO[u].label, unit: UTILITY_INFO[u].unit, a: va, b: vb, diff: va !== null && vb !== null ? va - vb : null, pct: change(va, vb) };
  }), [totals, a, b]);
  const occA = metricsMap.get(a)?.occupancy_rate ?? null, occB = metricsMap.get(b)?.occupancy_rate ?? null;
  const same = a === b;
  const build = () => ({
    title: 'Daily Comparison', period: `${formatDate(a)} vs ${formatDate(b)}`,
    tables: [{ title: 'Comparison', headers: ['Utility', 'Unit', formatDate(a), formatDate(b), 'Difference', '% change'], rows: rows.map((r) => [r.label, r.unit, r.a, r.b, r.diff === null ? null : fmtNumber(r.diff, 2), r.pct === null ? null : `${fmtSigned(r.pct * 100)} %`]), numericCols: [2, 3, 4, 5] }],
    notes: ['Only days with valid consumption are compared; missing days show N/A.'],
  });
  return (
    <>
      <PageHead title="Daily Comparison" subtitle="Compare the consumption of two days"><ExportButtons build={build} /></PageHead>
      <div className="filters">
        <Field label="Day A"><input className="input" type="date" max={today} value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Day B"><input className="input" type="date" max={today} value={b} onChange={(e) => setB(e.target.value)} /></Field>
        <button className="btn" onClick={() => { setA(addDays(today, -1)); setB(addDays(today, -2)); }}>Clear filters</button>
      </div>
      {same && <Note kind="warn">Choose two different days.</Note>}
      <div className="grid g2">
        <div className="card"><DataTable searchable={false} rows={rows} rowKey={(r) => r.u} pageSizes={[10]} columns={[
          { key: 'u', header: 'Utility', value: (r) => r.label }, { key: 'a', header: formatDate(a), num: true, value: (r) => r.a, render: (r) => `${fmtAuto(r.a)} ${r.a === null ? '' : r.unit}` },
          { key: 'b', header: formatDate(b), num: true, value: (r) => r.b, render: (r) => `${fmtAuto(r.b)} ${r.b === null ? '' : r.unit}` },
          { key: 'd', header: 'Difference', num: true, value: (r) => r.diff, render: (r) => (r.diff === null ? NA : `${fmtSigned(r.diff, 2)} ${r.unit}`) },
          { key: 'p', header: '% change', num: true, value: (r) => r.pct, render: (r) => (r.pct === null ? NA : `${fmtSigned(r.pct * 100)} %`) }]} />
          <p className="small muted">Occupancy: {formatDate(a)} {occA === null ? NA : `${(occA * 100).toFixed(1)} %`} · {formatDate(b)} {occB === null ? NA : `${(occB * 100).toFixed(1)} %`}</p></div>
        <ChartCard title="Relative comparison (% of Day B)" hasData={rows.some((r) => r.pct !== null)}>
          <BarChart data={rows.filter((r) => r.pct !== null).map((r) => ({ name: r.label, change: Math.round((r.pct as number) * 1000) / 10 }))}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="name" tick={axisStyle} /><YAxis tick={axisStyle} unit="%" width={50} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Bar isAnimationActive={false} dataKey="change" name="Change vs Day B (%)" fill={UTILITY_COLOR.energy} radius={[2, 2, 0, 0]} /></BarChart>
        </ChartCard>
      </div>
    </>
  );
}
