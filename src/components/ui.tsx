import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { useUi } from '../store/ui.ts';
import { clsx, NA } from '../lib/format.ts';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const icon = { success: <CheckCircle2 size={18} />, error: <XCircle size={18} />, warning: <AlertTriangle size={18} />, info: <Info size={18} /> };
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={clsx('toast', t.kind)}>
          {icon[t.kind]}
          <div style={{ flex: 1 }}><strong>{t.title}</strong>{t.message && <div className="small muted">{t.message}</div>}</div>
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export interface ConfirmProps {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  /** Destructive operations can require typing a word to confirm. */
  typeToConfirm?: string;
  onConfirm: () => void | Promise<void>; onCancel: () => void;
}
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, typeToConfirm, onConfirm, onCancel }: ConfirmProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !typeToConfirm || text.trim() === typeToConfirm;
  return (
    <Modal title={title} onClose={onCancel} actions={<>
      <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className={clsx('btn', danger ? 'danger' : 'primary')} disabled={!ok || busy}
        onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</button>
    </>}>
      <div>{message}</div>
      {typeToConfirm && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Type <code>{typeToConfirm}</code> to confirm</label>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
      )}
    </Modal>
  );
}

/** A KPI cell for the divided `.kpis` strip: label over value, unit as a grey suffix. `icon` and `color` are
 *  accepted for older callers but not drawn: KPIs are type, not tiles. Missing data is a grey dash, never a guess. */
export function KpiCard({ label, value, unit, sub }: { label: string; value: string | null; unit?: string; sub?: string; color?: string; icon?: ReactNode }) {
  const na = value === null || value === NA;
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={clsx('value', na && 'na')} title={na ? 'No data available' : undefined}>{na ? '— No data' : value}{!na && unit && <span className="unit">{unit}</span>}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function StatusPill({ kind, children }: { kind: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={clsx('pill', kind !== 'neutral' && kind)}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty"><div>{children}</div></div>; }

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="field"><label>{label}</label>{children}{hint && <span className="small muted">{hint}</span>}</div>;
}

export function Note({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return <div className={clsx('note', kind)}>{children}</div>;
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <div className="spacer" />
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/** Loading keeps the final layout: a title bar, a KPI strip and two panels as flat grey blocks, no shimmer. */
export function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 32, width: 220, marginBottom: 24 }} />
      <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />
      <div className="grid g-main"><div className="skeleton" style={{ height: 300 }} /><div className="skeleton" style={{ height: 300 }} /></div>
    </div>
  );
}

/** Closes a popup when clicking outside of it. */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [onOutside]);
  return ref;
}
