import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys";

// GET /api/v1/whoami — the reference endpoint that proves the issued-key
// verifier works end-to-end. Authenticate with an issued secret key, e.g.:
//
//   curl https://app.fundexecs.com/api/v1/whoami \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Returns the org the key belongs to and the key's mode. New external API
// routes follow this same requireApiKey gate.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({
    organization_id: auth.key.orgId,
    mode: auth.key.mode,
    key_id: auth.key.keyId,
  });
}
