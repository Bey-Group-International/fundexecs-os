import { failure, resource, withApiKey } from "@/lib/api-v1";

// DELETE /api/v1/webhooks/:id — remove a subscription (scope events:subscribe).
// Hard delete: the endpoint stops receiving deliveries immediately and its
// signing secret is gone with the row.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withApiKey(async ({ orgId, supabase }, request) => {
  // Route params aren't threaded through withApiKey; the id is the last path
  // segment and validated here.
  const id = new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!UUID_RE.test(id)) return failure("Invalid endpoint id", 400);

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id)
    .select("id");
  if (error) return failure(error.message, 500);
  if (!data || data.length === 0) return failure("Endpoint not found", 404);

  return resource({ id, deleted: true });
}, "events:subscribe");
