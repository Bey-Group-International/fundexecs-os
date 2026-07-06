// components/run/ContractReviewModule.tsx
// Run › Contract Review — server component that resolves org context and
// best-effort reads the org's `contracts` (id, title) so the operator can label
// a review against a known contract. The contracts table isn't in the codegen
// types (see ClosingLive.tsx, which reads it with an untyped client cast), so
// the read uses a cast client. Every read is best-effort: any failure (no org,
// query error, exception) degrades to an empty list rather than throwing, so the
// panel always renders.
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { ContractReviewPanel } from "@/components/run/ContractReviewPanel";

export interface ContractOption {
  id: string;
  title: string;
}

async function loadContracts(): Promise<ContractOption[]> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return [];
    const supabase = await createServerClient();
    // Untyped client: `contracts` isn't in the generated database types, so cast
    // to an untyped shape for this read exactly as ClosingLive.tsx does.
    const res = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => Promise<{ data: { id: string; title: string }[] | null }>;
          };
        };
      };
    })
      .from("contracts")
      .select("id, title")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false });
    const rows = (res?.data ?? []) as { id: string; title: string }[];
    return rows
      .filter((r) => r && typeof r.id === "string" && typeof r.title === "string")
      .map((r) => ({ id: r.id, title: r.title }));
  } catch {
    // Best-effort: any failure degrades to an empty contract list.
    return [];
  }
}

export async function ContractReviewModule() {
  const contracts = await loadContracts();
  return <ContractReviewPanel contracts={contracts} />;
}
