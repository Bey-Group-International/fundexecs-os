import type { Metadata } from 'next';
import { Gift, Sparkles, Users } from 'lucide-react';
import { AccountPageShell } from '@/components/account/AccountPageShell';
import { GiftShareCard } from './GiftShareCard';

export const metadata: Metadata = {
  title: 'Gift FundExecs',
  description: 'Share FundExecs OS with another fund manager.'
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
      eyebrow="Refer a manager"
      title="Gift FundExecs"
      intro="Know another fund manager who's drowning in back-office work? Send them your invite link. Sharing the desk is the fastest way to help us build the right things next."
    >
      <div className="space-y-8">
        <GiftShareCard />

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
