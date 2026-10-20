import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { ChartCard, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Column } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Field, Note, PageHead } from '../components/ui.tsx';
import { actualByMonth, budgetFor, variance } from '../lib/kpi.ts';
import { fmtNumber, fmtPercent, fmtSigned } from '../lib/format.ts';

type MetricKey = 'electricity' | 'water' | 'gas' | 'roomsSold' | 'guests' | 'occupancy';
const METRICS: Array<{ key: MetricKey; label: string; unit: string }> = [
  { key: 'electricity', label: 'Electricity', unit: 'kWh' }, { key: 'water', label: 'Water', unit: 'm³' }, { key: 'gas', label: 'Gas', unit: 'L' },
  { key: 'roomsSold', label: 'Rooms sold', unit: 'rooms' }, { key: 'guests', label: 'Guests', unit: 'guests' }, { key: 'occupancy', label: 'Occupancy rate', unit: '%' },
];

export default function Budget() {
  const { fy, totals, metrics, budgets, settings } = useData();
  const [metric, setMetric] = useState<MetricKey>('electricity');
  const actual = useMemo(() => actualByMonth(fy, totals, metrics, settings.fiscalStartMonth), [fy, totals, metrics, settings.fiscalStartMonth]);

  const rows = useMemo(() => actual.map((a) => {
    const b = budgetFor(budgets, fy, a.month, 'budget');
    const p = budgetFor(budgets, fy - 1, a.month, 'previous') ?? budgetFor(budgets, fy, a.month, 'previous');
    const pick = (src: { electricity?: number | null; water?: number | null; gas?: number | null; rooms_sold?: number | null; guests?: number | null; occupancy_rate?: number | null } | null) => {
      if (!src) return null;
      return metric === 'roomsSold' ? src.rooms_sold ?? null : metric === 'occupancy' ? src.occupancy_rate ?? null : (src[metric as 'electricity'] ?? null);
    };
    const act = metric === 'roomsSold' ? a.roomsSold : metric === 'occupancy' ? a.occupancyAvg : (a[metric as 'electricity'] as number | null);
    const bud = pick(b), prev = pick(p);
    return { label: a.label, actual: act, budget: bud, previous: prev, vsBudget: variance(act, bud), vsPrev: variance(act, prev) };
  }), [actual, budgets, fy, metric]);

  const info = METRICS.find((m) => m.key === metric)!;
  const fmt = (v: number | null) => (metric === 'occupancy' ? fmtPercent(v) : fmtNumber(v, 0));
  const hasBudget = budgets.some((b) => b.kind === 'budget' && b.fiscal_year === fy);
  const chart = rows.map((r) => { const f = metric === 'occupancy' ? 100 : 1; return { label: r.label.split(' ')[0], Actual: r.actual === null ? null : r.actual * f, Budget: r.budget === null ? null : r.budget * f, Previous: r.previous === null ? null : r.previous * f }; });

  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'm', header: 'Month', value: (r) => r.label },
    { key: 'a', header: 'Actual', num: true, value: (r) => r.actual, render: (r) => fmt(r.actual) },
    { key: 'b', header: 'Budget', num: true, value: (r) => r.budget, render: (r) => fmt(r.budget) },
    { key: 'd', header: 'Δ vs budget', num: true, value: (r) => r.vsBudget.difference, render: (r) => (r.vsBudget.difference === null ? 'N/A' : metric === 'occupancy' ? `${fmtSigned(r.vsBudget.difference * 100, 1)} pts` : fmtSigned(r.vsBudget.difference, 0)) },
    { key: 'dp', header: '% vs budget', num: true, value: (r) => r.vsBudget.percent, render: (r) => (r.vsBudget.percent === null ? 'N/A' : `${fmtSigned(r.vsBudget.percent * 100, 1)} %`) },
    { key: 'p', header: 'Previous period', num: true, value: (r) => r.previous, render: (r) => fmt(r.previous) },
    { key: 'pp', header: '% vs previous', num: true, value: (r) => r.vsPrev.percent, render: (r) => (r.vsPrev.percent === null ? 'N/A' : `${fmtSigned(r.vsPrev.percent * 100, 1)} %`) },
  ];

  const build = () => ({
    title: `Budget vs Actual – ${info.label}`, period: `Reporting year ${fy}-${String(fy + 1).slice(2)}`, landscape: true,
    tables: [{ title: `${info.label} (${info.unit})`, headers: cols.map((c) => c.header), rows: rows.map((r) => cols.map((c) => (c.render ? String(c.render(r)) : (c.value(r) ?? null)))), numericCols: [1, 2, 3, 4, 5, 6] }],
    notes: ['Actual values come from saved meter readings and daily occupancy entries. Budget and previous-period values come from the workbook inputs.'],
  });

  return (
    <>
      <PageHead title="Budget vs Actual" subtitle={`Reporting year ${fy}-${String(fy + 1).slice(2)}`}><ExportButtons build={build} /></PageHead>
      <div className="filters"><Field label="Metric"><select className="input" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>)}</select></Field></div>
      {!hasBudget && <Note kind="warn"><strong>No budget values for this year.</strong> The budget block of the workbook is empty; fill it in Excel and re-import, or the budget columns remain N/A.</Note>}
      <div style={{ marginBottom: 16 }}>
        <ChartCard title={`${info.label} – actual vs budget vs previous (${info.unit})`} hasData={chart.some((c) => c.Actual !== null || c.Budget !== null || c.Previous !== null)}>
          <BarChart data={chart}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={70} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Bar isAnimationActive={false} dataKey="Actual" fill="#a51a2d" radius={[2, 2, 0, 0]} /><Bar isAnimationActive={false} dataKey="Budget" fill="#a8998f" radius={[2, 2, 0, 0]} /><Bar isAnimationActive={false} dataKey="Previous" fill="#d9ccc1" radius={[2, 2, 0, 0]} /></BarChart>
        </ChartCard>
      </div>
      <div className="card"><DataTable rows={rows} columns={cols} rowKey={(r) => r.label} searchable={false} pageSizes={[12]} defaultPageSize={12} /></div>
    </>
  );
}
