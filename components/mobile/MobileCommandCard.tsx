import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

export interface CommandStat {
  label: string;
  value: string | number;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: "gold" | "neural" | "danger" | "success";
}

const TONE: Record<string, string> = {
  gold: "text-gold-400 border-gold-500/25",
  neural: "text-neural-300 border-neural-400/25",
  danger: "text-status-danger border-status-danger/30",
  success: "text-status-success border-status-success/30",
};

// Compact stat tile for the command-center snapshot strip. Tappable — each
// routes to the surface that owns the number.
export function MobileStatTile({ stat }: { stat: CommandStat }) {
  const Icon = stat.icon;
  const tone = TONE[stat.tone ?? "neural"];
  return (
    <Link
      href={stat.href}
      className="fx-tap group flex flex-col gap-1.5 rounded-2xl border border-line/60 bg-surface-1/70 p-3 transition active:scale-[0.98] active:bg-surface-2"
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg border bg-surface-0/60 ${tone}`}>
        <Icon width={17} height={17} />
      </span>
      <span className="mt-0.5 font-display text-xl font-semibold leading-none text-fg-primary">{stat.value}</span>
      <span className="text-[11px] leading-tight text-fg-secondary">{stat.label}</span>
    </Link>
  );
}

// The single "recommended next action" hero — answers "what needs my attention
// right now?" with one decisive prompt.
export function MobileNextAction({
  eyebrow,
  title,
  body,
  href,
  cta,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="fx-tap relative block overflow-hidden rounded-2xl border border-neural-400/30 bg-gradient-to-br from-surface-1/90 to-surface-0/80 p-4 transition active:scale-[0.99]"
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_15%_0%,rgb(var(--fx-accent-rgb)/0.14),transparent_70%)]" />
      <div className="relative">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-neural-300">{eyebrow}</p>
        <p className="mt-1.5 text-[15px] font-semibold leading-tight text-fg-primary">{title}</p>
        {body && <p className="mt-1 text-[12.5px] leading-snug text-fg-secondary">{body}</p>}
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neural-400/40 bg-neural-400/[0.08] px-3 py-1.5 text-[12.5px] font-semibold text-neural-300">
          {cta}
          <span aria-hidden>›</span>
        </span>
      </div>
    </Link>
  );
}
