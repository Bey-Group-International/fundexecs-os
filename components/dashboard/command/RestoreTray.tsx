'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Plus, RotateCcw } from 'lucide-react';
import { useDashboardLayout } from './DashboardLayoutContext';
import { FX_SPRING } from './motion';

/**
 * RestoreTray — a docked control bar that surfaces every panel the operator has
 * closed, so a dismissed module is one tap from coming back. Renders nothing
 * when the desk is fully laid out (no dead chrome). Chips animate in/out.
 */
export function RestoreTray() {
  const { dismissed, restore } = useDashboardLayout();

  return (
    <AnimatePresence>
      {dismissed.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={FX_SPRING}
          data-testid="restore-tray"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-hairline bg-surface-1 px-3 py-2.5"
        >
          <span className="inline-flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-fg-5">
            <RotateCcw size={12} strokeWidth={2.2} aria-hidden />
            Closed panels
          </span>
          <AnimatePresence initial={false}>
            {dismissed.map((m) => (
              <motion.button
                key={m.id}
                type="button"
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.95 }}
                transition={FX_SPRING}
                onClick={() => restore(m.id)}
                data-testid={`restore-${m.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-1 px-2.5 py-1 text-[11px] font-semibold text-fg-2 transition-colors hover:border-[var(--azure-line)] hover:text-azure-1"
              >
                <Plus size={11} strokeWidth={2.4} aria-hidden />
                {m.title}
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default RestoreTray;
