import { createClient } from '@supabase/supabase-js';
import { ENV, isConfigured } from '../config/env.ts';

// The anon key is public by design; every table is protected by Row Level Security and login.
export const supabase = createClient(
  isConfigured() ? ENV.supabaseUrl : 'http://localhost:54321',
  isConfigured() ? ENV.supabaseAnonKey : 'not-configured-anon-key-placeholder',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ghrs-energy-auth' } },
);

/** Reads every row of a query that may exceed PostgREST's 1000-row page limit. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

/** Turns Supabase / network errors into a message a technician can act on. */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  if (/Failed to fetch|NetworkError|network request failed/i.test(msg)) return 'Cannot reach the server. Check your internet connection and try again.';
  if (/row-level security|permission denied|42501/i.test(msg)) return 'You do not have permission to do this.';
  if (/duplicate key|23505/i.test(msg)) return 'This record already exists.';
  if (/Invalid login credentials/i.test(msg)) return 'Incorrect username or password.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Your session has expired. Please sign in again.';
  if (/future/i.test(msg)) return msg;
  return msg;
}
