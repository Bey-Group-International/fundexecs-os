import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { listLinkedAccounts } from "@/lib/treasury/linked-accounts";
import { listTransfers } from "@/lib/treasury/transfers";
import { stripeConfigured, stripePublishableKeyValue } from "@/lib/stripe";
import { TreasuryPanel } from "../TreasuryPanel";

export const dynamic = "force-dynamic";

// Treasury — linked bank accounts and ACH transfers. Split out of the wallet so
// the wallet stays focused on credits and plans; reachable from the account menu.
export default async function WalletTreasuryPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const live = stripeConfigured();
  const publishableKey = stripePublishableKeyValue();

  const supabase = await createServerClient();
  const [linkedAccounts, treasuryTransfers] = await Promise.all([
    listLinkedAccounts(supabase, ctx.orgId),
    listTransfers(supabase, ctx.orgId),
  ]);

  return (
    <div className="fx-neural-ambient mx-auto max-w-5xl">
      <div className="mb-2">
        <Link
          href="/wallet"
          className="font-mono text-[11px] uppercase tracking-[0.28em] text-fg-muted transition hover:text-gold-300"
        >
          ← Wallet
        </Link>
      </div>

      <TreasuryPanel
        accounts={linkedAccounts}
        transfers={treasuryTransfers}
        publishableKey={publishableKey}
        stripeLive={live}
      />
    </div>
  );
}
