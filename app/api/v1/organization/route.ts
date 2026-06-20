import { failure, resource, withApiKey } from "@/lib/api-v1";
import type { Organization } from "@/lib/supabase/database.types";

// GET /api/v1/organization — the authenticated org's public profile.
//
//   curl https://app.fundexecs.com/api/v1/organization \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Reads with the service-role client scoped strictly to the key's organization_id.
// Only non-sensitive profile fields are returned — never internal flags.
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ orgId, supabase }) => {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();

  if (error) return failure(error.message, 500);
  if (!data) return failure("Organization not found", 404);

  const org = data as Organization;
  return resource({
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
});
