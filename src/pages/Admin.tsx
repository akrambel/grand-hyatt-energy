import { useState } from 'react';
import { PageHead } from '../components/ui.tsx';
import { clsx } from '../lib/format.ts';
import UsersTab from './admin/UsersTab.tsx';
import ImportTab from './admin/ImportTab.tsx';
import ExportTab from './admin/ExportTab.tsx';
import MetersTab from './admin/MetersTab.tsx';
import TariffsTab from './admin/TariffsTab.tsx';
import SettingsTab from './admin/SettingsTab.tsx';
import DevicesTab from './admin/DevicesTab.tsx';
import AuditTab from './admin/AuditTab.tsx';
import ReadingsTab from './admin/ReadingsTab.tsx';

const TABS = [
  { id: 'users', label: 'Users', C: UsersTab }, { id: 'readings', label: 'Readings', C: ReadingsTab }, { id: 'import', label: 'Import', C: ImportTab }, { id: 'export', label: 'Export', C: ExportTab },
  { id: 'meters', label: 'Meters', C: MetersTab }, { id: 'tariffs', label: 'Tariffs', C: TariffsTab }, { id: 'settings', label: 'Settings & thresholds', C: SettingsTab },
  { id: 'devices', label: 'Devices', C: DevicesTab }, { id: 'audit', label: 'Audit & maintenance', C: AuditTab },
] as const;

export default function Admin() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('users');
  const Active = TABS.find((t) => t.id === tab)!.C;
  return (
    <>
      <PageHead title="Administration" subtitle="Users, readings, data import/export, meters, tariffs, alert thresholds and devices" />
      <div className="tabs" role="tablist">{TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={clsx('tab', tab === t.id && 'active')} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      <Active />
    </>
  );
}
