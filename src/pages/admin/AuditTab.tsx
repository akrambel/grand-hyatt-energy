import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { useData } from '../../store/data.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { formatDateTimeLocal } from '../../lib/dates.ts';
import { notify } from '../../store/ui.ts';

interface Audit { id: number; at: string; username: string | null; action: string; table_name: string; record_id: string | null }
interface Imp { id: number; at: string; username: string | null; filename: string | null; mode: string | null; summary: unknown }

export default function AuditTab() {
  const { settings } = useData();
  const [audit, setAudit] = useState<Audit[]>([]);
  const [imports, setImports] = useState<Imp[]>([]);

  const load = useCallback(async () => {
    const [a, i] = await Promise.all([
      supabase.from('audit_log').select('id, at, username, action, table_name, record_id').order('at', { ascending: false }).limit(500),
      supabase.from('import_log').select('id, at, username, filename, mode, summary').order('at', { ascending: false }).limit(100),
    ]);
    if (a.error) notify.error('Audit log unavailable', friendlyError(a.error)); else setAudit((a.data ?? []) as Audit[]);
    if (!i.error) setImports((i.data ?? []) as Imp[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="grid">
      <div className="card"><h3>Imports</h3>
        <DataTable searchable={false} rows={imports} rowKey={(r) => String(r.id)} empty="No imports yet." columns={[
          { key: 'at', header: 'When', value: (r) => r.at, render: (r) => formatDateTimeLocal(r.at, settings.timezone) }, { key: 'u', header: 'User', value: (r) => r.username },
          { key: 'f', header: 'File', value: (r) => r.filename }, { key: 'm', header: 'Mode', value: (r) => r.mode }]} /></div>
      <div className="card"><h3>Audit log (latest 500 changes)</h3>
        <DataTable rows={audit} rowKey={(r) => String(r.id)} initialSort={{ key: 'at', dir: 'desc' }} columns={[
          { key: 'at', header: 'When', value: (r) => r.at, render: (r) => formatDateTimeLocal(r.at, settings.timezone) }, { key: 'u', header: 'User', value: (r) => r.username },
          { key: 'a', header: 'Action', value: (r) => r.action }, { key: 't', header: 'Table', value: (r) => r.table_name }, { key: 'r', header: 'Record', value: (r) => r.record_id }]} /></div>
    </div>
  );
}
