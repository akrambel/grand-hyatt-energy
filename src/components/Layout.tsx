import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Camera, FileText, Wifi, WifiOff, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, Trash2, UserCircle } from 'lucide-react';
import { useUi, notify } from '../store/ui.ts';
import { useAuth, useIsAdmin, useIsRecorder } from '../store/auth.ts';
import { useData, sendOfflineReadings, showSampleData } from '../store/data.ts';
import { isSampleMode } from '../lib/sampleData.ts';
import { useOutbox } from '../store/outbox.ts';
import { useReports } from '../store/reports.ts';
import { toDisplay } from '../lib/units.ts';
import { useSensors } from '../store/sensors.ts';
import { useAvatar, AVATAR_TYPES } from '../store/avatar.ts';
import { supabase } from '../lib/supabase.ts';
import { ENV, logoUrl } from '../config/env.ts';
import { NAV } from './nav.ts';
import { floorOf, isHotelRoom } from '../lib/rooms.ts';
import { roomDetail } from '../lib/roomDetails.ts';
import { Toasts, useClickOutside, Loading, Note } from './ui.tsx';
import { clsx, fmtNumber } from '../lib/format.ts';
import { fiscalLabel, fiscalYearOf, formatDate, localToday, timeAgo } from '../lib/dates.ts';
import { animatePage, driftShapes, moveGlider, holdScroll, pressFeedback, scrollToTop, smoothScroll } from '../lib/motion.ts';

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
function UserMenu({ roleLabel }: { roleLabel: string }) {
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
      <div className="who"><strong>{profile?.display_name}</strong><span>{roleLabel}</span></div>
      <button className="icon-btn" onClick={() => { useAvatar.getState().clear(); void logout(); }} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
      <input ref={file} type="file" accept={AVATAR_TYPES.join(',')} hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {open && (
        <div className="user-menu" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); file.current?.click(); }}><Camera size={15} />{path ? 'Change photo' : 'Add a photo'}</button>
          {path && <button role="menuitem" onClick={() => { setOpen(false); void remove().then(() => notify.success('Photo removed')).catch((e: Error) => notify.error('Photo not removed', e.message)); }}><Trash2 size={15} />Remove photo</button>}
          <button role="menuitem" onClick={() => { setOpen(false); nav('/profile'); }}><UserCircle size={15} />My account</button>
          <button role="menuitem" onClick={() => { setOpen(false); useAvatar.getState().clear(); void logout(); }}><LogOut size={15} />Sign out</button>
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
  const reports = useReports((s) => s.reports);
  const seen = useReports((s) => s.seen);
  const markSeen = useReports((s) => s.markSeen);
  const openReport = useReports((s) => s.open);
  const newReport = reports[0] && (!seen || reports[0].month_key > seen) ? reports[0] : null;
  const count = unread.length + (newReport ? 1 : 0);
  const download = async () => {
    if (!newReport) return;
    try { await openReport(newReport); markSeen(); } catch (e) { notify.error('Could not open the report', e instanceof Error ? e.message : String(e)); }
  };
  const ack = async (id: number) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('alerts').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: u.user?.id ?? null }).eq('id', id);
    if (error) notify.error('Could not acknowledge', error.message); else void reload();
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notifications (${count} unread)`}>
        <Bell size={17} />{count > 0 && <span className="badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="drawer">
          {newReport && (
            <div className="item report-item">
              <div><span className="pill info"><FileText size={12} />Monthly report ready</span></div>
              <div style={{ marginTop: 6 }}>The {newReport.label} PDF report is saved in the website.</div>
              <div className="small muted">{timeAgo(newReport.created_at)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn sm primary" onClick={() => void download()}>Download PDF</button>
                <button className="btn sm" onClick={() => markSeen()}>Dismiss</button>
              </div>
            </div>)}
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

/** Offline entry: shows "Offline" and readings waiting on this phone; sends them when the connection is back. */
function OfflineChip() {
  const items = useOutbox((s) => s.items);
  const sending = useOutbox((s) => s.sending);
  const remove = useOutbox((s) => s.remove);
  const meterById = useData((s) => s.meterById);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const send = async () => {
    const before = useOutbox.getState().items.length;
    const n = await sendOfflineReadings();
    if (n) notify.success(`${n} offline reading${n === 1 ? '' : 's'} sent`, 'They are now saved on the server.');
    else if (before && navigator.onLine !== false && useOutbox.getState().items.some((x) => !x.error)) notify.info('Still waiting', 'The server cannot be reached yet. Readings stay on this phone.');
  };
  useEffect(() => {
    const up = () => { setOnline(true); void sendOfflineReadings().then((n) => { if (n) notify.success(`${n} offline reading${n === 1 ? '' : 's'} sent`, 'They are now saved on the server.'); }); };
    const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    void sendOfflineReadings();
    // some phones report "online" in a basement with no real connection: retry quietly every 30 s
    const t = window.setInterval(() => { if (useOutbox.getState().items.some((x) => !x.error)) void sendOfflineReadings(); }, 30000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); window.clearInterval(t); };
  }, []);

  if (online && items.length === 0) return null;
  const refused = items.filter((x) => x.error);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={clsx('offline-chip', !online && 'off', refused.length > 0 && 'bad')} onClick={() => setOpen(!open)} aria-label="Readings saved on this phone">
        {online ? <Wifi size={14} /> : <WifiOff size={14} />}
        <span>{!online && items.length === 0 ? 'Offline' : `${items.length} waiting`}</span>
      </button>
      {open && (
        <div className="drawer">
          <div className="item">
            <strong>{online ? 'Connected' : 'No connection'}</strong>
            <div className="small muted">Readings typed without a connection are kept on this phone and sent automatically when it is back online. Do not sign out until they are sent.</div>
          </div>
          {items.length === 0 && <div className="item muted">Nothing waiting.</div>}
          {items.map((it) => {
            const m = meterById.get(it.meter_id);
            const shown = toDisplay(it.closing, m?.unitFactor ?? 1);
            return (
              <div className="item" key={it.key}>
                <div><strong>{m?.name ?? 'Meter'}</strong> · {formatDate(it.reading_date)}</div>
                <div className="small">Closing {fmtNumber(shown, 3)} {m?.unit ?? ''}</div>
                {it.error
                  ? <><div className="small" style={{ color: 'var(--bad)' }}>Not accepted: {it.error}</div><button className="btn sm" style={{ marginTop: 6 }} onClick={() => remove(it.key)}>Discard</button></>
                  : <div className="small muted">Waiting to send · typed {timeAgo(it.queued_at)}</div>}
              </div>);
          })}
          {items.some((x) => !x.error) && <div className="item"><button className="btn sm primary" disabled={sending || !online} onClick={() => void send()}>{sending ? 'Sending…' : 'Send now'}</button></div>}
        </div>)}
    </div>
  );
}

const QUICK_PERIODS = [
  { mode: 'mtd', short: 'MTD', name: 'Month to date', terms: 'mtd month to date' },
  { mode: 'wtd', short: 'WTD', name: 'Week to date', terms: 'wtd week to date' },
];
/** Recorders only enter daily readings. */
const RECORDER_PAGES = ['/entry', '/profile'];

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
    // Guest rooms by number: "905", "12" → room 012
    const roomNo = /^\d{1,3}$/.test(n) ? n.padStart(3, '0') : '';
    const room = roomNo && isHotelRoom(roomNo) ? [{ key: `room:${roomNo}`, label: `Room ${roomNo}`, sub: `${roomDetail(roomNo)?.type ?? 'Guest room'} · ${floorOf(roomNo)}`, to: `/rooms?room=${roomNo}` }] : [];
    return [...room, ...quick, ...pages, ...ms];
  }, [q, meters, admin]);
  return (
    <div className="search" ref={ref}>
      <Search size={16} />
      <input ref={inputRef} aria-label="Global search" placeholder="Search pages, meters, rooms, MTD" value={q} onChange={(e) => setQ(e.target.value)} />
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
  const logout = useAuth((s) => s.logout);
  const loadAvatar = useAvatar((s) => s.load);
  const admin = useIsAdmin();
  const recorder = useIsRecorder();
  const { status, error, fy, setFy, load, subscribe, settings } = useData();
  const subscribeSensors = useSensors((s) => s.subscribe);
  const loc = useLocation();

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (profile?.id) void loadAvatar(profile.id); }, [profile?.id, loadAvatar]);
  useEffect(() => subscribe(), [subscribe]);
  // Monthly PDF: viewers see saved reports; the first administrator visit of a month saves last month's.
  useEffect(() => {
    if (status !== 'ready' || recorder || !profile) return;
    const r = useReports.getState();
    void r.list().then(async () => {
      if (!admin) return;
      const made = await useReports.getState().ensureLastMonth();
      if (made) notify.success(`${made.label} report saved`, 'The monthly PDF is now in the notifications and on Monthly Reports for everybody who views reports.');
    });
  }, [status, recorder, admin, profile]);
  useEffect(() => subscribeSensors(), [subscribeSensors]);
  useEffect(() => { setMobileNav(false); }, [loc.pathname, setMobileNav]);
  // Phone menu: Escape closes it, and the page behind does not scroll while it is open.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNav(false); };
    document.addEventListener('keydown', key);
    holdScroll(true);
    return () => { document.removeEventListener('keydown', key); holdScroll(false); };
  }, [mobileNavOpen, setMobileNav]);

  // Motion: page entrance on every page change, drifting background shapes, sliding menu highlight.
  const appRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const gliderRef = useRef<HTMLDivElement>(null);
  const firstGlide = useRef(true);
  useEffect(() => {
    const page = pageRef.current;
    if (!page || status === 'loading') return;
    let undo: (() => void) | undefined;
    let frame = 0;
    const t0 = performance.now();
    const wait = () => {
      if (page.querySelector('.card, .kpi, .round-cell') || performance.now() - t0 > 1000) undo = animatePage(page);
      else frame = requestAnimationFrame(wait);
    };
    frame = requestAnimationFrame(wait);
    return () => { cancelAnimationFrame(frame); undo?.(); };
  }, [loc.pathname, status]);
  useEffect(() => smoothScroll(), []);
  useEffect(() => { scrollToTop(); }, [loc.pathname]);
  useEffect(() => (appRef.current ? driftShapes(appRef.current) : undefined), []);
  useEffect(() => (appRef.current ? pressFeedback(appRef.current) : undefined), []);
  useEffect(() => {
    const place = () => moveGlider(gliderRef.current, navRef.current?.querySelector<HTMLElement>('.nav-link.active') ?? null, firstGlide.current);
    const frame = requestAnimationFrame(() => { place(); firstGlide.current = false; });
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); };
  }, [loc.pathname, sidebarCollapsed, admin, recorder]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof NAV>();
    for (const n of NAV) {
      if (n.adminOnly && !admin) continue;
      if (recorder && !RECORDER_PAGES.includes(n.path)) continue;
      m.set(n.group, [...(m.get(n.group) ?? []), n]); }
    return [...m.entries()];
  }, [admin, recorder]);

  // Reporting years start with FY2026-27 (first year of the system) and end with the current fiscal year
  // (a fiscal year starts on 1 October). The next year appears automatically when it begins.
  const FIRST_FY = 2026;
  const thisFy = fiscalYearOf(localToday(settings.timezone), settings.fiscalStartMonth);
  const fyOptions = Array.from({ length: Math.max(1, thisFy - FIRST_FY + 1) }, (_, i) => thisFy - i);
  const sample = isSampleMode();
  if (sample && !fyOptions.includes(thisFy - 1)) fyOptions.push(thisFy - 1); // the sample preview fills the last full year
  if (!fyOptions.includes(fy)) fyOptions.push(fy);

  const current = NAV.find((n) => (n.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.path)));
  const openAlerts = useData((s) => s.alerts.filter((a) => !a.resolved_at && !a.acknowledged_at).length);

  return (
    <div ref={appRef} className={clsx('app', sidebarCollapsed && 'collapsed')}>
      <div className="ambient" aria-hidden="true">
        <svg className="shape s1" viewBox="0 0 200 200"><path d="M44.7,-58.6C57.1,-47.7,65.7,-33.1,70.1,-16.9C74.5,-0.7,74.7,17.1,67.3,30.9C59.9,44.7,44.9,54.6,28.6,61.6C12.3,68.6,-5.3,72.7,-22.4,69C-39.5,65.3,-56.1,53.8,-65.5,38C-74.9,22.2,-77.1,2.1,-72.4,-15.6C-67.7,-33.3,-56.1,-48.6,-41.6,-59.1C-27.1,-69.6,-9.7,-75.3,4.6,-80.8C18.9,-86.3,32.3,-69.5,44.7,-58.6Z" transform="translate(100 100)" /></svg>
        <svg className="shape s2" viewBox="0 0 200 200"><path d="M38.9,-47.5C50.4,-37.1,59.4,-24.6,63.2,-9.9C67,4.8,65.6,21.7,57.3,34.3C49,46.9,33.8,55.2,17.4,61.1C1,67,-16.6,70.5,-31.8,65C-47,59.5,-59.8,45,-66.2,28.4C-72.6,11.8,-72.6,-6.9,-65.9,-22.4C-59.2,-37.9,-45.8,-50.2,-31.6,-59.9C-17.4,-69.6,-2.4,-76.7,10.6,-74.2C23.6,-71.7,27.4,-57.9,38.9,-47.5Z" transform="translate(100 100)" /></svg>
        <svg className="shape s3" viewBox="0 0 200 200"><circle cx="100" cy="100" r="86" fill="none" strokeWidth="1.2" /><circle cx="100" cy="100" r="62" fill="none" strokeWidth="1" /><circle cx="100" cy="100" r="38" fill="none" strokeWidth="0.8" /></svg>
      </div>
      {mobileNavOpen && <div className="nav-scrim" onClick={() => setMobileNav(false)} aria-hidden="true" />}
      <aside className={clsx('sidebar', mobileNavOpen && 'open')} aria-label="Main navigation">
        <NavLink to={recorder ? '/entry' : '/'} className="side-brand" title={`${ENV.propertyName} · Energy & Utilities`}>
          <Logo />
          <div className="name"><strong>Energy &amp; Utilities</strong><span>Engineering</span></div>
        </NavLink>
        <nav ref={navRef}>
          <div className="nav-glider" ref={gliderRef} aria-hidden="true" />
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
        <UserMenu roleLabel={admin ? 'Administrator' : recorder ? 'Recorder' : 'User'} />
      </aside>
      <div className="main">
        <header className="header">
          <button className="icon-btn menu-btn" onClick={() => setMobileNav(!mobileNavOpen)} aria-label="Open menu"><Menu size={18} /></button>
          <span className="mobile-title">{current?.label ?? 'Energy & Utilities'}</span>
          <button className="icon-btn desktop-only collapse-btn" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="crumb">{current ? <>{current.group} / <strong>{current.label}</strong></> : null}</div>
          {!recorder && <GlobalSearch />}
          <div className="spacer" />
          {!recorder && <select className="input desktop-only" value={fy} onChange={(e) => void setFy(Number(e.target.value))} aria-label="Reporting year">
            {fyOptions.sort((a, b) => b - a).map((y) => <option key={y} value={y}>{fiscalLabel(y, settings.fiscalStartMonth)}</option>)}
          </select>}
          <OfflineChip />
          {!recorder && <Notifications />}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle light/dark mode" title="Light / dark">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="icon-btn phone-only" onClick={() => { useAvatar.getState().clear(); void logout(); }} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
        </header>
        <div className="sheet">
          <main className="page" id="content" ref={pageRef}>
            {status === 'error' && <Note kind="bad"><strong>Data could not be loaded.</strong> {error} <button className="btn sm" onClick={() => void load()}>Retry</button></Note>}
            {sample && status !== 'loading' && (
              <div className="sample-banner" role="status">
                <span><strong>Sample data.</strong> These figures are made up to preview the dashboard; nothing is saved and only you see them.</span>
                <button className="btn sm" onClick={() => void showSampleData(false).then(() => notify.success('Sample data removed', 'The dashboard shows the real data again.'))}>Remove sample data</button>
              </div>)}
            {status === 'loading' && <Loading />}
            {status !== 'loading' && <Outlet />}
          </main>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
