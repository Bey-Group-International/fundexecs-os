'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  History,
  Info,
  Radio,
  Sparkles,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivityItem, MajorAlert, SinceLastVisit } from '@/lib/queries/dashboard';
import { FX_SPRING } from './motion';

/* ============================================================================
 * NotificationCenter — the command center's pop-up desk feed.
 *
 * Ephemeral signal, not permanent chrome: the "since you were away" read, live
 * Risk Desk alerts, and fresh tape print as transient toasts that auto-settle.
 * A persistent Risk Desk pill re-opens active alerts on demand, so nothing
 * urgent is ever lost to an auto-dismiss.
 * ========================================================================= */

type Tone = 'gold' | 'azure' | 'danger' | 'warning';

interface Toast {
  id: string;
  tone: Tone;
  icon: typeof Bell;
  eyebrow: string;
  title: string;
  detail?: string;
  href?: string;
  /** ms before auto-settle; criticals linger longest. */
  ttl: number;
}

const TONE: Record<Tone, { line: string; soft: string; fg: string }> = {
  gold: { line: 'var(--gold-line)', soft: 'var(--gold-soft)', fg: 'var(--gold-1)' },
  azure: { line: 'var(--azure-line)', soft: 'var(--azure-soft)', fg: 'var(--azure-1)' },
  danger: { line: 'var(--danger-line)', soft: 'var(--danger-soft)', fg: 'var(--danger)' },
  warning: { line: 'var(--warning-line)', soft: 'var(--warning-soft)', fg: 'var(--warning)' }
};

const ALERT_META: Record<
  MajorAlert['severity'],
  { tone: Tone; icon: typeof Bell; eyebrow: string }
> = {
  critical: { tone: 'danger', icon: AlertTriangle, eyebrow: 'Risk Desk · critical' },
  warning: { tone: 'warning', icon: AlertCircle, eyebrow: 'Risk Desk · watch' },
  info: { tone: 'azure', icon: Info, eyebrow: 'Risk Desk · note' }
};

export interface NotificationCenterProps {
  since: SinceLastVisit;
  alerts: MajorAlert[];
  activity: ActivityItem[];
}

function alertToast(a: MajorAlert): Toast {
  const meta = ALERT_META[a.severity];
  return {
    id: `alert-${a.id}`,
    tone: meta.tone,
    icon: meta.icon,
    eyebrow: meta.eyebrow,
    title: a.title,
    detail: a.detail,
    href: a.href,
    ttl: a.severity === 'critical' ? 14000 : 9000
  };
}

export function NotificationCenter({ since, alerts, activity }: NotificationCenterProps) {
  const [queue, setQueue] = useState<Toast[]>([]);

  // The opening burst — built once from the server payload.
  const seed = useMemo<Toast[]>(() => {
    const out: Toast[] = [];
    if (since.isFirstVisit) {
      out.push({
        id: 'since-welcome',
        tone: 'gold',
        icon: Sparkles,
        eyebrow: 'The desk is live',
        title: 'Welcome to your command center.',
        detail: 'Earn and the desk start compounding from here — every move on the record.',
        ttl: 11000
      });
    } else if (since.newActivityCount > 0) {
      out.push({
        id: 'since-summary',
        tone: 'azure',
        icon: History,
        eyebrow: 'Since you were away',
        title: `The desk logged ${since.newActivityCount} update${
          since.newActivityCount === 1 ? '' : 's'
        }.`,
        detail: since.highlights.slice(0, 2).join(' · ') || undefined,
        ttl: 10000
      });
    }
    for (const a of alerts) out.push(alertToast(a));
    for (const item of activity.slice(0, 2)) {
      out.push({
        id: `tape-${item.id}`,
        tone: 'azure',
        icon: Radio,
        eyebrow: `The tape · ${item.actor}`,
        title: item.title,
        ttl: 8000
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Print the opening burst on mount (deferred so it never blocks first paint).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setQueue(seed));
    return () => cancelAnimationFrame(raf);
  }, [seed]);

  const close = (id: string) => setQueue((q) => q.filter((t) => t.id !== id));

  const activeAlerts = alerts.length;
  const reopenAlerts = () =>
    setQueue((q) => {
      const have = new Set(q.map((t) => t.id));
      const add = alerts.map(alertToast).filter((t) => !have.has(t.id));
      return [...add, ...q];
    });

  return (
    <>
      {/* Pop-up stack — top-right, under the shell header. */}
      <div
        className="pointer-events-none fixed right-3 top-[72px] z-[55] flex w-[320px] max-w-[calc(100vw-1.5rem)] flex-col gap-2 sm:right-5"
        role="region"
        aria-label="Desk notifications"
      >
        <AnimatePresence initial={false}>
          {queue.slice(0, 4).map((t) => (
            <ToastCard key={t.id} toast={t} onClose={() => close(t.id)} />
          ))}
        </AnimatePresence>
      </div>

      {/* Persistent Risk Desk pill — re-opens active alerts on demand. */}
      {activeAlerts > 0 && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.96 }}
          transition={FX_SPRING}
          onClick={reopenAlerts}
          data-testid="risk-desk-pill"
          className="fixed bottom-[88px] right-3 z-[54] inline-flex items-center gap-1.5 rounded-full border border-[var(--danger-line)] bg-bg-2 px-3 py-2 text-[11px] font-semibold text-fg-1 shadow-[var(--shadow-lg)] sm:right-5"
          aria-label={`Re-open ${activeAlerts} Risk Desk alert${activeAlerts === 1 ? '' : 's'}`}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
          </span>
          Risk Desk
          <span className="rounded-full bg-[var(--danger-soft)] px-1.5 text-[10px] text-danger">
            {activeAlerts}
          </span>
        </motion.button>
      )}
    </>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const tone = TONE[toast.tone];
  const Icon = toast.icon;

  useEffect(() => {
    const id = setTimeout(onClose, toast.ttl);
    return () => clearTimeout(id);
  }, [toast.ttl, onClose]);

  const body = (
    <>
      <span
        aria-hidden
        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
        style={{ backgroundColor: tone.soft, color: tone.fg }}
      >
        <Icon size={16} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="text-[9.5px] font-semibold uppercase tracking-[0.13em]"
          style={{ color: tone.fg }}
        >
          {toast.eyebrow}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] font-semibold tracking-[-0.01em] text-fg-1">
          {toast.title}
        </p>
        {toast.detail ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-3">{toast.detail}</p>
        ) : null}
      </div>
      {toast.href ? (
        <ArrowUpRight
          size={13}
          strokeWidth={2}
          className="mt-0.5 flex-none text-fg-4"
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.97 }}
      transition={FX_SPRING}
      className="pointer-events-auto"
      data-testid={`toast-${toast.id}`}
    >
      <div
        className="relative flex items-start gap-3 overflow-hidden rounded-2xl border bg-bg-2 p-3 pr-9 shadow-[var(--shadow-lg)]"
        style={{ borderColor: tone.line }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: tone.fg }}
        />
        {toast.href ? (
          <Link href={toast.href} className="flex min-w-0 flex-1 items-start gap-3">
            {body}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          className={cn(
            'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-fg-5',
            'transition-colors hover:bg-surface-2 hover:text-fg-1'
          )}
        >
          <X size={13} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}

export default NotificationCenter;
