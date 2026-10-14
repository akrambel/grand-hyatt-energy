import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useData } from '../../store/data.ts';
import type { Device } from '../../store/data.ts';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { ConfirmDialog, Field, Modal, Note, StatusPill } from '../../components/ui.tsx';
import { deviceState } from '../../lib/sensor.ts';
import { formatDateTimeLocal } from '../../lib/dates.ts';
import { ENV } from '../../config/env.ts';
import { notify } from '../../store/ui.ts';

export default function DevicesTab() {
  const { devices, settings, reloadDevices } = useData();
  const [f, setF] = useState({ id: 'esp32-01', name: 'Environment sensor 1', location: '' });
  const [key, setKey] = useState<{ device: string; key: string } | null>(null);
  const [rotate, setRotate] = useState<Device | null>(null);
  const [del, setDel] = useState<Device | null>(null);
  const idOk = /^[A-Za-z0-9_-]{3,40}$/.test(f.id);

  const register = async () => {
    const { data, error } = await supabase.rpc('register_device', { p_device_id: f.id, p_name: f.name.trim() || f.id, p_location: f.location.trim() || null });
    if (error) notify.error('Device not registered', friendlyError(error)); else { setKey({ device: f.id, key: data as string }); await reloadDevices(); }
  };
  const functionUrl = `${ENV.supabaseUrl}/functions/v1/ingest`;

  return (
    <div className="grid">
      <div className="card"><h3>Register an ESP32</h3>
        <div className="form-grid">
          <Field label="Device ID" hint="Letters, digits, - and _ (goes into secrets.h)"><input className={idOk ? 'input' : 'input invalid'} value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Engineering office" /></Field>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!idOk} onClick={() => void register()}>Register & generate API key</button>
        <p className="small muted">Ingest endpoint for the firmware: <code>{functionUrl}</code></p></div>
      <div className="card"><h3>Devices</h3>
        <DataTable searchable={false} rows={devices} rowKey={(d) => d.id} empty="No devices registered." columns={[
          { key: 'n', header: 'Name', value: (d) => d.name }, { key: 'id', header: 'Device ID', value: (d) => d.device_id }, { key: 'l', header: 'Location', value: (d) => d.location },
          { key: 's', header: 'Status', value: (d) => deviceState(d.last_seen_at, settings.deviceOfflineMinutes), render: (d) => { const st = deviceState(d.last_seen_at, settings.deviceOfflineMinutes); return <StatusPill kind={st === 'online' ? 'ok' : st === 'delayed' ? 'warn' : st === 'offline' ? 'bad' : 'neutral'}>{st}</StatusPill>; } },
          { key: 'ls', header: 'Last seen', value: (d) => d.last_seen_at, render: (d) => (d.last_seen_at ? formatDateTimeLocal(d.last_seen_at, settings.timezone) : 'never') },
          { key: 'fw', header: 'Firmware', value: (d) => d.firmware_version },
          { key: 'ac', header: 'Active', value: (d) => (d.active ? 'Yes' : 'No'), render: (d) => <input type="checkbox" checked={d.active} aria-label={`Active ${d.name}`} onChange={async (e) => { const { error } = await supabase.from('devices').update({ active: e.target.checked }).eq('id', d.id); if (error) notify.error('Update failed', friendlyError(error)); else void reloadDevices(); }} /> },
          { key: 'x', header: '', value: () => '', render: (d) => <span className="actions"><button className="btn sm" onClick={() => setRotate(d)}>New key</button><button className="btn sm danger" onClick={() => setDel(d)}>Delete</button></span> }]} /></div>
      {key && <Modal title="Device API key" onClose={() => setKey(null)} actions={<button className="btn primary" onClick={() => setKey(null)}>I have saved it</button>}>
        <Note kind="warn"><strong>This key is shown only once.</strong> Copy it into the firmware file <code>secrets.h</code> (never commit that file). If it is lost, generate a new key.</Note>
        <p>Device: <code>{key.device}</code></p>
        <div className="input mono" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{key.key}</div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => { void navigator.clipboard?.writeText(key.key).then(() => notify.success('Copied')).catch(() => notify.error('Copy failed – select and copy manually')); }}><Copy size={14} />Copy</button></Modal>}
      {rotate && <ConfirmDialog danger title="Generate a new key?" message={`The current key of “${rotate.name}” stops working immediately. The firmware must be updated with the new key.`} confirmLabel="Generate" onCancel={() => setRotate(null)}
        onConfirm={async () => { const { data, error } = await supabase.rpc('rotate_device_key', { p_device_id: rotate.device_id }); if (error) notify.error('Failed', friendlyError(error)); else setKey({ device: rotate.device_id, key: data as string }); setRotate(null); }} />}
      {del && <ConfirmDialog danger typeToConfirm={del.device_id} title="Delete device?" message={`Deletes “${del.name}” and ALL of its stored sensor readings. This cannot be undone.`} confirmLabel="Delete device" onCancel={() => setDel(null)}
        onConfirm={async () => { const { error } = await supabase.from('devices').delete().eq('id', del.id); if (error) notify.error('Delete failed', friendlyError(error)); else { notify.success('Device deleted'); await reloadDevices(); } setDel(null); }} />}
    </div>
  );
}
