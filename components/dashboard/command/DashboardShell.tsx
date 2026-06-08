'use client';

import type { ReactNode } from 'react';
import { MotionConfig, motion, type HTMLMotionProps } from 'motion/react';
import { DashboardLayoutProvider } from './DashboardLayoutContext';
import { NotificationCenter, type NotificationCenterProps } from './NotificationCenter';
import { fxStagger, fxRiseItem } from './motion';

/**
 * DashboardShell — the client envelope for the command center.
 *
 * Provides the motion physics (reduced-motion follows the OS preference), the
 * per-operator layout state, and the pop-up notification feed. The composed
 * canvas is passed as children so the heavy server-rendered cards stay on the
 * server; only the interaction layer is client.
 */
export function DashboardShell({
  notifications,
  children
}: {
  notifications: NotificationCenterProps;
  children: ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <DashboardLayoutProvider>
        {children}
        <NotificationCenter {...notifications} />
      </DashboardLayoutProvider>
    </MotionConfig>
  );
}

/** Staggered-reveal container — children with item variants rise in sequence. */
export function RevealGroup({ children, ...rest }: HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={fxStagger} initial="hidden" animate="show" {...rest}>
      {children}
    </motion.div>
  );
}

/** A single revealed item — wrap a server card to give it the rise-in entrance. */
export function RevealItem({ children, ...rest }: HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={fxRiseItem} layout {...rest}>
      {children}
    </motion.div>
  );
}
