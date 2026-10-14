import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../store/data.ts';
import { usePeriod } from '../components/PeriodFilter.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Column } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Field, KpiCard, PageHead, StatusPill } from '../components/ui.tsx';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import type { Utility } from '../lib/types.ts';
import { fmtAuto, fmtNumber } from '../lib/format.ts';
import { formatDate } from '../lib/dates.ts';
import { FilterX } from 'lucide-react';

interface Row { key: string; date: string; utility: Utility; area: string; meter: string; unit: string; opening: number | null; closing: number | null; consumption: number | null; status: string; discontinuity: boolean; note: string }

const STATUS_TEXT: Record<string, string> = { ok: 'OK', rollover: 'Rollover', negative: 'Negative – excluded', missing_closing: 'No closing', missing_opening: 'No opening' };

export default function DailyConsumption() {
  const { period, ui, clear } = usePeriod('month');
  const meters = useData((s) => s.meters);
  const readings = useData((s) => s.readings);
  const meterDays = useData((s) => s.meterDays);
  const [params, setParams] = useSearchParams();
  const [utility, setUtility] = useState<'all' | Utility>('all');
  const [area, setArea] = useState('all');
  const meterParam = params.get('meter') ?? 'all';
  const [shown, setShown] = useState<Row[]>([]);

  const meterById = useMemo(() => new Map(meters.map((m) => [m.id, m])), [meters]);
  const areas = useMemo(() => [...new Set(meters.filter((m) => utility === 'all' || m.utility === utility).map((m) => m.area))].sort(), [meters, utility]);
  const meterOptions = useMemo(() => meters.filter((m) => (utility === 'all' || m.utility === utility) && (area === 'all' || m.area === area)), [meters, utility, area]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const r of readings) {
      if (r.reading_date < period.start || r.reading_date > period.end) continue;
      const m = meterById.get(r.meter_id);
      if (!m) continue;
      if (utility !== 'all' && m.utility !== utility) continue;
      if (area !== 'all' && m.area !== area) continue;
      if (meterParam !== 'all' && m.id !== meterParam) continue;
      const md = meterDays.get(`${r.meter_id}|${r.reading_date}`);
      out.push({ key: `${r.meter_id}|${r.reading_date}`, date: r.reading_date, utility: m.utility, area: m.area, meter: m.name, unit: m.unit,
        opening: md?.opening ?? null, closing: r.closing, consumption: md?.consumption ?? null, status: md?.status ?? 'missing_closing', discontinuity: !!md?.discontinuity, note: r.note ?? '' });
    }
    return out;
  }, [readings, period, meterById, meterDays, utility, area, meterParam]);

  const cols: Column<Row>[] = [
    { key: 'date', header: 'Date', value: (r) => r.date, render: (r) => formatDate(r.date) },
    { key: 'utility', header: 'Utility', value: (r) => UTILITY_INFO[r.utility].label },
    { key: 'area', header: 'Area', value: (r) => r.area },
    { key: 'meter', header: 'Meter', value: (r) => r.meter },
    { key: 'unit', header: 'Unit', value: (r) => r.unit },
    { key: 'opening', header: 'Opening', num: true, value: (r) => r.opening, render: (r) => fmtNumber(r.opening, 3) },
    { key: 'closing', header: 'Closing', num: true, value: (r) => r.closing, render: (r) => fmtNumber(r.closing, 3) },
    { key: 'consumption', header: 'Consumption', num: true, value: (r) => r.consumption, render: (r) => <strong>{fmtNumber(r.consumption, 3)}</strong> },
    { key: 'status', header: 'Status', value: (r) => STATUS_TEXT[r.status] ?? r.status, render: (r) => <StatusPill kind={r.status === 'ok' ? 'ok' : r.status === 'rollover' ? 'info' : 'warn'}>{STATUS_TEXT[r.status] ?? r.status}{r.discontinuity ? ' · new opening' : ''}</StatusPill> },
    { key: 'note', header: 'Note', value: (r) => r.note },
  ];

  const counted = shown.filter((r) => r.consumption !== null);
  const flagged = shown.filter((r) => r.status === 'negative' || r.status === 'missing_opening').length;
  const unitsMixed = new Set(counted.map((r) => r.unit)).size > 1;
  const sum = counted.reduce((a, r) => a + (r.consumption as number), 0);

  const build = () => ({
    title: 'Daily Consumption', period: period.label, landscape: true,
    filters: [['Utility', utility === 'all' ? 'All' : UTILITY_INFO[utility].label], ['Area', area === 'all' ? 'All' : area], ['Meter', meterParam === 'all' ? 'All' : meterById.get(meterParam)?.name ?? meterParam]] as Array<[string, string]>,
    kpis: [{ label: 'Rows', value: String(shown.length) }, { label: 'Rows with consumption', value: String(counted.length) }, { label: 'Rows flagged', value: String(flagged) }],
    tables: [{ title: 'Daily meter readings and consumption', headers: ['Date', 'Utility', 'Area', 'Meter', 'Unit', 'Opening', 'Closing', 'Consumption', 'Status'],
      rows: shown.map((r) => [r.date, UTILITY_INFO[r.utility].label, r.area, r.meter, r.unit, r.opening, r.closing, r.consumption, STATUS_TEXT[r.status] ?? r.status]), numericCols: [5, 6, 7] }],
    includeCharts: false,
  });

  return (
    <>
      <PageHead title="Daily Consumption" subtitle="Meter readings and calculated daily consumption (closing − opening)"><ExportButtons build={build} /></PageHead>
      <div className="filters">
        {ui}
        <Field label="Utility"><select className="input" value={utility} onChange={(e) => { setUtility(e.target.value as 'all' | Utility); setArea('all'); setParams({}); }}><option value="all">All utilities</option>{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label}</option>)}</select></Field>
        <Field label="Area"><select className="input" value={area} onChange={(e) => { setArea(e.target.value); setParams({}); }}><option value="all">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select></Field>
        <Field label="Meter"><select className="input" value={meterParam} onChange={(e) => setParams(e.target.value === 'all' ? {} : { meter: e.target.value })}><option value="all">All meters</option>{meterOptions.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.area})</option>)}</select></Field>
        <button className="btn" onClick={() => { clear(); setUtility('all'); setArea('all'); setParams({}); }}><FilterX size={16} />Clear filters</button>
      </div>
      <div className="kpis">
        <KpiCard label="Readings shown" value={fmtNumber(shown.length)} />
        <KpiCard label="Total consumption" value={counted.length && !unitsMixed ? fmtAuto(sum) : null} unit={!unitsMixed && counted[0] ? counted[0].unit : undefined} sub={unitsMixed ? 'Select one utility to see a total (units differ)' : undefined} />
        <KpiCard label="Flagged readings" value={fmtNumber(flagged)} color="#a51a2d" sub="Negative or missing opening" />
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.key} onView={setShown} initialSort={{ key: 'date', dir: 'desc' }} rowClass={(r) => r.status === 'negative'} empty="No readings for the selected filters." />
    </>
  );
}
