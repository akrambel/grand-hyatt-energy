import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useAuth } from '../store/auth.ts';
import { supabase, friendlyError } from '../lib/supabase.ts';
import { passwordProblems } from '../lib/password.ts';
import { notify } from '../store/ui.ts';
import { usernameToEmail } from '../config/env.ts';
import { Field, Note, PageHead } from '../components/ui.tsx';
import { UserAvatar } from '../components/Layout.tsx';
import { useAvatar, AVATAR_TYPES } from '../store/avatar.ts';

export default function Profile() {
  const profile = useAuth((s) => s.profile);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const problems = next ? passwordProblems(next) : [];
  const { path, busy: photoBusy, upload, remove } = useAvatar();
  const file = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f || !profile) return;
    setPhotoError(null);
    try { await upload(profile.id, f); notify.success('Photo updated'); } catch (e) { setPhotoError(e instanceof Error ? e.message : String(e)); }
  };

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
          <div className="profile-photo">
            <UserAvatar size={88} />
            <div>
              <h3>{profile?.display_name}</h3>
              <p className="small muted">Your photo appears in the menu and on the Overview. It is cropped to a square and reduced to 256 × 256 px before it is saved; only signed-in staff can see it.</p>
              <div className="actions">
                <button className="btn primary sm" disabled={photoBusy} onClick={() => file.current?.click()}><Camera size={14} />{path ? 'Change photo' : 'Add a photo'}</button>
                {path && <button className="btn sm" disabled={photoBusy} onClick={() => { setPhotoError(null); void remove().catch((e: Error) => setPhotoError(e.message)); }}><Trash2 size={14} />Remove</button>}
              </div>
              <input ref={file} type="file" accept={AVATAR_TYPES.join(',')} hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>
          {photoError && <Note kind="bad">{photoError} If this keeps happening, the database update for photos (migration 0006) may not be applied yet.</Note>}
          <h3>Profile</h3>
          <div className="x-scroll"><table className="data"><tbody>
            <tr><th>Name</th><td>{profile?.display_name}</td></tr>
            <tr><th>Username</th><td>{profile?.username}</td></tr>
            <tr><th>Role</th><td>{profile?.role === 'admin' ? 'Administrator' : 'User'}</td></tr>
            <tr><th>Daily data entry</th><td>{profile?.role === 'admin' || profile?.can_enter_data ? 'Allowed' : 'Not authorised (ask an administrator)'}</td></tr>
          </tbody></table></div>
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
