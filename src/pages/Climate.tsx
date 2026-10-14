import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { CloudDownload, Save } from 'lucide-react';
import { useData, saveMetric } from '../store/data.ts';
import { useCanEnter, useIsAdmin } from '../store/auth.ts';
import { fetchDailyStats } from '../store/sensors.ts';
import type { DailyStat } from '../store/sensors.ts';
import { supabase, friendlyError, fetchAll } from '../lib/supabase.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { ChartCard, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Field, KpiCard, Note, PageHead } from '../components/ui.tsx';
import { eachDay, formatDate, localToday, monthShortName, parseISO } from '../lib/dates.ts';
import { summarizeMetrics } from '../lib/kpi.ts';
import { fmtNumber, fmtPercent, NA } from '../lib/format.ts';
import { parseReading } from '../lib/validate.ts';
import { notify } from '../store/ui.ts';

interface Weather { weather_date: string; avg_temp_c: number | null; min_temp_c: number | null; max_temp_c: number | null }
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export default function Climate() {
  const { period, ui, clearButton } = usePeriod('month');
  const { metricsMap, metrics, settings } = useData();
  const canEnter = useCanEnter();
  const admin = useIsAdmin();
  const today = localToday(settings.timezone);
  const [sensor, setSensor] = useState<Map<string, DailyStat>>(new Map());
  const [weather, setWeather] = useState<Map<string, Weather>>(new Map());
  const [fetching, setFetching] = useState(false);

  const loadExternal = useCallback(async () => {
    try {
      const stats = await fetchDailyStats(period.start, period.end);
      // merge devices of the same day by sample-weighted mean of AHT20 temperature
      const merged = new Map<string, DailyStat>();
      for (const s of stats) { const cur = merged.get(s.day); if (!cur || s.samples > cur.samples) merged.set(s.day, s); }
      setSensor(merged);
      const w = await fetchAll<Record<string, unknown>>((a, b) => supabase.from('external_weather').select('*').gte('weather_date', period.start).lte('weather_date', period.end).order('weather_date').range(a, b));
      setWeather(new Map(w.map((r) => [r.weather_date as string, { weather_date: r.weather_date as string, avg_temp_c: num(r.avg_temp_c), min_temp_c: num(r.min_temp_c), max_temp_c: num(r.max_temp_c) }])));
    } catch (e) { notify.warning('Some climate sources could not be loaded', friendlyError(e)); }
  }, [period.start, period.end]);
  useEffect(() => { void loadExternal(); }, [loadExternal]);

  const days = useMemo(() => eachDay(period.start, period.end > today ? today : period.end).map((d) => {
    const m = metricsMap.get(d); const s = sensor.get(d); const w = weather.get(d);
    return { date: d, manual: m?.avg_temp_c ?? null, sensor: s?.aht20_temp_avg ?? null, sMin: s?.aht20_temp_min ?? null, sMax: s?.aht20_temp_max ?? null, samples: s?.samples ?? 0, hum: s?.humidity_avg ?? null,
      pressure: s?.pressure_avg ?? null, external: w?.avg_temp_c ?? null, occ: m?.occupancy_rate ?? null, rooms: m?.occupied_rooms ?? null, guests: m?.guests ?? null };
  }), [period, today, metricsMap, sensor, weather]);

  const sum = summarizeMetrics(metrics, period.start, period.end);
  const chart = days.map((d) => { const { m, d: dd } = parseISO(d.date); return { label: `${dd} ${monthShortName(m)}`, 'Manual entry': d.manual, 'Live sensor (AHT20)': d.sensor, 'External weather': d.external }; });
  const sensorDays = days.filter((d) => d.sensor !== null).length;

  const fetchWeather = async () => {
    const { latitude, longitude } = settings.site;
    if (latitude === null || longitude === null) { notify.error('Site coordinates missing', 'Enter latitude and longitude in Administration → Settings.'); return; }
    setFetching(true);
    try {
      const end = period.end > today ? today : period.end;
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${period.start}&end_date=${end}&daily=temperature_2m_mean,temperature_2m_min,temperature_2m_max&timezone=${encodeURIComponent(settings.timezone)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
      const j = (await res.json()) as { daily?: { time: string[]; temperature_2m_mean: Array<number | null>; temperature_2m_min: Array<number | null>; temperature_2m_max: Array<number | null> } };
      if (!j.daily) throw new Error('Unexpected weather response');
      const rows = j.daily.time.map((t, i) => ({ weather_date: t, avg_temp_c: j.daily!.temperature_2m_mean[i], min_temp_c: j.daily!.temperature_2m_min[i], max_temp_c: j.daily!.temperature_2m_max[i], provider: 'open-meteo' })).filter((r) => r.avg_temp_c !== null);
      if (!rows.length) throw new Error('The weather service returned no data for this period (recent days may not be available yet).');
      const { error } = await supabase.from('external_weather').upsert(rows, { onConflict: 'weather_date' });
      if (error) throw error;
      notify.success('External weather updated', `${rows.length} day(s) from Open-Meteo`);
      await loadExternal();
    } catch (e) { notify.error('Weather download failed', friendlyError(e)); } finally { setFetching(false); }
  };

  const build = () => ({
    title: 'Climate & Occupancy', period: period.label, landscape: true,
    kpis: [{ label: 'Average occupancy', value: fmtPercent(sum.occupancyAvg) }, { label: 'Occupied room-nights', value: fmtNumber(sum.roomsSold) }, { label: 'Guests (hotel nights)', value: fmtNumber(sum.guests) },
      { label: 'Avg temperature – manual', value: sum.avgTemp === null ? NA : `${fmtNumber(sum.avgTemp, 1)} °C` }, { label: 'Days with live sensor data', value: String(sensorDays) }],
    tables: [{ title: 'Daily climate and occupancy (source of each temperature is labelled)', headers: ['Date', 'Manual °C', 'Live AHT20 avg °C', 'Live min', 'Live max', 'Humidity %', 'Pressure hPa', 'External °C', 'Occupancy %', 'Occupied rooms', 'Guests'],
      rows: days.map((d) => [d.date, d.manual, d.sensor, d.sMin, d.sMax, d.hum, d.pressure, d.external, d.occ === null ? null : Math.round(d.occ * 1000) / 10, d.rooms, d.guests]), numericCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    notes: ['Three temperature sources are kept separate: manual entry (workbook), live ESP32/AHT20 sensor readings, and external weather data (Open-Meteo).'],
  });

  return (
    <>
      <PageHead title="Climate & Occupancy" subtitle={period.label}>
        {admin && <button className="btn" onClick={() => void fetchWeather()} disabled={fetching}><CloudDownload size={16} />{fetching ? 'Downloading…' : 'Download external weather'}</button>}
        <ExportButtons build={build} />
      </PageHead>
      <div className="filters">{ui}{clearButton}</div>
      <div className="kpis">
        <KpiCard label="Average occupancy" value={sum.occupancyAvg === null ? null : fmtPercent(sum.occupancyAvg)} />
        <KpiCard label="Occupied room-nights" value={sum.roomsSold === null ? null : fmtNumber(sum.roomsSold)} />
        <KpiCard label="Guests (hotel nights)" value={sum.guests === null ? null : fmtNumber(sum.guests)} />
        <KpiCard label="Avg temperature – manual" value={sum.avgTemp === null ? null : fmtNumber(sum.avgTemp, 1)} unit="°C" sub="From workbook / manual entry" />
        <KpiCard label="Days with live sensor data" value={fmtNumber(sensorDays)} color="#14a39b" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <ChartCard title="Average daily temperature by source (°C)" hasData={chart.some((c) => c['Manual entry'] !== null || c['Live sensor (AHT20)'] !== null || c['External weather'] !== null)} tall>
          <LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} domain={['auto', 'auto']} width={44} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            <Line dataKey="Manual entry" stroke="#1f7fb8" dot={false} strokeWidth={2} /><Line dataKey="Live sensor (AHT20)" stroke="#1f8a5b" dot={false} strokeWidth={2} /><Line dataKey="External weather" stroke="#e8892d" dot={false} strokeDasharray="5 4" strokeWidth={2} /></LineChart>
        </ChartCard>
      </div>
      {canEnter && <MetricForm today={today} />}
      <div className="card">
        <h3>Daily values</h3>
        <DataTable rows={days} rowKey={(r) => r.date} initialSort={{ key: 'd', dir: 'desc' }} columns={[
          { key: 'd', header: 'Date', value: (r) => r.date, render: (r) => formatDate(r.date) },
          { key: 'm', header: 'Manual °C', num: true, value: (r) => r.manual, render: (r) => fmtNumber(r.manual, 1) },
          { key: 's', header: 'Live AHT20 avg °C', num: true, value: (r) => r.sensor, render: (r) => fmtNumber(r.sensor, 1) },
          { key: 'smin', header: 'Live min', num: true, value: (r) => r.sMin, render: (r) => fmtNumber(r.sMin, 1) },
          { key: 'smax', header: 'Live max', num: true, value: (r) => r.sMax, render: (r) => fmtNumber(r.sMax, 1) },
          { key: 'h', header: 'Humidity %', num: true, value: (r) => r.hum, render: (r) => fmtNumber(r.hum, 1) },
          { key: 'p', header: 'Pressure hPa', num: true, value: (r) => r.pressure, render: (r) => fmtNumber(r.pressure, 1) },
          { key: 'e', header: 'External °C', num: true, value: (r) => r.external, render: (r) => fmtNumber(r.external, 1) },
          { key: 'o', header: 'Occupancy', num: true, value: (r) => r.occ, render: (r) => fmtPercent(r.occ) },
          { key: 'r', header: 'Occupied rooms', num: true, value: (r) => r.rooms, render: (r) => fmtNumber(r.rooms) },
          { key: 'g', header: 'Guests', num: true, value: (r) => r.guests, render: (r) => fmtNumber(r.guests) },
        ]} />
      </div>
    </>
  );
}

function MetricForm({ today }: { today: string }) {
  const metricsMap = useData((s) => s.metricsMap);
  const [date, setDate] = useState(today);
  const [t, setT] = useState(''); const [o, setO] = useState(''); const [r, setR] = useState(''); const [g, setG] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const m = metricsMap.get(date);
    setT(m?.avg_temp_c != null ? String(m.avg_temp_c) : ''); setO(m?.occupancy_rate != null ? String(Math.round(m.occupancy_rate * 1000) / 10) : '');
    setR(m?.occupied_rooms != null ? String(m.occupied_rooms) : ''); setG(m?.guests != null ? String(m.guests) : '');
  }, [date, metricsMap]);

  const p = (s: string) => parseReading(s);
  const errs: string[] = [];
  const pt = p(t), po = p(o), pr = p(r), pg = p(g);
  if (Number.isNaN(pt) || (pt !== null && (pt < -30 || pt > 70))) errs.push('Temperature must be between −30 and 70 °C.');
  if (Number.isNaN(po) || (po !== null && (po < 0 || po > 100))) errs.push('Occupancy must be between 0 and 100 %.');
  if (Number.isNaN(pr) || (pr !== null && (pr < 0 || !Number.isInteger(pr)))) errs.push('Occupied rooms must be a whole number ≥ 0.');
  if (Number.isNaN(pg) || (pg !== null && (pg < 0 || !Number.isInteger(pg)))) errs.push('Guests must be a whole number ≥ 0.');
  if (date > today) errs.push('The date cannot be in the future.');

  const save = async () => {
    setBusy(true);
    try {
      await saveMetric({ metric_date: date, avg_temp_c: pt, occupancy_rate: po === null ? null : (po as number) / 100, occupied_rooms: pr, guests: pg });
      notify.success('Saved', formatDate(date));
    } catch (e) { notify.error('Not saved', friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Daily climate & occupancy entry <span className="tag manual">manual</span></h3>
      <div className="form-grid">
        <Field label="Date"><input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Average temperature (°C)"><input className="input mono" inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} /></Field>
        <Field label="Occupancy rate (%)"><input className="input mono" inputMode="decimal" value={o} onChange={(e) => setO(e.target.value)} /></Field>
        <Field label="Occupied rooms"><input className="input mono" inputMode="numeric" value={r} onChange={(e) => setR(e.target.value)} /></Field>
        <Field label="Hotel nights / guests"><input className="input mono" inputMode="numeric" value={g} onChange={(e) => setG(e.target.value)} /></Field>
      </div>
      {errs.length > 0 && <Note kind="bad"><ul>{errs.map((e) => <li key={e}>{e}</li>)}</ul></Note>}
      <p className="small muted">Leave a field empty if the value is unknown – empty means “no data”, never zero. Clearing all fields removes the day’s entry.</p>
      <button className="btn primary" disabled={busy || errs.length > 0} onClick={() => void save()}><Save size={16} />Save</button>
    </div>
  );
}
