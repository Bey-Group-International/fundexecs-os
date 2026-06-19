import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Organization } from "@/lib/supabase/database.types";
import { ModuleHeader, inputClass } from "./DraftWithEarn";
import { updateBrand } from "./actions";
import { AutosaveForm } from "./AutosaveForm";

export async function BrandModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  const { data } = await supabase.from("organizations").select("*").eq("id", ctx.orgId).maybeSingle();
  const org = data as Organization | null;
  const palette = org?.brand_palette ?? [];

  return (
    <div>
      <ModuleHeader
        title="Brand"
        blurb="Your firm's identity — logo, colors, tagline, and voice."
        module="brand"
      />

      <AutosaveForm action={updateBrand} className="grid max-w-xl gap-4 pt-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Tagline</span>
          <input name="tagline" defaultValue={org?.tagline ?? ""} placeholder="One line that captures the firm" className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-secondary">Primary color</span>
            <input name="brand_color" defaultValue={org?.brand_color ?? ""} placeholder="#f7c948" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-secondary">Logo URL</span>
            <input name="logo_url" defaultValue={org?.logo_url ?? ""} placeholder="https://…" className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Palette (comma-separated hex)</span>
          <input name="brand_palette" defaultValue={palette.join(", ")} placeholder="#0a0a0a, #f7c948, #94a3b8" className={inputClass} />
        </label>
        {palette.length ? (
          <div className="flex gap-1.5">
            {palette.map((c) => (
              <span key={c} className="h-6 w-6 rounded-md border border-line" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        ) : null}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Brand voice</span>
          <textarea name="brand_voice" rows={3} defaultValue={org?.brand_voice ?? ""} placeholder="How the firm sounds in writing — tone, what to avoid." className={`${inputClass} resize-none`} />
        </label>
      </AutosaveForm>
    </div>
  );
}
