'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { RequestAccessModal } from '@/components/landing/RequestAccessModal';
import { track } from '@/lib/landing/analytics';

interface RequestAccessContextValue {
  /** Open the request-access modal. `source` attributes the opener for funnel analytics. */
  open: (source: string) => void;
}

const RequestAccessContext = createContext<RequestAccessContextValue | null>(null);

/**
 * RequestAccessProvider — wraps the public landing page so every primary CTA
 * (nav, hero, mid-page, closing) opens the same request-access modal. Keeps
 * the page itself a server component: only the CTAs and the modal are client.
 */
export function RequestAccessProvider({ children }: { children: ReactNode }) {
  const [openSource, setOpenSource] = useState<string | null>(null);

  const open = useCallback((source: string) => {
    track('landing_cta_click', { cta: 'request-access', location: source });
    track('request_access_open', { source });
    setOpenSource(source);
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <RequestAccessContext.Provider value={value}>
      {children}
      <RequestAccessModal
        open={openSource !== null}
        onClose={() => setOpenSource(null)}
        source={openSource ?? 'landing'}
      />
    </RequestAccessContext.Provider>
  );
}

/**
 * useRequestAccess — returns the modal opener. Falls back to a no-op-safe
 * navigation to /request-access when rendered outside the provider, so a CTA
 * never silently does nothing.
 */
export function useRequestAccess(): RequestAccessContextValue {
  const ctx = useContext(RequestAccessContext);
  if (ctx) return ctx;
  return {
    open: () => {
      if (typeof window !== 'undefined') window.location.assign('/request-access');
    }
  };
}
