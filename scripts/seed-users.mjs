#!/usr/bin/env node
// Creates (or updates) the dashboard accounts in Supabase Auth + public.profiles.
//
//   cp .env.seed.example .env.seed      # then fill in YOUR values (file is git-ignored)
//   npm run seed:users
//
// Passwords are read from environment variables and are never stored in the repository.
// Re-running the script resets the passwords of the listed users to the values in .env.seed.
import { createClient } from '@supabase/supabase-js';

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k} – see .env.seed.example`); process.exit(1); }
  return v;
};
const url = need('SUPABASE_URL');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const domain = process.env.AUTH_EMAIL_DOMAIN || 'energy.ghrs.app';
const spec = need('SEED_USERS'); // Username:role:can_enter_data,...   e.g. Akram:admin:true,Arvind:user:false

function passwordProblems(pw) {
  const out = [];
  if (pw.length < 10) out.push('at least 10 characters');
  if (pw.length > 72) out.push('at most 72 characters');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3) out.push('at least 3 of: lowercase, uppercase, digit, symbol');
  return out;
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserIdByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

let failures = 0;
for (const item of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
  const [username, roleRaw = 'user', entryRaw = 'false'] = item.split(':');
  const role = roleRaw === 'admin' ? 'admin' : 'user';
  const canEnter = entryRaw === 'true' || role === 'admin';
  const password = process.env[`SEED_PASSWORD_${username.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (!password) { console.error(`✗ ${username}: SEED_PASSWORD_${username.toUpperCase()} is not set`); failures++; continue; }
  const problems = passwordProblems(password);
  if (problems.length) { console.error(`✗ ${username}: password needs ${problems.join(', ')}`); failures++; continue; }

  const email = `${username.toLowerCase()}@${domain}`;
  let id;
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) {
    id = await findUserIdByEmail(email);
    if (!id) { console.error(`✗ ${username}: ${created.error.message}`); failures++; continue; }
    const upd = await supabase.auth.admin.updateUserById(id, { password, ban_duration: 'none' });
    if (upd.error) { console.error(`✗ ${username}: ${upd.error.message}`); failures++; continue; }
  } else id = created.data.user.id;

  const { error } = await supabase.from('profiles').upsert(
    { id, username, display_name: username, role, can_enter_data: canEnter, active: true }, { onConflict: 'id' });
  if (error) { console.error(`✗ ${username}: ${error.message}`); failures++; continue; }
  console.log(`✓ ${username} (${role}${canEnter ? ', data entry' : ''})`);
}
process.exit(failures ? 1 : 0);
