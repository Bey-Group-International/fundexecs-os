import { NextResponse } from "next/server";

// GET /api/v1 — a public, self-describing index of the FundExecs OS API.
// Unauthenticated on purpose: it documents how to authenticate and what's
// available, so a developer with a freshly minted key knows where to point it.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    name: "FundExecs OS API",
    version: "v1",
    authentication:
      "Send your secret key as `Authorization: Bearer fxsk_…` or the `x-api-key` header. Manage keys under Settings → API keys.",
    endpoints: [
      { method: "GET", path: "/api/v1/whoami", description: "Identity of the presented key" },
      { method: "GET", path: "/api/v1/organization", description: "Your organization profile" },
      { method: "GET", path: "/api/v1/funds", description: "Your funds" },
      { method: "GET", path: "/api/v1/deals", description: "Your deal pipeline" },
      { method: "GET", path: "/api/v1/investors", description: "Your investor records" },
    ],
  });
}
