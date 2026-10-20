import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { ENV } from '../../config/env.ts';
import { passwordProblems } from '../../lib/password.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { ConfirmDialog, Field, Modal, Note, StatusPill } from '../../components/ui.tsx';
import { notify } from '../../store/ui.ts';
import { useAuth } from '../../store/auth.ts';
import type { Profile } from '../../store/auth.ts';

async function callAdmin(body: Record<string, unknown>): Promise<{ id?: string } | null> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // invoke wraps non-2xx; try to read the JSON message of the function
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) throw new Error(j.error); } catch (e) { if (e instanceof Error && e.message) throw e; } }
    throw new Error(error.message);
  }
  if (data && data.ok === false) throw new Error(data.error ?? 'Request failed');
  return (data as { id?: string } | null) ?? null;
}

type Role = Profile['role'];
const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', user: 'User', recorder: 'Recorder' };

export default function UsersTab() {
  const me = useAuth((s) => s.profile);
  const [users, setUsers] = useState<Profile[]>([]);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [toggle, setToggle] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('id, username, display_name, role, can_enter_data, active').order('username');
    if (error) notify.error('Could not load users', friendlyError(error)); else setUsers((data ?? []) as Profile[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (u: Profile, change: Partial<Pick<Profile, 'can_enter_data' | 'role'>>) => {
    const { error } = await supabase.from('profiles').update(change).eq('id', u.id);
    if (error) notify.error('Update failed', friendlyError(error)); else { notify.success('User updated', u.username); void load(); }
  };

  return (
    <div className="card">
      <div className="card-head"><h3>Users</h3><button className="btn primary" onClick={() => setCreating(true)}>Add user</button></div>
      <Note kind="info"><strong>Administrators</strong> see everything and manage users and settings. <strong>Users</strong> view, search and export reports; tick <strong>Data entry</strong> to let them enter daily readings too. <strong>Recorders</strong> only see Daily Entry and My Account. Passwords are never displayed; only a reset is possible.</Note>
      <DataTable rows={users} rowKey={(u) => u.id} searchable columns={[
        { key: 'u', header: 'Username', value: (u) => u.username }, { key: 'n', header: 'Name', value: (u) => u.display_name },
        { key: 'r', header: 'Role', value: (u) => u.role, render: (u) => u.id === me?.id ? ROLE_LABEL[u.role] :
          <select className="input sm" aria-label={`Role of ${u.username}`} value={u.role} onChange={(e) => void patch(u, { role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select> },
        { key: 'e', header: 'Data entry', value: (u) => (u.role !== 'user' || u.can_enter_data ? 'Yes' : 'No'), render: (u) => u.role !== 'user' ? <span className="muted">always</span> :
          <label><input type="checkbox" checked={u.can_enter_data} onChange={(e) => void patch(u, { can_enter_data: e.target.checked })} /> allowed</label> },
        { key: 'a', header: 'Status', value: (u) => (u.active ? 'Active' : 'Deactivated'), render: (u) => <StatusPill kind={u.active ? 'ok' : 'bad'}>{u.active ? 'Active' : 'Deactivated'}</StatusPill> },
        { key: 'x', header: '', value: () => '', render: (u) => <span className="actions"><button className="btn sm" onClick={() => setResetFor(u)}>Reset password</button>
          <button className={u.active ? 'btn sm danger' : 'btn sm'} disabled={u.id === me?.id} onClick={() => setToggle(u)}>{u.active ? 'Deactivate' : 'Activate'}</button></span> },
      ]} />
      {creating && <CreateUser onClose={() => { setCreating(false); void load(); }} />}
      {resetFor && <ResetPassword user={resetFor} onClose={() => setResetFor(null)} />}
      {toggle && <ConfirmDialog danger={toggle.active} title={toggle.active ? 'Deactivate user?' : 'Activate user?'} message={toggle.active ? `${toggle.username} will no longer be able to sign in.` : `${toggle.username} will be able to sign in again.`} confirmLabel={toggle.active ? 'Deactivate' : 'Activate'}
        onCancel={() => setToggle(null)} onConfirm={async () => { try { await callAdmin({ action: 'set_active', user_id: toggle.id, active: !toggle.active }); notify.success('User updated'); void load(); } catch (e) { notify.error('Update failed', friendlyError(e)); } setToggle(null); }} />}
    </div>
  );
}

function CreateUser({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ username: '', display_name: '', password: '', role: 'user', can_enter_data: false });
  const [busy, setBusy] = useState(false);
  const problems = f.password ? passwordProblems(f.password) : [];
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      // A recorder is created as a user, then switched to recorder (works with older versions of the admin-users function too).
      const res = await callAdmin({ action: 'create_user', ...f, can_enter_data: f.role === 'recorder' || f.can_enter_data });
      if (f.role === 'recorder') {
        let id = res?.id;
        if (!id) {
          const { data } = await supabase.from('profiles').select('id').ilike('username', f.username.replace(/[\\%_]/g, '\\$&')).maybeSingle();
          id = (data as { id: string } | null)?.id;
        }
        if (!id) throw new Error('The user was created, but the role could not be set to Recorder. Change it in the list.');
        const { error } = await supabase.from('profiles').update({ role: 'recorder' }).eq('id', id);
        if (error) throw new Error(`The user was created as User; set the role to Recorder in the list. (${friendlyError(error)})`);
      }
      notify.success('User created', f.username); onClose(); } catch (err) { notify.error('User not created', friendlyError(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid">
        <Field label="Username" hint={`Signs in as <username>@${ENV.emailDomain} (internal)`}><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></Field>
        <Field label="Display name"><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="Initial password"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        {problems.length > 0 && <Note kind="warn"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
        <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="recorder">Recorder</option><option value="user">User</option><option value="admin">Administrator</option></select></Field>
        {f.role === 'recorder' && <Note kind="info">A recorder can only enter daily readings and change their own account. Their name is saved with every reading they enter.</Note>}
        {f.role === 'user' && <label><input type="checkbox" checked={f.can_enter_data} onChange={(e) => setF({ ...f, can_enter_data: e.target.checked })} /> Allow daily data entry</label>}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || problems.length > 0 || !f.password}>Create</button></div>
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: Profile; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const problems = pw ? passwordProblems(pw) : [];
  return (
    <Modal title={`Reset password – ${user.username}`} onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !pw || problems.length > 0} onClick={async () => { setBusy(true); try { await callAdmin({ action: 'reset_password', user_id: user.id, password: pw }); notify.success('Password reset', user.username); onClose(); } catch (e) { notify.error('Reset failed', friendlyError(e)); setBusy(false); } }}>Reset</button></>}>
      <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
      {problems.length > 0 && <Note kind="warn"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
    </Modal>
  );
}
