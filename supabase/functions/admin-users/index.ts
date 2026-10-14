// Supabase Edge Function: POST /functions/v1/admin-users   (JWT of an administrator required)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleAdminRequest } from './handler.ts';
import type { AdminDeps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const deps: AdminDeps = {
  emailDomain: Deno.env.get('AUTH_EMAIL_DOMAIN') ?? 'energy.ghrs.app',
  async getUserIdFromJwt(jwt) { const { data } = await admin.auth.getUser(jwt); return data.user?.id ?? null; },
  async getProfile(id) {
    const { data } = await admin.from('profiles').select('role, active, username').eq('id', id).maybeSingle();
    return data;
  },
  async usernameExists(u) {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).ilike('username', u);
    return (count ?? 0) > 0;
  },
  async createAuthUser(email, password) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error('createUser failed');
    return data.user.id;
  },
  async deleteAuthUser(id) { await admin.auth.admin.deleteUser(id); },
  async insertProfile(p) { const { error } = await admin.from('profiles').insert(p); if (error) throw error; },
  async setPassword(id, password) { const { error } = await admin.auth.admin.updateUserById(id, { password }); if (error) throw error; },
  async setActive(id, active) {
    const { error } = await admin.from('profiles').update({ active }).eq('id', id); if (error) throw error;
    // also ban/unban the auth user so existing sessions cannot refresh
    await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  },
  async otherActiveAdmins(id) {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true).neq('id', id);
    return count ?? 0;
  },
};

Deno.serve((req) => handleAdminRequest(req, deps, cors));
