import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceDot, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { usePeriodStats } from '../hooks.ts';
import { ChartCard, PALETTE, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Column } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { KpiCard, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { areaTotals, dailySeries, monthlySeries } from '../lib/aggregate.ts';
import { analyzeSeries } from '../lib/anomaly.ts';
import type { PointAnalysis } from '../lib/anomaly.ts';
import { meterTotalsInRange } from '../lib/calc.ts';
import { UTILITY_INFO } from '../lib/types.ts';
import type { Utility } from '../lib/types.ts';
import { fmtAuto, fmtMoney, fmtNumber, NA } from '../lib/format.ts';
import { WaterSectionsPanel, useWaterSections } from '../components/WaterSections.tsx';
import { formatDate, monthShortName, parseISO } from '../lib/dates.ts';

export default function UtilityPage({ utility }: { utility: Utility }) {
  const info = UTILITY_INFO[utility];
  const { period, ui, clearButton } = usePeriod('month');
  const fy = useData((s) => s.fy);
  const settings = useData((s) => s.settings);
  const totals = useData((s) => s.totals[utility]);
  const meters = useData((s) => s.meters);
  const meterDays = useData((s) => s.meterDays);
  const stats = usePeriodStats(period.start, period.end).byUtility[utility];
  const [areaFilter, setAreaFilter] = useState('all');
  const sections = useWaterSections(period.start, period.end);

  const daily = useMemo(() => dailySeries(totals, period.start, period.end), [totals, period.start, period.end]);
  // anomalies use the whole loaded year as history, then are shown for the selected period
  const analysis = useMemo(() => {
    const all = dailySeries(totals, historyStart(period.start), period.end);
    return new Map(analyzeSeries(all, settings.anomaly.enabled ? settings.anomaly : { ...settings.anomaly, minSamples: Infinity }).map((a) => [a.date, a]));
  }, [totals, period, settings.anomaly]);
  const chart = daily.map((p) => {
    const { m, d } = parseISO(p.date);
    return { date: p.date, label: `${d} ${monthShortName(m)}`, value: p.value, baseline: analysis.get(p.date)?.baseline ?? null };
  });
  const anomalies = [...analysis.values()].filter((a) => a.state === 'anomaly' && a.date >= period.start && a.date <= period.end);
  const insufficient = [...analysis.values()].filter((a) => a.state === 'insufficient' && a.date >= period.start && a.date <= period.end).length;
  const monthly = monthlySeries(totals, fy, settings.fiscalStartMonth).map((m) => ({ label: m.label.split(' ')[0], value: m.value }));
  const areas = useMemo(() => areaTotals(meters, meterDays, utility, period.start, period.end), [meters, meterDays, utility, period.start, period.end]);
  const meterRows = useMemo(() => {
    const t = meterTotalsInRange(meters.filter((m) => m.utility === utility && (areaFilter === 'all' || m.area === areaFilter)), meterDays, period.start, period.end);
    return meters.filter((m) => t.has(m.id)).map((m) => ({ ...m, total: t.get(m.id)!.total, days: t.get(m.id)!.days }));
  }, [meters, meterDays, utility, areaFilter, period]);
  const areaNames = [...new Set(meters.filter((m) => m.utility === utility).map((m) => m.area))];

  const dayRows = daily.filter((p) => p.value !== null).map((p) => ({ date: p.date, value: p.value as number, a: analysis.get(p.date) as PointAnalysis | undefined, counted: totals.get(p.date)?.counted ?? 0, expected: totals.get(p.date)?.expected ?? 0 }));
  const dayCols: Column<(typeof dayRows)[number]>[] = [
    { key: 'd', header: 'Date', value: (r) => r.date, render: (r) => formatDate(r.date) },
    { key: 'v', header: `Total (${info.unit})`, num: true, value: (r) => r.value, render: (r) => fmtNumber(r.value, 3) },
    { key: 'm', header: 'Meters counted', num: true, value: (r) => r.counted, render: (r) => `${r.counted} / ${r.expected}` },
    { key: 'b', header: 'Typical (median)', num: true, value: (r) => r.a?.baseline ?? null, render: (r) => fmtAuto(r.a?.baseline ?? null) },
    { key: 'z', header: 'Deviation', value: (r) => r.a?.z ?? null, render: (r) => r.a?.state === 'anomaly' ? <StatusPill kind="bad">{r.a.direction === 'high' ? 'High' : 'Low'} (z {r.a.z})</StatusPill> : r.a?.state === 'normal' ? <StatusPill kind="ok">Normal</StatusPill> : <span className="muted">Not enough history</span> },
  ];

  const build = () => ({
    title: `${info.label} Report`, period: period.label,
    kpis: [
      { label: `Total (${info.unit})`, value: fmtAuto(stats.total) }, { label: 'Days with data', value: `${stats.days} of ${stats.coverage.daysElapsed}` },
      { label: `Average per day (${info.unit})`, value: fmtAuto(stats.avgDaily) }, { label: `Per guest (${info.unit})`, value: fmtNumber(stats.perGuest, 2) },
      { label: `Per occupied room (${info.unit})`, value: fmtNumber(stats.perRoom, 2) }, { label: 'Cost', value: stats.cost.cost === null ? NA : fmtMoney(stats.cost.cost, stats.cost.currency ?? 'SAR') },
    ],
    tables: [
      ...(utility === 'water' ? [{ title: 'Water sections (included in the water total)', headers: ['Section', `Total (${info.unit})`, 'Share %', 'Meters', 'Cost'], rows: sections.map((x) => [x.label, x.total, x.share, x.meters, x.cost.cost === null ? NA : fmtMoney(x.cost.cost, x.cost.currency ?? 'SAR')]), numericCols: [1, 2, 3] }] : []),
      { title: 'Consumption by area', headers: ['Area', `Total (${info.unit})`, 'Days'], rows: areas.map((a) => [a.area, a.total, a.days]), numericCols: [1, 2] },
      { title: 'Daily totals', headers: ['Date', `Total (${info.unit})`, 'Meters counted', 'Typical', 'Deviation'], rows: dayRows.map((r) => [r.date, r.value, `${r.counted}/${r.expected}`, r.a?.baseline ?? null, r.a?.state === 'anomaly' ? `${r.a.direction} (z ${r.a.z})` : r.a?.state === 'normal' ? 'Normal' : 'Not enough history']), numericCols: [1, 3] },
      { title: 'Consumption by meter', headers: ['Area', 'Meter', 'Total', 'Days'], rows: meterRows.map((m) => [m.area, m.name, m.total, m.days]), numericCols: [2, 3] },
    ],
    notes: stats.coverage.missing.length ? [`${stats.coverage.missing.length} day(s) in the period have no valid consumption (N/A).`] : [],
  });

  return (
    <>
      <PageHead title={info.label} subtitle={period.label}><ExportButtons build={build} /></PageHead>
      <div className="filters">{ui}{clearButton}</div>
      {stats.total === null && <Note kind="info"><strong>No data available for this period.</strong> Readings are needed on consecutive days to calculate consumption.</Note>}
      <div className="kpis">
        <KpiCard label={`Total consumption`} value={stats.total === null ? null : fmtAuto(stats.total)} unit={info.unit} color={UTILITY_COLOR[utility]} sub={`${stats.days} day(s) with data of ${stats.coverage.daysElapsed}`} />
        <KpiCard label="Average per day" value={stats.avgDaily === null ? null : fmtAuto(stats.avgDaily)} unit={info.unit} />
        <KpiCard label="Per guest" value={stats.perGuest === null ? null : fmtNumber(stats.perGuest, 2)} unit={`${info.unit}/guest`} sub={stats.intensityDays.guest ? `${stats.intensityDays.guest} days with guest data` : 'No guest data'} />
        <KpiCard label="Per occupied room" value={stats.perRoom === null ? null : fmtNumber(stats.perRoom, 2)} unit={`${info.unit}/room`} sub={stats.intensityDays.room ? `${stats.intensityDays.room} days with room data` : 'No occupied-room data'} />
        <KpiCard label="Cost" value={stats.cost.cost === null ? null : fmtMoney(stats.cost.cost, stats.cost.currency ?? 'SAR')} sub={stats.cost.cost === null ? 'No tariff configured' : stats.cost.daysWithoutTariff ? `${stats.cost.daysWithoutTariff} day(s) without tariff excluded` : undefined} />
        <KpiCard label="Abnormal days" value={settings.anomaly.enabled ? fmtNumber(anomalies.length) : null} color="#a51a2d" sub={insufficient ? `${insufficient} day(s) have too little history to judge` : undefined} />
      </div>
      {utility === 'water' && <WaterSectionsPanel sections={sections} start={period.start} end={period.end} />}
      <div className="grid g2" style={utility === 'water' ? { marginTop: 16 } : undefined}>
        <ChartCard title={`Daily consumption (${info.unit})`} hasData={chart.some((c) => c.value !== null)}>
          <LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Line type="monotone" dataKey="value" name={`Consumption (${info.unit})`} stroke={UTILITY_COLOR[utility]} strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="baseline" name="Typical (median of previous days)" stroke="#8a8a8a" strokeDasharray="4 4" dot={false} connectNulls={false} />
            {anomalies.map((a) => <ReferenceDot key={a.date} x={chart.find((c) => c.date === a.date)?.label} y={a.value} r={5} fill="#a51a2d" stroke="#fff" />)}
          </LineChart>
        </ChartCard>
        <ChartCard title={`Monthly totals – ${fy}-${String(fy + 1).slice(2)} (${info.unit})`} hasData={monthly.some((m) => m.value !== null)}>
          <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" name={info.unit} fill={UTILITY_COLOR[utility]} radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Consumption by area" hasData={areas.length > 0}>
          <PieChart><Pie data={areas} dataKey="total" nameKey="area" outerRadius={105} label={(e: { name?: string; percent?: number }) => `${e.name ?? ''} ${((e.percent ?? 0) * 100).toFixed(0)}%`}>{areas.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /></PieChart>
        </ChartCard>
        <ChartCard title="Area ranking" hasData={areas.length > 0}>
          <BarChart data={areas.slice(0, 12)} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis type="number" tick={axisStyle} /><YAxis type="category" dataKey="area" tick={axisStyle} width={120} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="total" name={info.unit} fill={UTILITY_COLOR[utility]} radius={[0, 4, 4, 0]} /></BarChart>
        </ChartCard>
      </div>
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><h3>Daily totals</h3></div>
          <DataTable rows={dayRows} columns={dayCols} rowKey={(r) => r.date} initialSort={{ key: 'd', dir: 'desc' }} rowClass={(r) => r.a?.state === 'anomaly'} empty="No daily totals for this period." />
        </div>
        <div className="card"><div className="card-head"><h3>Meters</h3>
          <select className="input" style={{ width: 'auto' }} value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} aria-label="Area filter"><option value="all">All areas</option>{areaNames.map((a) => <option key={a}>{a}</option>)}</select></div>
          <DataTable rows={meterRows} columns={[
            { key: 'a', header: 'Area', value: (r) => r.area }, { key: 'n', header: 'Meter', value: (r) => r.name },
            { key: 't', header: `Total (${info.unit})`, num: true, value: (r) => r.total, render: (r) => fmtNumber(r.total, 3) },
            { key: 'd', header: 'Days', num: true, value: (r) => r.days },
            { key: 'i', header: 'Counted in total', value: (r) => (r.include_in_total ? 'Yes' : 'No – informational') },
          ]} rowKey={(r) => r.id} />
        </div>
      </div>
    </>
  );
}

/** Start of the history window used for anomaly baselines: 60 days before the period (bounded by data). */
function historyStart(start: string): string {
  const { y, m, d } = parseISO(start);
  const dt = new Date(Date.UTC(y, m - 1, d - 60));
  return dt.toISOString().slice(0, 10);
}
