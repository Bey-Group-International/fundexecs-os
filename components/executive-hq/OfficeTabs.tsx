"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { ExecutiveHQ } from "./ExecutiveHQ";

// Load Phaser only in the browser
const VirtualOfficeGame = dynamic(
  () => import("@/components/virtual-office/VirtualOfficeGame").then((m) => m.VirtualOfficeGame),
  { ssr: false, loading: () => <div className="h-[600px] flex items-center justify-center text-slate-500 text-sm">Loading virtual office…</div> }
);

type Tab = "hq" | "virtual";

export function OfficeTabs() {
  const [tab, setTab] = useState<Tab>("hq");
  const [token, setToken] = useState<string | undefined>(undefined);

  // Fetch Supabase access token once on mount — enables multiplayer when WS server is up
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token;
      if (t) setToken(t);
    });
  }, []);

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-line/60 bg-surface px-4 pt-3 gap-1">
        <TabButton active={tab === "hq"} onClick={() => setTab("hq")}>
          HQ Overview
        </TabButton>
        <TabButton active={tab === "virtual"} onClick={() => setTab("virtual")}>
          Virtual Office
          <span className="ml-2 text-[9px] bg-amber-400/20 text-amber-400 border border-amber-400/30 rounded px-1 py-0.5 font-mono uppercase tracking-wide">
            M1
          </span>
        </TabButton>
      </div>

      {/* Panels — keep both mounted so Phaser doesn't reinitialise on tab switch */}
      <div className={tab === "hq" ? "block" : "hidden"}>
        <ExecutiveHQ />
      </div>
      <div className={tab === "virtual" ? "block p-4" : "hidden"}>
        <VirtualOfficeGame token={token} />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
        active
          ? "border-amber-400 text-amber-400 bg-amber-400/5"
          : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/5",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
