import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useData } from '../../store/data.ts';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { loadWorkbook, readerFor } from '../../lib/excelAdapter.ts';
import { parseWorkbook } from '../../lib/workbook.ts';
import type { ImportPlan } from '../../lib/workbook.ts';
import { localToday, formatDate } from '../../lib/dates.ts';
import { ConfirmDialog, Field, Note } from '../../components/ui.tsx';
import { notify } from '../../store/ui.ts';
import { fmtNumber } from '../../lib/format.ts';

const CHUNK = 500;

async function runChunks(kind: string, rows: unknown[], mode: string, onProgress: (n: number) => void) {
  const totals = { received: 0, inserted: 0, updated: 0, unknown_meter: 0, unchanged: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase.rpc('import_rows', { p_kind: kind, p_rows: rows.slice(i, i + CHUNK), p_mode: mode });
    if (error) throw new Error(`${kind}: ${error.message}`);
    const d = data as typeof totals;
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(d[k] ?? 0);
    onProgress(Math.min(i + CHUNK, rows.length));
  }
  return totals;
}

export default function ImportTab() {
  const { meters, settings, reloadReference } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [mode, setMode] = useState<'overwrite' | 'skip_existing'>('skip_existing');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const analyse = async (f: File) => {
    setFile(f); setPlan(null); setResult(null); setBusy(true); setProgress('Reading workbook…');
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error('Please choose an .xlsx workbook (Excel 2007 or newer).');
      if (f.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.');
      const wb = await loadWorkbook(await f.arrayBuffer());
      const p = parseWorkbook(readerFor(wb), { knownMeters: meters.map((m) => ({ code: m.code, utility: m.utility, name: m.name })), today: localToday(settings.timezone) });
      setPlan(p);
    } catch (e) { notify.error('Workbook could not be read', `${friendlyError(e)}${e instanceof Error && e.stack ? ' — Technical detail: ' + e.stack.split('\n').slice(0, 4).join(' | ') : ''}`); setFile(null); } finally { setBusy(false); setProgress(''); }
  };

  const run = async () => {
    if (!plan || !file) return;
    setBusy(true); setConfirm(false);
    try {
      const summary: Record<string, unknown> = {};
      if (plan.newMeters.length) summary.meters = await runChunks('meters', plan.newMeters, mode, (n) => setProgress(`Meters ${n}/${plan.newMeters.length}`));
      if (plan.readings.length) summary.readings = await runChunks('readings', plan.readings, mode, (n) => setProgress(`Readings ${n}/${plan.readings.length}`));
      if (plan.metrics.length) summary.daily_metrics = await runChunks('daily_metrics', plan.metrics, mode, (n) => setProgress(`Daily metrics ${n}/${plan.metrics.length}`));
      if (plan.budgets.length) summary.budgets = await runChunks('budgets', plan.budgets, mode, (n) => setProgress(`Budgets ${n}/${plan.budgets.length}`));
      if (plan.lpg.length) summary.lpg = await runChunks('lpg', plan.lpg, mode, () => setProgress('LPG levels'));
      const { error } = await supabase.rpc('log_import', { p_filename: file.name, p_mode: mode, p_summary: summary });
      if (error) notify.warning('Import finished but could not be logged', error.message);
      setResult(summary);
      notify.success('Import completed', file.name);
      await reloadReference();
    } catch (e) { notify.error('Import stopped', `${friendlyError(e)} Rows imported before the error stay saved; re-running the import is safe.`); } finally { setBusy(false); setProgress(''); }
  };

  const errors = plan?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = plan?.issues.filter((i) => i.level === 'warning') ?? [];

  return (
    <div className="grid">
      <div className="card">
        <h3>Import the Excel workbook</h3>
        <p className="muted">Reads the sheets “Daily Consumption”, “Utility Budget &amp; Actual” and “LPG Dashboard” of the workbook layout. Formulas are not imported – daily totals, monthly sums and the actual-vs-budget block are recalculated by the application with the same rules. You can import an updated workbook at any time without rebuilding the application.</p>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyse(f); e.target.value = ''; }} />
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={16} />Choose workbook (.xlsx)</button>
        {busy && <span className="small muted" style={{ marginLeft: 12 }}>{progress || 'Working…'}</span>}
      </div>

      {plan && (
        <div className="card">
          <h3>Preview – {file?.name}</h3>
          <table className="data"><tbody>
            <tr><th>Sheets found</th><td>{plan.sheetsFound.join(', ') || 'none'}</td></tr>
            <tr><th>Reporting year</th><td>{plan.fiscalYear ?? 'not detected'}{plan.dateRange ? ` · ${formatDate(plan.dateRange.start)} – ${formatDate(plan.dateRange.end)}` : ''}</td></tr>
            <tr><th>Meter readings</th><td>{fmtNumber(plan.readings.length)}</td></tr>
            <tr><th>Daily climate / occupancy rows</th><td>{fmtNumber(plan.metrics.length)}</td></tr>
            <tr><th>Budget / previous-period rows</th><td>{fmtNumber(plan.budgets.length)}</td></tr>
            <tr><th>LPG tank levels</th><td>{fmtNumber(plan.lpg.length)}</td></tr>
            <tr><th>New meters</th><td>{fmtNumber(plan.newMeters.length)}{plan.newMeters.length ? ` (${plan.newMeters.slice(0, 5).map((m) => m.name).join(', ')}${plan.newMeters.length > 5 ? ', …' : ''})` : ''}</td></tr>
          </tbody></table>
          {errors.length > 0 && <Note kind="bad"><strong>{errors.length} error(s) – fix the workbook first:</strong><ul>{errors.slice(0, 15).map((i, k) => <li key={k}>{i.sheet}{i.cell ? ` ${i.cell}` : ''}: {i.message}</li>)}</ul></Note>}
          {warnings.length > 0 && <Note kind="warn"><strong>{warnings.length} warning(s)</strong> (these cells are skipped):<ul>{warnings.slice(0, 15).map((i, k) => <li key={k}>{i.sheet}{i.cell ? ` ${i.cell}` : ''}: {i.message}</li>)}{warnings.length > 15 && <li>… and {warnings.length - 15} more</li>}</ul></Note>}
          {plan.issues.filter((i) => i.level === 'info').map((i, k) => <p className="small muted" key={k}>{i.message}</p>)}
          <Field label="If data already exists">
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} style={{ maxWidth: 420 }}>
              <option value="skip_existing">Keep existing values, only add what is missing (safest)</option>
              <option value="overwrite">Overwrite existing values with the workbook values</option>
            </select>
          </Field>
          <p className="small muted">Blank workbook cells never erase saved data in either mode.</p>
          <button className="btn primary" disabled={busy || errors.length > 0 || (plan.readings.length + plan.metrics.length + plan.budgets.length + plan.lpg.length === 0)} onClick={() => setConfirm(true)}>Import into the database</button>
        </div>)}

      {result && (
        <Note kind="ok"><strong>Import result</strong>
          <ul>{Object.entries(result).map(([k, v]) => { const r = v as Record<string, number>; return <li key={k}>{k}: {r.received} received · {r.inserted} added · {r.updated} updated · {r.unchanged} unchanged{r.unknown_meter ? ` · ${r.unknown_meter} with unknown meter` : ''}</li>; })}</ul></Note>)}
      {confirm && <ConfirmDialog title="Import workbook data?" confirmLabel="Import" onCancel={() => setConfirm(false)} onConfirm={run}
        message={<>This writes {plan?.readings.length} readings, {plan?.metrics.length} daily rows, {plan?.budgets.length} budget rows and {plan?.lpg.length} LPG levels. Mode: <strong>{mode === 'overwrite' ? 'overwrite existing values' : 'keep existing values'}</strong>. The import is recorded in the audit log.</>} />}
    </div>
  );
}
