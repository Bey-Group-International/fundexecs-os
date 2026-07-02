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

// HQ room ids that differ from virtual office room keys
const HQ_TO_VIRTUAL: Record<string, string> = { investor: "office" };

export function OfficeTabs() {
  const [tab, setTab] = useState<Tab>("hq");
  const [token, setToken] = useState<string | undefined>(undefined);
  const [characterId, setCharacterId] = useState<string | undefined>(undefined);
  const [teleportTarget, setTeleportTarget] = useState<string | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});

  // Fetch Supabase access token and character identity once on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token;
      if (t) setToken(t);
      const meta = data.session?.user?.user_metadata;
      if (meta?.character_id) setCharacterId(meta.character_id as string);
    });
  }, []);

  const handleNavigateRoom = (hqRoomId: string) => {
    const virtualKey = HQ_TO_VIRTUAL[hqRoomId] ?? hqRoomId;
    setTeleportTarget(virtualKey);
    setTab("virtual");
    // Clear target after one frame so repeated clicks on same room re-trigger
    setTimeout(() => setTeleportTarget(null), 100);
  };

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
            M4
          </span>
        </TabButton>
      </div>

      {/* Panels — keep both mounted so Phaser doesn't reinitialise on tab switch */}
      <div className={tab === "hq" ? "block" : "hidden"}>
        <ExecutiveHQ onNavigateRoom={handleNavigateRoom} roomOccupancy={occupancy} />
      </div>
      {/* Virtual panel: always in DOM but hidden via CSS visibility so Phaser can
          measure dimensions correctly after the first activation. */}
      <div className={tab === "virtual" ? "block p-4" : "invisible h-0 overflow-hidden"}>
        <VirtualOfficeGame
          token={token}
          characterId={characterId}
          active={tab === "virtual"}
          teleportTarget={teleportTarget}
          onOccupancyChange={setOccupancy}
        />
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
