// components/run/DocumentsModuleLive.tsx
// Server component — loads contracts, investors, and funds for the Documents module.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { DocumentsModule } from "@/components/run/DocumentsModule";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import type { ContractStatus, DocumentType } from "@/lib/contracts";

export async function DocumentsModuleLive() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return null;
    const supabase = await createServerClient();
    const orgId = auth.ctx.orgId;

    const [contractsResult, investorsResult, fundsResult] = await Promise.all([
      supabase
        .from("contracts")
        .select("id, title, document_type, status, investor_id, created_at, expiry_date")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("investors")
        .select("id, name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true })
        .limit(200),
      supabase
        .from("funds")
        .select("id, name")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

    // Build investor name lookup
    const investorNames = new Map<string, string>(
      (investorsResult.data ?? []).map((r) => [r.id, r.name as string]),
    );

    const contracts = (contractsResult.data ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      documentType: r.document_type as DocumentType,
      status: r.status as ContractStatus,
      investorName: r.investor_id ? (investorNames.get(r.investor_id as string) ?? null) : null,
      createdAt: r.created_at as string,
      expiryDate: r.expiry_date as string | null,
    }));

    const investors = (investorsResult.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
    }));

    const funds = (fundsResult.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
    }));

    return (
      <div>
        <ModuleHeader
          title="Documents"
          blurb="Generate and track subscription agreements, side letters, NDAs, and other fund documents through draft → signature → active."
        />
        <DocumentsModule
          contracts={contracts}
          investors={investors}
          funds={funds}
        />
      </div>
    );
  } catch {
    return null;
  }
}
