import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { getCapitalRailProvider } from "@/lib/providers";
import type { CapitalRailType } from "@/lib/providers";
import { requireOrgAdmin } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RAIL_TYPES: readonly CapitalRailType[] = ["ach", "wire", "card", "internal"];

interface TransferBody {
  capitalEventId?: unknown;
  amountUsd?: unknown;
  railType?: unknown;
  fromAccountRef?: unknown;
  toAccountRef?: unknown;
  memo?: unknown;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

/**
 * Initiate a capital transfer for one of the caller's own capital events.
 *
 * This moves money (Stripe Treasury / Connect when configured), so it is
 * limited to org owners and admins, the organization comes from the session
 * and never from the body, and the capital event must belong to that
 * organization and be at least as large as the transfer.
 */
export async function POST(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = requireOrgAdmin(auth.ctx.role);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  let body: TransferBody;
  try {
    body = (await req.json()) as TransferBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { capitalEventId, amountUsd, railType } = body;
  if (
    typeof capitalEventId !== "string" ||
    !capitalEventId ||
    typeof amountUsd !== "number" ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    typeof railType !== "string" ||
    !RAIL_TYPES.includes(railType as CapitalRailType)
  ) {
    return NextResponse.json(
      {
        error:
          "capitalEventId, a positive amountUsd, and a railType of ach, wire, card or internal are required",
      },
      { status: 400 },
    );
  }

  // The event must be this organization's. The user-scoped client is used on
  // purpose so row-level security applies as well as the explicit filter.
  const supabase = await createServerClient();
  const { data: event, error: eventError } = await supabase
    .from("capital_events")
    .select("id, amount")
    .eq("id", capitalEventId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  if (eventError) {
    console.error("[/api/capital/transfer] event lookup failed", eventError.message);
    return NextResponse.json({ error: "Could not verify the capital event" }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: "Capital event not found" }, { status: 404 });
  }
  if (amountUsd > Number(event.amount)) {
    return NextResponse.json(
      { error: "Transfer amount exceeds the capital event amount" },
      { status: 400 },
    );
  }

  try {
    const provider = getCapitalRailProvider();
    const result = await provider.initiate({
      orgId: auth.ctx.orgId,
      capitalEventId,
      amountUsd,
      railType: railType as CapitalRailType,
      fromAccountRef: text(body.fromAccountRef, 200) ?? "",
      toAccountRef: text(body.toAccountRef, 200) ?? "",
      memo: text(body.memo, 500),
      requestedBy: auth.ctx.userId,
    });

    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/capital/transfer]", err);
    return NextResponse.json({ error: "Transfer could not be initiated" }, { status: 500 });
  }
}
