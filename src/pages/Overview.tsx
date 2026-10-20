import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Bell, Droplets, Flame, Gauge as GaugeIcon, MapPin, PenSquare, Snowflake, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../store/auth.ts';
import { brandUrl } from '../config/env.ts';
import { UserAvatar } from '../components/Layout.tsx';
import { BUDGET_FIELD, guestForecast } from '../lib/kpi.ts';
import type { BudgetedUtility } from '../lib/kpi.ts';
import { fiscalMonths } from '../lib/dates.ts';
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
const INK_DAYS = 14;
const UTILITY_ICON: Record<Utility, LucideIcon> = { energy: Zap, water: Droplets, gas: Flame, chilled: Snowflake };
const UTILITY_PATH: Record<Utility, string> = { energy: '/energy', water: '/water', gas: '/gas', chilled: '/chilled' };

const greeting = (h: number): string => (h < 12 ? 'Good morning,' : h < 18 ? 'Good afternoon,' : 'Good evening,');

/** Semicircle gauge drawn as tick marks; the ticks up to the value are in the brand red. Read-only: it shows a reading, it controls nothing. */
function ArcGauge({ value, min, max, unit }: { value: number | null; min: number; max: number; unit: string }) {
  const n = 41, cx = 130, cy = 128, r = 110;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const on = Math.round(frac * (n - 1));
  const ticks = Array.from({ length: n }, (_, i) => {
    const a = Math.PI - (i / (n - 1)) * Math.PI;
    const long = i % 5 === 0;
    const r1 = r - (long ? 14 : 9), cos = Math.cos(a), sin = Math.sin(a);
    return <line key={i} className={clsx('tick', value !== null && i <= on && 'on')} x1={cx + r1 * cos} y1={cy - r1 * sin} x2={cx + r * cos} y2={cy - r * sin} />;
  });
  const end = Math.PI - frac * Math.PI;
  const bandR = r - 22;
  const band = value === null || frac === 0 ? null
    : `M ${cx - bandR} ${cy} A ${bandR} ${bandR} 0 0 1 ${cx + bandR * Math.cos(end)} ${cy - bandR * Math.sin(end)}`;
  return (
    <div className="gauge">
      <svg viewBox="0 0 260 150" role="img" aria-label={value === null ? 'No reading' : `${fmtNumber(value, 1)} ${unit} on a scale of ${min} to ${max}`}>
        {band && <path className="band" d={band} />}
        {ticks}
        <text className="g-scale" x={cx - r} y={cy + 18} textAnchor="middle">{min}°</text>
        <text className="g-scale" x={cx + r} y={cy + 18} textAnchor="middle">{max}°</text>
      </svg>
      <div className={clsx('g-value', value === null && 'na')}>{value === null ? 'No reading' : <>{fmtNumber(value, 1)}<small>{unit}</small></>}</div>
    </div>
  );
}

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
  const profile = useAuth((s) => s.profile);
  const firstName = (profile?.display_name || profile?.username || '').split(/\s+/)[0];

  // The ink card: the selected utility over the last two weeks up to the reading day; the two highest days are hatched.
  const selCell = cells.find((c) => c.u === sel)!;
  const ink = useMemo(() => {
    if (!readingDay) return [];
    const pts = dailySeries(totals[sel], addDays(readingDay, -(INK_DAYS - 1)), readingDay);
    const top = pts.filter((p) => p.value !== null).sort((a, b) => b.value! - a.value!).slice(0, 2).map((p) => p.date);
    return pts.map((p) => ({ label: shortDate(p.date), value: p.value, peak: top.includes(p.date) ? p.value : null }));
  }, [totals, sel, readingDay]);
  const readCount = cells.filter((c) => c.day?.total != null).length;

  // Per guest night this month: actual so far against the workbook forecast (budget ÷ budgeted guests).
  const budgets = useData((s) => s.budgets);
  const forecastMonth = useMemo(() => {
    const ref = readingDay ?? today;
    return fiscalMonths(fy, settings.fiscalStartMonth).find((m) => ref >= m.start && ref <= m.end) ?? null;
  }, [readingDay, today, fy, settings.fiscalStartMonth]);
  const perGuest = useMemo(() => forecastMonth
    ? (Object.keys(BUDGET_FIELD) as BudgetedUtility[]).map((u) => guestForecast(u, totals[u], metricsMap, budgets, fy, forecastMonth, readingDay ?? today))
    : [], [forecastMonth, totals, metricsMap, budgets, fy, readingDay, today]);
  const hasForecast = perGuest.some((g) => g.forecast !== null);

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
      <section className="greet">
        <UserAvatar size={64} className="greet-avatar" />
        <div>
          <p className="hello">{greeting(new Date().getHours())}</p>
          <h1>{firstName || 'Overview'}</h1>
          <p className="finding">{findingText}</p>
        </div>
        <div className="actions">
          <ExportButtons build={build} />
          {canEnter && <Link className="btn primary" to="/entry"><PenSquare size={16} />Enter readings</Link>}
        </div>
      </section>

      {!anyData && <Note kind="info"><strong>No consumption data in this period.</strong> Enter readings on the Daily Entry page or import the workbook (Administration → Import).</Note>}

      <div className="hero-row">
        {/* The ink card: the selected utility on the reading day, and its last two weeks as steps */}
        <div className="ink-card">
          <div className="ink-head">
            <span className="ink-icon">{(() => { const I = UTILITY_ICON[sel]; return <I size={18} />; })()}</span>
            <div>
              <h3>{UTILITY_INFO[sel].label} {readingDay ? `on ${shortDate(readingDay)}` : ''}</h3>
              {selCell.change !== null && (
                <span className={clsx('ink-chip', selCell.change > 0 ? 'up' : 'down')}>
                  <i>{selCell.change > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</i>
                  {fmtNumber(Math.abs(selCell.change * 100), 1)}% vs {selCell.baseDays}-day average
                </span>
              )}
            </div>
          </div>
          <div className={clsx('ink-value', selCell.day?.total == null && 'na')}>
            {selCell.day?.total == null ? 'Not read yet' : <>{fmtAuto(selCell.day.total)}<small>{unitOf(sel)}</small></>}
          </div>
          <div className="ink-sub">Last {INK_DAYS} days · hatched: the two highest days</div>
          <div className="ink-chart">
            {ink.some((p) => p.value !== null) && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ink} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="8%">
                  <defs>
                    <pattern id="ink-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill="#2a1418" />
                      <line x1="0" y1="0" x2="0" y2="6" stroke="#e8798a" strokeWidth="2.4" />
                    </pattern>
                  </defs>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={Math.ceil(INK_DAYS / 4) - 1} tick={{ fontSize: 11 }} />
                  <YAxis hide domain={[(min: number) => Math.max(0, min - (min * 0.25)), 'dataMax']} />
                  <Tooltip cursor={false} formatter={(v: number) => [`${fmtAuto(v)} ${unitOf(sel)}`, UTILITY_INFO[sel].label]} />
                  <Bar dataKey="peak" tooltipType="none" fill="url(#ink-hatch)" stroke="#e8798a" strokeWidth={1} isAnimationActive={false} />
                  <Line dataKey="value" type="stepAfter" stroke="#f5efee" strokeWidth={1.4} strokeDasharray="3 3" dot={{ r: 2.2, fill: '#f5efee', stroke: 'none' }} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* The resort, with each utility's reading as a glass label */}
        <div className="hero-photo" style={{ backgroundImage: `url(${brandUrl('hero-wide.jpg')})` }}>
          <span className="glass-chip status">
            <span className={clsx('dot', !readingDay ? '' : readingDay === today ? 'ok' : readingDay >= addDays(today, -1) ? '' : 'warn')} />
            <strong>{readingDay ? `Readings up to ${shortDate(readingDay)}` : 'No readings yet'}</strong>
            {readingDay && <span>· {readCount} of {UTILITIES.length} utilities read</span>}
          </span>
          <div className="chip-grid">
            {cells.map((c) => {
              const I = UTILITY_ICON[c.u];
              return (
                <Link key={c.u} className="glass-chip" to={UTILITY_PATH[c.u]}>
                  <span className="ic"><I size={15} /></span>
                  <strong>{UTILITY_INFO[c.u].short}</strong>
                  <span>{c.day?.total == null ? 'not read' : `${fmtAuto(c.day.total)} ${UTILITY_INFO[c.u].unit}`}</span>
                </Link>
              );
            })}
            {openAlerts.length > 0 && (
              <Link className="glass-chip" to="/alerts"><span className="ic"><Bell size={15} /></span><strong>{openAlerts.length} open alert{openAlerts.length === 1 ? '' : 's'}</strong></Link>
            )}
          </div>
        </div>

        {/* The live sensor, as a gauge */}
        <div className="card sensor-panel">
          <div className="card-head">
            <h3>{device?.name ?? 'Live sensor'}</h3>
            <span className="stamp"><span className={clsx('dot', devState === 'online' ? 'ok' : devState === 'delayed' ? 'warn' : devState === 'offline' ? 'bad' : '')} />
              {devState === 'never' ? (device ? 'No data yet' : 'No device') : devState === 'online' ? `Live · ${timeAgo(live?.measured_at ?? device?.last_seen_at)}` : `${devState === 'offline' ? 'Offline' : 'Delayed'} · ${timeAgo(device?.last_seen_at)}`}</span>
          </div>
          <div className="chips">
            <span className="soft-chip"><i><Droplets size={12} /></i>{live?.aht20_humidity_pct == null ? '—' : `${fmtNumber(live.aht20_humidity_pct, 0)}% RH`}</span>
            <span className="soft-chip"><i><GaugeIcon size={12} /></i>{live?.bmp280_pressure_hpa == null ? '—' : `${fmtNumber(live.bmp280_pressure_hpa, 0)} hPa`}</span>
            {device?.location && <span className="soft-chip"><i><MapPin size={12} /></i>{device.location}</span>}
          </div>
          <ArcGauge value={ambientTemp(live)} min={10} max={40} unit="°C" />
          <div className="g-caption">Temperature (AHT20), scale 10–40 °C</div>
        </div>
      </div>

      <div className="filters">{ui}{clearButton}</div>

      {/* Utility tiles: each utility on the latest reading day; picking one drives the ink card and the chart */}
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
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(165,26,45,.06)' }} formatter={(v: number) => [`${fmtAuto(v)} ${unitOf(sel)}`, UTILITY_INFO[sel].label]} />
            {avgLine !== null && <ReferenceLine y={avgLine} stroke="#75696b" strokeDasharray="3 3" ifOverflow="extendDomain" />}
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
          <div className="card-head"><h3>Per guest night{forecastMonth ? ` · ${forecastMonth.label}` : ''}</h3><Link className="link-btn" to="/budget">Budget</Link></div>
          <table className="data overview-table">
            <thead><tr><th>Utility</th><th className="num">Actual</th><th className="num">Forecast</th><th className="num">vs forecast</th></tr></thead>
            <tbody>
              {perGuest.map((g) => {
                const u = UTILITY_INFO[g.utility].unit;
                return (
                  <tr key={g.utility}>
                    <td>{UTILITY_INFO[g.utility].short}</td>
                    <td className="num">{g.actual === null ? <span className="na">—</span> : <>{fmtNumber(g.actual, 2)} <span className="muted small">{u}</span></>}</td>
                    <td className="num">{g.forecast === null ? <span className="na">—</span> : <>{fmtNumber(g.forecast, 2)} <span className="muted small">{u}</span></>}</td>
                    <td className="num">{g.vsForecast === null ? <span className="na">—</span> : <span className={clsx('pill', Math.abs(g.vsForecast) < 0.05 ? '' : g.vsForecast > 0 ? 'bad' : 'ok')}>{g.vsForecast > 0 ? '+' : ''}{fmtNumber(g.vsForecast * 100, 1)}%</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasForecast
            ? <p className="small muted" style={{ margin: '12px 0 0' }}>Forecast = the month's budgeted consumption ÷ budgeted guests (workbook budget block). Actual uses only days with both a reading and a guest count ({perGuest[0]?.actualDays ?? 0} days).</p>
            : <p className="small muted" style={{ margin: '12px 0 0' }}>No forecast for this month in the workbook budget block yet, so only the actual is shown.</p>}
          {perGuest.some((g) => g.projected !== null) && (
            <dl className="kv" style={{ marginTop: 8 }}>
              {perGuest.filter((g) => g.projected !== null).map((g) => (
                <div key={g.utility}><dt>{UTILITY_INFO[g.utility].short} at month end</dt>
                  <dd>{fmtAuto(g.projected)}<small>{UTILITY_INFO[g.utility].unit}</small>{g.budgetTotal !== null && <small> · budget {fmtAuto(g.budgetTotal)}</small>}</dd></div>
              ))}
            </dl>
          )}
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
