import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { updateProfile } from "./actions";

export const dynamic = "force-dynamic";

const FIELDS: { name: string; label: string; type?: string }[] = [
  { name: "name", label: "Organization name" },
  { name: "legal_name", label: "Legal name" },
  { name: "entity_type", label: "Entity type" },
  { name: "jurisdiction", label: "Jurisdiction" },
  { name: "website", label: "Website" },
];

export default async function ProfilePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", ctx.orgId)
    .maybeSingle();

  return (
    <div className="max-w-xl">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
        Build · Profile
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Organization profile
      </h1>
      <p className="mt-1 text-sm text-fg-secondary">
        Your identity and entity foundation. The first Build-hub module.
      </p>

      <form action={updateProfile} className="mt-6 flex flex-col gap-4">
        {FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-secondary">{f.label}</span>
            <input
              name={f.name}
              type={f.type ?? "text"}
              defaultValue={(org?.[f.name as keyof typeof org] as string) ?? ""}
              className="rounded-md border border-line bg-surface-1 px-3 py-2 outline-none focus:border-gold-500"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={org?.description ?? ""}
            className="rounded-md border border-line bg-surface-1 px-3 py-2 outline-none focus:border-gold-500"
          />
        </label>
        <button className="self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:opacity-90">
          Save profile
        </button>
      </form>
    </div>
  );
}
