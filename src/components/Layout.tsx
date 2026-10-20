import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Camera, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, Trash2, UserCircle } from 'lucide-react';
import { useUi, notify } from '../store/ui.ts';
import { useAuth, useIsAdmin } from '../store/auth.ts';
import { useData } from '../store/data.ts';
import { useSensors } from '../store/sensors.ts';
import { useAvatar, AVATAR_TYPES } from '../store/avatar.ts';
import { supabase } from '../lib/supabase.ts';
import { ENV, logoUrl } from '../config/env.ts';
import { NAV } from './nav.ts';
import { Toasts, useClickOutside, Loading, Note } from './ui.tsx';
import { clsx } from '../lib/format.ts';
import { fiscalLabel, fiscalYearOf, localToday, timeAgo } from '../lib/dates.ts';

export function Logo({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={className} src={logoUrl()} alt={`${ENV.propertyName} logo`} onError={() => setFailed(true)} />;
}

export const initials = (name: string | undefined): string => (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

/** The signed-in user's photo, or their initials when there is none. */
export function UserAvatar({ size = 32, className }: { size?: number; className?: string }) {
  const profile = useAuth((s) => s.profile);
  const url = useAvatar((s) => s.url);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) };
  return url && !broken
    ? <img className={clsx('avatar', className)} style={style} src={url} alt="" onError={() => setBroken(true)} />
    : <span className={clsx('avatar', className)} style={style} aria-hidden="true">{initials(profile?.display_name)}</span>;
}

/** Photo, name and role at the bottom of the menu; the photo opens a small menu to add, change or remove it. */
function UserMenu({ admin }: { admin: boolean }) {
  const profile = useAuth((s) => s.profile);
  const logout = useAuth((s) => s.logout);
  const { path, busy, upload, remove } = useAvatar();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const file = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const pick = async (f: File | undefined) => {
    if (!f || !profile) return;
    try { await upload(profile.id, f); notify.success('Photo updated'); }
    catch (e) { notify.error('Photo not saved', e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="side-foot" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Profile photo and account" disabled={busy}>
        <UserAvatar size={36} />
        <span className="cam" aria-hidden="true"><Camera size={11} /></span>
      </button>
      <div className="who"><strong>{profile?.display_name}</strong><span>{admin ? 'Administrator' : 'User'}</span></div>
      <button className="icon-btn" onClick={() => { useAvatar.getState().clear(); void logout(); }} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
      <input ref={file} type="file" accept={AVATAR_TYPES.join(',')} hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {open && (
        <div className="user-menu" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); file.current?.click(); }}><Camera size={15} />{path ? 'Change photo' : 'Add a photo'}</button>
          {path && <button role="menuitem" onClick={() => { setOpen(false); void remove().then(() => notify.success('Photo removed')).catch((e: Error) => notify.error('Photo not removed', e.message)); }}><Trash2 size={15} />Remove photo</button>}
          <button role="menuitem" onClick={() => { setOpen(false); nav('/profile'); }}><UserCircle size={15} />My account</button>
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const alerts = useData((s) => s.alerts);
  const reload = useData((s) => s.reloadAlerts);
  const nav = useNavigate();
  const unread = alerts.filter((a) => !a.resolved_at && !a.acknowledged_at);
  const ack = async (id: number) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('alerts').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: u.user?.id ?? null }).eq('id', id);
    if (error) notify.error('Could not acknowledge', error.message); else void reload();
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notifications (${unread.length} unread)`}>
        <Bell size={17} />{unread.length > 0 && <span className="badge">{unread.length > 99 ? '99+' : unread.length}</span>}
      </button>
      {open && (
        <div className="drawer">
          {unread.length === 0 && <div className="item muted">No open alerts.</div>}
          {unread.slice(0, 12).map((a) => (
            <div className="item" key={a.id}>
              <div><span className={clsx('pill', a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info')}>{a.title}</span></div>
              {a.message && <div style={{ marginTop: 6 }}>{a.message}</div>}
              <div className="small muted">{timeAgo(a.created_at)}</div>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void ack(a.id)}>Acknowledge</button>
            </div>))}
          <div className="item"><button className="link-btn" onClick={() => { setOpen(false); nav('/alerts'); }}>View all alerts</button></div>
        </div>)}
    </div>
  );
}

const QUICK_PERIODS = [
  { mode: 'mtd', short: 'MTD', name: 'Month to date', terms: 'mtd month to date' },
  { mode: 'wtd', short: 'WTD', name: 'Week to date', terms: 'wtd week to date' },
];
const QUICK_PAGES = NAV.filter((p) => ['/', '/energy', '/water', '/gas', '/chilled', '/costs'].includes(p.path));

function GlobalSearch() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const meters = useData((s) => s.meters);
  const admin = useIsAdmin();
  const ref = useClickOutside<HTMLDivElement>(() => setQ(''));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); } if (e.key === 'Escape') setQ(''); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    const pages = NAV.filter((p) => (admin || !p.adminOnly) && `${p.label} ${p.keywords ?? ''}`.toLowerCase().includes(n)).map((p) => ({ key: p.path, label: p.label, sub: 'Page', to: p.path }));
    const ms = meters.filter((m) => `${m.code} ${m.name} ${m.area}`.toLowerCase().includes(n)).slice(0, 8)
      .map((m) => ({ key: m.id, label: m.name, sub: `${m.area} · ${m.utility}`, to: `/daily?meter=${m.id}` }));
    // Quick period views: "mtd", "wtd", "mtd energy", "week to date water" ...
    const words = n.split(/\s+/).filter(Boolean);
    const quick = QUICK_PERIODS.flatMap((qp) => QUICK_PAGES.map((pg) => ({ qp, pg })))
      .filter(({ qp, pg }) => { const hay = `${qp.terms} ${pg.label} ${pg.keywords ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .slice(0, 6)
      .map(({ qp, pg }) => ({ key: `${qp.mode}:${pg.path}`, label: `${qp.short} – ${pg.label}`, sub: qp.name, to: `${pg.path}?period=${qp.mode}` }));
    return [...quick, ...pages, ...ms];
  }, [q, meters, admin]);
  return (
    <div className="search" ref={ref}>
      <Search size={16} />
      <input ref={inputRef} aria-label="Global search" placeholder="Search pages, meters, MTD, WTD" value={q} onChange={(e) => setQ(e.target.value)} />
      <kbd aria-hidden="true">Ctrl K</kbd>
      {hits.length > 0 && (
        <div className="search-results">
          {hits.map((h) => <a key={h.key} href={`#${h.to}`} onClick={(e) => { e.preventDefault(); nav(h.to); setQ(''); }}><span>{h.label}</span><span className="small muted">{h.sub}</span></a>)}
        </div>)}
    </div>
  );
}

export function Layout() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNav, theme, toggleTheme } = useUi();
  const profile = useAuth((s) => s.profile);
  const loadAvatar = useAvatar((s) => s.load);
  const admin = useIsAdmin();
  const { status, error, fy, setFy, load, subscribe, settings } = useData();
  const subscribeSensors = useSensors((s) => s.subscribe);
  const loc = useLocation();

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (profile?.id) void loadAvatar(profile.id); }, [profile?.id, loadAvatar]);
  useEffect(() => subscribe(), [subscribe]);
  useEffect(() => subscribeSensors(), [subscribeSensors]);
  useEffect(() => { setMobileNav(false); }, [loc.pathname, setMobileNav]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof NAV>();
    for (const n of NAV) { if (n.adminOnly && !admin) continue; m.set(n.group, [...(m.get(n.group) ?? []), n]); }
    return [...m.entries()];
  }, [admin]);

  // Reporting years start with FY2026-27 (first year of the system) and end with the current fiscal year
  // (a fiscal year starts on 1 October). The next year appears automatically when it begins.
  const FIRST_FY = 2026;
  const thisFy = fiscalYearOf(localToday(settings.timezone), settings.fiscalStartMonth);
  const fyOptions = Array.from({ length: Math.max(1, thisFy - FIRST_FY + 1) }, (_, i) => thisFy - i);
  if (!fyOptions.includes(fy)) fyOptions.push(fy);

  const current = NAV.find((n) => (n.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.path)));
  const openAlerts = useData((s) => s.alerts.filter((a) => !a.resolved_at && !a.acknowledged_at).length);

  return (
    <div className={clsx('app', sidebarCollapsed && 'collapsed')}>
      <aside className={clsx('sidebar', mobileNavOpen && 'open')} aria-label="Main navigation">
        <NavLink to="/" className="side-brand" title={`${ENV.propertyName} · Energy & Utilities`}>
          <Logo />
          <div className="name"><strong>Energy &amp; Utilities</strong><span>Engineering</span></div>
        </NavLink>
        <nav>
          {groups.map(([g, items]) => (
            <div key={g}>
              <div className="nav-group">{g}</div>
              {items.map((n) => (
                <NavLink key={n.path} to={n.path} end={n.path === '/'} className={({ isActive }) => clsx('nav-link', isActive && 'active')} title={n.label}>
                  <n.icon size={16} strokeWidth={1.75} /><span>{n.label}</span>
                  {n.path === '/alerts' && openAlerts > 0 && <span className="count">{openAlerts}</span>}
                </NavLink>))}
            </div>))}
        </nav>
        <UserMenu admin={admin} />
      </aside>
      <div className="main">
        <header className="header">
          <button className="icon-btn menu-btn" onClick={() => setMobileNav(!mobileNavOpen)} aria-label="Open menu"><Menu size={18} /></button>
          <span className="mobile-title">{current?.label ?? 'Energy & Utilities'}</span>
          <button className="icon-btn desktop-only collapse-btn" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="crumb">{current ? <>{current.group} / <strong>{current.label}</strong></> : null}</div>
          <GlobalSearch />
          <div className="spacer" />
          <select className="input desktop-only" value={fy} onChange={(e) => void setFy(Number(e.target.value))} aria-label="Reporting year">
            {fyOptions.sort((a, b) => b - a).map((y) => <option key={y} value={y}>{fiscalLabel(y, settings.fiscalStartMonth)}</option>)}
          </select>
          <Notifications />
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle light/dark mode" title="Light / dark">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        </header>
        <div className="sheet">
          <main className="page" id="content">
            {status === 'error' && <Note kind="bad"><strong>Data could not be loaded.</strong> {error} <button className="btn sm" onClick={() => void load()}>Retry</button></Note>}
            {status === 'loading' && <Loading />}
            {status !== 'loading' && <Outlet />}
          </main>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
