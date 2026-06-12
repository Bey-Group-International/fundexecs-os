import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WalletView } from '@/components/settings/WalletView';
import { getWalletSummary } from '@/lib/credits/wallet-summary';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Wallet',
  description: 'Your credit balance, this month’s usage, and how to earn or top up.'
};

/**
 * /settings/wallet — the "where am I on usage?" surface. Balance + this-month
 * spend (getWalletSummary) and the recent ledger (getCreditWallet) over the
 * member-read `credit_wallets` / `credit_transactions`. The three paths to more
 * (earn / top up / upgrade) live in the client view.
 */
export default async function WalletPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [summary, wallet] = await Promise.all([
    getWalletSummary(org.orgId),
    getCreditWallet(org.orgId)
  ]);

  return (
    <div className="fx-rise mx-auto max-w-[860px]">
      <WalletView
        balance={summary.balance}
        plan={summary.plan}
        monthlyGrant={summary.monthlyGrant}
        usedThisMonth={summary.usedThisMonth}
        isLow={summary.isLow}
        isEmpty={summary.isEmpty}
        ledger={wallet.recentConsumption.map((c) => ({
          id: c.id,
          reason: c.reason,
          delta: c.delta,
          at: c.at
        }))}
      />
    </div>
  );
}
