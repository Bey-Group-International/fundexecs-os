"use client";

// "Preview as LP", scoped to a link. The question a GP actually asks before
// sending is not "what is in this room?" but "what does *this recipient* get?"
// A link with a section allowlist answers differently from the room as a whole.
// Picking a link here narrows the preview exactly the way the server narrows the
// live room: the same allowlist, applied to the documents and to the firm's
// Build pages alike.
//
// The payload is loaded when the pane is opened, not with the page: it carries
// every published document's text, and most visits to this page never open the
// preview. It is fetched again on each opening, so what shows is current once it
// loads; the previous answer for the same room stays up meanwhile. An answer for
// another room is never shown, and a failed load clears it rather than leaving it.
import { useEffect, useMemo, useRef, useState } from "react";
import { buildPagesAllowedBy, sectionsAllowedBy } from "@/lib/data-rooms";
import {
  DataRoomViewer,
  type ViewerOrg,
  type ViewerTrackRecord,
  type ViewerThesis,
  type ViewerTeamMember,
  type ViewerEntity,
  type ViewerSection,
  type ViewerRoom,
} from "@/components/dataroom/DataRoomViewer";

export interface PreviewShare {
  id: string;
  label: string | null;
  /** null or empty = every published section. */
  allowedSections: string[] | null;
  gates: string[];
}

export interface PreviewPayload {
  org: ViewerOrg;
  blended: ViewerTrackRecord;
  thesis: ViewerThesis | null;
  team: ViewerTeamMember[];
  entities: ViewerEntity[];
  docSections: ViewerSection[];
  room: ViewerRoom;
}

const NO_DEALS: ViewerTrackRecord = {
  dealCount: 0,
  realizedCount: 0,
  weightedGrossIrr: null,
  pooledMoic: null,
  dpi: null,
  totalInvested: null,
  vintageRange: null,
};

type Width = "desktop" | "phone";

interface Props {
  roomId: string;
  shares: PreviewShare[];
  /** The pane is on screen. Loads on becoming active. */
  active: boolean;
  /** Open on this document (from a row in Room contents). */
  focusDocumentId?: string | null;
  /** Counts each request to open on a document, so asking for the same one again reopens it. */
  focusRequest?: number;
  loadPreview: (roomId: string) => Promise<PreviewPayload | null>;
}

export function RoomPreview({ roomId, shares, active, focusDocumentId = null, focusRequest = 0, loadPreview }: Props) {
  const [shareId, setShareId] = useState<string>("");
  const [loaded, setLoaded] = useState<{ roomId: string; payload: PreviewPayload } | null>(null);
  // Only ever this room's own answer.
  const payload = loaded && loaded.roomId === roomId ? loaded.payload : null;
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [width, setWidth] = useState<Width>("desktop");
  const [fullscreen, setFullscreen] = useState(false);
  const request = useRef(0);

  // Fetch whenever the pane becomes active. A late answer to an earlier opening
  // is dropped, so it cannot overwrite a newer one.
  useEffect(() => {
    if (!active) return;
    const mine = ++request.current;
    setStatus("loading");
    loadPreview(roomId).then(
      (result) => {
        if (mine !== request.current) return;
        setLoaded(result ? { roomId, payload: result } : null);
        setStatus(result ? "ready" : "error");
      },
      () => {
        if (mine !== request.current) return;
        setLoaded(null);
        setStatus("error");
      },
    );
  }, [active, roomId, loadPreview]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const share = shares.find((s) => s.id === shareId) ?? null;
  // The same rules the server applies to the live room (lib/data-rooms).
  const pages = buildPagesAllowedBy(share?.allowedSections);
  const scoped = useMemo(
    () => (payload ? sectionsAllowedBy(share?.allowedSections, payload.docSections) : []),
    [payload, share],
  );
  const hiddenCount = payload ? payload.docSections.length - scoped.length : 0;

  const shell = fullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-surface-0"
    : "flex h-full flex-col";

  return (
    <div className={shell}>
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
              {s.allowedSections === null
                ? " · full room"
                : ` · ${s.allowedSections.length} section${s.allowedSections.length === 1 ? "" : "s"}`}
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

        <div className="ml-auto flex items-center gap-2">
          <div role="group" aria-label="Preview width" className="flex overflow-hidden rounded-md border border-line">
            {(["desktop", "phone"] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={width === w}
                onClick={() => setWidth(w)}
                className={`px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${
                  width === w ? "bg-surface-0 text-fg-primary" : "text-fg-muted hover:text-fg-primary"
                }`}
              >
                {w === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((v) => !v)}
            className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
          >
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {/* The viewer itself, in preview mode: inert links, no dwell tracking. */}
      <div className="flex min-h-0 flex-1 justify-center bg-surface-0">
        <div
          className={`min-h-0 w-full ${
            width === "phone" ? "max-w-[390px] border-x border-line" : ""
          }`}
          data-preview-width={width}
        >
          {payload ? (
            <DataRoomViewer
              // A new focus (a row clicked in Room contents) reopens the viewer on it.
              key={`${focusDocumentId ?? "room"}:${focusRequest}`}
              compact={width === "phone"}
              token="preview"
              shareId="preview"
              org={payload.org}
              blended={pages.trackRecord ? payload.blended : NO_DEALS}
              thesis={pages.thesis ? payload.thesis : null}
              team={pages.team ? payload.team : []}
              entities={pages.structure ? payload.entities : []}
              docSections={scoped}
              room={payload.room}
              focusDocumentId={focusDocumentId}
              gateConfig={{
                requireEmail: false,
                requireNda: false,
                ndaText: null,
                passwordProtected: false,
              }}
              contentReady
              preview
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p role="status" className="text-sm text-fg-muted">
                {status === "error" ? "Preview unavailable." : "Loading the preview…"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
