"use client";

// "Preview as LP", scoped to a link. The question a GP actually asks before
// sending is not "what is in this room?" but "what does *this recipient* get?"
// — and a link with a section allowlist answers differently from the room as a
// whole. Picking a link here narrows the preview exactly the way the server
// narrows the live room, because both apply the same allowlist to the same
// payload.
import { useMemo, useState } from "react";
import { sectionsAllowedBy } from "@/lib/data-rooms";
import {
  DataRoomViewer,
  type ViewerOrg,
  type ViewerTrackRecord,
  type ViewerThesis,
  type ViewerTeamMember,
  type ViewerEntity,
  type ViewerSection,
} from "@/components/dataroom/DataRoomViewer";

export interface PreviewShare {
  id: string;
  label: string | null;
  /** null or empty = every published section. */
  allowedSections: string[] | null;
  gates: string[];
}

interface Props {
  org: ViewerOrg;
  blended: ViewerTrackRecord;
  thesis: ViewerThesis | null;
  team: ViewerTeamMember[];
  entities: ViewerEntity[];
  docSections: ViewerSection[];
  shares: PreviewShare[];
}

export function RoomPreview({
  org,
  blended,
  thesis,
  team,
  entities,
  docSections,
  shares,
}: Props) {
  const [shareId, setShareId] = useState<string>("");

  const share = shares.find((s) => s.id === shareId) ?? null;

  // Same rule the server applies to the live room (lib/data-rooms).
  const scoped = useMemo(
    () => sectionsAllowedBy(share?.allowedSections, docSections),
    [docSections, share],
  );

  const hiddenCount = docSections.length - scoped.length;

  return (
    <div className="flex h-full flex-col">
      {/* Scope bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
        <label
          htmlFor="preview-scope"
          className="font-mono text-[11px] uppercase tracking-wider text-fg-muted"
        >
          Viewing as
        </label>
        <select
          id="preview-scope"
          value={shareId}
          onChange={(e) => setShareId(e.target.value)}
          className="min-w-0 max-w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
        >
          <option value="">Anyone with full access</option>
          {shares.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label || "Untitled link"}
              {s.allowedSections && s.allowedSections.length > 0
                ? ` · ${s.allowedSections.length} section${s.allowedSections.length > 1 ? "s" : ""}`
                : " · full room"}
            </option>
          ))}
        </select>

        {hiddenCount > 0 ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-amber-400">
            {hiddenCount} section{hiddenCount > 1 ? "s" : ""} hidden from this link
          </span>
        ) : null}

        {share && share.gates.length > 0 ? (
          <span
            title="This link asks for these before showing anything. The preview skips them."
            className="font-mono text-[11px] uppercase tracking-wider text-fg-muted"
          >
            Gates: {share.gates.join(" · ")}
          </span>
        ) : null}
      </div>

      {/* The viewer itself, in preview mode: inert links, no dwell tracking. */}
      <div className="min-h-0 flex-1">
        <DataRoomViewer
          token="preview"
          shareId="preview"
          org={org}
          blended={blended}
          thesis={thesis}
          team={team}
          entities={entities}
          docSections={scoped}
          gateConfig={{
            requireEmail: false,
            requireNda: false,
            ndaText: null,
            passwordProtected: false,
          }}
          contentReady
          preview
        />
      </div>
    </div>
  );
}
