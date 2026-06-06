'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { TrustDrawer } from './TrustDrawer';
import type { StartChainInput } from '@/lib/actions/trust';

interface TrustDrawerOpenArg {
  recordId?: string | null;
  starter?: StartChainInput | null;
}

interface TrustDrawerHostValue {
  open: (arg: TrustDrawerOpenArg) => void;
  close: () => void;
}

const TrustDrawerHostContext = createContext<TrustDrawerHostValue | null>(null);

/**
 * Read the imperative trust drawer handle from the surrounding host. Throws
 * when called outside a `<TrustDrawerHost />` so the dev sees the wiring
 * mistake immediately.
 */
export function useTrustDrawer(): TrustDrawerHostValue {
  const v = useContext(TrustDrawerHostContext);
  if (!v) {
    throw new Error('useTrustDrawer must be used inside a <TrustDrawerHost />');
  }
  return v;
}

interface DrawerState {
  open: boolean;
  recordId: string | null;
  starter: StartChainInput | null;
}

const INITIAL: DrawerState = { open: false, recordId: null, starter: null };

/**
 * TrustDrawerHost — mounts a single global Chain-of-Trust drawer inside a
 * subtree and exposes an imperative `open({ recordId | starter })` handle
 * via React Context. Multiple call sites (the CoT strip in the dashboard
 * hero, per-deal Trust chips, future invocation points) can open the same
 * drawer without lifting state up to every caller.
 */
export function TrustDrawerHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DrawerState>(INITIAL);

  const open = useCallback((arg: TrustDrawerOpenArg) => {
    setState({
      open: true,
      recordId: arg.recordId ?? null,
      starter: arg.starter ?? null
    });
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const value = useMemo<TrustDrawerHostValue>(() => ({ open, close }), [open, close]);

  return (
    <TrustDrawerHostContext.Provider value={value}>
      {children}
      <TrustDrawer
        open={state.open}
        onClose={close}
        recordId={state.recordId}
        starterContext={state.starter}
      />
    </TrustDrawerHostContext.Provider>
  );
}
