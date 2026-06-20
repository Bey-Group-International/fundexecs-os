import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys-verify";
import { createServiceClient } from "@/lib/supabase/server";
import type { Organization } from "@/lib/supabase/database.types";

// GET /api/v1/organization — the authenticated org's public profile.
//
//   curl https://app.fundexecs.com/api/v1/organization \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Authenticated by an issued secret key (see lib/api-keys-verify). The caller has
// no Supabase session, so we read with the service-role client and scope strictly
// to the key's own organization_id. Only non-sensitive profile fields are
// returned — never internal flags or credentials.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", auth.key.orgId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const org = data as Organization;
  return NextResponse.json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    description: org.description,
    website: org.website,
    jurisdiction: org.jurisdiction,
    primary_strategy: org.primary_strategy,
    aum_range: org.aum_range,
    created_at: org.created_at,
  });
}
