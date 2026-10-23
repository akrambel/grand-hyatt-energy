// Offline entry. When a reading cannot reach the server (no Wi-Fi in a basement plant room), it is kept
// on this phone and shown as "waiting to send"; it is sent as soon as the connection is back. Readings
// are kept in the meter's native unit, in the order they were typed, and survive closing the browser.
import { create } from 'zustand';
import { supabase, friendlyError } from '../lib/supabase.ts';
import type { Reading } from '../lib/types.ts';

export interface OutboxItem {
  key: string;             // meter_id|reading_date: a newer entry for the same meter and day replaces the older one
  meter_id: string;
  reading_date: string;
  opening: number | null;  // native unit
  closing: number;         // native unit
  note: string | null;
  queued_at: string;
  /** Set when the server refused the reading (not a connection problem); it then waits for a person. */
  error?: string;
}

const STORE_KEY = 'ghrs-outbox-v1';

function loadSaved(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function persist(items: OutboxItem[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch { /* storage full or blocked: kept in memory */ }
}

/** True when the failure is the connection, not the data (then the reading is kept and retried). */
export function isConnectionError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  return /Failed to fetch|NetworkError|network request failed|Load failed|fetch failed|ERR_INTERNET|timed? ?out/i.test(msg);
}

interface OutboxState {
  items: OutboxItem[];
  sending: boolean;
  lastSentAt: number | null;
  add: (item: Omit<OutboxItem, 'key' | 'queued_at'>) => void;
  remove: (key: string) => void;
  /** Sends everything waiting; returns how many were sent. */
  flush: (onSent?: (r: Record<string, unknown>) => void) => Promise<number>;
}

export const useOutbox = create<OutboxState>((set, get) => ({
  items: loadSaved(),
  sending: false,
  lastSentAt: null,

  add: (item) => {
    const key = `${item.meter_id}|${item.reading_date}`;
    const items = [...get().items.filter((x) => x.key !== key), { ...item, key, queued_at: new Date().toISOString() }];
    persist(items);
    set({ items });
  },

  remove: (key) => {
    const items = get().items.filter((x) => x.key !== key);
    persist(items);
    set({ items });
  },

  flush: async (onSent) => {
    if (get().sending || get().items.length === 0) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    set({ sending: true });
    let sent = 0;
    try {
      // oldest day first, so each opening follows the closing sent before it
      const queue = [...get().items].filter((x) => !x.error).sort((a, b) => a.reading_date.localeCompare(b.reading_date) || a.queued_at.localeCompare(b.queued_at));
      for (const it of queue) {
        const { data, error } = await supabase.from('readings')
          .upsert({ meter_id: it.meter_id, reading_date: it.reading_date, opening: it.opening, closing: it.closing, note: it.note, source: 'manual' },
            { onConflict: 'meter_id,reading_date' })
          .select('id, meter_id, reading_date, opening, closing, note, source, entered_by, updated_at').single();
        if (error) {
          if (isConnectionError(error)) break; // still offline: try again later
          const items = get().items.map((x) => (x.key === it.key ? { ...x, error: friendlyError(error) } : x));
          persist(items); set({ items });
          continue;
        }
        get().remove(it.key);
        sent++;
        onSent?.(data as Record<string, unknown>);
      }
    } catch { /* connection dropped mid-way: the rest stays queued */ }
    set({ sending: false, lastSentAt: sent ? Date.now() : get().lastSentAt });
    return sent;
  },
}));

/** A queued reading as the pages show it until it reaches the server. */
export function pendingReading(it: OutboxItem, toDisplay: (v: number | null) => number | null): Reading {
  return { meter_id: it.meter_id, reading_date: it.reading_date, opening: toDisplay(it.opening), closing: toDisplay(it.closing), note: it.note, source: 'offline', updated_at: it.queued_at };
}
