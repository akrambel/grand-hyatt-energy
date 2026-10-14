import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { useData } from '../store/data.ts';
import { useIsAdmin } from '../store/auth.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { usePeriodStats, useTotalCost } from '../hooks.ts';
import { ChartCard, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { KpiCard, Note, PageHead } from '../components/ui.tsx';
import { costInRange, tariffFor } from '../lib/kpi.ts';
import { fiscalMonths, formatDate } from '../lib/dates.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import { fmtAuto, fmtMoney, fmtNumber, NA } from '../lib/format.ts';

export default function Costs() {
  const { period, ui, clearButton } = usePeriod('fy');
  const admin = useIsAdmin();
  const { fy, settings, totals, tariffs } = useData();
  const { byUtility } = usePeriodStats(period.start, period.end);
  const total = useTotalCost(byUtility);
  const currency = tariffs[0]?.currency ?? 'SAR';

  const monthly = useMemo(() => fiscalMonths(fy, settings.fiscalStartMonth).map((m) => {
    const row: Record<string, number | string | null> = { label: m.label.split(' ')[0] };
    for (const u of UTILITIES) row[u] = costInRange(totals[u], tariffs, u, m.start, m.end).cost;
    return row;
  }), [fy, settings.fiscalStartMonth, totals, tariffs]);

  const tariffRows = UTILITIES.map((u) => { const t = tariffFor(tariffs, u, period.end); return { u, label: UTILITY_INFO[u].label, price: t?.price_per_unit ?? null, from: t?.effective_from ?? null, cur: t?.currency ?? currency }; });
  const costRows = UTILITIES.map((u) => ({ u, label: UTILITY_INFO[u].label, unit: UTILITY_INFO[u].unit, consumption: byUtility[u].total, cost: byUtility[u].cost.cost, cur: byUtility[u].cost.currency ?? currency, missing: byUtility[u].cost.daysWithoutTariff }));

  const build = () => ({
    title: 'Utility Costs', period: period.label,
    kpis: [...costRows.map((r) => ({ label: `${r.label} cost`, value: r.cost === null ? NA : fmtMoney(r.cost, r.cur) })), { label: 'Total cost', value: total.total === null ? NA : fmtMoney(total.total, total.currency ?? currency) }],
    tables: [
      { title: 'Cost by utility', headers: ['Utility', 'Consumption', 'Unit', 'Tariff (per unit)', 'Cost'], rows: costRows.map((r) => [r.label, fmtAuto(r.consumption), r.unit, tariffRows.find((t) => t.u === r.u)?.price ?? null, r.cost === null ? null : fmtNumber(r.cost, 2)]), numericCols: [1, 3, 4] },
      { title: 'Monthly cost', headers: ['Month', ...UTILITIES.map((u) => UTILITY_INFO[u].label), 'Total'], rows: monthly.map((m) => { const parts = UTILITIES.map((u) => m[u] as number | null); const s = parts.filter((p): p is number => p !== null); return [m.label as string, ...parts.map((p) => (p === null ? null : fmtNumber(p, 2))), s.length ? fmtNumber(s.reduce((a, b) => a + b, 0), 2) : null]; }), numericCols: [1, 2, 3, 4, 5] },
    ],
    notes: ['Cost = daily consumption × tariff in force on that day. Days without a tariff are excluded and shown as N/A.'],
  });

  return (
    <>
      <PageHead title="Utility Costs" subtitle={period.label}><ExportButtons build={build} /></PageHead>
      <div className="filters">{ui}{clearButton}</div>
      {tariffs.length === 0 && <Note kind="warn"><strong>No tariffs configured.</strong> The workbook contains no prices, so costs are N/A. {admin ? <Link to="/admin">Add tariffs in Administration → Tariffs</Link> : 'Ask an administrator to add tariffs.'}</Note>}
      {total.incomplete && total.total !== null && <Note kind="warn">Some utilities or days have no tariff; the total below is partial.</Note>}
      <div className="kpis">
        {costRows.map((r) => <KpiCard key={r.u} label={`${r.label} cost`} color={UTILITY_COLOR[r.u]} value={r.cost === null ? null : fmtMoney(r.cost, r.cur)} sub={r.consumption === null ? 'No consumption data' : `${fmtAuto(r.consumption)} ${r.unit}${r.missing ? ` · ${r.missing} day(s) without tariff` : ''}`} />)}
        <KpiCard label="Total cost" value={total.total === null ? null : fmtMoney(total.total, total.currency ?? currency)} />
      </div>
      <div className="grid g2">
        <ChartCard title={`Monthly cost (${currency})`} hasData={monthly.some((m) => UTILITIES.some((u) => m[u] !== null))}>
          <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={70} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            {UTILITIES.map((u) => <Bar key={u} dataKey={u} name={UTILITY_INFO[u].label} stackId="c" fill={UTILITY_COLOR[u]} />)}</BarChart>
        </ChartCard>
        <div className="card"><h3>Tariffs in force</h3>
          <DataTable searchable={false} rows={tariffRows} rowKey={(r) => r.u} pageSizes={[10]} columns={[
            { key: 'u', header: 'Utility', value: (r) => r.label }, { key: 'p', header: 'Price per unit', num: true, value: (r) => r.price, render: (r) => (r.price === null ? NA : `${fmtNumber(r.price, 4)} ${r.cur}`) },
            { key: 'f', header: 'Effective from', value: (r) => r.from, render: (r) => (r.from ? formatDate(r.from) : NA) }]} />
        </div>
      </div>
    </>
  );
}
