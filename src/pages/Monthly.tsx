import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { usePeriodStats, useTotalCost } from '../hooks.ts';
import { ChartCard, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Field, KpiCard, Note, PageHead } from '../components/ui.tsx';
import { areaTotals, change, dailySeries } from '../lib/aggregate.ts';
import { budgetFor } from '../lib/kpi.ts';
import { fiscalMonths, formatDate, localToday, monthShortName, parseISO } from '../lib/dates.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import type { Utility } from '../lib/types.ts';
import { fmtAuto, fmtMoney, fmtNumber, fmtPercent, fmtSigned, NA } from '../lib/format.ts';
import { FilterX } from 'lucide-react';

export default function Monthly() {
  const { fy, settings, totals, metricsMap, meters, meterDays, budgets } = useData();
  const months = useMemo(() => fiscalMonths(fy, settings.fiscalStartMonth), [fy, settings.fiscalStartMonth]);
  const today = localToday(settings.timezone);
  const def = months.find((m) => today >= m.start && today <= m.end) ?? months[0];
  const [key, setKey] = useState(def.key);
  const idx = Math.max(0, months.findIndex((m) => m.key === key));
  const month = months[idx];
  const prev = idx > 0 ? months[idx - 1] : null; // previous month is only available inside the loaded reporting year
  const cur = usePeriodStats(month.start, month.end);
  const prevStats = usePeriodStats(prev?.start ?? '9999-01-01', prev?.end ?? '9999-01-02');
  const cost = useTotalCost(cur.byUtility);
  const [area, setArea] = useState<Utility>('energy');

  const days = useMemo(() => {
    const series = Object.fromEntries(UTILITIES.map((u) => [u, dailySeries(totals[u], month.start, month.end)])) as Record<Utility, ReturnType<typeof dailySeries>>;
    return series.energy.map((p, i) => {
      const { m, d } = parseISO(p.date); const mm = metricsMap.get(p.date);
      return { date: p.date, label: `${d} ${monthShortName(m)}`, energy: p.value, water: series.water[i].value, gas: series.gas[i].value, chilled: series.chilled[i].value,
        temp: mm?.avg_temp_c ?? null, occ: mm?.occupancy_rate ?? null, rooms: mm?.occupied_rooms ?? null, guests: mm?.guests ?? null };
    });
  }, [totals, metricsMap, month]);
  const areas = useMemo(() => areaTotals(meters, meterDays, area, month.start, month.end), [meters, meterDays, area, month]);
  const bud = budgetFor(budgets, fy, month.month, 'budget');
  const budgetOf: Record<Utility, number | null> = { energy: bud?.electricity ?? null, water: bud?.water ?? null, gas: bud?.gas ?? null, chilled: null };

  const build = () => ({
    title: `Monthly Report – ${month.label}`, period: `${formatDate(month.start)} – ${formatDate(month.end)}`, landscape: true,
    kpis: [...UTILITIES.map((u) => ({ label: `${UTILITY_INFO[u].label} (${UTILITY_INFO[u].unit})`, value: fmtAuto(cur.byUtility[u].total) })),
      { label: 'Total cost', value: cost.total === null ? NA : fmtMoney(cost.total, cost.currency ?? 'SAR') }, { label: 'Average occupancy', value: fmtPercent(cur.metrics.occupancyAvg) },
      { label: 'Guests', value: fmtNumber(cur.metrics.guests) }, { label: 'Average temperature (manual)', value: cur.metrics.avgTemp === null ? NA : `${fmtNumber(cur.metrics.avgTemp, 1)} °C` }],
    tables: [
      { title: 'Month summary', headers: ['Utility', 'Total', 'Unit', 'Days with data', 'Avg/day', 'Per guest', 'Per occupied room', 'Budget', 'Previous month'],
        rows: UTILITIES.map((u) => [UTILITY_INFO[u].label, cur.byUtility[u].total, UTILITY_INFO[u].unit, `${cur.byUtility[u].days}/${cur.byUtility[u].coverage.daysElapsed}`, cur.byUtility[u].avgDaily, cur.byUtility[u].perGuest, cur.byUtility[u].perRoom, budgetOf[u], prevStats.byUtility[u].total]), numericCols: [1, 4, 5, 6, 7, 8] },
      { title: 'Daily values', headers: ['Date', 'Energy kWh', 'Water m³', 'Gas L', 'Chilled m³', 'Temp °C', 'Occupancy %', 'Rooms', 'Guests'],
        rows: days.map((d) => [d.date, d.energy, d.water, d.gas, d.chilled, d.temp, d.occ === null ? null : Math.round(d.occ * 1000) / 10, d.rooms, d.guests]), numericCols: [1, 2, 3, 4, 5, 6, 7, 8] },
    ],
    notes: cur.byUtility.energy.coverage.missing.length ? [`Energy: ${cur.byUtility.energy.coverage.missing.length} day(s) without valid data.`] : [],
  });

  return (
    <>
      <PageHead title="Monthly Reports" subtitle={`${month.label} · ${formatDate(month.start)} – ${formatDate(month.end)}`}><ExportButtons build={build} /></PageHead>
      <div className="filters">
        <Field label="Month"><select className="input" value={month.key} onChange={(e) => setKey(e.target.value)}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}{m.start > today ? ' (future)' : ''}</option>)}</select></Field>
        <button className="btn" onClick={() => { setKey(def.key); setArea('energy'); }}><FilterX size={16} />Clear filters</button>
      </div>
      {UTILITIES.every((u) => cur.byUtility[u].total === null) && <Note kind="info"><strong>No consumption data for {month.label}.</strong></Note>}
      <div className="kpis">
        {UTILITIES.map((u) => {
          const s = cur.byUtility[u]; const ch = change(s.total, prevStats.byUtility[u].total);
          return <KpiCard key={u} label={UTILITY_INFO[u].label} color={UTILITY_COLOR[u]} value={s.total === null ? null : fmtAuto(s.total)} unit={UTILITY_INFO[u].unit}
            sub={[`${s.days}/${s.coverage.daysElapsed} days`, ch !== null ? `${fmtSigned(ch * 100)} % vs ${prev?.label.split(' ')[0]}` : prev ? '' : 'previous month not loaded', budgetOf[u] !== null && s.total !== null ? `budget ${fmtAuto(budgetOf[u])}` : ''].filter(Boolean).join(' · ')} />;
        })}
        <KpiCard label="Utility cost" value={cost.total === null ? null : fmtMoney(cost.total, cost.currency ?? 'SAR')} />
        <KpiCard label="Avg occupancy" value={cur.metrics.occupancyAvg === null ? null : fmtPercent(cur.metrics.occupancyAvg)} />
        <KpiCard label="Guests" value={cur.metrics.guests === null ? null : fmtNumber(cur.metrics.guests)} />
        <KpiCard label="Avg temperature (manual)" value={cur.metrics.avgTemp === null ? null : fmtNumber(cur.metrics.avgTemp, 1)} unit="°C" />
      </div>
      <div className="grid g2">
        {(['energy', 'water', 'gas', 'chilled'] as Utility[]).map((u) => (
          <ChartCard key={u} title={`Daily ${UTILITY_INFO[u].label} (${UTILITY_INFO[u].unit})`} hasData={days.some((d) => d[u] !== null)}>
            <BarChart data={days}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="label" tick={axisStyle} minTickGap={16} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Bar isAnimationActive={false} dataKey={u} name={UTILITY_INFO[u].unit} fill={UTILITY_COLOR[u]} radius={[2, 2, 0, 0]} /></BarChart>
          </ChartCard>))}
        <ChartCard title="Temperature (manual) & occupancy" hasData={days.some((d) => d.temp !== null || d.occ !== null)}>
          <LineChart data={days.map((d) => ({ ...d, occ: d.occ === null ? null : Math.round(d.occ * 1000) / 10 }))}><CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="label" tick={axisStyle} minTickGap={16} /><YAxis yAxisId="l" tick={axisStyle} width={40} /><YAxis yAxisId="r" orientation="right" tick={axisStyle} width={40} domain={[0, 100]} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Line isAnimationActive={false} yAxisId="l" dataKey="temp" name="Temp °C" stroke="#a8998f" dot={false} strokeWidth={2} /><Line isAnimationActive={false} yAxisId="r" dataKey="occ" name="Occupancy %" stroke="#a51a2d" dot={false} strokeWidth={2} /></LineChart>
        </ChartCard>
        <ChartCard title={`Area breakdown – ${UTILITY_INFO[area].label}`} hasData={areas.length > 0} actions={<select className="input" style={{ width: 'auto' }} value={area} onChange={(e) => setArea(e.target.value as Utility)} aria-label="Utility for area chart">{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label}</option>)}</select>}>
          <BarChart data={areas.slice(0, 12)} layout="vertical" margin={{ left: 40 }}><CartesianGrid horizontal={false} stroke="#efe7df" /><XAxis type="number" tick={axisStyle} /><YAxis type="category" interval={0} dataKey="area" tick={axisStyle} width={120} /><Tooltip contentStyle={tooltipStyle} /><Bar isAnimationActive={false} dataKey="total" fill={UTILITY_COLOR[area]} radius={[0, 2, 2, 0]} /></BarChart>
        </ChartCard>
      </div>
      <div className="card" style={{ marginTop: 16 }}><h3>Daily values</h3>
        <DataTable rows={days} rowKey={(r) => r.date} defaultPageSize={31} pageSizes={[10, 31]} columns={[
          { key: 'd', header: 'Date', value: (r) => r.date, render: (r) => formatDate(r.date) },
          ...UTILITIES.map((u) => ({ key: u, header: `${UTILITY_INFO[u].short} (${UTILITY_INFO[u].unit})`, num: true, value: (r: (typeof days)[number]) => r[u], render: (r: (typeof days)[number]) => fmtNumber(r[u], 2) })),
          { key: 't', header: 'Temp °C', num: true, value: (r) => r.temp, render: (r) => fmtNumber(r.temp, 1) }, { key: 'o', header: 'Occupancy', num: true, value: (r) => r.occ, render: (r) => fmtPercent(r.occ) },
          { key: 'r', header: 'Rooms', num: true, value: (r) => r.rooms, render: (r) => fmtNumber(r.rooms) }, { key: 'g', header: 'Guests', num: true, value: (r) => r.guests, render: (r) => fmtNumber(r.guests) }]} />
      </div>
    </>
  );
}
