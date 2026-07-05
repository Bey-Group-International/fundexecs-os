// app/(app)/dashboard/ProactiveSection.tsx
// Server component that loads the proactive feed for the Command Center: the
// surfaced items plus each one's pre-run draft content, so the operator sees
// finished decisions inline. Renders nothing when Earn has nothing to propose
// (restraint is the feature). Best-effort — a load failure never breaks the
// dashboard.

import { createServerClient } from "@/lib/supabase/server";
import { listSurfacedItems } from "@/lib/proactive/items";
import { ProactiveInitiative, type ProactiveItemView } from "@/components/dashboard/ProactiveInitiative";

export async function ProactiveSection({ orgId }: { orgId: string }) {
  let items;
  try {
    const supabase = await createServerClient();
    const surfaced = await listSurfacedItems(supabase, orgId);
    if (surfaced.length === 0) return null;

    // Fetch the pre-run draft content for the items that have one.
    const draftIds = surfaced.map((i) => i.draftArtifactId).filter((x): x is string => Boolean(x));
    const draftById = new Map<string, string>();
    if (draftIds.length) {
      const { data } = await supabase
        .from("artifacts")
        .select("id, content")
        .eq("organization_id", orgId)
        .in("id", draftIds);
      for (const a of (data ?? []) as Array<{ id: string; content: string | null }>) {
        if (a.content) draftById.set(a.id, a.content);
      }
    }

    items = surfaced.map<ProactiveItemView>((i) => ({
      ...i,
      draft: i.draftArtifactId ? draftById.get(i.draftArtifactId) ?? null : null,
    }));
  } catch {
    return null;
  }

  return <ProactiveInitiative items={items} />;
}
