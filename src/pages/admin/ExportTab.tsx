import { useState } from 'react';
import { FileSpreadsheet, Table } from 'lucide-react';
import { useData } from '../../store/data.ts';
import { exportTables, exportWorkbookFromTemplate } from '../../lib/exportXlsx.ts';
import { fiscalLabel } from '../../lib/dates.ts';
import { Note } from '../../components/ui.tsx';
import { notify } from '../../store/ui.ts';
import { friendlyError } from '../../lib/supabase.ts';

export default function ExportTab() {
  const { meters, readings, metrics, budgets, lpgLatest, fy, settings, meterDays } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const label = fiscalLabel(fy, settings.fiscalStartMonth);
  const code = new Map(meters.map((m) => [m.id, m]));

  const workbook = async () => {
    setBusy('wb');
    try {
      const { warnings, applied } = await exportWorkbookFromTemplate({
        meters: meters.map((m) => ({ utility: m.utility, name: m.name, code: m.code })),
        readings: readings.flatMap((r) => { const m = code.get(r.meter_id); return m ? [{ meter_code: m.code, reading_date: r.reading_date, closing: r.closing, opening: r.opening }] : []; }),
        metrics: metrics.map((m) => ({ metric_date: m.metric_date, avg_temp_c: m.avg_temp_c, occupancy_rate: m.occupancy_rate, occupied_rooms: m.occupied_rooms, guests: m.guests })),
        budgets: budgets.filter((b) => b.fiscal_year === fy || b.kind === 'previous').map((b) => ({ ...b })),
        lpg: lpgLatest.map((l) => ({ tank: l.tank, level_fraction: l.level_fraction })),
      }, `Main_Consumption_Opening_Closing_${label}.xlsx`);
      notify.success('Workbook exported', `${applied} cells written. Formulas recalculate when opened in Excel.`);
      warnings.forEach((w) => notify.warning('Export note', w));
    } catch (e) { notify.error('Export failed', friendlyError(e)); } finally { setBusy(null); }
  };

  const flat = async () => {
    setBusy('flat');
    try {
      await exportTables([
        { name: 'Readings', title: `Meter readings ${label}`, headers: ['Date', 'Utility', 'Area', 'Meter', 'Code', 'Unit', 'Opening', 'Closing', 'Consumption', 'Status'],
          rows: readings.flatMap((r) => { const m = code.get(r.meter_id); if (!m) return []; const d = meterDays.get(`${r.meter_id}|${r.reading_date}`); return [[r.reading_date, m.utility, m.area, m.name, m.code, m.unit, d?.opening ?? null, r.closing, d?.consumption ?? null, d?.status ?? '']]; }) },
        { name: 'Daily metrics', title: `Climate & occupancy ${label}`, headers: ['Date', 'Avg temp °C (manual)', 'Occupancy (fraction)', 'Occupied rooms', 'Guests'], rows: metrics.map((m) => [m.metric_date, m.avg_temp_c, m.occupancy_rate, m.occupied_rooms, m.guests]) },
        { name: 'Meters', headers: ['Code', 'Utility', 'Area', 'Name', 'Unit', 'Counted in total', 'Rollover at', 'Active'], rows: meters.map((m) => [m.code, m.utility, m.area, m.name, m.unit, m.include_in_total ? 'Yes' : 'No', m.rollover_at, m.active ? 'Yes' : 'No']) },
      ], `Energy-data-${label}.xlsx`);
      notify.success('Data exported');
    } catch (e) { notify.error('Export failed', friendlyError(e)); } finally { setBusy(null); }
  };

  return (
    <div className="grid g2">
      <div className="card"><h3>Workbook (original layout)</h3>
        <p className="muted">Fills the original workbook template with the data of the selected reporting year ({label}). All formulas, formatting and sheets of the template are kept; Excel recalculates them on opening.</p>
        <Note kind="info">Limits: the workbook layout stores only closing readings, so explicit opening values (meter replacement) are listed as warnings and not written. Data outside the template’s dates is not exported.</Note>
        <button className="btn primary" disabled={busy !== null} onClick={() => void workbook()}><FileSpreadsheet size={16} />{busy === 'wb' ? 'Preparing…' : 'Export workbook'}</button></div>
      <div className="card"><h3>Flat data tables</h3>
        <p className="muted">Readings with calculated consumption, daily climate/occupancy and the meter list as simple Excel tables – convenient for filtering and pivot tables.</p>
        <button className="btn" disabled={busy !== null} onClick={() => void flat()}><Table size={16} />{busy === 'flat' ? 'Preparing…' : 'Export data tables'}</button></div>
    </div>
  );
}
