// lib/data-room-engagement.server.ts
//
// Earn's read of investor engagement in one room: for each investor, a short
// summary of what they did, an interest signal and a suggested next step. One
// model call covers the room; the offline rules (ruleRead) stand in when the
// model is not configured or fails, so the page always has a read to show.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEngagement,
  formatSeconds,
  ruleRead,
  type EngagementView,
  type InvestorActivity,
  type RoomEngagement,
  type Signal,
} from "@/lib/data-room-engagement";
import type { Database, DataRoomEngagementRead } from "@/lib/supabase/database.types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
/** Most-engaged first; the long tail of one-glance visitors adds cost, not insight. */
export const MAX_INVESTORS_PER_READ = 12;

export interface EngagementRead {
  key: string;
  summary: string;
  signal: Signal;
  follow_up: string;
  source: "earn" | "rules";
}

const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", description: "The investor's key, exactly as given." },
          signal: { type: "string", enum: ["hot", "warm", "cold"] },
          summary: { type: "string", description: "One or two sentences on what they read and what it suggests." },
          follow_up: { type: "string", description: "One concrete next step for the fund manager, under 25 words." },
        },
        required: ["key", "signal", "summary", "follow_up"],
      },
    },
  },
  required: ["reads"],
} as const;

const SYSTEM =
  "You are Earn, the AI associate in FundExecs OS. A private-markets fund manager shared a data room with prospective " +
  "investors (LPs). For each investor below you get what they did in the room: which documents they opened, read (with " +
  "time spent) and downloaded, on which days. Write a short read for each:\n" +
  "- signal: hot (serious diligence: long reads of core documents such as the PPM, LPA, financials or track record, " +
  "downloads, repeat visits), warm (real interest, not yet deep), cold (a glance, or gone quiet for weeks).\n" +
  "- summary: what they focused on and what that suggests they are evaluating (e.g. terms, team, performance). Ground every " +
  "claim in the activity given; never invent documents, people or facts.\n" +
  "- follow_up: one concrete next step for the manager, naming the document or topic it should address.\n" +
  "Be brief and specific. Today is given so you can judge recency.";

function describe(a: InvestorActivity): string {
  const lines = [
    `key: ${a.key}`,
    `who: ${a.email ?? "unnamed reader (no email given)"}`,
    `first seen ${a.firstSeen.slice(0, 10)}, last seen ${a.lastSeen.slice(0, 10)}, active on ${a.visitDays} day(s)`,
    `total reading ${formatSeconds(a.seconds)}, downloads ${a.downloads}`,
    "documents:",
    ...a.documents
      .slice(0, 15)
      .map(
        (d) =>
          `  - ${d.name}: read ${formatSeconds(d.seconds)}, opened ${d.opens}x, downloaded ${d.downloads}x`,
      ),
  ];
  return lines.join("\n");
}

export async function readEngagement(
  investors: InvestorActivity[],
  context: { roomName: string; today: string },
): Promise<EngagementRead[]> {
  const subjects = investors.slice(0, MAX_INVESTORS_PER_READ);
  const rules = new Map(subjects.map((a) => [a.key, { key: a.key, ...ruleRead(a), source: "rules" as const }]));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || subjects.length === 0) return [...rules.values()];

  try {
    const anthropic = anthropicClient(apiKey, LONG_RUN_TIMEOUT_MS);
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "low", READ_SCHEMA),
      messages: [
        {
          role: "user",
          content:
            `Room: ${context.roomName}\nToday: ${context.today}\n\n` +
            subjects.map((a) => `<investor>\n${describe(a)}\n</investor>`).join("\n"),
        },
      ],
    });
    const json = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const raw = JSON.parse(json) as { reads?: Partial<EngagementRead>[] };
    const fromModel = new Map<string, EngagementRead>();
    for (const r of raw.reads ?? []) {
      if (!r?.key || !rules.has(r.key)) continue;
      if (!["hot", "warm", "cold"].includes(r.signal as string)) continue;
      const summary = (r.summary ?? "").trim();
      const follow_up = (r.follow_up ?? "").trim();
      if (!summary || !follow_up) continue;
      fromModel.set(r.key, { key: r.key, signal: r.signal as Signal, summary, follow_up, source: "earn" });
    }
    // Anyone the model skipped keeps the rules' read rather than none.
    return subjects.map((a) => fromModel.get(a.key) ?? rules.get(a.key)!);
  } catch (err) {
    console.warn("[data-room-engagement] model read failed; using rules", err instanceof Error ? err.message : "error");
    return [...rules.values()];
  }
}

// ---------------------------------------------------------------------------
// Loading a room's engagement
// ---------------------------------------------------------------------------

/** Enough history for any live round; older rows add little to a read. */
const MAX_VIEWS = 20_000;

/**
 * Everything the activity view needs for one room, read through the caller's
 * client so RLS scopes it. Views are taken through the room's links (not
 * views.room_id), so rows written before rooms existed still count.
 */
export async function loadRoomEngagement(
  supabase: SupabaseClient<Database>,
  orgId: string,
  roomId: string,
): Promise<{ engagement: RoomEngagement; reads: Map<string, DataRoomEngagementRead> }> {
  const { data: shareRows } = await supabase
    .from("data_room_shares")
    .select("id, label")
    .eq("organization_id", orgId)
    .eq("room_id", roomId);
  const shares = (shareRows ?? []) as { id: string; label: string | null }[];
  const empty = { engagement: buildEngagement([], new Map()), reads: new Map<string, DataRoomEngagementRead>() };
  if (shares.length === 0) return empty;

  const [{ data: views }, { data: docs }, { data: reads }] = await Promise.all([
    supabase
      .from("data_room_views")
      .select("share_id, document_id, kind, action, viewer_email, session_id, duration_seconds, created_at")
      .eq("organization_id", orgId)
      .in(
        "share_id",
        shares.map((s) => s.id),
      )
      .order("created_at", { ascending: false })
      .limit(MAX_VIEWS),
    supabase.from("documents").select("id, name").eq("organization_id", orgId),
    supabase.from("data_room_engagement_reads").select("*").eq("organization_id", orgId).eq("room_id", roomId),
  ]);

  const engagement = buildEngagement(
    (views ?? []) as EngagementView[],
    new Map(((docs ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name])),
    new Map(shares.map((s) => [s.id, s.label || "Untitled link"])),
  );
  return {
    engagement,
    reads: new Map(((reads ?? []) as DataRoomEngagementRead[]).map((r) => [r.viewer_key, r])),
  };
}
