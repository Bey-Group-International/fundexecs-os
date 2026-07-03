import { resource, withApiKey } from "@/lib/api-v1";

// GET /api/v1/whoami — identity of the presented key. The reference endpoint
// that proves the issued-key verifier works end-to-end:
//
//   curl https://app.fundexecs.com/api/v1/whoami \
//     -H "Authorization: Bearer fxsk_live_…"
export const dynamic = "force-dynamic";

// Deliberately unscoped: any valid key may introspect itself — the returned
// scope list is how a consumer discovers what its key can reach.
export const GET = withApiKey(async ({ orgId, mode, keyId, scopes }) =>
  resource({ organization_id: orgId, mode, key_id: keyId, scopes }),
);
