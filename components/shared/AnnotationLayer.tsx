"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Annotation, EntityType } from "@/lib/annotations";

interface Props {
  entityType: EntityType;
  entityId: string;
  orgId: string;
  children: React.ReactNode;
}

interface Popover {
  kind: "new";
  x_pct: number;
  y_pct: number;
} | {
  kind: "thread";
  annotationId: string;
};

function pin(a: Annotation) {
  const colors: Record<string, string> = {
    document: "var(--gold-400)",
    envelope: "var(--status-info)",
    deal: "var(--status-success)",
    artifact: "var(--gold-300)",
    session: "var(--fg-secondary)",
  };
  return colors[a.entity_type] ?? "var(--gold-400)";
}

export function AnnotationLayer({ entityType, entityId, orgId, children }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [newText, setNewText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  async function load() {
    const res = await fetch(`/api/annotations?entityType=${entityType}&entityId=${entityId}`);
    if (res.ok) setAnnotations(await res.json());
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`annotations:${entityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "annotations", filter: `entity_id=eq.${entityId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [entityId]);

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-annotation-pin]") || target.closest("[data-annotation-popover]")) return;
    setPopover(null);
    const rect = containerRef.current.getBoundingClientRect();
    const x_pct = ((e.clientX - rect.left) / rect.width) * 100;
    const y_pct = ((e.clientY - rect.top) / rect.height) * 100;
    setNewText("");
    setPopover({ kind: "new", x_pct, y_pct });
  }

  async function submitNew(x_pct: number, y_pct: number) {
    if (!newText.trim()) return;
    await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, entityType, entityId, content: newText.trim(), positionJson: { x_pct, y_pct } }),
    });
    setNewText("");
    setPopover(null);
    load();
  }

  async function submitReply(parentId: string) {
    if (!replyText.trim()) return;
    await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, entityType, entityId, content: replyText.trim(), parentId }),
    });
    setReplyText("");
    load();
  }

  async function resolve(id: string) {
    await fetch(`/api/annotations/${id}/resolve`, { method: "PATCH" });
    load();
  }

  const roots = annotations.filter(a => !a.parent_id);
  const replies = (parentId: string) => annotations.filter(a => a.parent_id === parentId);

  const threadAnnotation = popover?.kind === "thread"
    ? annotations.find(a => a.id === popover.annotationId)
    : null;

  return (
    <div style={{ position: "relative", display: "contents" }}>
      {/* sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(o => !o)}
        style={{
          position: "fixed", right: sidebarOpen ? 320 : 0, top: "50%", transform: "translateY(-50%)",
          zIndex: 50, background: "var(--surface-2)", border: "1px solid var(--line)",
          borderRadius: "6px 0 0 6px", padding: "8px 4px", cursor: "pointer", color: "var(--fg-primary)",
          fontSize: 12, writingMode: "vertical-rl",
        }}
      >
        {annotations.length} notes
      </button>

      {/* sidebar */}
      {sidebarOpen && (
        <div style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: 320, zIndex: 40,
          background: "var(--surface-1)", borderLeft: "1px solid var(--line)",
          overflowY: "auto", padding: 16,
        }}>
          <div style={{ fontWeight: 600, color: "var(--fg-primary)", marginBottom: 12 }}>Annotations</div>
          {roots.length === 0 && <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>No annotations yet. Click anywhere on the document to add one.</div>}
          {roots.map(a => (
            <div key={a.id} style={{ marginBottom: 12, background: "var(--surface-2)", borderRadius: 8, padding: 10, border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 13, color: "var(--fg-primary)", marginBottom: 6 }}>{a.content}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setPopover({ kind: "thread", annotationId: a.id }); setSidebarOpen(false); }}
                  style={{ fontSize: 11, color: "var(--gold-400)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  {replies(a.id).length} repl{replies(a.id).length === 1 ? "y" : "ies"}
                </button>
                {!a.resolved && (
                  <button onClick={() => resolve(a.id)}
                    style={{ fontSize: 11, color: "var(--fg-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* clickable overlay + children */}
      <div ref={containerRef} onClick={handleContainerClick} style={{ position: "relative" }}>
        {children}

        {/* annotation pins */}
        {roots.filter(a => a.position_json?.x_pct != null).map((a, i) => (
          <button
            key={a.id}
            data-annotation-pin
            onClick={e => { e.stopPropagation(); setPopover({ kind: "thread", annotationId: a.id }); }}
            style={{
              position: "absolute",
              left: `${a.position_json!.x_pct}%`,
              top: `${a.position_json!.y_pct}%`,
              transform: "translate(-50%, -50%)",
              width: 22, height: 22, borderRadius: "50%",
              background: pin(a), border: "2px solid var(--surface-0)",
              color: "#000", fontSize: 10, fontWeight: 700,
              cursor: "pointer", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {i + 1}
          </button>
        ))}

        {/* new annotation popover */}
        {popover?.kind === "new" && (
          <div
            data-annotation-popover
            onClick={e => e.stopPropagation()}
            style={{
              position: "absolute",
              left: `${popover.x_pct}%`,
              top: `${popover.y_pct}%`,
              zIndex: 20, width: 240,
              background: "var(--surface-1)", border: "1px solid var(--line)",
              borderRadius: 8, padding: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-primary)", marginBottom: 8 }}>New annotation</div>
            <textarea
              autoFocus
              value={newText}
              onChange={e => setNewText(e.target.value)}
              rows={3}
              style={{
                width: "100%", background: "var(--surface-2)", border: "1px solid var(--line)",
                borderRadius: 6, color: "var(--fg-primary)", fontSize: 13, padding: "6px 8px",
                resize: "none", outline: "none", boxSizing: "border-box",
              }}
              placeholder="Add a note…"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                onClick={() => submitNew(popover.x_pct, popover.y_pct)}
                style={{ flex: 1, background: "var(--gold-400)", border: "none", borderRadius: 6, color: "#000", fontWeight: 600, fontSize: 12, padding: "6px 0", cursor: "pointer" }}
              >
                Add
              </button>
              <button
                onClick={() => setPopover(null)}
                style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--fg-muted)", fontSize: 12, padding: "6px 0", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* thread popover */}
        {popover?.kind === "thread" && threadAnnotation && (
          <div
            data-annotation-popover
            onClick={e => e.stopPropagation()}
            style={{
              position: "absolute",
              left: threadAnnotation.position_json?.x_pct != null ? `${threadAnnotation.position_json.x_pct}%` : "50%",
              top: threadAnnotation.position_json?.y_pct != null ? `${threadAnnotation.position_json.y_pct}%` : "50%",
              zIndex: 20, width: 280,
              background: "var(--surface-1)", border: "1px solid var(--line)",
              borderRadius: 8, padding: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-primary)" }}>Thread</span>
              <button onClick={() => setPopover(null)} style={{ background: "none", border: "none", color: "var(--fg-muted)", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: "var(--fg-primary)", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
              {threadAnnotation.content}
            </div>
            {replies(threadAnnotation.id).map(r => (
              <div key={r.id} style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid var(--line)" }}>
                {r.content}
              </div>
            ))}
            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows={2}
              style={{
                width: "100%", marginTop: 8, background: "var(--surface-2)", border: "1px solid var(--line)",
                borderRadius: 6, color: "var(--fg-primary)", fontSize: 12, padding: "5px 8px",
                resize: "none", outline: "none", boxSizing: "border-box",
              }}
              placeholder="Reply…"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => submitReply(threadAnnotation.id)}
                style={{ flex: 1, background: "var(--gold-400)", border: "none", borderRadius: 6, color: "#000", fontWeight: 600, fontSize: 11, padding: "5px 0", cursor: "pointer" }}>
                Reply
              </button>
              {!threadAnnotation.resolved && (
                <button onClick={() => { resolve(threadAnnotation.id); setPopover(null); }}
                  style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--fg-muted)", fontSize: 11, padding: "5px 0", cursor: "pointer" }}>
                  Resolve
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
