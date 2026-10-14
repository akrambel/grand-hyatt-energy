import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react';
import { useUi, notify } from '../store/ui.ts';
import { useAuth, useIsAdmin } from '../store/auth.ts';
import { useData } from '../store/data.ts';
import { useSensors } from '../store/sensors.ts';
import { supabase } from '../lib/supabase.ts';
import { ENV, logoUrl } from '../config/env.ts';
import { NAV } from './nav.ts';
import { Toasts, useClickOutside, Loading, Note } from './ui.tsx';
import { clsx } from '../lib/format.ts';
import { fiscalLabel, fiscalYearOf, localToday, timeAgo } from '../lib/dates.ts';

export function Logo() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={logoUrl()} alt={`${ENV.propertyName} logo`} onError={() => setFailed(true)} />;
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
        <Bell size={18} />{unread.length > 0 && <span className="badge">{unread.length > 99 ? '99+' : unread.length}</span>}
      </button>
      {open && (
        <div className="drawer">
          {unread.length === 0 && <div className="item muted">No open alerts.</div>}
          {unread.slice(0, 12).map((a) => (
            <div className="item" key={a.id}>
              <div><span className={clsx('pill', a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info')}>{a.title}</span></div>
              {a.message && <div className="small">{a.message}</div>}
              <div className="small muted">{timeAgo(a.created_at)}</div>
              <button className="btn sm" style={{ marginTop: 6 }} onClick={() => void ack(a.id)}>Acknowledge</button>
            </div>))}
          <div className="item"><button className="btn sm" onClick={() => { setOpen(false); nav('/alerts'); }}>All alerts</button></div>
        </div>)}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const meters = useData((s) => s.meters);
  const admin = useIsAdmin();
  const ref = useClickOutside<HTMLDivElement>(() => setQ(''));
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    const pages = NAV.filter((p) => (admin || !p.adminOnly) && `${p.label} ${p.keywords ?? ''}`.toLowerCase().includes(n)).map((p) => ({ key: p.path, label: p.label, sub: 'Page', to: p.path }));
    const ms = meters.filter((m) => `${m.code} ${m.name} ${m.area}`.toLowerCase().includes(n)).slice(0, 8)
      .map((m) => ({ key: m.id, label: m.name, sub: `${m.area} · ${m.utility}`, to: `/daily?meter=${m.id}` }));
    return [...pages, ...ms];
  }, [q, meters, admin]);
  return (
    <div className="search" ref={ref}>
      <Search size={16} />
      <input aria-label="Global search" placeholder="Search pages and meters…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <div className="search-results">
          {hits.map((h) => <a key={h.key} href={`#${h.to}`} onClick={(e) => { e.preventDefault(); nav(h.to); setQ(''); }}>{h.label} <span className="small muted">— {h.sub}</span></a>)}
        </div>)}
    </div>
  );
}

export function Layout() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNav, theme, toggleTheme } = useUi();
  const profile = useAuth((s) => s.profile);
  const logout = useAuth((s) => s.logout);
  const admin = useIsAdmin();
  const { status, error, fy, setFy, load, subscribe, settings } = useData();
  const subscribeSensors = useSensors((s) => s.subscribe);
  const loc = useLocation();

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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

  return (
    <div className={clsx('app', sidebarCollapsed && 'collapsed')}>
      <aside className={clsx('sidebar', mobileNavOpen && 'open')} aria-label="Main navigation">
        <nav>
          {groups.map(([g, items]) => (
            <div key={g}>
              <div className="nav-group">{g}</div>
              {items.map((n) => (
                <NavLink key={n.path} to={n.path} end={n.path === '/'} className={({ isActive }) => clsx('nav-link', isActive && 'active')} title={n.label}>
                  <n.icon size={19} /><span>{n.label}</span>
                </NavLink>))}
            </div>))}
        </nav>
      </aside>
      <div className="main">
        <header className="header">
          <button className="icon-btn menu-btn" onClick={() => setMobileNav(!mobileNavOpen)} aria-label="Open menu"><Menu size={18} /></button>
          <div className="brand">
            <Logo />
            <div className="title">{ENV.propertyName}<small>{ENV.appName}</small></div>
          </div>
          <button className="icon-btn desktop-only" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className="spacer" />
          <GlobalSearch />
          <select className="input desktop-only" style={{ width: 'auto' }} value={fy} onChange={(e) => void setFy(Number(e.target.value))} aria-label="Reporting year">
            {fyOptions.sort((a, b) => b - a).map((y) => <option key={y} value={y}>{fiscalLabel(y, settings.fiscalStartMonth)}</option>)}
          </select>
          <Notifications />
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle light/dark mode">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <div className="desktop-only small" style={{ textAlign: 'right', lineHeight: 1.2 }}>
            <strong>{profile?.display_name}</strong><br /><span className="muted">{admin ? 'Administrator' : 'User'}</span>
          </div>
          <button className="icon-btn" onClick={() => void logout()} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </header>
        <main className="page" id="content">
          {status === 'error' && <Note kind="bad"><strong>Data could not be loaded.</strong> {error} <button className="btn sm" onClick={() => void load()}>Retry</button></Note>}
          {status === 'loading' && <Loading />}
          {status !== 'loading' && <Outlet />}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
