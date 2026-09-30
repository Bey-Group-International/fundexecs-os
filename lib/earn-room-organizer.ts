// lib/earn-room-organizer.ts
//
// Earn's proposals for tidying a data room, computed from what the library and
// Earn's document reviews already know. Pure, so the same plan renders on the
// page and in tests.
//
// Every proposal is something the operator applies with one click; none is
// applied for them. Publishing into a room is internal (nothing is visible
// outside until a link is shared), but it is still the operator's room.
import type { DocumentReview, DocumentStatus } from "@/lib/supabase/database.types";

export interface OrganizerDoc {
  id: string;
  name: string;
  section: string;
  status: DocumentStatus;
  /** Has a file, a link, or written content — something a reader can open. */
  hasBody: boolean;
}

export type OrganizerItem =
  | { kind: "publish"; docId: string; name: string; section: string; reason: string }
  | { kind: "refile"; docId: string; name: string; from: string; to: string; reason: string }
  | { kind: "hold"; docId: string; name: string; reason: string };

export function planRoomOrganization(input: {
  library: OrganizerDoc[];
  publishedIds: Set<string>;
  reviews: Pick<DocumentReview, "document_id" | "suggested_section" | "recommendations">[];
  sectionLabel: (key: string) => string;
}): OrganizerItem[] {
  const reviews = new Map(input.reviews.map((r) => [r.document_id, r]));
  const items: OrganizerItem[] = [];

  for (const d of input.library) {
    const review = reviews.get(d.id);
    const blockers = review?.recommendations.filter((r) => r.severity === "blocker").length ?? 0;
    const published = input.publishedIds.has(d.id);

    if (review?.suggested_section && review.suggested_section !== d.section) {
      items.push({
        kind: "refile",
        docId: d.id,
        name: d.name,
        from: d.section,
        to: review.suggested_section,
        reason: `Earn read it as ${input.sectionLabel(review.suggested_section)}, not ${input.sectionLabel(d.section)}.`,
      });
    }

    if (published && (d.status !== "ready" || blockers > 0)) {
      items.push({
        kind: "hold",
        docId: d.id,
        name: d.name,
        reason:
          blockers > 0
            ? `Published with ${blockers} item${blockers > 1 ? "s" : ""} Earn says to fix first.`
            : `Published while still marked ${d.status}.`,
      });
    } else if (!published && d.status === "ready" && d.hasBody && blockers === 0) {
      items.push({
        kind: "publish",
        docId: d.id,
        name: d.name,
        section: d.section,
        reason: `Accepted as complete but not in this room yet.`,
      });
    }
  }

  const order = { hold: 0, refile: 1, publish: 2 } as const;
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}
