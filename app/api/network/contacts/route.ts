// POST /api/network/contacts — add a single professional contact through the
// professional-network adapter pipeline (manual entry or LinkedIn profile URL).
//
// Unlike the bulk CSV route (/api/network/import — the fallback path), this is
// the primary per-contact flow: adapter → normalize → dedupe → score → insert
// → relationship edge. High-confidence duplicates return 409 with the matches
// so the UI can ask the user to merge or force-add.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  fromLinkedInUrl,
  fromManualEntry,
  type CapitalRole,
} from "@/lib/integrations/professional-network";
import { addProfessionalContact } from "@/lib/integrations/professional-network/pipeline.server";

export const dynamic = "force-dynamic";

type Payload = {
  mode: "manual" | "linkedin_url";
  fullName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  title?: string;
  company?: string;
  location?: string;
  capitalRole?: CapitalRole;
  tags?: string[];
  notes?: string;
  /** User confirmed "add anyway" after seeing duplicate matches. */
  force?: boolean;
};

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-add-contact`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Payload | null;
  if (!payload || (payload.mode !== "manual" && payload.mode !== "linkedin_url")) {
    return NextResponse.json(
      { error: "Required: mode ('manual' | 'linkedin_url') plus contact fields." },
      { status: 400 },
    );
  }

  const adapted =
    payload.mode === "linkedin_url"
      ? fromLinkedInUrl({
          linkedinUrl: payload.linkedinUrl ?? "",
          fullName: payload.fullName,
          title: payload.title,
          company: payload.company,
          capitalRole: payload.capitalRole,
          tags: payload.tags,
          notes: payload.notes,
        })
      : fromManualEntry({
          fullName: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          linkedinUrl: payload.linkedinUrl,
          title: payload.title,
          company: payload.company,
          location: payload.location,
          capitalRole: payload.capitalRole,
          tags: payload.tags,
          notes: payload.notes,
        });

  if ("error" in adapted) {
    return NextResponse.json({ error: adapted.error }, { status: 400 });
  }
  if (payload.mode === "linkedin_url" && !adapted.linkedin_url) {
    return NextResponse.json(
      { error: "That doesn't look like a LinkedIn profile URL (expected linkedin.com/in/…)." },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const result = await addProfessionalContact(supabase, {
    orgId: auth.ctx.orgId,
    userId: auth.ctx.userId,
    profile: adapted,
    force: payload.force === true,
  });

  if (!result.ok && result.needsReview) {
    // Duplicate review: the client shows matches and may retry with force.
    return NextResponse.json({ needsReview: true, duplicates: result.duplicates }, { status: 409 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    contactId: result.contactId,
    duplicates: result.duplicates,
    profile: {
      fullName: `${adapted.first_name} ${adapted.last_name}`.trim(),
      capitalRole: adapted.capital_role,
      confidence: adapted.confidence,
      source: adapted.source,
    },
  });
}
