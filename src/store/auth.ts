import { create } from 'zustand';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { usernameToEmail, isConfigured } from '../config/env.ts';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'user' | 'recorder';
  can_enter_data: boolean;
  active: boolean;
  /** the owner account (Akram): sees who is online and the change history (Administration › Activity) */
  is_owner?: boolean;
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  profile: Profile | null;
  message: string | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { id: r.id as string, username: r.username as string, display_name: r.display_name as string, role: r.role as Profile['role'],
    can_enter_data: r.can_enter_data === true, active: r.active !== false, is_owner: r.is_owner === true };
}

let initialised = false;

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  profile: null,
  message: null,

  init: async () => {
    if (initialised) return;
    initialised = true;
    if (!isConfigured()) { set({ status: 'signedOut' }); return; }
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const profile = await loadProfile(data.session.user.id);
        if (profile && profile.active) { set({ status: 'signedIn', profile }); }
        else { await supabase.auth.signOut(); set({ status: 'signedOut', message: 'This account is not active.' }); }
      } else set({ status: 'signedOut' });
    } catch (e) {
      set({ status: 'signedOut', message: friendlyError(e) });
    }
    supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_OUT') set({ status: 'signedOut', profile: null });
    });
  },

  login: async (username, password) => {
    set({ message: null });
    if (!isConfigured()) { set({ message: 'The application is not connected to a backend yet. See the README (Supabase setup).' }); return false; }
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error || !data.user) { set({ message: friendlyError(error ?? new Error('Invalid login credentials')) }); return false; }
    try {
      const profile = await loadProfile(data.user.id);
      if (!profile) { await supabase.auth.signOut(); set({ message: 'No profile exists for this account. Ask an administrator.' }); return false; }
      if (!profile.active) { await supabase.auth.signOut(); set({ message: 'This account has been deactivated.' }); return false; }
      set({ status: 'signedIn', profile, message: null });
      void logSignIn();
      return true;
    } catch (e) {
      await supabase.auth.signOut();
      set({ message: friendlyError(e) });
      return false;
    }
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ status: 'signedOut', profile: null, message: null });
  },

  refreshProfile: async () => {
    const p = get().profile;
    if (!p) return;
    try {
      const fresh = await loadProfile(p.id);
      if (fresh && fresh.active) set({ profile: fresh });
      else await get().logout();
    } catch { /* keep the old profile on transient errors */ }
  },
}));

export const useIsOwner = (): boolean => useAuth((s) => s.profile?.is_owner === true);
export const useIsAdmin = (): boolean => useAuth((s) => s.profile?.role === 'admin');
export const useIsRecorder = (): boolean => useAuth((s) => s.profile?.role === 'recorder');
export const useCanEnter = (): boolean => useAuth((s) => !!s.profile && (s.profile.role === 'admin' || s.profile.role === 'recorder' || s.profile.can_enter_data));

/** "Phone · Chrome", "Computer · Edge" … from the browser, for the owner's activity page. */
export function deviceLabel(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const kind = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Computer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|Mac OS/.test(ua) ? (/iPhone|iPad/.test(ua) ? 'iOS' : 'macOS') : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return [kind, browser, os].filter(Boolean).join(' · ');
}

/** Records the sign-in (who, when, device). Fails quietly until migration 0012 is applied. */
async function logSignIn(): Promise<void> {
  try { await supabase.rpc('log_sign_in', { p_device: deviceLabel() }); } catch { /* not recorded */ }
}

/** Tells the server this user has the website open on `page` (the owner sees it as "online"). */
export async function heartbeat(page: string): Promise<void> {
  try { await supabase.rpc('heartbeat', { p_page: page, p_device: deviceLabel() }); } catch { /* not recorded */ }
}
