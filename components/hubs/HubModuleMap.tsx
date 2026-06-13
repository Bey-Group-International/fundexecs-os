'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { MandateIcon } from '@/components/ui/MandateIcon';
import { fxPressable, fxRiseItem, fxStagger } from '@/components/dashboard/command/motion';

/** One module tile as the hub landing renders it (serializable). */
interface HubModule {
  label: string;
  meta: string;
  icon: string;
  href?: string;
}

const TILE = 'flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3';

/**
 * The verb-hub module map — the tiles the team manages in this hub.
 *
 * Client island so the grid can carry two tier=meaningful motions on the
 * foundation tokens: the tiles cascade in on first view ("your modules are
 * assembling") via `fxStagger`/`fxRiseItem`, and each live tile gets a spring
 * lift + tap settle (`fxPressable`) so a navigable module feels tactile — a
 * gap the prior CSS (bg-only hover) left. Non-live tiles ("Online next") are
 * not interactive, so they reveal but do not press.
 *
 * Reduced motion renders the grid statically (the guard below), and the
 * app-level `<MotionConfig reducedMotion="user">` neutralizes the spring.
 */
export function HubModuleMap({ modules }: { modules: readonly HubModule[] }) {
  const reduced = useReducedMotion() ?? false;

  if (reduced) {
    return (
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {modules.map((mod) => (
          <Tile key={mod.label} mod={mod} />
        ))}
      </div>
    );
  }

  return (
    <motion.div
      className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2"
      variants={fxStagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
    >
      {modules.map((mod) =>
        mod.href ? (
          <motion.div key={mod.label} variants={fxRiseItem} {...fxPressable}>
            <Link href={mod.href} className={`${TILE} transition-colors hover:bg-surface-2`}>
              <TileInner mod={mod} />
            </Link>
          </motion.div>
        ) : (
          <motion.div key={mod.label} variants={fxRiseItem} className={TILE}>
            <TileInner mod={mod} />
          </motion.div>
        )
      )}
    </motion.div>
  );
}

/** Static (reduced-motion) tile — same markup, no motion wrappers. */
function Tile({ mod }: { mod: HubModule }) {
  return mod.href ? (
    <Link href={mod.href} className={`${TILE} transition-colors hover:bg-surface-2`}>
      <TileInner mod={mod} />
    </Link>
  ) : (
    <div className={TILE}>
      <TileInner mod={mod} />
    </div>
  );
}

function TileInner({ mod }: { mod: HubModule }) {
  return (
    <>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
        <MandateIcon name={mod.icon} size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{mod.label}</div>
        <div className="mt-0.5 truncate text-[11px] text-fg-5">{mod.meta}</div>
      </div>
      {mod.href ? (
        <span className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1">
          Open
          <ArrowRight size={12} strokeWidth={2} aria-hidden />
        </span>
      ) : (
        <span className="flex-none text-[9.5px] font-semibold uppercase tracking-[0.08em] text-fg-5">
          Online next
        </span>
      )}
    </>
  );
}
