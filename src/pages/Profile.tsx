import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../store/auth.ts';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { passwordProblems } from '../lib/password.ts';
import { notify } from '../store/ui.ts';
import { usernameToEmail } from '../config/env.ts';
import { Field, Note, PageHead } from '../components/ui.tsx';

export default function Profile() {
  const profile = useAuth((s) => s.profile);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const problems = next ? passwordProblems(next) : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (problems.length) return;
    if (next !== again) { notify.error('Passwords do not match'); return; }
    setBusy(true);
    try {
      // re-verify the current password first
      const { error: vErr } = await supabase.auth.signInWithPassword({ email: usernameToEmail(profile.username), password: current });
      if (vErr) throw new Error('The current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      notify.success('Password changed');
      setCurrent(''); setNext(''); setAgain('');
    } catch (err) { notify.error('Could not change password', friendlyError(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="My Account" subtitle="Your profile and password" />
      <div className="grid g2">
        <div className="card">
          <h3>Profile</h3>
          <table className="data"><tbody>
            <tr><th>Name</th><td>{profile?.display_name}</td></tr>
            <tr><th>Username</th><td>{profile?.username}</td></tr>
            <tr><th>Role</th><td>{profile?.role === 'admin' ? 'Administrator' : 'User'}</td></tr>
            <tr><th>Daily data entry</th><td>{profile?.role === 'admin' || profile?.can_enter_data ? 'Allowed' : 'Not authorised (ask an administrator)'}</td></tr>
          </tbody></table>
        </div>
        <form className="card" onSubmit={(e) => void submit(e)}>
          <h3>Change password</h3>
          <div className="grid">
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
            <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
            <Field label="Repeat new password"><input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
            {problems.length > 0 && <Note kind="warn"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
            <button className="btn primary" disabled={busy || problems.length > 0 || !next}>Change password</button>
          </div>
        </form>
      </div>
    </>
  );
}
