import { useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { buildPdf } from '../lib/pdf.ts';
import type { PdfReport } from '../lib/pdf.ts';
import { exportTables } from '../lib/exportXlsx.ts';
import type { SheetSpec } from '../lib/exportXlsx.ts';
import { captureCharts } from '../lib/chartImage.ts';
import { useAuth } from '../store/auth.ts';
import { useData } from '../store/data.ts';
import { notify } from '../store/ui.ts';
import { ENV } from '../config/env.ts';
import { slug } from '../lib/format.ts';

export interface ExportSpec {
  title: string;
  period: string;
  filters?: Array<[string, string]>;
  kpis?: PdfReport['kpis'];
  tables?: PdfReport['tables'];
  notes?: string[];
  landscape?: boolean;
  /** Sheets for Excel export. When omitted the table list is reused. */
  sheets?: SheetSpec[];
  includeCharts?: boolean;
}

/** PDF and Excel export that always uses the data currently shown (the caller builds the spec from its filtered state). */
export function ExportButtons({ build, disabled }: { build: () => ExportSpec; disabled?: boolean }) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const user = useAuth((s) => s.profile);
  const tz = useData((s) => s.settings.timezone);
  const stamp = () => new Date().toISOString().slice(0, 10);

  const pdf = async () => {
    setBusy('pdf');
    try {
      const spec = build();
      const charts = spec.includeCharts === false ? [] : await captureCharts();
      await buildPdf({
        title: spec.title, period: spec.period, filters: spec.filters, kpis: spec.kpis, tables: spec.tables, notes: spec.notes, charts,
        landscape: spec.landscape, user: user ? `${user.display_name} (${user.username})` : 'Unknown', property: ENV.propertyName, timezone: tz,
        filename: `${slug(spec.title)}-${stamp()}.pdf`,
      });
      notify.success('PDF exported', `${spec.title}`);
    } catch (e) { notify.error('PDF export failed', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const xlsx = async () => {
    setBusy('xlsx');
    try {
      const spec = build();
      const sheets: SheetSpec[] = spec.sheets ?? (spec.tables ?? []).map((t) => ({
        name: t.title, title: spec.title, subtitle: [spec.period, ...(spec.filters ?? []).map(([k, v]) => `${k}: ${v}`)],
        headers: t.headers, rows: t.rows,
      }));
      if (!sheets.length) throw new Error('There is no table to export on this page.');
      const generated = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
      await exportTables(sheets, `${slug(spec.title)}-${stamp()}.xlsx`, {
        property: ENV.propertyName, generated, user: user ? `${user.display_name} (${user.username})` : undefined,
      });
      notify.success('Excel exported', `${spec.title}`);
    } catch (e) { notify.error('Excel export failed', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  return (
    <>
      <button className="btn" onClick={pdf} disabled={disabled || busy !== null}><FileDown size={16} />{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
      <button className="btn" onClick={xlsx} disabled={disabled || busy !== null}><FileSpreadsheet size={16} />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
    </>
  );
}
