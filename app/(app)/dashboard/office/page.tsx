import type { Metadata } from "next";
import { ExecutiveHQ } from "@/components/executive-hq/ExecutiveHQ";

export const metadata: Metadata = {
  title: "Executive HQ · FundExecs OS",
  description: "Your AI executive team's virtual headquarters — every department, every executive, one command center.",
};

export const dynamic = "force-dynamic";

export default function ExecutiveHQPage() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line/60 shadow-2xl">
      <ExecutiveHQ />
    </div>
  );
}
