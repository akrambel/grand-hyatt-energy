import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { useData } from '../../store/data.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { formatDateTimeLocal } from '../../lib/dates.ts';
import { notify } from '../../store/ui.ts';

interface Imp { id: number; at: string; username: string | null; filename: string | null; mode: string | null; summary: unknown }

export default function AuditTab() {
  const { settings } = useData();
  const [imports, setImports] = useState<Imp[]>([]);

  const load = useCallback(async () => {
    const i = await supabase.from('import_log').select('id, at, username, filename, mode, summary').order('at', { ascending: false }).limit(100);
    if (i.error) notify.error('Import history unavailable', friendlyError(i.error)); else setImports((i.data ?? []) as Imp[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="grid">
      <div className="card"><h3>Imports</h3>
        <DataTable searchable={false} rows={imports} rowKey={(r) => String(r.id)} empty="No imports yet." columns={[
          { key: 'at', header: 'When', value: (r) => r.at, render: (r) => formatDateTimeLocal(r.at, settings.timezone) }, { key: 'u', header: 'User', value: (r) => r.username },
          { key: 'f', header: 'File', value: (r) => r.filename }, { key: 'm', header: 'Mode', value: (r) => r.mode }]} /></div>
    </div>
  );
}
