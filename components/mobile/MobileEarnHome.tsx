"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { CommandCenterData } from "./MobileCommandCenter";
import { MobileApprovalCard } from "./MobileApprovalCard";
import { MobileDealCard } from "./MobileDealCard";
import { MobileWorkflowCard } from "./MobileWorkflowCard";
import { PullToRefresh } from "./PullToRefresh";
import { EarnIcon, SparkIcon, DealsIcon, ShieldIcon, TaskIcon, BellIcon } from "./icons";
import { haptic } from "./haptics";
import { MicButton } from "./MicButton";

// Earn's coin avatar for the conversation.
function EarnAvatar({ size = 30 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-gold-300"
      style={{ width: size, height: size }}
    >
      <EarnIcon width={size * 0.62} height={size * 0.62} />
    </span>
  );
}

// A left-aligned "Earn is speaking" turn: the avatar once, then a stack of
// bubbles / attached cards.
function EarnTurn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <div className="flex gap-2.5 motion-safe:animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <EarnAvatar />
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-fit max-w-[92%] rounded-2xl rounded-tl-md border border-line/70 bg-surface-1 px-3.5 py-2.5 text-[13.5px] leading-snug text-fg-primary">
      {children}
    </div>
  );
}

// The glanceable "pulse" Earn drops into the thread — the monitor surface,
// compact and tappable.
function Pulse({ c }: { c: CommandCenterData["counts"] }) {
  const items = [
    { label: "Pipeline", value: `${c.deals}`, sub: "active", href: "/deals/feed", icon: DealsIcon, tone: "text-gold-400" },
    { label: "Approvals", value: `${c.approvals}`, sub: "waiting", href: "/approvals", icon: ShieldIcon, tone: c.approvals > 0 ? "text-status-danger" : "text-neural-300" },
    { label: "Workflows", value: `${c.workflows}`, sub: "running", href: "/automations", icon: TaskIcon, tone: "text-neural-300" },
    { label: "Inbox", value: `${c.unread}`, sub: "unread", href: "/inbox", icon: BellIcon, tone: "text-status-success" },
  ];
  return (
    <div className="w-full overflow-hidden rounded-2xl rounded-tl-md border border-neural-400/25 bg-gradient-to-br from-surface-1 to-surface-0/70">
      <div className="flex items-center gap-1.5 border-b border-line/50 px-3 py-1.5">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted">Live pulse</span>
      </div>
      <div className="grid grid-cols-4 divide-x divide-line/50">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link key={it.label} href={it.href} onClick={() => haptic("tap")} className="fx-tap flex flex-col items-center gap-0.5 px-1 py-2.5 transition active:bg-surface-2">
              <Icon width={15} height={15} className={it.tone} />
              <span className="font-display text-lg font-semibold leading-none text-fg-primary">{it.value}</span>
              <span className="text-[9px] leading-tight text-fg-muted">{it.sub}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Build Earn's conversational brief from the data.
function briefLine(d: CommandCenterData): string {
  const c = d.counts;
  const bits: string[] = [];
  if (c.approvals > 0) bits.push(`**${c.approvals}** ${c.approvals === 1 ? "approval needs" : "approvals need"} your sign-off`);
  if (c.workflows > 0) bits.push(`I've got **${c.workflows}** ${c.workflows === 1 ? "workflow" : "workflows"} running`);
  if (c.deals > 0) bits.push(`**${c.deals}** ${c.deals === 1 ? "deal is" : "deals are"} live`);
  if (bits.length === 0) return "You're all caught up — nothing needs you right now.";
  const last = bits.pop();
  return bits.length ? `${bits.join(", ")}, and ${last}.` : `${last}.`;
}

// Render **bold** spans inside Earn's short lines without a markdown dep.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-fg-primary">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const CHIPS = [
  { label: "Summarize my hottest deal", ask: "Summarize my hottest deal and its next step" },
  { label: "Who should I follow up with?", ask: "Who should I follow up with today?" },
  { label: "Draft an LP update", ask: "Draft an LP update for this quarter" },
  { label: "What needs approval?", ask: "What is waiting on my approval and why?" },
];

// The mobile home, reimagined as a conversation with Earn. Instead of a
// dashboard of sections, Earn greets the operator and walks them through what
// needs attention, dropping a live pulse and rich action cards inline. A
// persistent composer sits above the tab bar so they can talk back at any time.
// This is a dedicated mobile surface — the desktop dashboard is untouched.
export function MobileEarnHome({ data }: { data: CommandCenterData }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const first = data.name.split(" ")[0];

  function send(text?: string) {
    const q = (text ?? value).trim();
    haptic("select");
    router.push(q ? `/earn?ask=${encodeURIComponent(q)}` : "/earn");
  }

  const hottest = data.deals[0];
  const nothing = data.approvals.length === 0 && data.workflows.length === 0 && data.deals.length === 0;

  return (
    <div className="mx-auto max-w-lg">
      <PullToRefresh>
        <div className="space-y-4 pb-28" role="region" aria-label="Conversation with Earn">
          {/* Conversation header */}
          <header className="flex items-center gap-2.5 pb-1 pt-1">
            <EarnAvatar size={38} />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight text-fg-primary">Earn</p>
              <p className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-success" />
                Executive copilot · {data.dateLabel}
              </p>
            </div>
          </header>

          {/* Earn's greeting + brief */}
          <EarnTurn>
            <Bubble>
              {data.greeting}, {first}. <Rich text={briefLine(data)} />
            </Bubble>
            <Pulse c={data.counts} />
          </EarnTurn>

          {/* Approvals */}
          {data.approvals.length > 0 && (
            <EarnTurn delay={60}>
              <Bubble>
                {data.approvals.length === 1 ? "This is waiting on your sign-off:" : `${data.approvals.length} things are waiting on your sign-off:`}
              </Bubble>
              <div className="space-y-2">
                {data.approvals.map((a) => (
                  <MobileApprovalCard key={a.id} approval={a} />
                ))}
              </div>
            </EarnTurn>
          )}

          {/* Hottest deal */}
          {hottest && (
            <EarnTurn delay={120}>
              <Bubble>
                {hottest.nextStep ? (
                  <>Your hottest deal, <strong className="font-semibold">{hottest.name}</strong> — here&apos;s the next move. Swipe it for one-tap actions.</>
                ) : (
                  <>Top of your pipeline right now: <strong className="font-semibold">{hottest.name}</strong>.</>
                )}
              </Bubble>
              <MobileDealCard deal={hottest} />
            </EarnTurn>
          )}

          {/* Workflows */}
          {data.workflows.length > 0 && (
            <EarnTurn delay={180}>
              <Bubble>I&apos;m already moving on {data.workflows.length === 1 ? "this" : "these"} for you:</Bubble>
              <div className="space-y-2">
                {data.workflows.map((w) => (
                  <MobileWorkflowCard key={w.id} workflow={w} />
                ))}
              </div>
            </EarnTurn>
          )}

          {/* All clear */}
          {nothing && (
            <EarnTurn delay={60}>
              <Bubble>
                Nothing needs you this second. Want me to source new deals, warm up your LPs, or prep an investor update? Just say the word.
              </Bubble>
            </EarnTurn>
          )}

          {/* Suggested replies */}
          <div className="flex flex-wrap gap-2 pl-[38px]">
            {CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => send(c.ask)}
                className="fx-tap rounded-full border border-gold-500/30 bg-gold-500/[0.06] px-3 py-1.5 text-[12px] font-medium text-gold-300 transition active:scale-[0.98]"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </PullToRefresh>

      {/* Persistent composer — talk to Earn from anywhere on the home screen. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="fx-appnav fixed inset-x-0 z-40 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] flex items-center gap-2 border-t border-line/60 px-3 py-2.5 md:hidden print:hidden"
      >
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            enterKeyHint="send"
            aria-label="Message Earn"
            placeholder="Message Earn…"
            className="w-full rounded-full border border-line bg-surface-0/80 py-2.5 pl-4 pr-4 text-[15px] text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus:ring-2 focus:ring-gold-400/25"
          />
        </div>
        {/* Hands-free path: dictate an ask to Earn while on the move. Renders
            nothing on browsers without the Web Speech API. Final transcripts are
            appended to whatever is already typed. */}
        <MicButton
          onFinal={(text) => setValue((v) => (v ? `${v.trimEnd()} ${text}` : text))}
        />
        <button
          type="submit"
          aria-label="Send to Earn"
          className="fx-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 to-gold-500 text-surface-0 transition active:scale-95"
        >
          <SparkIcon width={19} height={19} />
        </button>
      </form>
    </div>
  );
}
