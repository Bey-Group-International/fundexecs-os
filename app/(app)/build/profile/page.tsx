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
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
        Build · Profile
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Organization profile
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        Your identity and entity foundation. The first Build-hub module.
      </p>

      <form action={updateProfile} className="mt-6 flex flex-col gap-4">
        {FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-neutral-400">{f.label}</span>
            <input
              name={f.name}
              type={f.type ?? "text"}
              defaultValue={(org?.[f.name as keyof typeof org] as string) ?? ""}
              className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 outline-none focus:border-agent-associate"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-neutral-400">Description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={org?.description ?? ""}
            className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 outline-none focus:border-agent-associate"
          />
        </label>
        <button className="self-start rounded-md bg-agent-associate px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
          Save profile
        </button>
      </form>
    </div>
  );
}
