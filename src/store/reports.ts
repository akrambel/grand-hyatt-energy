// Monthly PDF reports kept in the website (migration 0010). The first time an administrator opens the
// website in a new month, last month's PDF is made in their browser and saved in the "reports" storage
// bucket; everybody who can view reports then finds it in the notifications and on Monthly Reports,
// on any device. Administrators can also make (or remake) a month's PDF at any time.
import { create } from 'zustand';
import { supabase, friendlyError } from '../lib/supabase.ts';
import type { ReportMonth } from '../lib/monthlyReport.ts';
import { localToday } from '../lib/dates.ts';
import { useData } from './data.ts';
import { useAuth } from './auth.ts';

const BUCKET = 'reports';
const SEEN_KEY = 'ghrs-reports-seen-v1';

export interface MonthlyReport { month_key: string; label: string; path: string; size_bytes: number | null; created_at: string }

const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };

interface ReportsState {
  reports: MonthlyReport[];
  /** False when the table is missing (migration 0010 not run yet) or the user may not view reports. */
  available: boolean;
  loaded: boolean;
  creating: string | null;
  /** Newest month key the user has already looked at, so the notification shows once per report. */
  seen: string | null;
  list: () => Promise<void>;
  create: (month: ReportMonth) => Promise<MonthlyReport>;
  /** Administrators only: makes last month's PDF if it is not saved yet. Runs once per visit. */
  ensureLastMonth: () => Promise<MonthlyReport | null>;
  open: (r: MonthlyReport) => Promise<void>;
  markSeen: () => void;
}

let ensured = false;

export const useReports = create<ReportsState>((set, get) => ({
  reports: [],
  available: true,
  loaded: false,
  creating: null,
  seen: readSeen(),

  list: async () => {
    const { data, error } = await supabase.from('monthly_reports').select('month_key, label, path, size_bytes, created_at').order('month_key', { ascending: false });
    if (error) { set({ available: false, loaded: true, reports: [] }); return; }
    set({ reports: (data ?? []) as MonthlyReport[], available: true, loaded: true });
  },

  create: async (month) => {
    set({ creating: month.key });
    try {
      const st = useData.getState();
      const profile = useAuth.getState().profile;
      const { buildMonthlyPdf } = await import('../lib/monthlyReport.ts'); // PDF code loads only when needed
      const blob = await buildMonthlyPdf(month, localToday(st.settings.timezone), profile?.display_name ?? '');
      const path = `monthly-report-${month.key}.pdf`;
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: true });
      if (up.error) throw new Error(friendlyError(up.error));
      const row = { month_key: month.key, label: month.label, path, size_bytes: blob.size, created_at: new Date().toISOString(), created_by: profile?.id ?? null };
      const { error } = await supabase.from('monthly_reports').upsert(row, { onConflict: 'month_key' });
      if (error) throw new Error(friendlyError(error));
      const saved: MonthlyReport = { month_key: row.month_key, label: row.label, path, size_bytes: row.size_bytes, created_at: row.created_at };
      set({ reports: [saved, ...get().reports.filter((r) => r.month_key !== month.key)].sort((a, b) => b.month_key.localeCompare(a.month_key)) });
      return saved;
    } finally {
      set({ creating: null });
    }
  },

  ensureLastMonth: async () => {
    if (ensured) return null;
    ensured = true;
    if (!get().loaded) await get().list();
    if (!get().available) return null;
    const st = useData.getState();
    const { previousMonth } = await import('../lib/monthlyReport.ts');
    const month = previousMonth(localToday(st.settings.timezone), st.settings.fiscalStartMonth);
    if (get().reports.some((r) => r.month_key === month.key)) return null;
    // no readings at all that month (for example before the website was used): nothing to report
    const { count } = await supabase.from('readings').select('id', { count: 'exact', head: true }).gte('reading_date', month.start).lte('reading_date', month.end);
    if (count === 0) return null;
    try { return await get().create(month); } catch { return null; } // tried again on the next visit
  },

  open: async (r) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.path, 60 * 10, { download: r.path });
    if (error || !data) throw new Error(error ? friendlyError(error) : 'The file could not be found.');
    window.location.assign(data.signedUrl);
  },

  markSeen: () => {
    const newest = get().reports[0]?.month_key ?? null;
    if (!newest) return;
    try { localStorage.setItem(SEEN_KEY, newest); } catch { /* kept for this visit only */ }
    set({ seen: newest });
  },
}));
