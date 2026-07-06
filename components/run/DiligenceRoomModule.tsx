"use server";

// Async server component for the Run › Due-diligence data-room agent. Mirrors
// SigningModule: resolve the session, best-effort read the org's deals for a
// picker, and hand off to the client panel. Takes NO props.
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { DiligenceRoomPanel } from "@/components/run/DiligenceRoomPanel";

interface DealOption {
  id: string;
  name: string;
}

export async function DiligenceRoomModule() {
  const ctx = await getSessionContext();

  let deals: DealOption[] = [];
  if (ctx?.orgId) {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase
        .from("deals")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (!error && data) {
        deals = (data as DealOption[]).filter((d) => d && d.id && typeof d.name === "string");
      }
    } catch {
      // Table not available (e.g. unmigrated preview) — render with no picker.
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="max-w-2xl text-sm leading-6 text-fg-secondary">
          Run a multi-lens diligence agent over a deal&apos;s data room. Paste the excerpt and the
          agent returns a structured risk memo across legal, financial, commercial, operational, and
          compliance lenses — with an overall risk gauge and prioritized follow-ups.
        </p>
      </div>
      <DiligenceRoomPanel deals={deals} />
    </div>
  );
}
