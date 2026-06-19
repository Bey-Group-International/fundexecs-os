import Link from "next/link";
import { getMandate } from "@/lib/build-readiness";

function compactUsd(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

// Compact banner that carries the firm's mandate — defined once in Build ›
// Thesis — into the downstream hubs (Source, Run) that act on it. Sourcing and
// evaluation now happen against the foundation rather than from scratch.
export async function MandateStrip({ orgId }: { orgId: string }) {
  const mandate = await getMandate(orgId);

  if (!mandate) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line bg-surface-1 px-4 py-2.5 text-xs text-fg-muted">
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">Mandate</span>
        <span>No active thesis yet —</span>
        <Link href="/build/thesis" className="text-gold-400 hover:underline">
          define it in Build → Thesis
        </Link>
        <span>to frame this work.</span>
      </div>
    );
  }

  const checkSize = [compactUsd(mandate.checkSizeMin), compactUsd(mandate.checkSizeMax)].filter(Boolean);
  const facts = [
    mandate.assetClasses.length ? mandate.assetClasses.join(", ") : null,
    mandate.geographies.length ? mandate.geographies.join(", ") : null,
    checkSize.length ? checkSize.join("–") : null,
    mandate.targetIrr != null ? `${mandate.targetIrr}% IRR` : null,
    mandate.targetMoic != null ? `${mandate.targetMoic}x MOIC` : null,
  ].filter(Boolean) as string[];

  return (
    <Link
      href="/build/thesis"
      className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-surface-1 px-4 py-2.5 text-xs transition hover:border-gold-500/40"
    >
      <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">Mandate</span>
      <span className="font-medium text-fg-primary">{mandate.thesisTitle}</span>
      {facts.length ? <span className="text-fg-muted">·</span> : null}
      {facts.map((f, i) => (
        <span key={f} className="text-fg-secondary">
          {f}
          {i < facts.length - 1 ? <span className="ml-2 text-fg-muted">·</span> : null}
        </span>
      ))}
    </Link>
  );
}
