import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { PenSquare } from 'lucide-react';
import { useData } from '../store/data.ts';
import { useSensors } from '../store/sensors.ts';
import { useCanEnter } from '../store/auth.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { usePeriodStats, useTotalCost } from '../hooks.ts';
import { ChartCard, HUE, GRID, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Note } from '../components/ui.tsx';
import { sectionKpis, useWaterSections } from '../components/WaterSections.tsx';
import { dailySeries, monthlySeries } from '../lib/aggregate.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import type { DayTotal, Utility } from '../lib/types.ts';
import { clsx, fmtAuto, fmtMoney, fmtNumber, fmtPercent, NA } from '../lib/format.ts';
import { ambientTemp, deviceState } from '../lib/sensor.ts';
import { addDays, formatDate, monthShortName, parseISO, timeAgo } from '../lib/dates.ts';

const MAX_DAILY_BARS = 93;

/** "20 Oct" */
const shortDate = (iso: string): string => { const { m, d } = parseISO(iso); return `${d} ${monthShortName(m)}`; };

interface RoundCell {
  u: Utility;
  day: DayTotal | null;      // the utility's total on the reading day
  baseline: number | null;   // mean of up to 7 earlier days with data (within 14 days)
  baseDays: number;
  change: number | null;     // fraction vs baseline
}

/** Latest day with a total on or before `limit`, across all utilities. */
function latestDay(totals: Record<Utility, Map<string, DayTotal>>, limit: string): string | null {
  let best: string | null = null;
  for (const u of UTILITIES) for (const [d, t] of totals[u]) if (t.total !== null && d <= limit && (best === null || d > best)) best = d;
  return best;
}

function roundCell(u: Utility, map: Map<string, DayTotal>, day: string | null): RoundCell {
  const t = day ? map.get(day) ?? null : null;
  const prior: number[] = [];
  if (day) for (let i = 1; i <= 14 && prior.length < 7; i++) { const v = map.get(addDays(day, -i))?.total; if (v !== null && v !== undefined) prior.push(v); }
  const baseline = prior.length >= 3 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
  const change = t?.total != null && baseline ? (t.total - baseline) / baseline : null;
  return { u, day: t, baseline, baseDays: prior.length, change };
}

export default function Overview() {
  const { period, ui, clearButton } = usePeriod('fy');
  const fy = useData((s) => s.fy);
  const totals = useData((s) => s.totals);
  const settings = useData((s) => s.settings);
  const metricsMap = useData((s) => s.metricsMap);
  const alerts = useData((s) => s.alerts);
  const devices = useData((s) => s.devices);
  const latest = useSensors((s) => s.latest);
  const canEnter = useCanEnter();
  const { byUtility, metrics, today } = usePeriodStats(period.start, period.end);
  const cost = useTotalCost(byUtility);
  const sections = useWaterSections(period.start, period.end);

  // The reading round: the latest day readings came in, inside the selected period.
  const readingDay = useMemo(() => latestDay(totals, period.end < today ? period.end : today), [totals, period.end, today]);
  const cells = useMemo(() => UTILITIES.map((u) => roundCell(u, totals[u], readingDay && readingDay >= period.start ? readingDay : null)), [totals, readingDay, period.start]);
  const finding = useMemo(() => {
    const ranked = cells.filter((c) => c.change !== null && Math.abs(c.change) >= 0.1).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
    return ranked[0] ?? null;
  }, [cells]);
  const [picked, setPicked] = useState<Utility | null>(null);
  const sel: Utility = picked ?? finding?.u ?? 'energy';
  const selStats = byUtility[sel];
  const unitOf = (u: Utility) => UTILITY_INFO[u].unit;

  // The chart: daily bars from the period start to the last day with readings; monthly when the span is long.
  const chartEnd = readingDay && readingDay < period.end ? readingDay : period.end < today ? period.end : today;
  const span = Math.max(0, Math.round((Date.parse(chartEnd) - Date.parse(period.start)) / 864e5) + 1);
  const daily = span <= MAX_DAILY_BARS;
  const chart = useMemo(() => {
    if (chartEnd < period.start) return [];
    if (daily) return dailySeries(totals[sel], period.start, chartEnd).map((p) => ({ label: shortDate(p.date), value: p.value }));
    return monthlySeries(totals[sel], fy, settings.fiscalStartMonth).filter((m) => m.end >= period.start && m.start <= chartEnd).map((m) => ({ label: m.label.split(' ')[0], value: m.value }));
  }, [totals, sel, period.start, chartEnd, daily, fy, settings.fiscalStartMonth]);
  const avgLine = daily ? selStats.avgDaily : null;

  const water = useMemo(() => sections.map((s) => ({ ...s, label: s.category === 'standard' ? 'Potable' : s.label })), [sections]);
  const live = useMemo(() => Object.values(latest).sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1))[0] ?? null, [latest]);
  const device = devices[0] ?? null;
  const devState = device ? deviceState(device.last_seen_at, settings.deviceOfflineMinutes) : 'never';
  const openAlerts = alerts.filter((a) => !a.resolved_at && !a.acknowledged_at);

  const months = useMemo(() => {
    const per = Object.fromEntries(UTILITIES.map((u) => [u, monthlySeries(totals[u], fy, settings.fiscalStartMonth)])) as Record<Utility, ReturnType<typeof monthlySeries>>;
    return per.energy.map((m, i) => ({ key: m.key, label: m.label, start: m.start, end: m.end, values: UTILITIES.map((u) => per[u][i].value) }))
      .filter((m) => m.values.some((v) => v !== null) || (today >= m.start && today <= m.end));
  }, [totals, fy, settings.fiscalStartMonth, today]);

  const anyData = UTILITIES.some((u) => byUtility[u].total !== null);

  const findingText = !readingDay || readingDay < period.start
    ? 'No meter readings in this period yet.'
    : finding
      ? `${UTILITY_INFO[finding.u].label} on ${shortDate(readingDay)} was ${fmtNumber(Math.abs(finding.change! * 100), 1)}% ${finding.change! > 0 ? 'above' : 'below'} its average of the previous ${finding.baseDays} days.`
      : `All four utilities on ${shortDate(readingDay)} are within 10% of their averages of the previous days.`;

  const build = () => ({
    title: 'General Overview', period: period.label,
    kpis: [
      ...UTILITIES.map((u) => ({ label: `${UTILITY_INFO[u].label} (${unitOf(u)})`, value: fmtAuto(byUtility[u].total) })),
      ...sectionKpis(sections.filter((x) => x.category !== 'standard')),
      { label: 'Total utility cost', value: cost.total === null ? NA : fmtMoney(cost.total, cost.currency ?? 'SAR') },
      { label: 'Average occupancy', value: fmtPercent(metrics.occupancyAvg) },
      { label: 'Occupied room-nights', value: fmtNumber(metrics.roomsSold) },
      { label: 'Guests (hotel nights)', value: fmtNumber(metrics.guests) },
      { label: 'Average temperature (manual)', value: metrics.avgTemp === null ? NA : `${fmtNumber(metrics.avgTemp, 1)} °C` },
    ],
    tables: [{
      title: 'Utility summary', headers: ['Utility', 'Total', 'Unit', 'Days with data', 'Per guest', 'Per occupied room', 'Cost'],
      rows: UTILITIES.map((u) => [UTILITY_INFO[u].label, fmtAuto(byUtility[u].total), unitOf(u), byUtility[u].days, fmtNumber(byUtility[u].perGuest, 3), fmtNumber(byUtility[u].perRoom, 3), fmtMoney(byUtility[u].cost.cost, byUtility[u].cost.currency ?? 'SAR')]),
      numericCols: [1, 3, 4, 5, 6],
    }],
    notes: ['Values are calculated from saved meter readings only. Missing readings are shown as N/A and are never estimated.'],
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>{findingText}</p>
        </div>
        <div className="actions">
          {readingDay && <span className="stamp"><span className={clsx('dot', readingDay === today ? 'ok' : readingDay >= addDays(today, -1) ? '' : 'warn')} />Readings up to {formatDate(readingDay)}</span>}
          <ExportButtons build={build} />
          {canEnter && <Link className="btn primary" to="/entry"><PenSquare size={16} />Enter readings</Link>}
        </div>
      </div>

      <div className="filters">{ui}{clearButton}</div>

      {!anyData && <Note kind="info"><strong>No consumption data in this period.</strong> Enter readings on the Daily Entry page or import the workbook (Administration → Import).</Note>}

      {/* The reading round: each utility on the latest reading day, how many meters came in, and the change in words. */}
      <div className="round" role="tablist" aria-label={readingDay ? `Readings on ${formatDate(readingDay)}` : 'Readings'}>
        {cells.map((c) => {
          const info = UTILITY_INFO[c.u];
          const v = c.day?.total ?? null;
          const expected = c.day?.expected ?? 0;
          const counted = c.day?.counted ?? 0;
          return (
            <button key={c.u} role="tab" aria-selected={sel === c.u} className="round-cell" onClick={() => setPicked(c.u)}>
              <div className="r-label">{info.label}<span>{readingDay && c.day ? `${counted} of ${expected} meters` : ''}</span></div>
              <div className={clsx('r-value', v === null && 'na')}>{v === null ? '— Not read' : <>{fmtAuto(v)}<small>{info.unit}</small></>}</div>
              <div className="r-sub">
                {c.change === null
                  ? (readingDay ? (c.baseDays < 3 ? 'Too few earlier days to compare' : '—') : 'No readings')
                  : <><span className={Math.abs(c.change) < 0.005 ? '' : c.change > 0 ? 'up' : 'down'}>{c.change > 0 ? '+' : ''}{fmtNumber(c.change * 100, 1)}%</span> vs {c.baseDays}-day average</>}
              </div>
              {expected > 0 && expected <= 40 && (
                <div className="meter-track" aria-hidden="true">{Array.from({ length: expected }, (_, i) => <i key={i} className={i < counted ? 'read' : ''} />)}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid g-main stretch">
        <ChartCard
          title={`${UTILITY_INFO[sel].label} ${daily ? 'per day' : 'per month'} (${unitOf(sel)})`}
          chartId={`overview-${sel}`}
          hasData={chart.some((p) => p.value !== null)}
          tall
          actions={<span className="meta">{avgLine !== null && <>Dashed line: average {fmtAuto(avgLine)} {unitOf(sel)}/day · </>}{chart.length ? `${chart[0].label} – ${chart[chart.length - 1].label}` : ''}</span>}
        >
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={20} interval="preserveStartEnd" />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => fmtNumber(v)} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(29,111,165,.06)' }} formatter={(v: number) => [`${fmtAuto(v)} ${unitOf(sel)}`, UTILITY_INFO[sel].label]} />
            {avgLine !== null && <ReferenceLine y={avgLine} stroke="#6b6560" strokeDasharray="3 3" ifOverflow="extendDomain" />}
            <Bar dataKey="value" name={unitOf(sel)} fill={HUE} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>

        <div className="card">
          <div className="card-head"><h3>{UTILITY_INFO[sel].label} in this period</h3></div>
          <dl className="kv">
            <div className="lead"><dt>Total</dt><dd className={clsx(selStats.total === null && 'na')}>{selStats.total === null ? '—' : <>{fmtAuto(selStats.total)}<small>{unitOf(sel)}</small></>}</dd></div>
            <div><dt>Average per day</dt><dd className={clsx(selStats.avgDaily === null && 'na')}>{selStats.avgDaily === null ? '—' : <>{fmtAuto(selStats.avgDaily)}<small>{unitOf(sel)}</small></>}</dd></div>
            <div><dt>Per occupied room</dt><dd className={clsx(selStats.perRoom === null && 'na')}>{selStats.perRoom === null ? '—' : <>{fmtNumber(selStats.perRoom, 2)}<small>{unitOf(sel)}</small></>}</dd></div>
            <div><dt>Per guest</dt><dd className={clsx(selStats.perGuest === null && 'na')}>{selStats.perGuest === null ? '—' : <>{fmtNumber(selStats.perGuest, 2)}<small>{unitOf(sel)}</small></>}</dd></div>
            <div><dt>Cost</dt><dd className={clsx(selStats.cost.cost === null && 'na')}>{selStats.cost.cost === null ? 'No tariff' : fmtMoney(selStats.cost.cost, selStats.cost.currency ?? 'SAR')}</dd></div>
            <div><dt>Days with readings</dt><dd>{selStats.coverage.daysWithData}<small>of {selStats.coverage.daysElapsed}</small></dd></div>
            <div><dt>All utilities, cost</dt><dd className={clsx(cost.total === null && 'na')}>{cost.total === null ? '—' : fmtMoney(cost.total, cost.currency ?? 'SAR')}{cost.incomplete && cost.total !== null && <small>partial</small>}</dd></div>
          </dl>
        </div>
      </div>

      <div className="grid g3 stretch">
        <div className="card">
          <div className="card-head"><h3>Water by section</h3><Link className="link-btn" to="/water">Water</Link></div>
          <ul className="list-rows">
            {water.map((s) => (
              <li key={s.category}>
                <div className="grow"><strong>{s.label}</strong><span>{s.meters === 0 ? 'No meters assigned yet' : `${s.meters} meter${s.meters === 1 ? '' : 's'} · ${s.share === null ? 'no share' : `${fmtNumber(s.share, 1)}% of water`}`}</span></div>
                <span className={clsx('num', s.total === null && 'muted')}>{s.total === null ? '—' : <>{fmtAuto(s.total)} <span className="muted small">{UTILITY_INFO.water.unit}</span></>}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="card-head"><h3>Guests and rooms</h3><Link className="link-btn" to="/climate">Details</Link></div>
          <dl className="kv">
            <div><dt>Average occupancy</dt><dd className={clsx(metrics.occupancyAvg === null && 'na')}>{metrics.occupancyAvg === null ? '—' : <>{fmtNumber(metrics.occupancyAvg * 100, 1)}<small>%</small></>}</dd></div>
            <div><dt>Occupied room-nights</dt><dd className={clsx(metrics.roomsSold === null && 'na')}>{metrics.roomsSold === null ? '—' : fmtNumber(metrics.roomsSold)}</dd></div>
            <div><dt>Guest nights</dt><dd className={clsx(metrics.guests === null && 'na')}>{metrics.guests === null ? '—' : fmtNumber(metrics.guests)}</dd></div>
            <div><dt>Outdoor average (manual)</dt><dd className={clsx(metrics.avgTemp === null && 'na')}>{metrics.avgTemp === null ? '—' : <>{fmtNumber(metrics.avgTemp, 1)}<small>°C</small></>}</dd></div>
          </dl>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>{device?.name ?? 'Live sensor'}</h3>
            <span className="stamp"><span className={clsx('dot', devState === 'online' ? 'ok' : devState === 'delayed' ? 'warn' : devState === 'offline' ? 'bad' : '')} />
              {devState === 'never' ? (device ? 'No data yet' : 'No device') : devState === 'online' ? `Live · ${timeAgo(live?.measured_at ?? device?.last_seen_at)}` : `${devState === 'offline' ? 'Offline' : 'Delayed'} · ${timeAgo(device?.last_seen_at)}`}</span>
          </div>
          <dl className="kv">
            <div><dt>Temperature (AHT20)</dt><dd className={clsx(ambientTemp(live) === null && 'na')}>{ambientTemp(live) === null ? '—' : <>{fmtNumber(ambientTemp(live), 1)}<small>°C</small></>}</dd></div>
            <div><dt>Humidity</dt><dd className={clsx(live?.aht20_humidity_pct == null && 'na')}>{live?.aht20_humidity_pct == null ? '—' : <>{fmtNumber(live.aht20_humidity_pct, 1)}<small>%</small></>}</dd></div>
            <div><dt>Pressure</dt><dd className={clsx(live?.bmp280_pressure_hpa == null && 'na')}>{live?.bmp280_pressure_hpa == null ? '—' : <>{fmtNumber(live.bmp280_pressure_hpa, 1)}<small>hPa</small></>}</dd></div>
            <div><dt>Location</dt><dd>{device?.location ?? '—'}</dd></div>
          </dl>
        </div>
      </div>

      <div className="grid g-main stretch">
        <div className="card">
          <div className="card-head"><h3>Monthly totals</h3><Link className="link-btn" to="/monthly">Monthly reports</Link></div>
          {months.length === 0
            ? <div className="empty">No readings in this reporting year yet.</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data overview-table">
                  <thead><tr><th>Month</th>{UTILITIES.map((u) => <th key={u} className="num">{UTILITY_INFO[u].short} <span className="muted">{UTILITY_INFO[u].unit}</span></th>)}</tr></thead>
                  <tbody>
                    {months.map((m) => (
                      <tr key={m.key} className={today >= m.start && today <= m.end ? 'current' : undefined}>
                        <td>{m.label}{today >= m.start && today <= m.end && <span className="muted"> · to date</span>}</td>
                        {m.values.map((v, i) => <td key={i} className="num">{v === null ? <span className="na">—</span> : fmtAuto(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <div className="card">
          <div className="card-head"><h3>Open alerts <span className="muted num">{openAlerts.length}</span></h3><Link className="link-btn" to="/alerts">View all</Link></div>
          {openAlerts.length === 0
            ? <div className="empty">No open alerts. Readings and sensors are within their limits.</div>
            : (
              <ul className="list-rows">
                {openAlerts.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <div className="grow"><strong>{a.title}</strong><span>{a.message ?? a.kind} · {timeAgo(a.created_at)}</span></div>
                    <span className={clsx('pill', a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info')}>{a.severity === 'critical' ? 'Critical' : a.severity === 'warning' ? 'Warning' : 'Info'}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </>
  );
}
