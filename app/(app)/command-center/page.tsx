import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { CommandCenter } from "./CommandCenter";

export const metadata: Metadata = {
  title: "Command Center · FundExecs OS",
  description:
    "A Gather-style spatial office where Earn orchestrates the executive team across private-market workflows.",
};

export const dynamic = "force-dynamic";

// The spatial office world. Authed by the (app) shell; the world itself runs on
// self-contained demo state, so it renders instantly without a data round-trip.
export default async function CommandCenterPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
            Command Center
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Earn orchestrates the executive team across the floor — in real time.
          </p>
        </div>
      </div>
      <CommandCenter />
    </div>
  );
}
