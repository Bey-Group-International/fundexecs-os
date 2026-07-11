import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { SpaceEditorShell } from "@/components/space-editor/SpaceEditorShell";

export const metadata: Metadata = {
  title: "Space Editor · Virtual Office · FundExecs OS",
  description:
    "Design the FundExecs Virtual Office — place furniture, browse the room structure, and shape the live 2.5D floor without editing code.",
};

export const dynamic = "force-dynamic";

// The Space Editor is a full-page, multi-panel builder for the Virtual Office
// environment. It shares the furniture-placement store with the in-world quick
// editor, so a change here shows on the live floor instantly and vice-versa —
// one normalized configuration, two surfaces.
export default async function SpaceEditorPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="p-1">
      <SpaceEditorShell />
    </div>
  );
}
