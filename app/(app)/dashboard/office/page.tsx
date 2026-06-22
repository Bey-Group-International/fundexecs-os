import type { Metadata } from "next";
import { CommandCenter } from "../../command-center/CommandCenter";

export const metadata: Metadata = {
  title: "Executive Office · FundExecs OS",
  description: "A closer interactive look at the FundExecs OS executive operating office.",
};

export const dynamic = "force-dynamic";

export default function DashboardOfficePage() {
  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
            Executive Office
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            A closer interactive look where Earnest Fundmaker coordinates the executive team.
          </p>
        </div>
      </div>
      <CommandCenter />
    </div>
  );
}
