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
    <div className="fx-blueprint flex min-h-screen bg-surface-0">
      {/* Progress rail */}
      <div className="hidden w-72 flex-col border-r border-line bg-surface-1/55 p-10 backdrop-blur-xl lg:flex">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          FundExecs OS
        </span>
        <div className="mt-12 flex flex-col gap-6">
          {[
            { step: 1, label: "Organization", sublabel: "Name, type, location" },
            { step: 2, label: "Your role", sublabel: "AUM, fund count, structure" },
            { step: 3, label: "Strategy", sublabel: "Asset class and focus" },
            { step: 4, label: "First hub", sublabel: "Where to start" },
            { step: 5, label: "Mandate", sublabel: "What Earn may run — optional" },
          ].map(({ step, label, sublabel }) => (
            <div key={step} className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line font-mono text-xs text-fg-muted">
                {step}
              </div>
              <div>
                <p className="text-sm text-fg-secondary">{label}</p>
                <p className="text-xs text-fg-muted">{sublabel}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-auto font-mono text-xs text-fg-muted">~2 minutes</p>
      </div>

      {/* Wizard */}
      <div className="flex flex-1 items-center justify-center px-4 py-20 sm:px-6">
        <OnboardingWizard error={searchParams.error} />
      </div>
    </div>
  );
}
