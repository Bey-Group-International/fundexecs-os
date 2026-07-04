"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";

// Build › Entity: hand an equity-issuance scenario from the interactive
// calculators (vesting, SAFE/note conversion, ASC 718) to the agent team. Each
// kind seeds an Earn session whose prompt invokes the right role on the scenario
// the operator just modeled — so the calculators don't just compute, the agents
// turn them into a board-, cap-table-, or audit-ready work product. Mirrors the
// Execute-hub "Run with Earn" launchers; no persistence of its own.
const EQUITY_TASKS: Record<string, string> = {
  vesting:
    "Acting as Counsel working with Fund Admin: build and sanity-check this equity vesting schedule — confirm the cliff and accrual cadence, lay out the tranche-by-tranche vesting table through full vest, note the next vesting events, and flag anything that needs board approval or an 83(b) election consideration.",
  convertible:
    "Acting as Counsel working with Fund Admin: model this SAFE / convertible-note conversion into the priced round — confirm whether the cap or the discount governs the conversion price, the shares issued and resulting ownership, accrued interest if a note, and produce a clean conversion summary for the cap table and the investor.",
  stock_comp:
    "Acting as the Analyst working with the Controller: compute the ASC 718 stock-based compensation expense for this grant — total grant-date fair value, the straight-line recognition schedule by period, expense recognized to date and the unrecognized remainder, and a disclosure-ready summary.",
};

export async function runEquityWithEarn(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const kind = String(formData.get("kind") ?? "");
  let prompt = EQUITY_TASKS[kind];
  if (!prompt) redirect("/workspace");

  // The scenario the operator modeled in the calculator, carried as context so
  // the agent works the exact numbers on screen.
  const scenario = String(formData.get("scenario") ?? "").trim();
  if (scenario) prompt += `\n\nScenario to work:\n${scenario}`;

  const supabase = await createServerClient();
  const result = await handlePrompt(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    prompt,
  );
  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}
