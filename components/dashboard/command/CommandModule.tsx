'use client';

import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDashboardLayout } from './DashboardLayoutContext';
import { fxCollapse, fxRiseItem, FX_SPRING } from './motion';

export interface CommandModuleProps {
  /** Stable id — persistence + restore key. */
  id: string;
  /** Short, all-caps chrome label for the module (instrument-panel header). */
  label: string;
  /** The module body (typically an existing dashboard Card). */
  children: ReactNode;
  /** Optional accent color for the status dot + label (defaults to muted). */
  accent?: string;
  className?: string;
}

/**
 * CommandModule — a collapsible / dismissible panel of the command center.
 *
 * Renders a slim chrome strip (status dot · label · collapse · dismiss) above
 * the panel body. Collapsing animates the body height; dismissing unmounts it
 * and surfaces it in the RestoreTray. The control state is owned by
 * DashboardLayoutContext, so every choice persists per operator.
 *
 * Reduced-motion is handled by the parent <MotionConfig reducedMotion="user">.
 */
export function CommandModule({ id, label, children, accent, className }: CommandModuleProps) {
  const { stateOf, register, collapse, expand, dismiss, ready } = useDashboardLayout();

  useEffect(() => {
    register({ id, title: label });
  }, [id, label, register]);

  const state = stateOf(id);

  // Until hydrated, render the body open (matches SSR) to avoid a collapse flash.
  const open = !ready || state === 'open';
  if (ready && state === 'dismissed') return null;

  return (
    <motion.section
      layout
      variants={fxRiseItem}
      data-testid={`command-module-${id}`}
      data-state={state}
      className={cn('flex flex-col', className)}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ backgroundColor: accent ?? 'var(--fg-5)' }}
          />
          <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-fg-5">
            {label}
          </span>
        </span>
        <span className="flex flex-none items-center gap-0.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            transition={FX_SPRING}
            onClick={() => (open ? collapse(id) : expand(id))}
            aria-expanded={open}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            data-testid={`command-module-toggle-${id}`}
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-surface-2 hover:text-fg-2"
          >
            <motion.span animate={{ rotate: open ? 0 : -90 }} transition={FX_SPRING}>
              <ChevronDown size={14} strokeWidth={2.2} aria-hidden />
            </motion.span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            transition={FX_SPRING}
            onClick={() => dismiss(id)}
            aria-label={`Close ${label}`}
            data-testid={`command-module-dismiss-${id}`}
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-5 transition-colors hover:bg-[var(--danger-soft)] hover:text-danger"
          >
            <X size={13} strokeWidth={2.2} aria-hidden />
          </motion.button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={fxCollapse}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

export default CommandModule;
