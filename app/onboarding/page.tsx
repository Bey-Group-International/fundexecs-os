import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createOrganization } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.orgId) redirect("/workspace");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
        Build · Identity
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Create your organization
      </h1>
      <p className="mt-2 text-sm text-neutral-400">
        Your GP firm, fund, or family office. This is the tenancy root —
        everything you build lives inside it.
      </p>

      {searchParams.error ? (
        <p className="mt-4 rounded-md border border-agent-diligence/40 bg-agent-diligence/10 px-3 py-2 text-sm text-red-300">
          {searchParams.error}
        </p>
      ) : null}

      <form action={createOrganization} className="mt-6 flex flex-col gap-3">
        <input
          name="name"
          required
          placeholder="Organization name"
          className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm outline-none focus:border-agent-associate"
        />
        <input
          name="entity_type"
          placeholder="Entity type (e.g. LLC, LP) — optional"
          className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm outline-none focus:border-agent-associate"
        />
        <button className="mt-1 rounded-md bg-agent-associate px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">
          Create organization
        </button>
      </form>
    </main>
  );
}
