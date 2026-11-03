import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { useData } from '../../store/data.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { ConfirmDialog, Field, Note } from '../../components/ui.tsx';
import { UTILITIES, UTILITY_INFO, fixedMonthly } from '../../lib/types.ts';
import { fmtMoney, fmtNumber } from '../../lib/format.ts';
import type { Utility } from '../../lib/types.ts';
import { formatDate, localToday } from '../../lib/dates.ts';
import { notify } from '../../store/ui.ts';
import { parseReading } from '../../lib/validate.ts';
import { BASE_UNITS } from '../../lib/units.ts';
import type { UnitUtility } from '../../lib/units.ts';

/** Tariffs are always entered per base unit (kWh, m³, litre), whatever display unit is chosen in Settings. */
const baseUnit = (u: Utility): string => (u === 'energy' ? 'kWh' : BASE_UNITS[u as UnitUtility]);

interface Row { id: string; utility: Utility; price_per_unit: number; currency: string; effective_from: string; note: string | null; demand: number | null; demand_unit: string | null; fixed_rate: number | null }

/** Usual unit of the contracted (diversified) demand on the utility bill. */
const DEMAND_UNIT: Record<Utility, string> = { energy: 'kW', water: 'm³', gas: '', chilled: 'TR' };
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export default function TariffsTab() {
  const { reloadReference, settings } = useData();
  const [rows, setRows] = useState<Row[]>([]);
  const [f, setF] = useState({ utility: 'energy' as Utility, price: '', demand: '', demandUnit: DEMAND_UNIT.energy, rate: '', currency: 'SAR', from: localToday(settings.timezone), note: '' });
  const [del, setDel] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tariffs').select('*').order('effective_from', { ascending: false });
    if (error) notify.error('Could not load tariffs', friendlyError(error)); else setRows(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...(r as unknown as Row), price_per_unit: Number(r.price_per_unit), demand: n(r.demand), fixed_rate: n(r.fixed_rate), demand_unit: (r.demand_unit as string | null) ?? null })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const price = parseReading(f.price);
  const demand = f.demand.trim() ? parseReading(f.demand) : null;
  const rate = f.rate.trim() ? parseReading(f.rate) : null;
  const badNum = (v: number | null) => v !== null && (Number.isNaN(v) || v < 0);
  // the fixed charge needs both the demand and its rate, or neither
  const halfFixed = (demand === null) !== (rate === null);
  const bad = price === null || Number.isNaN(price) || price < 0 || !f.from || badNum(demand) || badNum(rate) || halfFixed;
  const monthly = !halfFixed && demand !== null && rate !== null && !badNum(demand) && !badNum(rate) ? fixedMonthly({ demand, fixed_rate: rate }) : null;
  const cur = f.currency.trim() || 'SAR';
  const add = async () => {
    const { error } = await supabase.from('tariffs').upsert({ utility: f.utility, price_per_unit: price, currency: cur, effective_from: f.from, note: f.note || null,
      demand, demand_unit: demand === null ? null : f.demandUnit.trim() || null, fixed_rate: rate }, { onConflict: 'utility,effective_from' });
    if (error) notify.error('Tariff not saved', friendlyError(error)); else { notify.success('Tariff saved'); setF({ ...f, price: '', demand: '', rate: '', note: '' }); await load(); await reloadReference(); }
  };
  const edit = (r: Row) => setF({ utility: r.utility, price: String(r.price_per_unit), demand: r.demand === null ? '' : String(r.demand), demandUnit: r.demand_unit ?? DEMAND_UNIT[r.utility], rate: r.fixed_rate === null ? '' : String(r.fixed_rate), currency: r.currency, from: r.effective_from, note: r.note ?? '' });
  return (
    <div className="grid">
      <Note kind="info"><strong>Monthly bill = fixed charge + usage cost.</strong> Fixed charge = diversified demand × fixed rate, billed every month even with no consumption (a part of a month gets its share). Usage cost = daily consumption × price per unit valid on that day. Leave the demand and fixed rate empty for a utility billed on usage only (for example gas). Enter the real contractual tariffs – no value is assumed. Price per unit: energy per kWh, water and chilled water per m³, gas per litre. These base units stay the same even if you choose another display unit in Settings; the conversion is automatic. Hot water and irrigation water use the water tariff.</Note>
      <div className="card"><h3>Add / update tariff</h3>
        <div className="form-grid">
          <Field label="Utility"><select className="input" value={f.utility} onChange={(e) => { const u = e.target.value as Utility; setF({ ...f, utility: u, demandUnit: DEMAND_UNIT[u] }); }}>{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label} (per {baseUnit(u)})</option>)}</select></Field>
          <Field label={`Price per unit (${cur} per ${baseUnit(f.utility)})`}><input className="input mono" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Diversified demand (fixed part)" hint="Contracted demand on the bill. Empty = no fixed charge."><input className="input mono" inputMode="decimal" value={f.demand} onChange={(e) => setF({ ...f, demand: e.target.value })} placeholder="e.g. 4125" /></Field>
          <Field label="Demand unit"><input className="input" value={f.demandUnit} maxLength={12} onChange={(e) => setF({ ...f, demandUnit: e.target.value })} placeholder="kW, m³, TR" /></Field>
          <Field label={`Fixed rate (${cur} per ${f.demandUnit || 'unit'} per month)`} hint={halfFixed ? 'Enter both the demand and the fixed rate, or neither.' : undefined}><input className={halfFixed ? 'input mono invalid' : 'input mono'} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="e.g. 126.5" /></Field>
          <Field label="Currency"><input className="input" value={f.currency} maxLength={5} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Effective from"><input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <div className="tariff-preview">{monthly !== null ? <>Fixed charge per month: <strong>{fmtMoney(monthly, cur)}</strong> ({fmtNumber(demand, 2)} {f.demandUnit} × {fmtNumber(rate, 4)} {cur})</> : 'No fixed monthly charge: cost = consumption × price per unit.'}</div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={bad} onClick={() => void add()}>Save tariff</button>
        <p className="small muted" style={{ marginBottom: 0 }}>Saving with the same utility and “effective from” date replaces that tariff. Use Edit in the list to load a tariff into this form.</p></div>
      <div className="card"><DataTable rows={rows} rowKey={(r) => r.id} empty="No tariffs configured." columns={[
        { key: 'u', header: 'Utility', value: (r) => UTILITY_INFO[r.utility].label }, { key: 'p', header: 'Price per unit', num: true, value: (r) => r.price_per_unit, render: (r) => `${r.price_per_unit} / ${baseUnit(r.utility)}` },
        { key: 'd', header: 'Diversified demand', num: true, value: (r) => r.demand, render: (r) => (r.demand === null ? <span className="muted">—</span> : `${fmtNumber(r.demand, 2)} ${r.demand_unit ?? ''}`) },
        { key: 'r', header: 'Fixed rate / month', num: true, value: (r) => r.fixed_rate, render: (r) => (r.fixed_rate === null ? <span className="muted">—</span> : `${r.fixed_rate} / ${r.demand_unit ?? 'unit'}`) },
        { key: 'm', header: 'Fixed charge / month', num: true, value: (r) => fixedMonthly(r), render: (r) => { const m = fixedMonthly(r); return m === null ? <span className="muted">None</span> : fmtMoney(m, r.currency); } },
        { key: 'c', header: 'Currency', value: (r) => r.currency },
        { key: 'f', header: 'Effective from', value: (r) => r.effective_from, render: (r) => formatDate(r.effective_from) }, { key: 'n', header: 'Note', value: (r) => r.note },
        { key: 'x', header: '', value: () => '', render: (r) => <span style={{ display: 'inline-flex', gap: 6 }}><button className="btn sm" onClick={() => edit(r)}>Edit</button><button className="btn sm danger" onClick={() => setDel(r)}>Delete</button></span> }]} /></div>
      {del && <ConfirmDialog danger title="Delete tariff?" message="Costs for the affected days will become N/A unless an earlier tariff applies." confirmLabel="Delete" onCancel={() => setDel(null)}
        onConfirm={async () => { const { error } = await supabase.from('tariffs').delete().eq('id', del.id); if (error) notify.error('Delete failed', friendlyError(error)); else { notify.success('Tariff deleted'); await load(); await reloadReference(); } setDel(null); }} />}
    </div>
  );
}
