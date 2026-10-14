import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface Toast { id: number; kind: ToastKind; title: string; message?: string }

type Theme = 'light' | 'dark';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } };

const initialTheme = (): Theme => {
  const saved = read('ghrs-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  toasts: Toast[];
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  toast: (kind: ToastKind, title: string, message?: string, ms?: number) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme(),
  sidebarCollapsed: read('ghrs-sidebar') === 'collapsed',
  mobileNavOpen: false,
  toasts: [],
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    write('ghrs-theme', next);
    set({ theme: next });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    write('ghrs-sidebar', next ? 'collapsed' : 'expanded');
    set({ sidebarCollapsed: next });
  },
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  toast: (kind, title, message, ms = kind === 'error' ? 8000 : 4500) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-4), { id, kind, title, message }] });
    setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const notify = {
  success: (title: string, message?: string) => useUi.getState().toast('success', title, message),
  error: (title: string, message?: string) => useUi.getState().toast('error', title, message),
  warning: (title: string, message?: string) => useUi.getState().toast('warning', title, message),
  info: (title: string, message?: string) => useUi.getState().toast('info', title, message),
};
