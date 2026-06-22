import type { Metadata } from "next";
import { ExecutiveHQ } from "@/components/executive-hq/ExecutiveHQ";

export const metadata: Metadata = {
  title: "Executive HQ · FundExecs OS",
  description: "Your AI executive team's virtual headquarters — every department, every executive, one command center.",
};

export const dynamic = "force-dynamic";

export default function ExecutiveHQPage() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold-400">
            Virtual Headquarters
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
            Executive Team
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Your AI executive team — click a room to enter the workspace, click an executive to open their copilot.
          </p>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line/60 shadow-2xl">
        <ExecutiveHQ />
      </div>
    </div>
  );
}
