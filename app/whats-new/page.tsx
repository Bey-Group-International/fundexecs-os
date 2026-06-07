import type { Metadata } from 'next';
import { AccountPageShell } from '@/components/account/AccountPageShell';

export const metadata: Metadata = {
  title: "What's new",
  description: 'Recent shipped highlights in FundExecs OS.'
};

interface ChangelogEntry {
  date: string;
  title: string;
  tag: 'Shipped' | 'Improved' | 'Fixed';
  points: string[];
}

/**
 * Seeded with recent shipped highlights. As real releases land, append entries
 * to the top — this is a live changelog, not a placeholder.
 */
const CHANGELOG: ChangelogEntry[] = [
  {
    date: 'June 2026',
    title: 'Account menu in the side rail',
    tag: 'Shipped',
    points: [
      'The bottom identity row is now a popping account menu — identity, workspace + role switching, settings, integrations, plans, and more.',
      'Switch between every workspace you belong to, with your role shown in each.',
      'New light pages: Gift FundExecs, Get help, What’s new, and Documentation, plus a keyboard-shortcuts overlay.'
    ]
  },
  {
    date: 'June 2026',
    title: 'Intentional side-rail compartments',
    tag: 'Improved',
    points: [
      'The side rail is organized into six collapsible logic areas with auto-expand for your current lifecycle stage.',
      'Rollup badges summarize live signals per compartment so attention routes to what needs you.',
      'A Source-of-Truth fund-profile summary anchors the top of the rail.'
    ]
  },
  {
    date: 'June 2026',
    title: 'Credit Wallet top-ups',
    tag: 'Shipped',
    points: [
      'Buy agent credits directly from the wallet gauge with a real Stripe checkout.',
      'Balances update automatically once payment is confirmed.'
    ]
  },
  {
    date: 'May 2026',
    title: 'Chain of Trust across the desk',
    tag: 'Shipped',
    points: [
      'Material actions now carry a four-layer trust trail: identity, source, execution, and outcome.',
      'Trust toasts surface verification as work happens; the Trust center explains the model.'
    ]
  }
];

const TAG_CLASS: Record<ChangelogEntry['tag'], string> = {
  Shipped: 'border-[var(--success-line)] bg-[var(--success-soft)] text-success',
  Improved: 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
  Fixed: 'border-hairline bg-surface-1 text-fg-3'
};

export default function WhatsNewPage() {
  return (
    <AccountPageShell
      eyebrow="Changelog"
      title="What’s new"
      intro="The desk ships continuously. Here are the most recent highlights — newest first."
    >
      <ol className="relative space-y-8 border-l border-hairline pl-6">
        {CHANGELOG.map((entry) => (
          <li key={entry.title} className="relative">
            <span
              aria-hidden
              className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full border border-[var(--gold-line)] bg-gold-1"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                {entry.date}
              </span>
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${TAG_CLASS[entry.tag]}`}
              >
                {entry.tag}
              </span>
            </div>
            <h2 className="mt-1.5 text-[16px] font-semibold tracking-tight text-fg-1">
              {entry.title}
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-6 text-fg-3">
              {entry.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </AccountPageShell>
  );
}
