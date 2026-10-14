import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { Radio, Thermometer, Droplet, Gauge, Wifi, Clock } from 'lucide-react';
import { useData } from '../store/data.ts';
import { fetchBuckets, fetchDailyStats, fetchSensorRange, useSensors } from '../store/sensors.ts';
import type { Bucket, DailyStat } from '../store/sensors.ts';
import { ambientTemp, bucketSecondsFor, deviceState, findGaps, sensorTempDelta, stat, thresholdState } from '../lib/sensor.ts';
import type { SensorRow } from '../lib/sensor.ts';
import { defaultGrain, groupStats } from '../lib/sensorAgg.ts';
import type { Grain } from '../lib/sensorAgg.ts';
import { ChartCard, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Field, KpiCard, Note, PageHead, StatusPill } from '../components/ui.tsx';
import { addDays, formatDate, formatDateTimeLocal, formatTimeLocal, localToday, timeAgo } from '../lib/dates.ts';
import { fmtNumber, NA } from '../lib/format.ts';
import { friendlyError } from '../lib/supabase.ts';
import { notify } from '../store/ui.ts';

type Preset = '1h' | '6h' | '24h' | '7d' | '30d' | '365d' | 'custom';
const PRESET_MS: Record<Exclude<Preset, 'custom'>, number> = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, '365d': 365 * 86400e3 };

const stateKind = { online: 'ok', delayed: 'warn', offline: 'bad', never: 'neutral' } as const;
const stateText = { online: 'Online', delayed: 'Delayed', offline: 'Offline', never: 'No data yet' } as const;

export default function Live() {
  const { devices, settings } = useData();
  const latestMap = useSensors((s) => s.latest);
  const recent = useSensors((s) => s.recent);
  const live = useSensors((s) => s.live);
  const tz = settings.timezone;
  const today = localToday(tz);

  const [deviceRef, setDeviceRef] = useState<string>('');
  const [preset, setPreset] = useState<Preset>('24h');
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(today);
  const [grain, setGrain] = useState<Grain | 'auto'>('auto');
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [raw, setRaw] = useState<SensorRow[]>([]);
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { if (!deviceRef && devices.length) setDeviceRef(devices[0].id); }, [devices, deviceRef]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const device = devices.find((d) => d.id === deviceRef) ?? null;
  const latest = deviceRef ? latestMap[deviceRef] ?? null : null;
  const state = deviceState(device?.last_seen_at, settings.deviceOfflineMinutes);

  const range = useMemo(() => {
    if (preset === 'custom') {
      return { fromMs: new Date(`${from}T00:00:00+03:00`).getTime(), toMs: new Date(`${addDays(to, 1)}T00:00:00+03:00`).getTime(), fromDay: from, toDay: to };
    }
    const toMs = Date.now(); const fromMs = toMs - PRESET_MS[preset];
    return { fromMs, toMs, fromDay: new Date(fromMs + 3 * 3600e3).toISOString().slice(0, 10), toDay: today };
  }, [preset, from, to, tz, today, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!deviceRef) return;
    setLoading(true);
    try {
      const fromIso = new Date(range.fromMs).toISOString(), toIso = new Date(range.toMs).toISOString();
      const [b, d, r] = await Promise.all([
        fetchBuckets(fromIso, toIso, bucketSecondsFor(range.fromMs, range.toMs), deviceRef),
        fetchDailyStats(range.fromDay, range.toDay, deviceRef),
        range.toMs - range.fromMs <= 7 * 86400e3 ? fetchSensorRange(fromIso, toIso, deviceRef) : Promise.resolve<SensorRow[]>([]),
      ]);
      setBuckets(b); setDaily(d); setRaw(r);
    } catch (e) { notify.error('Sensor history could not be loaded', friendlyError(e)); } finally { setLoading(false); }
  }, [deviceRef, range.fromMs, range.toMs, range.fromDay, range.toDay]);
  useEffect(() => { void load(); }, [load, tick]);

  const chart = buckets.map((b) => ({ t: new Date(b.bucket).getTime(), label: range.toMs - range.fromMs > 2 * 86400e3 ? formatDateTimeLocal(b.bucket, tz).slice(0, 12) : formatTimeLocal(b.bucket, tz), 'AHT20 temp (°C)': b.aht20_temp_avg, 'BMP280 temp (°C)': b.bmp280_temp_avg, 'Humidity (%)': b.humidity_avg, 'Pressure (hPa)': b.pressure_avg }));
  const g: Grain = grain === 'auto' ? defaultGrain(range.fromDay, range.toDay) : grain;
  const agg = useMemo(() => groupStats(daily, g), [daily, g]);
  const gaps = useMemo(() => findGaps(raw.map((r) => r.measured_at), Math.max(5, settings.deviceOfflineMinutes / 2)), [raw, settings.deviceOfflineMinutes]);
  const th = settings.thresholds;
  const ambient = ambientTemp(latest);
  const delta = sensorTempDelta(latest);
  const recentOfDevice = recent.filter((r) => r.device_ref === deviceRef).slice(0, 50);
  const rangeStats = { t: stat(raw.map((r) => r.aht20_temp_c)), h: stat(raw.map((r) => r.aht20_humidity_pct)), p: stat(raw.map((r) => r.bmp280_pressure_hpa)) };

  const build = () => ({
    title: 'Live Environmental Monitoring', period: `${formatDate(range.fromDay)} – ${formatDate(range.toDay)} (${tz})`, landscape: true,
    filters: [['Device', device?.name ?? NA], ['Summary grouping', g]] as Array<[string, string]>,
    kpis: [{ label: 'Ambient temperature (AHT20)', value: ambient === null ? NA : `${fmtNumber(ambient, 1)} °C` }, { label: 'Relative humidity', value: latest?.aht20_humidity_pct == null ? NA : `${fmtNumber(latest.aht20_humidity_pct, 1)} %` },
      { label: 'Pressure', value: latest?.bmp280_pressure_hpa == null ? NA : `${fmtNumber(latest.bmp280_pressure_hpa, 1)} hPa` }, { label: 'BMP280 temperature', value: latest?.bmp280_temp_c == null ? NA : `${fmtNumber(latest.bmp280_temp_c, 1)} °C` },
      { label: 'Last measurement', value: latest ? formatDateTimeLocal(latest.measured_at, tz) : NA }, { label: 'Device status', value: stateText[state] }],
    tables: [{ title: `Summary by ${g}`, headers: ['Period', 'Samples', 'Temp min', 'Temp avg', 'Temp max', 'Hum min', 'Hum avg', 'Hum max', 'Press min', 'Press avg', 'Press max'],
      rows: agg.map((a) => [a.key, a.samples, a.tempMin, a.tempAvg, a.tempMax, a.humMin, a.humAvg, a.humMax, a.pMin, a.pAvg, a.pMax]), numericCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    notes: ['Statistics are calculated from actual stored sensor readings. Temperature = AHT20 (BMP280 shown for comparison). Times are shown in the property time zone.'],
  });

  return (
    <>
      <PageHead title="Live Environmental Monitoring" subtitle="ESP32 with BMP280 and AHT20 – live sensor data (not manual, not external weather)">
        <span className="pill" title="Realtime channel"><Radio size={12} />{live ? 'Live updates on' : 'Polling every 20 s'}</span><ExportButtons build={build} />
      </PageHead>
      {devices.length === 0 && <Note kind="info"><strong>No device registered yet.</strong> An administrator registers the ESP32 under Administration → Devices; the API key is shown once and goes into the firmware’s <code>secrets.h</code>. See <code>docs/hardware</code>.</Note>}
      {devices.length > 1 && <div className="filters"><Field label="Device"><select className="input" value={deviceRef} onChange={(e) => setDeviceRef(e.target.value)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></div>}
      {device && (
        <div className="kpis">
          <KpiCard label="Ambient temperature (AHT20)" icon={<Thermometer size={14} />} color="#a51a2d" value={ambient === null ? null : fmtNumber(ambient, 1)} unit="°C"
            sub={thresholdState(ambient, th.temperature) === 'high' ? 'Above threshold' : thresholdState(ambient, th.temperature) === 'low' ? 'Below threshold' : undefined} />
          <KpiCard label="Relative humidity" icon={<Droplet size={14} />} color="#1f7fb8" value={latest?.aht20_humidity_pct == null ? null : fmtNumber(latest.aht20_humidity_pct, 1)} unit="%"
            sub={thresholdState(latest?.aht20_humidity_pct ?? null, th.humidity) === 'ok' || thresholdState(latest?.aht20_humidity_pct ?? null, th.humidity) === 'off' ? undefined : 'Outside threshold'} />
          <KpiCard label="Atmospheric pressure" icon={<Gauge size={14} />} color="#6b4e9b" value={latest?.bmp280_pressure_hpa == null ? null : fmtNumber(latest.bmp280_pressure_hpa, 1)} unit="hPa" />
          <KpiCard label="AHT20 temperature" value={latest?.aht20_temp_c == null ? null : fmtNumber(latest.aht20_temp_c, 2)} unit="°C" sub="Default ambient value" />
          <KpiCard label="BMP280 temperature" value={latest?.bmp280_temp_c == null ? null : fmtNumber(latest.bmp280_temp_c, 2)} unit="°C" sub={delta === null ? 'For comparison / diagnostics' : `Difference AHT20 − BMP280: ${delta > 0 ? '+' : ''}${delta} °C`} />
          <KpiCard label="Last measurement" icon={<Clock size={14} />} value={latest ? formatDateTimeLocal(latest.measured_at, tz) : null} sub={latest ? timeAgo(latest.measured_at) : 'No readings received yet'} />
          <KpiCard label="Last communication" icon={<Wifi size={14} />} value={device.last_seen_at ? formatDateTimeLocal(device.last_seen_at, tz) : null} sub={device.last_seen_at ? timeAgo(device.last_seen_at) : undefined} />
        </div>)}
      {device && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h3>Device & sensor status</h3><StatusPill kind={stateKind[state]}>{stateText[state]}</StatusPill></div>
          <div className="actions">
            <span>AHT20: {device.last_status?.aht20_ok === undefined ? <span className="muted">unknown</span> : <StatusPill kind={device.last_status.aht20_ok ? 'ok' : 'bad'}>{device.last_status.aht20_ok ? 'OK' : 'Fault'}</StatusPill>}</span>
            <span>BMP280: {device.last_status?.bmp280_ok === undefined ? <span className="muted">unknown</span> : <StatusPill kind={device.last_status.bmp280_ok ? 'ok' : 'bad'}>{device.last_status.bmp280_ok ? 'OK' : 'Fault'}</StatusPill>}</span>
            <span className="small muted">Firmware {device.firmware_version ?? NA} · location {device.location ?? NA} · offline after {settings.deviceOfflineMinutes} min without data</span>
          </div>
          {state === 'offline' && <Note kind="bad">The device has not communicated since {formatDateTimeLocal(device.last_seen_at, tz)}. The values above are the last known readings, not current ones.</Note>}
        </div>)}

      <div className="filters">
        <Field label="Range"><select className="input" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          <option value="1h">Last hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="365d">Last year</option><option value="custom">Custom dates</option></select></Field>
        {preset === 'custom' && <><Field label="From"><input className="input" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input className="input" type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        <Field label="Summary by"><select className="input" value={grain} onChange={(e) => setGrain(e.target.value as Grain | 'auto')}><option value="auto">Automatic</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></Field>
        <button className="btn" onClick={() => { setPreset('24h'); setGrain('auto'); setFrom(addDays(today, -7)); setTo(today); }}>Clear filters</button>
        {loading && <span className="small muted">Loading…</span>}
      </div>

      <div className="grid g2">
        <ChartCard title="Temperature (°C) – AHT20 vs BMP280" hasData={chart.some((c) => c['AHT20 temp (°C)'] !== null || c['BMP280 temp (°C)'] !== null)}>
          <LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={32} /><YAxis tick={axisStyle} domain={['auto', 'auto']} width={44} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Line dataKey="AHT20 temp (°C)" stroke="#a51a2d" dot={false} strokeWidth={2} /><Line dataKey="BMP280 temp (°C)" stroke="#e8892d" dot={false} strokeDasharray="4 3" />
            {th.temperature.enabled && th.temperature.max !== null && <ReferenceLine y={th.temperature.max} stroke="#a51a2d" strokeDasharray="2 4" />}
            {th.temperature.enabled && th.temperature.min !== null && <ReferenceLine y={th.temperature.min} stroke="#1f7fb8" strokeDasharray="2 4" />}</LineChart>
        </ChartCard>
        <ChartCard title="Relative humidity (%)" hasData={chart.some((c) => c['Humidity (%)'] !== null)}>
          <LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={32} /><YAxis tick={axisStyle} domain={[0, 100]} width={40} /><Tooltip contentStyle={tooltipStyle} />
            <Line dataKey="Humidity (%)" stroke="#1f7fb8" dot={false} strokeWidth={2} />
            {th.humidity.enabled && th.humidity.max !== null && <ReferenceLine y={th.humidity.max} stroke="#a51a2d" strokeDasharray="2 4" />}
            {th.humidity.enabled && th.humidity.min !== null && <ReferenceLine y={th.humidity.min} stroke="#1f7fb8" strokeDasharray="2 4" />}</LineChart>
        </ChartCard>
        <ChartCard title="Atmospheric pressure (hPa)" hasData={chart.some((c) => c['Pressure (hPa)'] !== null)}>
          <LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={32} /><YAxis tick={axisStyle} domain={['auto', 'auto']} width={52} /><Tooltip contentStyle={tooltipStyle} /><Line dataKey="Pressure (hPa)" stroke="#6b4e9b" dot={false} strokeWidth={2} /></LineChart>
        </ChartCard>
        <div className="card"><h3>Range statistics (raw readings)</h3>
          {raw.length === 0 ? <p className="muted">Raw statistics are shown for ranges up to 7 days with data. Use the summary table below for longer ranges.</p> :
            <table className="data"><thead><tr><th>Measure</th><th className="num">Min</th><th className="num">Average</th><th className="num">Max</th><th className="num">Samples</th></tr></thead><tbody>
              <tr><td>Temperature °C (AHT20)</td><td className="num">{fmtNumber(rangeStats.t.min, 1)}</td><td className="num">{fmtNumber(rangeStats.t.avg, 1)}</td><td className="num">{fmtNumber(rangeStats.t.max, 1)}</td><td className="num">{rangeStats.t.n}</td></tr>
              <tr><td>Humidity %</td><td className="num">{fmtNumber(rangeStats.h.min, 1)}</td><td className="num">{fmtNumber(rangeStats.h.avg, 1)}</td><td className="num">{fmtNumber(rangeStats.h.max, 1)}</td><td className="num">{rangeStats.h.n}</td></tr>
              <tr><td>Pressure hPa</td><td className="num">{fmtNumber(rangeStats.p.min, 1)}</td><td className="num">{fmtNumber(rangeStats.p.avg, 1)}</td><td className="num">{fmtNumber(rangeStats.p.max, 1)}</td><td className="num">{rangeStats.p.n}</td></tr></tbody></table>}
          {gaps.length > 0 && <Note kind="warn"><strong>{gaps.length} communication gap(s)</strong> longer than {Math.max(5, settings.deviceOfflineMinutes / 2)} min in this range (e.g. {formatDateTimeLocal(gaps[0].from, tz)} → {formatDateTimeLocal(gaps[0].to, tz)}, {gaps[0].minutes} min). Missing readings are not interpolated.</Note>}
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card"><h3>Summary by {g} (min / average / max from stored readings)</h3>
          <DataTable rows={agg} rowKey={(r) => r.key} initialSort={{ key: 'k', dir: 'desc' }} columns={[
            { key: 'k', header: 'Period', value: (r) => r.key }, { key: 'n', header: 'Samples', num: true, value: (r) => r.samples },
            { key: 'a', header: 'Temp min', num: true, value: (r) => r.tempMin, render: (r) => fmtNumber(r.tempMin, 1) }, { key: 'b', header: 'Temp avg', num: true, value: (r) => r.tempAvg, render: (r) => fmtNumber(r.tempAvg, 1) }, { key: 'c', header: 'Temp max', num: true, value: (r) => r.tempMax, render: (r) => fmtNumber(r.tempMax, 1) },
            { key: 'd', header: 'Hum min', num: true, value: (r) => r.humMin, render: (r) => fmtNumber(r.humMin, 1) }, { key: 'e', header: 'Hum avg', num: true, value: (r) => r.humAvg, render: (r) => fmtNumber(r.humAvg, 1) }, { key: 'f', header: 'Hum max', num: true, value: (r) => r.humMax, render: (r) => fmtNumber(r.humMax, 1) },
            { key: 'g', header: 'Press min', num: true, value: (r) => r.pMin, render: (r) => fmtNumber(r.pMin, 1) }, { key: 'h', header: 'Press avg', num: true, value: (r) => r.pAvg, render: (r) => fmtNumber(r.pAvg, 1) }, { key: 'i', header: 'Press max', num: true, value: (r) => r.pMax, render: (r) => fmtNumber(r.pMax, 1) }]} />
        </div>
        <div className="card"><h3>Measurements {raw.length ? `(${raw.length} in range)` : '(latest 50)'}</h3>
          <DataTable rows={raw.length ? raw : recentOfDevice} rowKey={(r) => String(r.id ?? r.measured_at)} initialSort={{ key: 't', dir: 'desc' }} defaultPageSize={25} columns={[
            { key: 't', header: `Measured (${tz})`, value: (r) => r.measured_at, render: (r) => formatDateTimeLocal(r.measured_at, tz) },
            { key: 'a', header: 'AHT20 °C', num: true, value: (r) => r.aht20_temp_c, render: (r) => fmtNumber(r.aht20_temp_c, 2) }, { key: 'h', header: 'Humidity %', num: true, value: (r) => r.aht20_humidity_pct, render: (r) => fmtNumber(r.aht20_humidity_pct, 2) },
            { key: 'b', header: 'BMP280 °C', num: true, value: (r) => r.bmp280_temp_c, render: (r) => fmtNumber(r.bmp280_temp_c, 2) }, { key: 'p', header: 'Pressure hPa', num: true, value: (r) => r.bmp280_pressure_hpa, render: (r) => fmtNumber(r.bmp280_pressure_hpa, 2) },
            { key: 's', header: 'Sensors', value: (r) => (r.aht20_ok && r.bmp280_ok ? 'OK' : 'Fault'), render: (r) => <StatusPill kind={r.aht20_ok && r.bmp280_ok ? 'ok' : 'bad'}>{r.aht20_ok && r.bmp280_ok ? 'OK' : `${r.aht20_ok ? '' : 'AHT20 '}${r.bmp280_ok ? '' : 'BMP280'}`}</StatusPill> },
            { key: 'r', header: 'Received', value: (r) => r.received_at ?? '', render: (r) => (r.received_at ? formatDateTimeLocal(r.received_at, tz) : NA) }]} />
        </div>
      </div>
    </>
  );
}
