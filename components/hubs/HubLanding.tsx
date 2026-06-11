import { EarnCoin } from '@/components/ui/EarnCoin';
import { MandateIcon } from '@/components/ui/MandateIcon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { HubContent, HubId, HubMeta } from '@/lib/hubs/lifecycle';

/**
 * One verb hub's landing — the prototype's hub interior at overview depth:
 * hero (identity + live readiness), the role-aware module map, and Earn's
 * standing note. The module interiors (formation flow, materials room,
 * diligence desk, closings…) arrive in follow-up passes; until each comes
 * online its tile says so honestly instead of faking a surface.
 */
export function HubLanding({
  meta,
  content,
  pct,
  isCenter,
  earnNote
}: {
  meta: HubMeta;
  content: HubContent;
  pct: number;
  /** Whether this hub is the operator's center of gravity right now. */
  isCenter: boolean;
  /** Earn's one-liner for this hub ("I keep Build moving…"). */
  earnNote: string;
}) {
  return (
    <div className="fx-rise flex flex-col gap-4">
      {/* hero */}
      <section className="rounded-2xl border border-hairline bg-bg-1 p-5">
        <div className="flex items-center gap-3.5">
          <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent">
            <MandateIcon name={meta.icon} size={23} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{meta.label}</h1>
              <span className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                {meta.tag}
              </span>
              {isCenter && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.06em] text-gold-1">
                  <span className="fx-glow-pulse h-1.5 w-1.5 rounded-full bg-gold-1" aria-hidden />
                  YOUR FOCUS NOW
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-fg-3">{content.blurb}</p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
              {pct}%
            </div>
            <div className="text-[10.5px] text-fg-5">ready</div>
          </div>
        </div>
        <div className="mt-4">
          <ProgressBar value={pct} height={6} label={`${meta.label} readiness`} />
        </div>
      </section>

      {/* the module map */}
      <section className="rounded-2xl border border-hairline bg-bg-1 p-5">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          {meta.label} — your modules
        </h2>
        <p className="mt-1 text-[12.5px] text-fg-4">What the team manages here.</p>
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {content.modules.map((mod) => (
            <div
              key={mod.label}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <MandateIcon name={mod.icon} size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{mod.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-fg-5">{mod.meta}</div>
              </div>
              <span className="flex-none text-[9.5px] font-semibold uppercase tracking-[0.08em] text-fg-5">
                Online next
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Earn's standing note */}
      <section className="flex items-center gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
        <EarnCoin size={26} />
        <p className="text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> {earnNote}
        </p>
      </section>
    </div>
  );
}

/** Earn's standing note per hub — one spelling for all member types. */
export const EARN_HUB_NOTES: Record<HubId, string> = {
  build:
    'I keep Build moving in the background — every document and filing drafted to an institutional standard, brought to you for approval.',
  source:
    'I keep Source moving in the background — the team surfaces deals, capital and partners scored against your mandate, and nothing reaches out until you approve.',
  run: 'I keep Run moving in the background — diligence, workflows and reporting stay sequenced, with counsel in the loop where it matters.',
  execute:
    'I keep Execute moving in the background — every closing is step-gated to signature and logged to your Chain of Trust.'
};
