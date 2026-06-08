import type { Metadata } from 'next';
import { Gift, Sparkles, Users } from 'lucide-react';
import { AccountPageShell } from '@/components/account/AccountPageShell';
import { GiftStudio } from './GiftStudio';

export const metadata: Metadata = {
  title: 'Gift FundExecs',
  description: 'Send Earn credits to another fund manager, or share your invite link.'
};

const PERKS = [
  {
    icon: Sparkles,
    title: 'A real working desk',
    body: 'They get the same operating surface you use — Chain of Trust plus 15 agents, not a demo.'
  },
  {
    icon: Users,
    title: 'Built for emerging managers',
    body: 'Pipeline, diligence, IC memos, LP room, and capital stack in one place.'
  },
  {
    icon: Gift,
    title: 'Good for both of you',
    body: 'Referrals help us prioritize the roadmap — and keep the desk built by operators, for operators.'
  }
];

export default function GiftPage() {
  return (
    <AccountPageShell
      eyebrow="Give the desk"
      title="Gift FundExecs"
      intro="Send another fund manager Earn credits — fuel for their AI Chief Operating Officer — with a personal note. Or share your invite link. Either way, you're handing them a real working desk."
    >
      <div className="space-y-10">
        <GiftStudio />

        <section>
          <h2 className="text-[15px] font-semibold tracking-tight text-fg-1">
            What they&apos;ll get
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {PERKS.map((perk) => {
              const Icon = perk.icon;
              return (
                <div
                  key={perk.title}
                  className="rounded-2xl border border-hairline bg-surface-1 p-4"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
                    <Icon size={16} strokeWidth={1.9} aria-hidden />
                  </span>
                  <h3 className="mt-3 text-[13.5px] font-semibold text-fg-1">{perk.title}</h3>
                  <p className="mt-1 text-[12.5px] leading-6 text-fg-3">{perk.body}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AccountPageShell>
  );
}
