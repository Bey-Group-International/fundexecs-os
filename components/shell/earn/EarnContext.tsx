'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/* ----------------------------------------------------------------------------
 * EarnContext — what the Earn dock is "looking at" right now.
 *
 * Wave-1 spec: Earn surfaces "the current page/entity's agent actions". Pure
 * pathname inference covers most surfaces (dashboard / fund profile /
 * pipeline / settings / etc.) but misses the case where a drawer (e.g.
 * DealDetailDrawer on /pipeline) takes focus — the dock should switch to
 * deal-context quick actions even though the URL is still `/pipeline`.
 *
 * Pattern: a single React context whose default value is route-inferred.
 * Drawers that own a specific entity (deal / lp / contact / objective)
 * wrap their content in `<EarnContextProvider value={{ kind: 'deal', ... }}>`
 * — the override wins; closing the drawer falls back to the route default.
 *
 * The dock + orb consume via `useEarnContext()`. The Earn chat path itself
 * (`/api/ask-earn` payloads) is intentionally untouched — this is a
 * presentational hint, not a routing change.
 * --------------------------------------------------------------------------*/

export type EarnContextKind =
  | 'dashboard'
  | 'fund-profile'
  | 'trust'
  | 'pipeline'
  | 'lp'
  | 'deal-desk'
  | 'deal'
  | 'capital-stack'
  | 'objection'
  | 'intelligence'
  | 'materials'
  | 'partners'
  | 'audit'
  | 'settings'
  | 'action-queue'
  | 'match-inbox'
  | 'onboarding'
  | 'generic';

export interface EarnContextValue {
  /** The entity / surface the operator is focused on right now. */
  kind: EarnContextKind;
  /** Optional id (deal id, LP id, contact id). Helps drawers be specific. */
  entityId?: string;
  /** A human-readable label of the focused entity — drives the dock subtitle. */
  entityLabel?: string;
}

const FALLBACK: EarnContextValue = { kind: 'generic' };

const EarnContextInternal = createContext<EarnContextValue | null>(null);

/* ----------------------------------------------------------------------------
 * Route inference — single source of truth for "what kind is `/foo`?"
 * --------------------------------------------------------------------------*/

/** Infer the Earn context from a pathname. Pure; safe to call SSR. */
export function inferEarnContextFromPath(pathname: string | null): EarnContextValue {
  if (!pathname) return FALLBACK;
  // Order matters: more specific matches first.
  if (pathname.startsWith('/command-center')) return { kind: 'dashboard' };
  if (pathname.startsWith('/profile')) return { kind: 'fund-profile' };
  if (pathname.startsWith('/trust')) return { kind: 'trust' };
  if (pathname.startsWith('/action-queue')) return { kind: 'action-queue' };
  if (pathname.startsWith('/match-inbox')) return { kind: 'match-inbox' };
  if (pathname.startsWith('/pipeline')) return { kind: 'pipeline' };
  if (pathname.startsWith('/capital-stack')) return { kind: 'capital-stack' };
  if (pathname.startsWith('/objections')) return { kind: 'objection' };
  if (pathname.startsWith('/deal-desk')) return { kind: 'deal-desk' };
  if (pathname.startsWith('/ic-memos')) return { kind: 'deal-desk' };
  if (pathname.startsWith('/governance')) return { kind: 'deal-desk' };
  if (pathname.startsWith('/inbox-intelligence')) return { kind: 'intelligence' };
  if (pathname.startsWith('/knowledge')) return { kind: 'intelligence' };
  if (pathname.startsWith('/materials')) return { kind: 'materials' };
  if (pathname.startsWith('/partners')) return { kind: 'partners' };
  if (pathname.startsWith('/audit')) return { kind: 'audit' };
  if (pathname.startsWith('/settings')) return { kind: 'settings' };
  if (pathname.startsWith('/onboarding')) return { kind: 'onboarding' };
  return FALLBACK;
}

/* ----------------------------------------------------------------------------
 * Provider
 * --------------------------------------------------------------------------*/

export interface EarnContextProviderProps {
  /** Override the context the dock displays — useful for drawers that take
   *  focus on top of a route. When omitted the provider becomes a pass-through
   *  that re-asserts the route default; this lets the AppShell mount one at
   *  the root without flattening nested overrides. */
  value?: Partial<EarnContextValue>;
  children: ReactNode;
}

/**
 * EarnContextProvider — mount once at the shell to set the route default;
 * mount again inside any drawer/entity surface to override.
 */
export function EarnContextProvider({ value, children }: EarnContextProviderProps) {
  const pathname = usePathname();
  const inferred = useMemo(() => inferEarnContextFromPath(pathname), [pathname]);
  // Outer provider's value (if any) — preserves overrides higher up the tree
  // when a child provider passes a partial.
  const outer = useContext(EarnContextInternal);
  const resolved = useMemo<EarnContextValue>(() => {
    const base = outer ?? inferred;
    if (!value) return base;
    return { ...base, ...value, kind: value.kind ?? base.kind };
  }, [outer, inferred, value]);
  return <EarnContextInternal.Provider value={resolved}>{children}</EarnContextInternal.Provider>;
}

/* ----------------------------------------------------------------------------
 * Hook
 * --------------------------------------------------------------------------*/

/**
 * useEarnContext — read the current Earn context. Always returns a value:
 * when no provider has mounted, falls back to route-inference so consumers
 * never need to null-check.
 */
export function useEarnContext(): EarnContextValue {
  const ctx = useContext(EarnContextInternal);
  const pathname = usePathname();
  if (ctx) return ctx;
  return inferEarnContextFromPath(pathname);
}
