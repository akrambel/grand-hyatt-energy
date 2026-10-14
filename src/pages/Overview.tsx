import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Droplets, Flame, Snowflake, Thermometer, Users, Wallet, Zap, BedDouble, Droplet, Gauge } from 'lucide-react';
import { useData } from '../store/data.ts';
import { useSensors } from '../store/sensors.ts';
import { usePeriod, } from '../components/PeriodFilter.tsx';
import { usePeriodStats, useTotalCost } from '../hooks.ts';
import { KpiCard, Note, PageHead } from '../components/ui.tsx';
import { ChartCard, PALETTE, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { dailySeries, monthlySeries } from '../lib/aggregate.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import { fmtAuto, fmtMoney, fmtNumber, fmtPercent, NA } from '../lib/format.ts';
import { ambientTemp } from '../lib/sensor.ts';
import { ENV, brandUrl } from '../config/env.ts';
import { formatDateTimeLocal, monthShortName, parseISO } from '../lib/dates.ts';

const ICON = { energy: Zap, water: Droplets, gas: Flame, chilled: Snowflake } as const;

export default function Overview() {
  const { period, ui, clearButton } = usePeriod('fy');
  const fy = useData((s) => s.fy);
  const totals = useData((s) => s.totals);
  const settings = useData((s) => s.settings);
  const metricsMap = useData((s) => s.metricsMap);
  const devices = useData((s) => s.devices);
  const latest = useSensors((s) => s.latest);
  const { byUtility, metrics } = usePeriodStats(period.start, period.end);
  const cost = useTotalCost(byUtility);

  const live = useMemo(() => {
    const rows = Object.values(latest).sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1));
    return rows[0] ?? null;
  }, [latest]);

  const anyData = UTILITIES.some((u) => byUtility[u].total !== null);

  const monthly = useMemo(() => {
    const per = Object.fromEntries(UTILITIES.map((u) => [u, monthlySeries(totals[u], fy, settings.fiscalStartMonth)])) as Record<string, ReturnType<typeof monthlySeries>>;
    return per.energy.map((m, i) => ({ label: m.label.split(' ')[0], energy: per.energy[i].value, water: per.water[i].value, gas: per.gas[i].value, chilled: per.chilled[i].value }));
  }, [totals, fy, settings.fiscalStartMonth]);

  const daily = useMemo(() => {
    const e = dailySeries(totals.energy, period.start, period.end);
    const w = dailySeries(totals.water, period.start, period.end);
    return e.map((p, i) => {
      const { m, d } = parseISO(p.date);
      return { date: p.date, label: `${d} ${monthShortName(m)}`, energy: p.value, water: w[i].value, occupancy: metricsMap.get(p.date)?.occupancy_rate ?? null };
    });
  }, [totals, metricsMap, period.start, period.end]);

  const tempData = useMemo(() => daily.map((d) => ({ label: d.label, temp: metricsMap.get(d.date)?.avg_temp_c ?? null })), [daily, metricsMap]);
  const hasTemp = tempData.some((t) => t.temp !== null);

  const build = () => ({
    title: 'General Overview', period: period.label,
    kpis: [
      ...UTILITIES.map((u) => ({ label: `${UTILITY_INFO[u].label} (${UTILITY_INFO[u].unit})`, value: fmtAuto(byUtility[u].total) })),
      { label: 'Total utility cost', value: cost.total === null ? NA : fmtMoney(cost.total, cost.currency ?? 'SAR') },
      { label: 'Average occupancy', value: fmtPercent(metrics.occupancyAvg) },
      { label: 'Occupied room-nights', value: fmtNumber(metrics.roomsSold) },
      { label: 'Guests (hotel nights)', value: fmtNumber(metrics.guests) },
      { label: 'Average temperature (manual)', value: metrics.avgTemp === null ? NA : `${fmtNumber(metrics.avgTemp, 1)} °C` },
    ],
    tables: [{
      title: 'Utility summary', headers: ['Utility', 'Total', 'Unit', 'Days with data', 'Per guest', 'Per occupied room', 'Cost'],
      rows: UTILITIES.map((u) => [UTILITY_INFO[u].label, fmtAuto(byUtility[u].total), UTILITY_INFO[u].unit, byUtility[u].days, fmtNumber(byUtility[u].perGuest, 3), fmtNumber(byUtility[u].perRoom, 3), fmtMoney(byUtility[u].cost.cost, byUtility[u].cost.currency ?? 'SAR')]),
      numericCols: [1, 3, 4, 5, 6],
    }],
    notes: ['Values are calculated from saved meter readings only. Missing readings are shown as N/A and are never estimated.'],
  });

  return (
    <>
      <div className="hero-banner" style={{ backgroundImage: `url(${brandUrl('hero-wide.jpg')})` }}>
        <div><h2>{ENV.propertyName}</h2><p>Energy &amp; Utilities Management · {period.label}</p></div>
      </div>
      <PageHead title="General Overview" subtitle={period.label}><ExportButtons build={build} /></PageHead>
      <div className="filters">{ui}{clearButton}</div>

      {!anyData && <Note kind="info"><strong>No consumption data in this period.</strong> Enter readings on the Daily Entry page or import the workbook (Administration → Import).</Note>}

      <div className="kpis">
        {UTILITIES.map((u) => {
          const I = ICON[u]; const s = byUtility[u];
          return <KpiCard key={u} label={UTILITY_INFO[u].label} icon={<I size={14} />} color={UTILITY_COLOR[u]} value={s.total === null ? null : fmtAuto(s.total)} unit={UTILITY_INFO[u].unit}
            sub={s.total === null ? undefined : `${s.days} days · avg ${fmtAuto(s.avgDaily)} ${UTILITY_INFO[u].unit}/day`} />;
        })}
        <KpiCard label="Utility cost" icon={<Wallet size={14} />} color="#a51a2d" value={cost.total === null ? null : fmtMoney(cost.total, cost.currency ?? 'SAR')}
          sub={cost.total === null ? 'Set tariffs in Administration' : cost.incomplete ? 'Partial – some utilities have no tariff' : undefined} />
        <KpiCard label="Avg occupancy" icon={<BedDouble size={14} />} value={metrics.occupancyAvg === null ? null : fmtPercent(metrics.occupancyAvg)} sub={metrics.roomsSold === null ? undefined : `${fmtNumber(metrics.roomsSold)} room-nights`} />
        <KpiCard label="Guests (hotel nights)" icon={<Users size={14} />} value={metrics.guests === null ? null : fmtNumber(metrics.guests)} />
        <KpiCard label="Avg temperature (manual)" icon={<Thermometer size={14} />} value={metrics.avgTemp === null ? null : fmtNumber(metrics.avgTemp, 1)} unit="°C" />
      </div>

      <div className="kpis">
        {UTILITIES.map((u) => (
          <KpiCard key={u} label={`${UTILITY_INFO[u].short} per guest`} value={byUtility[u].perGuest === null ? null : fmtNumber(byUtility[u].perGuest, 2)} unit={`${UTILITY_INFO[u].unit}/guest`}
            sub={byUtility[u].perRoom === null ? undefined : `${fmtNumber(byUtility[u].perRoom, 2)} ${UTILITY_INFO[u].unit}/occupied room`} color={UTILITY_COLOR[u]} />
        ))}
        <KpiCard label="Live ambient temp." icon={<Gauge size={14} />} color="#14a39b" value={live && ambientTemp(live) !== null ? fmtNumber(ambientTemp(live), 1) : null} unit="°C"
          sub={live ? `Sensor · ${formatDateTimeLocal(live.measured_at, settings.timezone)}` : devices.length ? 'No readings received yet' : 'No device registered'} />
        <KpiCard label="Live humidity" icon={<Droplet size={14} />} color="#14a39b" value={live?.aht20_humidity_pct == null ? null : fmtNumber(live.aht20_humidity_pct, 1)} unit="%" />
        <KpiCard label="Live pressure" color="#14a39b" value={live?.bmp280_pressure_hpa == null ? null : fmtNumber(live.bmp280_pressure_hpa, 1)} unit="hPa" />
      </div>

      <div className="grid g2">
        <ChartCard title="Monthly consumption – energy (kWh)" hasData={monthly.some((m) => m.energy !== null)}>
          <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="energy" name="Energy (kWh)" fill={UTILITY_COLOR.energy} radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Monthly consumption – water & chilled water (m³)" hasData={monthly.some((m) => m.water !== null || m.chilled !== null)}>
          <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Bar dataKey="water" name="Water (m³)" fill={UTILITY_COLOR.water} radius={[4, 4, 0, 0]} /><Bar dataKey="chilled" name="Chilled (m³)" fill={UTILITY_COLOR.chilled} radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Monthly gas consumption (L)" hasData={monthly.some((m) => m.gas !== null)}>
          <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="gas" name="Gas (L)" fill={UTILITY_COLOR.gas} radius={[4, 4, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Daily energy & water" hasData={daily.some((d) => d.energy !== null || d.water !== null)}>
          <LineChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} />
            <YAxis yAxisId="l" tick={axisStyle} width={64} /><YAxis yAxisId="r" orientation="right" tick={axisStyle} width={50} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Line yAxisId="l" type="monotone" dataKey="energy" name="Energy (kWh)" stroke={UTILITY_COLOR.energy} dot={false} strokeWidth={2} connectNulls={false} />
            <Line yAxisId="r" type="monotone" dataKey="water" name="Water (m³)" stroke={UTILITY_COLOR.water} dot={false} strokeWidth={2} connectNulls={false} /></LineChart>
        </ChartCard>
        <ChartCard title="Occupancy rate" hasData={daily.some((d) => d.occupancy !== null)}>
          <AreaChart data={daily.map((d) => ({ ...d, occupancy: d.occupancy === null ? null : Math.round(d.occupancy * 1000) / 10 }))}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} unit="%" width={48} domain={[0, 100]} /><Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="occupancy" name="Occupancy (%)" stroke={PALETTE[1]} fill={PALETTE[1]} fillOpacity={0.15} connectNulls={false} /></AreaChart>
        </ChartCard>
        <ChartCard title="Average daily temperature (manual entry)" hasData={hasTemp}>
          <LineChart data={tempData}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} unit="°" width={44} domain={['auto', 'auto']} /><Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="temp" name="Temperature (°C)" stroke="#e8892d" dot={false} strokeWidth={2} connectNulls={false} /></LineChart>
        </ChartCard>
      </div>
    </>
  );
}
