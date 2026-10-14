import { create } from 'zustand';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { usernameToEmail, isConfigured } from '../config/env.ts';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  can_enter_data: boolean;
  active: boolean;
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
    .from('profiles').select('id, username, display_name, role, can_enter_data, active').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Profile | null) ?? null;
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

export const useIsAdmin = (): boolean => useAuth((s) => s.profile?.role === 'admin');
export const useCanEnter = (): boolean => useAuth((s) => !!s.profile && (s.profile.role === 'admin' || s.profile.can_enter_data));
