import Link from "next/link";
import { currentFeatureAccess } from "@/lib/feature-access.server";
import { featureLockedMessage, type GatedFeature } from "@/lib/feature-access";

// Shown at the top of a gated area (see lib/feature-access) when the org has no
// paid plan. The page underneath stays browsable; its actions refuse on the
// server with the same message, so this is the explanation, not the gate.
//
// Renders nothing for plan holders and platform admins.
export async function FeatureLockBanner({
  feature,
  className = "",
}: {
  feature: GatedFeature;
  className?: string;
}) {
  const access = await currentFeatureAccess();
  if (access.unlocked) return null;

  return (
    <div
      role="status"
      className={`mb-5 flex flex-wrap items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-500/[0.06] px-4 py-3.5 ${className}`}
    >
      <div
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-gold-300"
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg-primary">Preview mode</p>
        <p className="mt-0.5 text-[12px] leading-5 text-fg-secondary">
          {featureLockedMessage(feature)} You can look around, but actions here are locked
          until then.
        </p>
      </div>
      <Link
        href="/wallet"
        className="shrink-0 self-center rounded-lg border border-gold-500/40 px-3 py-1.5 text-[12px] font-medium text-gold-300 hover:bg-gold-500/10"
      >
        See plans
      </Link>
    </div>
  );
}
