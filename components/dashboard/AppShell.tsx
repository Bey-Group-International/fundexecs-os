"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { dashboardWorkspaces } from "@/lib/dashboard/config";
import type { DashboardData } from "@/lib/dashboard/types";
import { CommandPaletteTrigger } from "@/components/GlobalCommandPalette";
import { DashboardHUD } from "./DashboardHUD";
import { PWAInstallPrompt } from "./PWAInstallPrompt";
import { RecentsStrip } from "./RecentsStrip";

export function AppShell({
  data,
  children,
}: {
  data: DashboardData;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/dashboard";

  return (
    <div className="fx-blueprint mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav
          aria-label="Dashboard workspaces"
          className="flex gap-2 overflow-x-auto rounded-2xl border border-line bg-surface-1/75 p-1"
        >
          <Link
            href="/dashboard"
            className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
              pathname === "/dashboard"
                ? "bg-gold-500 text-surface-0"
                : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
            }`}
          >
            Command Center
          </Link>
          {dashboardWorkspaces.map((workspace) => {
            const active = pathname === workspace.href;
            return (
              <Link
                key={workspace.key}
                href={workspace.href}
                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                  active
                    ? "bg-gold-500 text-surface-0"
                    : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                }`}
              >
                {workspace.title}
              </Link>
            );
          })}
          <Link
            href="/dashboard/office"
            className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
              pathname === "/dashboard/office"
                ? "bg-gold-500 text-surface-0"
                : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
            }`}
          >
            Office
          </Link>
        </nav>
        {/* Opens the app-wide palette mounted in the (app) layout. */}
        <CommandPaletteTrigger />
      </div>
      <RecentsStrip />
      <DashboardHUD data={data} />
      <PWAInstallPrompt />
      {children}
    </div>
  );
}
