'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

/* ============================================================================
 * DashboardLayoutContext — per-operator module state for the command center.
 *
 * Every collapsible module owns one of three states: open · collapsed ·
 * dismissed. The operator's choices persist across visits (localStorage), so a
 * desk configured once stays configured. Modules self-register their label on
 * mount so the RestoreTray can bring a dismissed panel back by name.
 *
 * SSR-safe: state hydrates from storage in an effect (defaults to "open"), so
 * the first server/client paint always agree.
 * ========================================================================= */

export type ModuleState = 'open' | 'collapsed' | 'dismissed';

interface ModuleMeta {
  id: string;
  title: string;
}

interface DashboardLayoutValue {
  stateOf: (id: string) => ModuleState;
  setState: (id: string, next: ModuleState) => void;
  collapse: (id: string) => void;
  expand: (id: string) => void;
  dismiss: (id: string) => void;
  restore: (id: string) => void;
  register: (meta: ModuleMeta) => void;
  /** Registered modules currently in the "dismissed" state, in registration order. */
  dismissed: ModuleMeta[];
  /** Hydrated from storage yet? Lets modules avoid an initial collapse flash. */
  ready: boolean;
}

const STORAGE_KEY = 'fx-dashboard-layout-v1';

const DashboardLayoutContext = createContext<DashboardLayoutValue | null>(null);

export function DashboardLayoutProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ModuleState>>({});
  const [ready, setReady] = useState(false);
  // Registry of mounted modules, in registration (on-canvas) order. State, not a
  // ref, so the `dismissed` derivation never reads a ref during render.
  const [registry, setRegistry] = useState<ModuleMeta[]>([]);

  // Hydrate persisted states once on mount. Deferred to a rAF so the setState is
  // not synchronous in the effect body (keeps the React-compiler lint clean) and
  // the first server/client paint both use defaults (all open) — no mismatch.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) setStates(JSON.parse(raw) as Record<string, ModuleState>);
      } catch {
        /* storage unavailable — defaults (all open) apply */
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Persist on change (after hydration only, to avoid clobbering with defaults).
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
    } catch {
      /* ignore */
    }
  }, [states, ready]);

  const register = useCallback((meta: ModuleMeta) => {
    setRegistry((prev) => {
      const existing = prev.find((m) => m.id === meta.id);
      if (existing) {
        if (existing.title === meta.title) return prev;
        return prev.map((m) => (m.id === meta.id ? { ...m, title: meta.title } : m));
      }
      return [...prev, meta];
    });
  }, []);

  const setState = useCallback((id: string, next: ModuleState) => {
    setStates((prev) => (prev[id] === next ? prev : { ...prev, [id]: next }));
  }, []);

  const stateOf = useCallback((id: string): ModuleState => states[id] ?? 'open', [states]);

  const collapse = useCallback((id: string) => setState(id, 'collapsed'), [setState]);
  const expand = useCallback((id: string) => setState(id, 'open'), [setState]);
  const dismiss = useCallback((id: string) => setState(id, 'dismissed'), [setState]);
  const restore = useCallback((id: string) => setState(id, 'open'), [setState]);

  const dismissed = useMemo(
    () => registry.filter((m) => (states[m.id] ?? 'open') === 'dismissed'),
    [registry, states]
  );

  const value = useMemo<DashboardLayoutValue>(
    () => ({
      stateOf,
      setState,
      collapse,
      expand,
      dismiss,
      restore,
      register,
      dismissed,
      ready
    }),
    [stateOf, setState, collapse, expand, dismiss, restore, register, dismissed, ready]
  );

  return (
    <DashboardLayoutContext.Provider value={value}>{children}</DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout(): DashboardLayoutValue {
  const ctx = useContext(DashboardLayoutContext);
  if (!ctx) {
    throw new Error('useDashboardLayout must be used within <DashboardLayoutProvider>');
  }
  return ctx;
}
