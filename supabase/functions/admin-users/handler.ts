// Administrator-only user management (create user, reset password, activate/deactivate).
// Runs with the service role; the caller must present a valid session JWT of an active admin.

import { passwordProblems } from '../_shared/password.ts';

export interface AdminDeps {
  getUserIdFromJwt(jwt: string): Promise<string | null>;
  getProfile(id: string): Promise<{ role: string; active: boolean; username: string } | null>;
  usernameExists(username: string): Promise<boolean>;
  createAuthUser(email: string, password: string): Promise<string>;
  deleteAuthUser(id: string): Promise<void>;
  insertProfile(p: { id: string; username: string; display_name: string; role: 'admin' | 'user'; can_enter_data: boolean }): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
  setActive(id: string, active: boolean): Promise<void>;
  /** Number of other active administrators (prevents locking everyone out). */
  otherActiveAdmins(excludingId: string): Promise<number>;
  emailDomain: string;
}

const json = (status: number, body: unknown, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

export const emailFor = (username: string, domain: string) => `${username.toLowerCase()}@${domain}`;

export async function handleAdminRequest(req: Request, deps: AdminDeps, cors: Record<string, string> = {}): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' }, cors);

  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const callerId = jwt ? await deps.getUserIdFromJwt(jwt) : null;
  if (!callerId) return json(401, { ok: false, error: 'Not signed in.' }, cors);
  const caller = await deps.getProfile(callerId);
  if (!caller || !caller.active || caller.role !== 'admin') return json(403, { ok: false, error: 'Administrator access required.' }, cors);

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }, cors); }

  switch (body?.action) {
    case 'create_user': {
      const username = String(body.username ?? '');
      const display = String(body.display_name ?? username).trim().slice(0, 80);
      const role = body.role === 'admin' ? 'admin' : 'user';
      const password = String(body.password ?? '');
      if (!USERNAME_RE.test(username)) return json(400, { ok: false, error: 'Username: 3-32 letters, digits, dot, dash or underscore.' }, cors);
      const problems = passwordProblems(password);
      if (problems.length) return json(400, { ok: false, error: `Password needs ${problems.join(', ')}.` }, cors);
      if (await deps.usernameExists(username)) return json(409, { ok: false, error: 'This username already exists.' }, cors);
      const id = await deps.createAuthUser(emailFor(username, deps.emailDomain), password);
      try {
        await deps.insertProfile({ id, username, display_name: display || username, role, can_enter_data: !!body.can_enter_data });
      } catch (e) {
        await deps.deleteAuthUser(id); // keep auth + profile consistent
        console.error('insertProfile failed', e);
        return json(500, { ok: false, error: 'Could not create the profile.' }, cors);
      }
      return json(200, { ok: true, id }, cors);
    }
    case 'reset_password': {
      const id = String(body.user_id ?? '');
      const password = String(body.password ?? '');
      const problems = passwordProblems(password);
      if (!id) return json(400, { ok: false, error: 'user_id required.' }, cors);
      if (problems.length) return json(400, { ok: false, error: `Password needs ${problems.join(', ')}.` }, cors);
      if (!(await deps.getProfile(id))) return json(404, { ok: false, error: 'Unknown user.' }, cors);
      await deps.setPassword(id, password);
      return json(200, { ok: true }, cors);
    }
    case 'set_active': {
      const id = String(body.user_id ?? '');
      const active = body.active === true;
      const target = await deps.getProfile(id);
      if (!target) return json(404, { ok: false, error: 'Unknown user.' }, cors);
      if (!active && target.role === 'admin' && (await deps.otherActiveAdmins(id)) === 0) {
        return json(409, { ok: false, error: 'You cannot deactivate the last active administrator.' }, cors);
      }
      await deps.setActive(id, active);
      return json(200, { ok: true }, cors);
    }
    default:
      return json(400, { ok: false, error: 'Unknown action.' }, cors);
  }
}
