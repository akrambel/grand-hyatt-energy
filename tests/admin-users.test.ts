import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminRequest } from '../supabase/functions/admin-users/handler.ts';
import type { AdminDeps } from '../supabase/functions/admin-users/handler.ts';
import { passwordProblems as a } from '../supabase/functions/_shared/password.ts';
import { passwordProblems as b } from '../src/lib/password.ts';

function deps(over: Partial<AdminDeps> = {}) {
  const log: any[] = [];
  const profiles = new Map<string, any>([['admin-1', { role: 'admin', active: true, username: 'Boss' }], ['user-1', { role: 'user', active: true, username: 'Joe' }]]);
  const d: AdminDeps = {
    emailDomain: 'test.local',
    async getUserIdFromJwt(jwt) { return jwt === 'admin-jwt' ? 'admin-1' : jwt === 'user-jwt' ? 'user-1' : null; },
    async getProfile(id) { return profiles.get(id) ?? null; },
    async usernameExists(u) { return [...profiles.values()].some((p) => p.username.toLowerCase() === u.toLowerCase()); },
    async createAuthUser(email) { log.push(['auth', email]); return 'new-id'; },
    async deleteAuthUser(id) { log.push(['deleteAuth', id]); },
    async insertProfile(p) { log.push(['profile', p]); profiles.set(p.id, { role: p.role, active: true, username: p.username }); },
    async setPassword(id) { log.push(['pw', id]); },
    async setActive(id, active) { log.push(['active', id, active]); },
    async otherActiveAdmins() { return 0; },
    ...over };
  return { d, log };
}
const call = (jwt: string | null, body: unknown, d: AdminDeps) =>
  handleAdminRequest(new Request('https://x', { method: 'POST', headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(body) }), d);

test('only an authenticated, active administrator may call', async () => {
  const { d } = deps();
  assert.equal((await call(null, { action: 'create_user' }, d)).status, 401);
  assert.equal((await call('bogus', { action: 'create_user' }, d)).status, 401);
  assert.equal((await call('user-jwt', { action: 'create_user' }, d)).status, 403);
});

test('create_user validates username/password and creates auth + profile', async () => {
  const { d, log } = deps();
  assert.equal((await call('admin-jwt', { action: 'create_user', username: 'a!', password: 'Abcdef12@x' }, d)).status, 400);
  assert.equal((await call('admin-jwt', { action: 'create_user', username: 'Newbie', password: 'short' }, d)).status, 400);
  assert.equal((await call('admin-jwt', { action: 'create_user', username: 'joe', password: 'Abcdef12@x' }, d)).status, 409);
  const ok = await call('admin-jwt', { action: 'create_user', username: 'Newbie', display_name: 'New Bie', role: 'user', can_enter_data: true, password: 'Abcdef12@x' }, d);
  assert.equal(ok.status, 200);
  assert.deepEqual(log[0], ['auth', 'newbie@test.local']);
  assert.equal(log[1][1].can_enter_data, true);
});

test('failed profile insert rolls back the auth user', async () => {
  const { d, log } = deps({ async insertProfile() { throw new Error('boom'); } });
  const res = await call('admin-jwt', { action: 'create_user', username: 'Newbie', password: 'Abcdef12@x' }, d);
  assert.equal(res.status, 500);
  assert.deepEqual(log.at(-1), ['deleteAuth', 'new-id']);
});

test('the last active administrator cannot be deactivated', async () => {
  const { d } = deps();
  assert.equal((await call('admin-jwt', { action: 'set_active', user_id: 'admin-1', active: false }, d)).status, 409);
  assert.equal((await call('admin-jwt', { action: 'set_active', user_id: 'user-1', active: false }, d)).status, 200);
});

test('reset_password enforces the policy; both policy copies behave identically', async () => {
  const { d } = deps();
  assert.equal((await call('admin-jwt', { action: 'reset_password', user_id: 'user-1', password: 'weak' }, d)).status, 400);
  assert.equal((await call('admin-jwt', { action: 'reset_password', user_id: 'user-1', password: 'Str0ng!Passw' }, d)).status, 200);
  for (const pw of ['', 'abc', 'abcdefghij', 'ABCDEFGHIJ1', 'Abcdefgh1', 'Abcdefgh1!', 'x'.repeat(80), 'Example@Pass99']) assert.deepEqual(a(pw), b(pw));
  assert.deepEqual(a('Example@Pass99'), []);
});
