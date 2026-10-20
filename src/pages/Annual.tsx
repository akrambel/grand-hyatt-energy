import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { usePeriodStats, useTotalCost } from '../hooks.ts';
import { ChartCard, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { KpiCard, PageHead } from '../components/ui.tsx';
import { monthlySeries } from '../lib/aggregate.ts';
import { actualByMonth, budgetFor, costInRange, variance } from '../lib/kpi.ts';
import { fiscalRange, formatDate } from '../lib/dates.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import { fmtAuto, fmtMoney, fmtNumber, fmtPercent, fmtSigned, NA } from '../lib/format.ts';

export default function Annual() {
  const { fy, settings, totals, tariffs, metrics, budgets } = useData();
  const range = fiscalRange(fy, settings.fiscalStartMonth);
  const year = usePeriodStats(range.start, range.end);
  const cost = useTotalCost(year.byUtility);
  const monthly = useMemo(() => {
    const s = Object.fromEntries(UTILITIES.map((u) => [u, monthlySeries(totals[u], fy, settings.fiscalStartMonth)]));
    const act = actualByMonth(fy, totals, metrics, settings.fiscalStartMonth);
    return s.energy.map((m, i) => ({
      key: m.key, label: m.label, energy: s.energy[i].value, water: s.water[i].value, gas: s.gas[i].value, chilled: s.chilled[i].value,
      occ: act[i].occupancyAvg, guests: act[i].guests,
      cost: UTILITIES.map((u) => costInRange(totals[u], tariffs, u, m.start, m.end).cost).filter((c): c is number => c !== null).reduce<number | null>((a, c) => (a ?? 0) + c, null),
      budgetElec: budgetFor(budgets, fy, m.month, 'budget')?.electricity ?? null,
    }));
  }, [totals, tariffs, metrics, budgets, fy, settings.fiscalStartMonth]);
  const elecBudget = monthly.reduce<number | null>((a, m) => (m.budgetElec === null ? a : (a ?? 0) + m.budgetElec), null);
  const elecVar = variance(year.byUtility.energy.total, elecBudget);

  const label = `Reporting year ${fy}-${String(fy + 1).slice(2)}`;
  const build = () => ({
    title: `Annual Summary ${fy}-${String(fy + 1).slice(2)}`, period: `${formatDate(range.start)} – ${formatDate(range.end)}`, landscape: true,
    kpis: [...UTILITIES.map((u) => ({ label: `${UTILITY_INFO[u].label} (${UTILITY_INFO[u].unit})`, value: fmtAuto(year.byUtility[u].total) })), { label: 'Total cost', value: cost.total === null ? NA : fmtMoney(cost.total, cost.currency ?? 'SAR') },
      { label: 'Average occupancy', value: fmtPercent(year.metrics.occupancyAvg) }, { label: 'Guests', value: fmtNumber(year.metrics.guests) }],
    tables: [{ title: 'Monthly totals', headers: ['Month', 'Energy kWh', 'Water m³', 'Gas L', 'Chilled m³', 'Occupancy %', 'Guests', 'Cost'],
      rows: [...monthly.map((m) => [m.label, m.energy, m.water, m.gas, m.chilled, m.occ === null ? null : Math.round(m.occ * 1000) / 10, m.guests, m.cost === null ? null : Math.round(m.cost * 100) / 100]),
        ['TOTAL', year.byUtility.energy.total, year.byUtility.water.total, year.byUtility.gas.total, year.byUtility.chilled.total, year.metrics.occupancyAvg === null ? null : Math.round(year.metrics.occupancyAvg * 1000) / 10, year.metrics.guests, cost.total]], numericCols: [1, 2, 3, 4, 5, 6, 7] }],
    notes: ['Totals include only days with valid readings. Months without data are shown as N/A.'],
  });

  return (
    <>
      <PageHead title="Annual Summary" subtitle={`${label} (starts ${formatDate(range.start)})`}><ExportButtons build={build} /></PageHead>
      <div className="kpis">
        {UTILITIES.map((u) => <KpiCard key={u} label={UTILITY_INFO[u].label} color={UTILITY_COLOR[u]} value={year.byUtility[u].total === null ? null : fmtAuto(year.byUtility[u].total)} unit={UTILITY_INFO[u].unit} sub={`${year.byUtility[u].days} days with data`} />)}
        <KpiCard label="Utility cost" value={cost.total === null ? null : fmtMoney(cost.total, cost.currency ?? 'SAR')} />
        <KpiCard label="Electricity vs budget" value={elecVar.percent === null ? null : `${fmtSigned(elecVar.percent * 100)} %`} sub={elecBudget === null ? 'No budget values' : `budget ${fmtAuto(elecBudget)} kWh`} />
        <KpiCard label="Avg occupancy" value={year.metrics.occupancyAvg === null ? null : fmtPercent(year.metrics.occupancyAvg)} />
        <KpiCard label="Guests" value={year.metrics.guests === null ? null : fmtNumber(year.metrics.guests)} />
      </div>
      <div className="grid g2">
        <ChartCard title="Monthly energy (kWh)" hasData={monthly.some((m) => m.energy !== null)}><BarChart data={monthly}><CartesianGrid vertical={false} stroke="#ebe8e3" /><XAxis dataKey="label" tickFormatter={(v: string) => v.split(' ')[0]} tick={axisStyle} /><YAxis tick={axisStyle} width={70} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="energy" name="kWh" fill={UTILITY_COLOR.energy} radius={[2, 2, 0, 0]} /></BarChart></ChartCard>
        <ChartCard title="Monthly water & chilled water (m³)" hasData={monthly.some((m) => m.water !== null || m.chilled !== null)}><BarChart data={monthly}><CartesianGrid vertical={false} stroke="#ebe8e3" /><XAxis dataKey="label" tickFormatter={(v: string) => v.split(' ')[0]} tick={axisStyle} /><YAxis tick={axisStyle} width={70} /><Tooltip contentStyle={tooltipStyle} /><Legend /><Bar dataKey="water" name="Water" fill={UTILITY_COLOR.water} /><Bar dataKey="chilled" name="Chilled" fill={UTILITY_COLOR.chilled} /></BarChart></ChartCard>
      </div>
      <div className="card" style={{ marginTop: 16 }}><h3>Monthly totals</h3>
        <DataTable searchable={false} rows={monthly} rowKey={(r) => r.key} pageSizes={[12]} defaultPageSize={12} columns={[
          { key: 'm', header: 'Month', value: (r) => r.label },
          ...UTILITIES.map((u) => ({ key: u, header: `${UTILITY_INFO[u].short} (${UTILITY_INFO[u].unit})`, num: true, value: (r: (typeof monthly)[number]) => r[u], render: (r: (typeof monthly)[number]) => fmtNumber(r[u], 0) })),
          { key: 'o', header: 'Occupancy', num: true, value: (r) => r.occ, render: (r) => fmtPercent(r.occ) }, { key: 'g', header: 'Guests', num: true, value: (r) => r.guests, render: (r) => fmtNumber(r.guests) },
          { key: 'c', header: 'Cost', num: true, value: (r) => r.cost, render: (r) => fmtMoney(r.cost, cost.currency ?? 'SAR') }]} />
      </div>
    </>
  );
}
