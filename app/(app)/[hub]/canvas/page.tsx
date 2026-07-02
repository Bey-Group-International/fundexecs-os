import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { CollaborativeCanvas } from "@/components/canvas/CollaborativeCanvas";
import {
  listCanvases,
  createCanvas,
  createCanvasForm,
  listElements,
} from "@/components/canvas/canvas-actions";
import type { Hub } from "@/lib/supabase/database.types";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

interface PageProps {
  params: { hub: string };
  searchParams: { id?: string };
}

// Derive short initials from an email address or display name.
function toInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export default async function CanvasPage({ params, searchParams }: PageProps) {
  if (!HUB_KEYS.includes(params.hub as Hub)) notFound();

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // If no canvas id provided, fetch or auto-create one
  let canvasId = searchParams.id ?? "";

  if (!canvasId) {
    const canvases = await listCanvases();
    if (canvases.length > 0) {
      canvasId = canvases[0].id;
      redirect(`/${params.hub}/canvas?id=${canvasId}`);
    } else {
      // Create a default canvas
      const fd = new FormData();
      fd.set("name", "My Canvas");
      const result = await createCanvas(fd);
      if (!result) {
        return (
          <div className="flex h-full items-center justify-center text-fg-muted">
            Unable to create canvas. Please refresh.
          </div>
        );
      }
      canvasId = result.id;
      redirect(`/${params.hub}/canvas?id=${canvasId}`);
    }
  }

  // Verify canvas belongs to the org (RLS will enforce, but 404 gracefully)
  const supabase = createServerClient();
  const { data: canvasRaw } = await supabase
    .from("canvases" as never)
    .select("*")
    .eq("id", canvasId)
    .single();
  const canvas = canvasRaw as { id: string; name: string; org_id: string } | null;

  if (!canvas) notFound();

  const canvases = await listCanvases();
  const elements = await listElements(canvasId);
  const initials = toInitials(ctx!.email);

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      {/* Canvas header */}
      <div className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-fg-primary">{canvas.name}</h1>

        {/* Canvas switcher */}
        {canvases.length > 1 && (
          <div className="ml-2 flex items-center gap-1">
            {canvases.map((c) => (
              <a
                key={c.id}
                href={`/${params.hub}/canvas?id=${c.id}`}
                className={[
                  "rounded px-2 py-0.5 text-xs transition",
                  c.id === canvasId
                    ? "bg-gold-400/20 text-gold-400"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg-primary",
                ].join(" ")}
              >
                {c.name}
              </a>
            ))}
          </div>
        )}

        {/* New canvas form */}
        <form action={createCanvasForm} className="ml-auto flex items-center gap-2">
          <input
            name="name"
            placeholder="New canvas name…"
            className="h-7 rounded border border-line bg-surface-0 px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-gold-400/50"
          />
          <button
            type="submit"
            className="h-7 rounded bg-gold-400/10 px-3 text-xs font-medium text-gold-400 transition hover:bg-gold-400/20"
          >
            + Canvas
          </button>
        </form>
      </div>

      {/* Main canvas area */}
      <div className="flex-1 overflow-hidden">
        <CollaborativeCanvas
          canvasId={canvasId}
          initialElements={elements}
          currentUserId={ctx!.userId}
          currentUserInitials={initials}
        />
      </div>
    </div>
  );
}
