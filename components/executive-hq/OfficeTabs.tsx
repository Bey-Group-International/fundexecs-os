"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ExecutiveHQ } from "./ExecutiveHQ";
import { executiveCharacters } from "@/components/characters/characterConfig";
import { MeetingModal } from "@/components/virtual-office/MeetingModal";

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
  const [displayName, setDisplayName] = useState<string>("You");
  const [teleportTarget, setTeleportTarget] = useState<string | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});

  // Guest join state — shown when no session and virtual tab is requested
  const [guestPrompt, setGuestPrompt] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const searchParams = useSearchParams();

  // Fetch Supabase access token and character identity once on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token;
      if (t) setToken(t);
      const meta = data.session?.user?.user_metadata;
      if (meta?.character_id) setCharacterId(meta.character_id as string);
      if (meta?.display_name) setDisplayName(meta.display_name as string);
      setSessionChecked(true);
    });
  }, []);

  // Auto-teleport when ?room= param is present (guest join links)
  useEffect(() => {
    const room = searchParams.get("room");
    if (!room || !sessionChecked) return;
    if (token) {
      // Authenticated — go straight to the room
      setTab("virtual");
      setTeleportTarget(room);
      setTimeout(() => setTeleportTarget(null), 100);
    } else {
      // No session — show guest name prompt, remember the target room
      setGuestPrompt(true);
      setTab("virtual");
    }
  }, [searchParams, sessionChecked, token]);

  const handleGuestJoin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    setGuestLoading(true);
    setGuestError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: name, is_guest: true } },
      });
      if (error) throw error;
      const t = data.session?.access_token;
      if (t) setToken(t);
      setDisplayName(name);
      setGuestPrompt(false);
      // Teleport to the room from ?room= if present
      const room = searchParams.get("room");
      if (room) {
        setTeleportTarget(room);
        setTimeout(() => setTeleportTarget(null), 100);
      }
    } catch (err) {
      setGuestError(err instanceof Error ? err.message : "Sign in failed");
      setGuestLoading(false);
    }
  }, [guestName, searchParams]);

  const handleNpcClick = useCallback(({ spriteKey, name }: { npcId: string; spriteKey: string; name: string }) => {
    const exec = executiveCharacters.find((c) => c.id === spriteKey);
    const execName = exec?.name ?? name;
    const prompt = exec
      ? `I'm talking to ${execName} in the virtual office. ${exec.promptBoundary}`
      : `I'm talking to ${execName} in the virtual office.`;
    window.dispatchEvent(new CustomEvent("earn:open-with-context", { detail: { execName, prompt } }));
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
        <TabButton active={tab === "virtual"} onClick={() => { setTab("virtual"); }}>
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
        {/* Guest join prompt — shown when no session and virtual tab is active */}
        {guestPrompt ? (
          <div className="flex h-[600px] items-center justify-center">
            <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-slate-900 p-7 shadow-2xl">
              <h2 className="mb-1 text-lg font-semibold text-amber-400">Enter the Virtual Office</h2>
              <p className="mb-5 text-sm text-slate-400">Choose a display name to join as a guest.</p>
              <form onSubmit={handleGuestJoin} className="flex flex-col gap-3">
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Your name"
                  maxLength={40}
                  required
                  autoFocus
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/30"
                />
                {guestError && (
                  <p className="text-xs text-red-400">{guestError}</p>
                )}
                <button
                  type="submit"
                  disabled={guestLoading || !guestName.trim()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-amber-400 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {guestLoading ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" />
                      Joining…
                    </>
                  ) : "Enter office"}
                </button>
              </form>
              <p className="mt-4 text-center text-[11px] text-slate-600">Guest session · no account required</p>
            </div>
          </div>
        ) : (
          <VirtualOfficeGame
            token={token}
            characterId={characterId}
            displayName={displayName}
            active={tab === "virtual"}
            teleportTarget={teleportTarget}
            onOccupancyChange={setOccupancy}
            onNpcClick={handleNpcClick}
          />
        )}
      </div>

      {/* Meeting modal — listens for office:start-meeting window event */}
      <MeetingModal />
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
