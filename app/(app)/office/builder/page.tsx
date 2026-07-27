import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAvatarConfig } from "@/lib/office/avatarConfig";
import { portraitGenerationConfigured } from "@/lib/office/portraitGen";
import { CharacterBuilder } from "./CharacterBuilder";

export const dynamic = "force-dynamic";

// The Character Builder — where a member designs the "you" avatar that
// represents them in the Virtual Office. The saved AvatarConfig lives on the
// member's office_member_prefs row (see actions.ts); here we hydrate the last
// saved character (falling back to a sensible default seeded with the member's
// name) and hand it to the client builder for live editing.
export default async function CharacterBuilderPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();

  const [{ data: prefRow }, { data: principalRow }] = await Promise.all([
    supabase
      .from("office_member_prefs")
      .select("avatar, portrait_url")
      .eq("organization_id", ctx.orgId)
      .eq("principal_id", ctx.userId)
      .maybeSingle(),
    supabase.from("principals").select("full_name").eq("id", ctx.userId).maybeSingle(),
  ]);

  const prefs = prefRow as { avatar: unknown; portrait_url: string | null } | null;
  const saved = prefs?.avatar ?? null;
  const portraitUrl = prefs?.portrait_url ?? null;
  const fullName = (principalRow as { full_name: string | null } | null)?.full_name ?? "";

  // Hydrate: prefer the saved character; seed an unsaved builder's name from the
  // member's profile so the roster chip isn't blank on first visit.
  const initial = normalizeAvatarConfig(saved);
  if (!initial.displayName && fullName) initial.displayName = fullName.trim().slice(0, 40);
  const hasSaved = Boolean(saved);

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            Virtual Office
          </span>
          <Link
            href="/office"
            className="rounded-md border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
          >
            ← Back to office
          </Link>
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Character studio
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          Design the character that represents you in the office. Pick a look, save it, and it
          becomes your presence on the floor.
        </p>
      </header>

      <CharacterBuilder
        initial={initial}
        hasSaved={hasSaved}
        portraitUrl={portraitUrl}
        portraitEnabled={portraitGenerationConfigured()}
      />
    </div>
  );
}
