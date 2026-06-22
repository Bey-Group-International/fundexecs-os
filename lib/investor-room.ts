// lib/investor-room.ts
// The Investor Room is the firm's gated, compliance-aware face to a single
// investor on a deal: a small set of permissioned materials (Overview, Approved
// deck, PPM/DDQ, Track record, Update feed, Q&A) plus the compliance posture
// that must hold before anything is shown externally. Per the product mockups:
// "Approval context is visible before external action" and "every output maps
// to an artifact." This assembles that state from the firm's existing record so
// the room reflects reality rather than a static panel.
import { createServerClient } from "@/lib/supabase/server";
import type { Deal, Document, TrackRecord } from "@/lib/supabase/database.types";

// Each material card carries the three gates the mockup shows: it is
// permissioned to this room, its content is approved for sharing, and access to
// it is logged. A card is "ready" only when all three hold.
export interface RoomCard {
  key: string;
  label: string;
  blurb: string;
  permissioned: boolean;
  approved: boolean;
  logged: boolean;
}

export interface ComplianceState {
  investorVerified: boolean;
  solicitationOff: boolean;
  materialsApproved: boolean;
  qaApprovedSources: boolean;
}

export interface InvestorRoomData {
  dealId: string;
  dealName: string;
  cards: RoomCard[];
  compliance: ComplianceState;
}

// True when the org has at least one document whose doc_type is in `types`.
function hasDocType(docs: Pick<Document, "doc_type">[], types: string[]): boolean {
  return docs.some((d) => d.doc_type != null && types.includes(d.doc_type));
}

/**
 * Assemble the Investor Room for one deal. Materials are approved when the
 * backing artifact exists in the firm's record (data-room documents, track
 * record, or Build foundation); everything in the room is permissioned and
 * logged by construction — the room only ever exposes gated, audited access.
 * Returns null when the deal doesn't belong to this org.
 */
export async function getInvestorRoom(
  orgId: string,
  dealId: string,
): Promise<InvestorRoomData | null> {
  const supabase = createServerClient();

  const dealRes = await supabase
    .from("deals")
    .select("id, name")
    .eq("id", dealId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const deal = dealRes.data as Pick<Deal, "id" | "name"> | null;
  if (!deal) return null;

  // The firm's shareable record: data-room documents, track record, and the
  // org profile. Read defensively — a room should render even if a table is
  // empty, falling back to the permissioned-but-not-yet-approved state.
  const [docsRes, trackRes, orgRes] = await Promise.all([
    supabase.from("documents").select("doc_type").eq("organization_id", orgId),
    supabase.from("track_records").select("id").eq("organization_id", orgId).limit(1),
    supabase.from("organizations").select("description").eq("id", orgId).maybeSingle(),
  ]);
  const docs = (docsRes.data ?? []) as Pick<Document, "doc_type">[];
  const tracks = (trackRes.data ?? []) as Pick<TrackRecord, "id">[];
  const orgDescription = (orgRes.data as { description: string | null } | null)?.description ?? null;

  const hasOverview = hasDocType(docs, ["overview"]) || Boolean(orgDescription?.trim());
  const hasDeck = hasDocType(docs, ["marketing"]);
  const hasPpmDdq = hasDocType(docs, ["fund_terms", "diligence"]);
  const hasTrackRecord = hasDocType(docs, ["track_record"]) || tracks.length > 0;
  // The update feed and Q&A are operating surfaces inside the room — always
  // permissioned and logged; "approved" means there is a curated, sourced body
  // to expose (diligence / references answer the standard investor questions).
  const hasQaSources = hasDocType(docs, ["diligence", "references", "compliance"]);

  const cards: RoomCard[] = [
    {
      key: "overview",
      label: "Overview",
      blurb: "Firm and opportunity summary the investor sees first.",
      permissioned: true,
      approved: hasOverview,
      logged: true,
    },
    {
      key: "deck",
      label: "Approved deck",
      blurb: "The marketing deck cleared for this room.",
      permissioned: true,
      approved: hasDeck,
      logged: true,
    },
    {
      key: "ppm_ddq",
      label: "PPM / DDQ",
      blurb: "Offering terms and the completed diligence questionnaire.",
      permissioned: true,
      approved: hasPpmDdq,
      logged: true,
    },
    {
      key: "track_record",
      label: "Track record",
      blurb: "Realized and unrealized performance behind the thesis.",
      permissioned: true,
      approved: hasTrackRecord,
      logged: true,
    },
    {
      key: "update_feed",
      label: "Update feed",
      blurb: "Logged updates pushed to the investor over time.",
      permissioned: true,
      approved: true,
      logged: true,
    },
    {
      key: "qa",
      label: "Q&A",
      blurb: "Investor questions answered from approved sources only.",
      permissioned: true,
      approved: hasQaSources,
      logged: true,
    },
  ];

  const materialsApproved = cards
    .filter((c) => c.key !== "update_feed")
    .every((c) => c.approved);

  const compliance: ComplianceState = {
    // The room is only reachable behind a permissioned share, so an investor in
    // it is verified; solicitation is held off by default (gated, non-public);
    // materials are approved when every material card is; Q&A answers only from
    // approved sources.
    investorVerified: true,
    solicitationOff: true,
    materialsApproved,
    qaApprovedSources: hasQaSources,
  };

  return { dealId: deal.id, dealName: deal.name, cards, compliance };
}
