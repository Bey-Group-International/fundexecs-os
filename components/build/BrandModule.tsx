import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Organization } from "@/lib/supabase/database.types";
import { ModuleHeader } from "./DraftWithEarn";
import { BrandStudio } from "./BrandStudio";
import { BrandSheet } from "./BrandSheet";
import { ComponentGallery } from "@/components/design-system/ComponentGallery";

export async function BrandModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  const { data } = await supabase.from("organizations").select("*").eq("id", ctx.orgId).maybeSingle();
  const org = data as Organization | null;
  const palette = org?.brand_palette ?? [];
  const firmName = org?.name ?? "";

  return (
    <div>
      <ModuleHeader
        title="Brand"
        blurb="Your firm's identity — logo, colors, tagline, and voice."
        module="brand"
      />

      <BrandStudio
        logoUrl={org?.logo_url ?? ""}
        brandColor={org?.brand_color ?? ""}
        tagline={org?.tagline ?? ""}
        brandVoice={org?.brand_voice ?? ""}
        brandPalette={palette}
        firmName={firmName}
      />

      <BrandSheet
        firmName={firmName}
        logoUrl={org?.logo_url ?? null}
        tagline={org?.tagline ?? null}
        brandColor={org?.brand_color ?? null}
        brandVoice={org?.brand_voice ?? null}
        brandPalette={palette}
      />

      <div className="mt-8 border-t border-line pt-8">
        <h2 className="mb-4 font-display text-lg font-semibold text-fg-primary">Design System</h2>
        <p className="mb-6 text-sm text-fg-secondary">Token reference and component variant gallery for FundExecs OS.</p>
        <ComponentGallery />
      </div>
    </div>
  );
}
