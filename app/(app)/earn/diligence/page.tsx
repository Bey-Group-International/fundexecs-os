import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { isExtractable } from "@/lib/document-files";
import { DiligenceConsole } from "./DiligenceConsole";

export const dynamic = "force-dynamic";

// Earn Diligence Brain — "ask your fund documents what matters."
export default async function DiligencePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  // Everything in the library Earn can read: uploaded PDFs and Office files,
  // and documents written in the app.
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("id, name, storage_key, content, updated_at")
    .eq("organization_id", ctx.orgId)
    .order("updated_at", { ascending: false })
    .limit(200);
  const library = ((data ?? []) as { id: string; name: string; storage_key: string | null; content: string | null }[])
    .filter((d) => isExtractable(d.storage_key) || (!d.storage_key && d.content))
    .map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
          Earn · Diligence Brain
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Ask your fund documents what matters.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-fg-secondary">
          Upload or pick a deck, CIM, PPM, financials, or call notes — PDF, Word, Excel, or
          PowerPoint — pick a question, and the right Brain
          reviews it — institutional-grade, with its reasoning and tools shown.{" "}
          <Link href="/earn" className="text-gold-300 hover:underline">
            Back to Earn
          </Link>
        </p>
      </header>

      <DiligenceConsole library={library} />
    </div>
  );
}
