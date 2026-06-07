import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, LifeBuoy, Mail, MessageSquare, Shield } from 'lucide-react';
import { AccountPageShell } from '@/components/account/AccountPageShell';

export const metadata: Metadata = {
  title: 'Get help',
  description: 'Support contact, FAQs, and resources for FundExecs OS.'
};

const SUPPORT_EMAIL = 'support@fundexecs.com';

const FAQS = [
  {
    q: 'How do I switch workspaces?',
    a: 'Open the account menu at the bottom of the side rail and pick a workspace under "Workspaces & roles". You can only switch to organizations you are an active member of.'
  },
  {
    q: 'Who can see the Admin section?',
    a: 'Admin lives inside Settings and is visible only to organization owners and admins. It covers members & roles, the audit log, and magic-link beta invites.'
  },
  {
    q: 'How do credits and the Credit Wallet work?',
    a: 'Agent runs draw from your organization’s Credit Wallet. Top up from the wallet gauge in the top bar or from Settings → Billing. Balances are scoped per organization.'
  },
  {
    q: 'What is the Chain of Trust?',
    a: 'Every material action carries a verifiable trust trail across four layers — identity, source, execution, and outcome — so the work the desk does is auditable rather than opaque.'
  },
  {
    q: 'Is FundExecs OS generally available?',
    a: 'FundExecs OS is an invite-only private beta. Features change quickly; the "What’s new" page tracks recent shipped highlights.'
  }
];

export default function HelpPage() {
  return (
    <AccountPageShell
      eyebrow="Support"
      title="Get help"
      intro="We’re a small team building the operating desk for emerging managers. Reach a human directly, or skim the answers below."
    >
      <div className="space-y-10">
        {/* Contact channels */}
        <section className="grid gap-3 sm:grid-cols-3">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rounded-2xl border border-hairline bg-surface-1 p-4 transition hover:bg-surface-2"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-bg-1 text-azure-1">
              <Mail size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <h2 className="mt-3 text-[13.5px] font-semibold text-fg-1">Email support</h2>
            <p className="mt-1 text-[12.5px] leading-6 text-fg-3">{SUPPORT_EMAIL}</p>
          </a>

          <Link
            href="/docs"
            className="rounded-2xl border border-hairline bg-surface-1 p-4 transition hover:bg-surface-2"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-bg-1 text-azure-1">
              <BookOpen size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <h2 className="mt-3 text-[13.5px] font-semibold text-fg-1">Documentation</h2>
            <p className="mt-1 text-[12.5px] leading-6 text-fg-3">
              The desk, Chain of Trust, and the 15 agents.
            </p>
          </Link>

          <Link
            href="/trust"
            className="rounded-2xl border border-hairline bg-surface-1 p-4 transition hover:bg-surface-2"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-bg-1 text-azure-1">
              <Shield size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <h2 className="mt-3 text-[13.5px] font-semibold text-fg-1">Trust center</h2>
            <p className="mt-1 text-[12.5px] leading-6 text-fg-3">
              How the Chain of Trust verifies your work.
            </p>
          </Link>
        </section>

        {/* FAQs */}
        <section>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} strokeWidth={1.9} aria-hidden className="text-fg-4" />
            <h2 className="text-[15px] font-semibold tracking-tight text-fg-1">Frequently asked</h2>
          </div>
          <div className="mt-4 divide-y divide-hairline rounded-2xl border border-hairline bg-surface-1">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13.5px] font-medium text-fg-1">
                  {faq.q}
                  <span aria-hidden className="text-fg-4 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-[12.5px] leading-6 text-fg-3">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-1 p-4">
          <LifeBuoy size={18} strokeWidth={1.9} aria-hidden className="flex-none text-gold-1" />
          <p className="text-[12.5px] leading-6 text-fg-3">
            Still stuck? Email{' '}
            <a className="text-azure-1 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{' '}
            with your workspace name and a screenshot — we usually reply same day during the beta.
          </p>
        </section>
      </div>
    </AccountPageShell>
  );
}
