"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ExecutiveHQ } from "./ExecutiveHQ";
import { hydrateWorkflows, setApprovalDecider, setOfficePersistence, setUserRole } from "@/components/virtual-office/program/officeProgramStore";
import { rowToWorkflow, type OfficeWorkflow } from "@/components/virtual-office/program/officeProgram";
import { officeRoleFromMemberRole } from "@/lib/office/approvalAuthority";
import { makeServerApprovalDecider } from "@/lib/office/officeApprovalClient";
import { appendOfficeAuditEvents, loadOfficeWorkflows, persistOfficeWorkflow } from "@/components/virtual-office/program/office-actions";
import type { MemberRole } from "@/lib/supabase/database.types";
import { executiveCharacters } from "@/components/characters/characterConfig";
import {
  parseUserAvatar,
  DEFAULT_USER_AVATAR,
  type UserAvatar,
} from "@/lib/office/userAvatar";

// Load Phaser only in the browser
const VirtualOfficeGame = dynamic(
  () => import("@/components/virtual-office/VirtualOfficeGame").then((m) => m.VirtualOfficeGame),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[640px] items-center justify-center rounded-2xl border border-line/60 bg-surface-0 text-sm text-fg-muted">
        Loading the execution office…
      </div>
    ),
  }
);

type Tab = "hq" | "virtual";

// HQ room ids that differ from virtual office room keys
const HQ_TO_VIRTUAL: Record<string, string> = { investor: "office" };

export function OfficeTabs() {
  const [tab, setTab] = useState<Tab>("virtual");
  const [opened, setOpened] = useState<Record<Tab, boolean>>({ hq: false, virtual: true });
  const [token, setToken] = useState<string | undefined>(undefined);
  const [officeAvatar, setOfficeAvatar] = useState<UserAvatar>(DEFAULT_USER_AVATAR);
  const [displayName, setDisplayName] = useState<string>("You");
  const [teleportTarget, setTeleportTarget] = useState<string | null>(null);
  const [dealRoomListingId, setDealRoomListingId] = useState<string | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});

  // Guest join state — shown when no session and virtual tab is requested
  const [zoneUrlOverrides, setZoneUrlOverrides] = useState<Record<string, string>>({});
  const [guestPrompt, setGuestPrompt] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const searchParams = useSearchParams();

  const activateTab = useCallback((next: Tab) => {
    setTab(next);
    setOpened((prev) => ({ ...prev, [next]: true }));
  }, []);

  // The Virtual Office has its own Earn entry points (⌘K + the Earn Center
  // button on its footer), so hide the app-wide floating "Ask Earn" launcher
  // while that tab is active. It returns on the Overview tab and off this page.
  useEffect(() => {
    const suppress = tab === "virtual";
    window.dispatchEvent(new CustomEvent("earn:suppress-launcher", { detail: { suppress } }));
    return () => {
      window.dispatchEvent(new CustomEvent("earn:suppress-launcher", { detail: { suppress: false } }));
    };
  }, [tab]);

  // Fetch Supabase access token and character identity once on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token;
      if (t) setToken(t);
      const meta = data.session?.user?.user_metadata;
      // Seed the operator's own floor avatar from account metadata.
      const savedAvatar = parseUserAvatar(meta?.office_avatar);
      if (savedAvatar) setOfficeAvatar(savedAvatar);
      if (meta?.display_name) setDisplayName(meta.display_name as string);
      // Populate dynamic zone URLs from integration metadata
      const overrides: Record<string, string> = {};
      if (meta?.calendly_scheduling_url) overrides["calendly"] = meta.calendly_scheduling_url as string;
      if (meta?.lp_portal_url) overrides["lp-portal"] = meta.lp_portal_url as string;
      if (Object.keys(overrides).length > 0) setZoneUrlOverrides(overrides);

      // Approval authority comes from the TRUSTED org membership role, not
      // client-set metadata. Seed the office role and register the
      // server-side decider so Tier 2/3 approvals are enforced by the
      // office_decide_approval RPC (RLS), not the client store.
      const userId = data.session?.user?.id;
      if (userId) {
        supabase
          .from("organization_members")
          .select("organization_id, role")
          .eq("principal_id", userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
          .then(({ data: membership }) => {
            if (!membership) return;
            const m = membership as { organization_id: string; role: MemberRole };
            setUserRole(officeRoleFromMemberRole(m.role));
            setApprovalDecider(makeServerApprovalDecider(supabase, m.organization_id));
            // Mirror routed workflows + the audit trail best-effort through the
            // org-scoped server actions (RLS-enforced). Failures are swallowed
            // by the store, so the floor keeps working purely in memory.
            setOfficePersistence({
              persistWorkflow: async (wf, phase) => {
                const outcome =
                  phase === "archived" ? (wf.stage === "blocked" ? "rejected" : "complete") : null;
                await persistOfficeWorkflow(wf, outcome);
              },
              appendAudit: async (events) => {
                await appendOfficeAuditEvents(events);
              },
            });
            // Best-effort read-hydrate: seed the archive with this org's
            // persisted workflows. Swallow everything — guest / no-Supabase /
            // empty-table paths return nothing and behave exactly as before,
            // so /command-center renders identically without a backend.
            loadOfficeWorkflows()
              .then((rows) => {
                if (!rows || rows.length === 0) return;
                const workflows = rows
                  .map((row) => rowToWorkflow(row))
                  .filter((w): w is OfficeWorkflow => w !== null);
                if (workflows.length > 0) hydrateWorkflows(workflows);
              })
              .catch(() => {});
          });
      }
      setSessionChecked(true);
    });

    // On unmount, stop routing approvals/persistence to a stale client/org.
    return () => {
      setApprovalDecider(null);
      setOfficePersistence(null);
    };
  }, []);

  // Auto-teleport when ?room= param is present (guest join links)
  useEffect(() => {
    const room = searchParams.get("room");
    const requestedTab = searchParams.get("tab");
    // A ?deal= link convenes a deal room around that listing — the Deal Room
    // shows its context on arrival (see VirtualOfficeGame / DealRoomBanner).
    const deal = searchParams.get("deal");
    if (deal) setDealRoomListingId(deal);
    if (requestedTab === "overview" || requestedTab === "hq") {
      activateTab("hq");
    } else if (requestedTab === "virtual") {
      activateTab("virtual");
    }
    if (!room || !sessionChecked) return;
    if (token) {
      // Authenticated — go straight to the room
      activateTab("virtual");
      setTeleportTarget(room);
      setTimeout(() => setTeleportTarget(null), 100);
      // A meeting link (?meet=1) auto-opens the video dock once we're in the room.
      if (searchParams.get("meet") === "1") {
        setTimeout(() => window.dispatchEvent(new CustomEvent("office:start-meeting")), 900);
      }
    } else {
      // No session — show guest name prompt, remember the target room
      setGuestPrompt(true);
      activateTab("virtual");
    }
  }, [activateTab, searchParams, sessionChecked, token]);

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
      // Guests get default zone URLs (no custom integrations)
      setZoneUrlOverrides({});
      // Teleport to the room from ?room= if present
      const room = searchParams.get("room");
      if (room) {
        setTeleportTarget(room);
        setTimeout(() => setTeleportTarget(null), 100);
        // A meeting link (?meet=1) auto-opens the video dock once we're in the room.
        if (searchParams.get("meet") === "1") {
          setTimeout(() => window.dispatchEvent(new CustomEvent("office:start-meeting")), 900);
        }
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
    activateTab("virtual");
    // Clear target after one frame so repeated clicks on same room re-trigger
    setTimeout(() => setTeleportTarget(null), 100);
  };

  return (
    <div className="bg-surface-0">
      {/* Slim single-row header — keeps the floor fitting the viewport without
          vertical scrolling. The full description now lives in the docs, not here. */}
      <div className="border-b border-line/60 bg-gradient-to-r from-surface-1 via-surface-0 to-surface-1 px-4 py-1.5">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
              AI Execution Floor
            </h1>
            <p className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400 sm:block">
              FundExecs OS · Office Program
            </p>
          </div>
          {/* The operator's character chip now lives inline on the floor's top
              rail beside Invite (sleek with the other chips) — not here, so the
              header stays a single tight title row. */}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-line/60 bg-surface-1/80 px-4 pt-1.5">
        <TabButton active={tab === "virtual"} onClick={() => activateTab("virtual")}>
          Execution Floor
        </TabButton>
        <TabButton active={tab === "hq"} onClick={() => activateTab("hq")}>
          Overview
        </TabButton>
      </div>

      {/* Overview is secondary and mounts only when requested. */}
      {opened.hq ? (
        <div className={tab === "hq" ? "block" : "hidden"}>
          <ExecutiveHQ onNavigateRoom={handleNavigateRoom} roomOccupancy={occupancy} />
        </div>
      ) : null}

      {/* Virtual panel stays mounted after first activation so Phaser does not
          reinitialise on tab switch, but is not mounted before it is needed. */}
      {opened.virtual ? (
      <div className={tab === "virtual" ? "block px-4 py-2" : "invisible h-0 overflow-hidden"}>
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
          <>
            {/* Character selection now lives in the header chip (one line with
                the office metrics), so the game mounts directly here. */}
            <VirtualOfficeGame
              token={token}
              officeAvatar={officeAvatar}
              onAvatarSaved={setOfficeAvatar}
              displayName={displayName}
              active={tab === "virtual"}
              teleportTarget={teleportTarget}
              dealRoomListingId={dealRoomListingId}
              onOccupancyChange={setOccupancy}
              onNpcClick={handleNpcClick}
              zoneUrlOverrides={zoneUrlOverrides}
            />
          </>
        )}
      </div>
      ) : null}
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
        "flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
        active
          ? "border-amber-400 text-amber-400 bg-amber-400/5"
          : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/5",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
