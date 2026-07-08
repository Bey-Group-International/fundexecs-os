import { getCapTable } from "@/lib/cap-table";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EarnAction } from "@/components/execute/ui";
import WaterfallCalculator from "@/components/execute/WaterfallCalculator";
import FundWaterfallTool from "@/components/execute/FundWaterfallTool";
import { listFinancialScenarios } from "@/lib/financial-scenarios";

// Execute › Waterfall: the distribution & carry engine. Seeds an interactive
// scenario from the firm's live paid-in capital and cap table, and puts Fund
// Admin on tap to model a real distribution end to end.
export async function ExecuteWaterfallModule({ orgId }: { orgId: string }) {
  const [t, waterfallScenarios] = await Promise.all([
    getCapTable(orgId),
    listFinancialScenarios("waterfall"),
  ]);

  // Seed: distribute the current NAV (a full realization) by default, falling
  // back to paid-in; paid-in capital is the return-of-capital + pref base.
  const paidIn = t.totalCalled;
  const defaultDistribution = t.totalNav > 0 ? t.totalNav : t.totalCalled;
  const holders = t.holders.map((h) => ({ name: h.name, ownershipPct: h.ownershipPct }));

  return (
    <div>
      <ModuleHeader
        title="Waterfall"
        blurb="Model a distribution end to end — return of capital, preferred return, GP catch-up, and carry."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <EarnAction kind="waterfall_model" label="Model with Earn" />
      </div>
      <WaterfallCalculator paidIn={paidIn} holders={holders} defaultDistribution={defaultDistribution} />
      <FundWaterfallTool saved={waterfallScenarios} />
    </div>
  );
}
