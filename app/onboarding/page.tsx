import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import OnboardingWizard from "./wizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.orgId) redirect("/workspace");

  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      {/* Progress rail */}
      <div className="hidden w-72 flex-col border-r border-white/5 p-10 lg:flex">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
          FundExecs OS
        </span>
        <div className="mt-12 flex flex-col gap-6">
          {[
            { step: 1, label: "Organization", sublabel: "Name, type, location" },
            { step: 2, label: "Your role", sublabel: "AUM, fund count, structure" },
            { step: 3, label: "Strategy", sublabel: "Asset class and focus" },
            { step: 4, label: "First hub", sublabel: "Where to start" },
          ].map(({ step, label, sublabel }) => (
            <div key={step} className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 font-mono text-xs text-neutral-600">
                {step}
              </div>
              <div>
                <p className="text-sm text-neutral-400">{label}</p>
                <p className="text-xs text-neutral-600">{sublabel}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-auto font-mono text-xs text-neutral-700">~2 minutes</p>
      </div>

      {/* Wizard */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <OnboardingWizard error={searchParams.error} />
      </div>
    </div>
  );
}
