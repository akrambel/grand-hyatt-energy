import { useState } from 'react';
import { useData } from '../../store/data.ts';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Field, Modal, Note } from '../../components/ui.tsx';
import { UTILITIES, UTILITY_INFO } from '../../lib/types.ts';
import type { Meter, Utility } from '../../lib/types.ts';
import { notify } from '../../store/ui.ts';
import { parseReading } from '../../lib/validate.ts';
import { fmtNumber } from '../../lib/format.ts';

export default function MetersTab() {
  const { meters, reloadReference } = useData();
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Meter | null>(null);

  return (
    <div className="card">
      <div className="card-head"><h3>Meters ({meters.length})</h3><button className="btn primary" onClick={() => setAdding(true)}>Add meter</button></div>
      <Note kind="info"><strong>Counted in total</strong> decides whether a meter is added into the utility’s daily total (as in the workbook). Turn it off for sub-meters that would count the same consumption twice – check main vs. sub-meters (for example the LPG main meter) with the engineering team.</Note>
      <DataTable rows={meters} rowKey={(m) => m.id} columns={[
        { key: 'c', header: 'Code', value: (m) => m.code }, { key: 'u', header: 'Utility', value: (m) => UTILITY_INFO[m.utility].label }, { key: 'a', header: 'Area', value: (m) => m.area },
        { key: 'n', header: 'Name', value: (m) => m.name }, { key: 'un', header: 'Unit', value: (m) => m.unit },
        { key: 'i', header: 'Counted in total', value: (m) => (m.include_in_total ? 'Yes' : 'No') }, { key: 'r', header: 'Rollover at', num: true, value: (m) => m.rollover_at, render: (m) => fmtNumber(m.rollover_at) },
        { key: 'ac', header: 'Active', value: (m) => (m.active ? 'Yes' : 'No') }, { key: 'x', header: '', value: () => '', render: (m) => <button className="btn sm" onClick={() => setEdit(m)}>Edit</button> },
      ]} />
      {(adding || edit) && <MeterForm meter={edit} onClose={() => { setAdding(false); setEdit(null); }} onSaved={() => { setAdding(false); setEdit(null); void reloadReference(); }} />}
    </div>
  );
}

function MeterForm({ meter, onClose, onSaved }: { meter: Meter | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: meter?.code ?? '', utility: (meter?.utility ?? 'water') as Utility, area: meter?.area ?? '', name: meter?.name ?? '', unit: meter?.unit ?? 'm³',
    include_in_total: meter?.include_in_total ?? true, rollover_at: meter?.rollover_at != null ? String(meter.rollover_at) : '', active: meter?.active ?? true });
  const [busy, setBusy] = useState(false);
  const roll = f.rollover_at.trim() === '' ? null : parseReading(f.rollover_at);
  const bad = !f.code.trim() || !f.name.trim() || !f.area.trim() || (roll !== null && (Number.isNaN(roll) || roll <= 0));
  const save = async () => {
    setBusy(true);
    const row = { code: f.code.trim(), utility: f.utility, area: f.area.trim(), name: f.name.trim(), unit: f.unit.trim(), include_in_total: f.include_in_total, rollover_at: roll, active: f.active };
    const { error } = meter ? await supabase.from('meters').update(row).eq('id', meter.id) : await supabase.from('meters').insert(row);
    setBusy(false);
    if (error) notify.error('Meter not saved', friendlyError(error)); else { notify.success('Meter saved', row.name); onSaved(); }
  };
  return (
    <Modal title={meter ? 'Edit meter' : 'Add meter'} onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || bad} onClick={() => void save()}>Save</button></>}>
      <div className="form-grid">
        <Field label="Code (unique)"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!meter} /></Field>
        <Field label="Utility"><select className="input" value={f.utility} onChange={(e) => setF({ ...f, utility: e.target.value as Utility, unit: UTILITY_INFO[e.target.value as Utility].unit })}>{UTILITIES.map((u) => <option key={u} value={u}>{UTILITY_INFO[u].label}</option>)}</select></Field>
        <Field label="Area"><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Field>
        <Field label="Meter name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Unit"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Rollover value (optional)" hint="Largest value the meter display shows before it restarts at 0"><input className="input mono" inputMode="decimal" value={f.rollover_at} onChange={(e) => setF({ ...f, rollover_at: e.target.value })} /></Field>
      </div>
      <label style={{ display: 'block', marginTop: 10 }}><input type="checkbox" checked={f.include_in_total} onChange={(e) => setF({ ...f, include_in_total: e.target.checked })} /> Counted in the utility total</label>
      <label style={{ display: 'block' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
    </Modal>
  );
}
