import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { useData } from '../../store/data.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { ConfirmDialog, Field, Note } from '../../components/ui.tsx';
import { UTILITIES, UTILITY_INFO } from '../../lib/types.ts';
import type { Utility } from '../../lib/types.ts';
import { formatDate, localToday } from '../../lib/dates.ts';
import { notify } from '../../store/ui.ts';
import { parseReading } from '../../lib/validate.ts';

interface Row { id: string; utility: Utility; price_per_unit: number; currency: string; effective_from: string; note: string | null }

export default function TariffsTab() {
  const { reloadReference, settings } = useData();
  const [rows, setRows] = useState<Row[]>([]);
  const [f, setF] = useState({ utility: 'energy' as Utility, price: '', currency: 'SAR', from: localToday(settings.timezone), note: '' });
  const [del, setDel] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tariffs').select('id, utility, price_per_unit, currency, effective_from, note').order('effective_from', { ascending: false });
    if (error) notify.error('Could not load tariffs', friendlyError(error)); else setRows(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...(r as unknown as Row), price_per_unit: Number(r.price_per_unit) })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const price = parseReading(f.price);
  const bad = price === null || Number.isNaN(price) || price < 0 || !f.from;
  const add = async () => {
    const { error } = await supabase.from('tariffs').upsert({ utility: f.utility, price_per_unit: price, currency: f.currency.trim() || 'SAR', effective_from: f.from, note: f.note || null }, { onConflict: 'utility,effective_from' });
    if (error) notify.error('Tariff not saved', friendlyError(error)); else { notify.success('Tariff saved'); setF({ ...f, price: '', note: '' }); await load(); await reloadReference(); }
  };
  return (
    <div className="grid">
      <Note kind="info">Costs = daily consumption × tariff valid on that day (latest tariff with “effective from” on or before the day). The workbook contains no prices, so enter the real contractual tariffs here – no value is assumed. Units: energy per kWh, water and chilled water per m³, gas per litre.</Note>
      <div className="card"><h3>Add / update tariff</h3>
        <div className="form-grid">
          <Field label="Utility"><select className="input" value={f.utility} onChange={(e) => setF({ ...f, utility: e.target.value as Utility })}>{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label} (per {UTILITY_INFO[u].unit})</option>)}</select></Field>
          <Field label="Price per unit"><input className="input mono" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Currency"><input className="input" value={f.currency} maxLength={5} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Effective from"><input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={bad} onClick={() => void add()}>Save tariff</button></div>
      <div className="card"><DataTable rows={rows} rowKey={(r) => r.id} empty="No tariffs configured." columns={[
        { key: 'u', header: 'Utility', value: (r) => UTILITY_INFO[r.utility].label }, { key: 'p', header: 'Price per unit', num: true, value: (r) => r.price_per_unit }, { key: 'c', header: 'Currency', value: (r) => r.currency },
        { key: 'f', header: 'Effective from', value: (r) => r.effective_from, render: (r) => formatDate(r.effective_from) }, { key: 'n', header: 'Note', value: (r) => r.note },
        { key: 'x', header: '', value: () => '', render: (r) => <button className="btn sm danger" onClick={() => setDel(r)}>Delete</button> }]} /></div>
      {del && <ConfirmDialog danger title="Delete tariff?" message="Costs for the affected days will become N/A unless an earlier tariff applies." confirmLabel="Delete" onCancel={() => setDel(null)}
        onConfirm={async () => { const { error } = await supabase.from('tariffs').delete().eq('id', del.id); if (error) notify.error('Delete failed', friendlyError(error)); else { notify.success('Tariff deleted'); await load(); await reloadReference(); } setDel(null); }} />}
    </div>
  );
}
