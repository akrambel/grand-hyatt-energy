import { useState } from 'react';
import type { FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../store/auth.ts';
import { ENV, brandUrl, isConfigured } from '../config/env.ts';
import { Logo } from '../components/Layout.tsx';
import { Note } from '../components/ui.tsx';

export default function Login() {
  const { login, message } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    await login(username, password);
    setBusy(false);
    setPassword('');
  };

  return (
    <div className="login-wrap">
      <aside className="login-hero" style={{ backgroundImage: `url(${brandUrl('hero-island.jpg')})` }} aria-hidden="true">
        <div className="hero-tag">
          <div className="bar" />
          <h2>Energy, Utilities &amp; Environmental Monitoring</h2>
          <p>{ENV.propertyName} · Engineering Department</p>
        </div>
      </aside>
      <div className="login-side">
      <form className="login-card" onSubmit={(e) => void submit(e)} autoComplete="on">
        <Logo />
        <h1>{ENV.propertyName}</h1>
        <p className="sub">{ENV.appName}</p>
        {!isConfigured() && <Note kind="warn"><strong>Backend not configured.</strong> Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).</Note>}
        {message && <Note kind="bad">{message}</Note>}
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="u">Username</label>
          <input id="u" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label htmlFor="p">Password</label>
          <input id="p" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}><LogIn size={16} />{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 14 }}>Access is restricted to authorised hotel engineering staff. Sign-in is verified by the server.</p>
      </form>
      </div>
    </div>
  );
}
