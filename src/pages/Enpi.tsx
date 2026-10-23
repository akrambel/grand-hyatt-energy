// Consumption per occupied room (kWh/POR, m³/POR …): the hotel energy performance indicators (ISO 50001
// EnPIs) against the targets set in Administration › Settings. Only days that have both a consumption
// total and an occupied-rooms figure are used, so a missing occupancy entry never distorts the ratio.
import { useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Bar, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { useData } from '../store/data.ts';
import { useIsAdmin } from '../store/auth.ts';
import { ChartCard, UTILITY_COLOR, axisStyle, tooltipStyle } from '../components/Chart.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { ExportButtons } from '../components/ExportButtons.tsx';
import { Note, PageHead, StatusPill } from '../components/ui.tsx';
import { enpiByMonth, enpiTarget } from '../lib/kpi.ts';
import type { EnpiMonth } from '../lib/kpi.ts';
import { fiscalMonths, localToday } from '../lib/dates.ts';
import { UTILITIES, UTILITY_INFO } from '../lib/types.ts';
import type { Utility } from '../lib/types.ts';
import { BASE_UNITS, unitFactor } from '../lib/units.ts';
import { clsx, fmtNumber, fmtSigned, NA } from '../lib/format.ts';

/** Within ±2 % of the target counts as on target. */
const BAND = 0.02;
const verdict = (v: number | null): { kind: 'ok' | 'warn' | 'bad' | 'neutral'; text: string } =>
  v === null ? { kind: 'neutral', text: 'No target' } : v > BAND ? { kind: 'bad', text: 'Above target' } : v < -BAND ? { kind: 'ok', text: 'Better than target' } : { kind: 'warn', text: 'On target' };

export default function Enpi() {
  const { fy, settings, totals, metricsMap } = useData();
  const admin = useIsAdmin();
  const today = localToday(settings.timezone);
  const months = useMemo(() => fiscalMonths(fy, settings.fiscalStartMonth), [fy, settings.fiscalStartMonth]);
  const [sel, setSel] = useState<Utility>('energy');

  const data = useMemo(() => Object.fromEntries(UTILITIES.map((u) => {
    const f = u === 'energy' ? 1 : unitFactor(BASE_UNITS[u], settings.units[u]);
    const target = enpiTarget(settings.enpiTargets, u, f);
    const rows = enpiByMonth(totals[u], metricsMap, months, target, today);
    // year to date: all paired days of the reporting year so far
    const c = rows.reduce((a, r) => a + (r.consumption ?? 0), 0), n = rows.reduce((a, r) => a + (r.roomNights ?? 0), 0);
    const ytd = n > 0 ? Math.round((c / n) * 1000) / 1000 : null;
    const current = [...rows].reverse().find((r) => r.value !== null) ?? null;
    return [u, { target, rows, ytd, ytdVs: ytd !== null && target ? (ytd - target) / target : null, current, days: rows.reduce((a, r) => a + r.days, 0) }];
  })) as Record<Utility, { target: number | null; rows: EnpiMonth[]; ytd: number | null; ytdVs: number | null; current: EnpiMonth | null; days: number }>,
  [totals, metricsMap, months, settings.enpiTargets, settings.units, today]);

  const unit = (u: Utility) => `${UTILITY_INFO[u].unit}/POR`;
  const noTargets = UTILITIES.every((u) => data[u].target === null);
  const noRooms = UTILITIES.every((u) => data[u].days === 0);
  const d = data[sel];
  const chart = d.rows.map((r) => ({ label: r.label.split(' ')[0], value: r.value, target: d.target }));

  const build = () => ({
    title: 'Consumption per Occupied Room (EnPI)', period: `Reporting year ${fy}-${String(fy + 1).slice(2)}`, landscape: true,
    kpis: UTILITIES.map((u) => ({ label: `${UTILITY_INFO[u].label} year to date`, value: data[u].ytd === null ? NA : `${fmtNumber(data[u].ytd, 2)} ${unit(u)}${data[u].target !== null ? ` (target ${fmtNumber(data[u].target, 2)})` : ''}` })),
    tables: UTILITIES.map((u) => ({
      title: `${UTILITY_INFO[u].label} per occupied room (${unit(u)})`,
      headers: ['Month', 'Consumption', 'Occupied room-nights', 'Days counted', unit(u), 'Target', 'vs target'],
      rows: data[u].rows.map((r) => [r.label, r.consumption, r.roomNights, r.days, r.value, data[u].target, r.vsTarget === null ? null : `${fmtSigned(r.vsTarget * 100, 1)} %`]),
      numericCols: [1, 2, 3, 4, 5],
    })),
    notes: ['EnPI = consumption ÷ occupied room-nights (POR), counting only days that have both a meter total and an occupied-rooms entry (ISO 50001 energy performance indicator).',
      `On target = within ±${BAND * 100} % of the target set in Administration › Settings.`],
  });

  return (
    <>
      <PageHead title="Per Occupied Room" subtitle={`Energy performance indicators (EnPI) · reporting year ${fy}-${String(fy + 1).slice(2)}`}><ExportButtons build={build} /></PageHead>
      {noTargets && <Note kind="info"><strong>No targets set yet.</strong> {admin ? <>Set the target per occupied room for each utility in <Link to="/admin">Administration › Settings</Link>.</> : 'An administrator can set them in Administration › Settings.'}</Note>}
      {noRooms && <Note kind="warn"><strong>No occupied-rooms figures for this year.</strong> Enter the daily occupied rooms (Climate &amp; Occupancy, or import the workbook) to calculate these indicators.</Note>}

      <div className="round enpi-round" role="tablist" aria-label="Utility">
        {UTILITIES.map((u) => {
          const x = data[u]; const v = verdict(x.ytdVs);
          return (
            <button key={u} className="round-cell" role="tab" aria-selected={sel === u} onClick={() => setSel(u)}>
              <div className="r-label">{UTILITY_INFO[u].label}<span>{x.days} day{x.days === 1 ? '' : 's'}</span></div>
              <div className={clsx('r-value', x.ytd === null && 'na')}>{x.ytd === null ? 'No data' : <>{fmtNumber(x.ytd, x.ytd < 10 ? 2 : 1)}<small>{unit(u)}</small></>}</div>
              <div className="r-sub">{x.target === null ? 'No target set' : <>Target {fmtNumber(x.target, 2)} · <StatusPill kind={v.kind}>{x.ytdVs === null ? v.text : `${fmtSigned(x.ytdVs * 100, 1)} %`}</StatusPill></>}</div>
            </button>);
        })}
      </div>

      <div className="grid g2">
        <ChartCard title={`${UTILITY_INFO[sel].label} per occupied room by month (${unit(sel)})`} hasData={chart.some((c) => c.value !== null)}
          actions={d.target !== null ? <span className="meta">Dashed line: target {fmtNumber(d.target, 2)}</span> : undefined}>
          <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#efe7df" /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${fmtNumber(v, 2)} ${unit(sel)}`, 'Actual']} />
            <Bar isAnimationActive={false} dataKey="value" name={unit(sel)} fill={UTILITY_COLOR[sel]} radius={[6, 6, 2, 2]} maxBarSize={44} />
            {d.target !== null && <ReferenceLine y={d.target} stroke="#4a0b16" strokeDasharray="5 4" ifOverflow="extendDomain" />}
          </ComposedChart>
        </ChartCard>
        <div className="card">
          <div className="card-head"><h3>Latest month · {d.current?.label ?? '—'}</h3></div>
          <dl className="kv">
            <div><dt>{UTILITY_INFO[sel].label} per occupied room</dt><dd className="v">{d.current?.value == null ? NA : `${fmtNumber(d.current.value, 2)} ${unit(sel)}`}</dd></div>
            <div><dt>Target</dt><dd className="v">{d.target === null ? 'Not set' : `${fmtNumber(d.target, 2)} ${unit(sel)}`}</dd></div>
            <div><dt>Against target</dt><dd>{d.current?.vsTarget == null ? NA : <StatusPill kind={verdict(d.current.vsTarget).kind}>{fmtSigned(d.current.vsTarget * 100, 1)} % · {verdict(d.current.vsTarget).text}</StatusPill>}</dd></div>
            <div><dt>Consumption counted</dt><dd className="v">{d.current?.consumption == null ? NA : `${fmtNumber(d.current.consumption, 2)} ${UTILITY_INFO[sel].unit}`}</dd></div>
            <div><dt>Occupied room-nights</dt><dd className="v">{d.current?.roomNights == null ? NA : fmtNumber(d.current.roomNights)}</dd></div>
            <div><dt>Days with both values</dt><dd className="v">{d.current?.days ?? 0}</dd></div>
          </dl>
          <p className="small muted" style={{ marginBottom: 0 }}>POR = occupied room-night. EnPI = consumption ÷ occupied room-nights, using only days that have both a reading and an occupied-rooms figure (ISO 50001). “On target” = within ±{BAND * 100} %.</p>
        </div>
      </div>

      <div className="card">
        <h3>{UTILITY_INFO[sel].label} per occupied room · by month</h3>
        <DataTable searchable={false} rows={d.rows} rowKey={(r) => r.key} pageSizes={[12]} defaultPageSize={12} columns={[
          { key: 'm', header: 'Month', value: (r) => r.label },
          { key: 'c', header: `Consumption (${UTILITY_INFO[sel].unit})`, num: true, value: (r) => r.consumption, render: (r) => fmtNumber(r.consumption, 2) },
          { key: 'n', header: 'Room-nights', num: true, value: (r) => r.roomNights, render: (r) => fmtNumber(r.roomNights) },
          { key: 'd', header: 'Days', num: true, value: (r) => r.days },
          { key: 'v', header: unit(sel), num: true, value: (r) => r.value, render: (r) => fmtNumber(r.value, 2) },
          { key: 't', header: 'vs target', num: true, value: (r) => r.vsTarget, render: (r) => (r.vsTarget === null ? <span className="muted">{NA}</span> : <StatusPill kind={verdict(r.vsTarget).kind}>{fmtSigned(r.vsTarget * 100, 1)} %</StatusPill>) },
        ]} />
      </div>
    </>
  );
}
