// lib/data-room-crm.server.ts
//
// Tying data-room readers to the CRM: finding the contact (and investor) each
// reader's email belongs to, keeping a daily "read the data room" entry on the
// contact's timeline, and Earn's draft of a follow-up email.
//
// Matching is EXACT email only, the CRM's own rule (lib/crm/contact-match.ts):
// a wrong link writes one person's reading onto another person's record.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { formatSeconds, type InvestorActivity } from "@/lib/data-room-engagement";
import { readingRollups, recentDays, templateFollowUp, type FollowUpDraft } from "@/lib/data-room-crm";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export interface CrmMatch {
  contactId: string | null;
  contactName: string | null;
  investorId: string | null;
  investorName: string | null;
}

/** network_activities is not in the generated types; this is the slice used. */
type ActivitiesTable = {
  from: (t: "network_activities") => {
    upsert: (rows: unknown[], o: { onConflict: string }) => PromiseLike<{ error: { message: string } | null }>;
    insert: (row: unknown) => PromiseLike<{ error: { message: string } | null }>;
  };
};

const SAFE_EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Escapes LIKE wildcards so an address matches itself, not a pattern. */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Contacts and investors holding exactly these addresses. The query is a
 * case-insensitive prefilter (CRM addresses are typed by people); the exact
 * comparison happens here, after normalising both sides.
 */
export async function crmMatches(client: Client, orgId: string, emails: string[]): Promise<Map<string, CrmMatch>> {
  // Reader emails come from a public gate, so only plain addresses go into the
  // filter string: a comma or parenthesis there would change the query itself.
  const wanted = [...new Set(emails.map(normalizeEmail).filter((e) => SAFE_EMAIL.test(e)))].slice(0, 200);
  const out = new Map<string, CrmMatch>();
  if (wanted.length === 0) return out;
  const or = (col: string) => wanted.map((e) => `${col}.ilike.${likeLiteral(e)}`).join(",");

  const [{ data: contacts }, { data: investors }] = await Promise.all([
    client.from("network_contacts").select("id, email, full_name").eq("organization_id", orgId).or(or("email")),
    client.from("investors").select("id, contact_email, name").eq("organization_id", orgId).or(or("contact_email")),
  ]);
  const get = (e: string) =>
    out.get(e) ?? { contactId: null, contactName: null, investorId: null, investorName: null };
  for (const c of (contacts ?? []) as { id: string; email: string | null; full_name: string | null }[]) {
    const e = normalizeEmail(c.email);
    if (!wanted.includes(e)) continue;
    out.set(e, { ...get(e), contactId: c.id, contactName: c.full_name });
  }
  for (const i of (investors ?? []) as { id: string; contact_email: string | null; name: string }[]) {
    const e = normalizeEmail(i.contact_email);
    if (!wanted.includes(e)) continue;
    out.set(e, { ...get(e), investorId: i.id, investorName: i.name });
  }
  return out;
}

/**
 * Keep today's and yesterday's reading entries current on each matched
 * contact's timeline. Upserted on (org, contact, room+day), so re-running
 * updates the day rather than adding another copy of it. Readers with no CRM
 * contact are left alone: an investor-only entry would have no key to update.
 */
export async function syncRoomTimeline(
  client: Client,
  orgId: string,
  room: { id: string; name: string },
  investors: InvestorActivity[],
  now = new Date(),
): Promise<{ written: number }> {
  const named = investors.filter((a) => a.email);
  if (named.length === 0) return { written: 0 };
  const matches = await crmMatches(client, orgId, named.map((a) => a.email!));
  const days = recentDays(now);
  const rows = named.flatMap((a) => {
    const m = matches.get(normalizeEmail(a.email));
    if (!m?.contactId) return [];
    return readingRollups(a, room, days).map((r) => ({
      organization_id: orgId,
      contact_id: m.contactId,
      investor_id: m.investorId,
      activity_type: "document",
      direction: "inbound",
      subject: r.subject,
      body: r.body,
      occurred_at: r.occurredAt,
      is_system: true,
      metadata: { source: "data_room", data_room_key: r.key, room_id: room.id, seconds: r.seconds },
    }));
  });
  if (rows.length === 0) return { written: 0 };
  const { error } = await (client as unknown as ActivitiesTable)
    .from("network_activities")
    .upsert(rows, { onConflict: DATA_ROOM_CONFLICT_TARGET });
  return { written: error ? 0 : rows.length };
}

/** Plain columns only: PostgREST cannot conflict on an expression. */
export const DATA_ROOM_CONFLICT_TARGET = "organization_id,contact_id,data_room_key";

/** Record a sent follow-up on the contact's timeline, when there is a contact. */
export async function logFollowUpOnTimeline(
  client: Client,
  orgId: string,
  match: CrmMatch | undefined,
  args: { actorId: string; subject: string; body: string; roomId: string; sentAt: string },
): Promise<void> {
  if (!match?.contactId && !match?.investorId) return;
  await (client as unknown as ActivitiesTable)
    .from("network_activities")
    .insert({
      organization_id: orgId,
      contact_id: match.contactId,
      investor_id: match.investorId,
      actor_id: args.actorId,
      activity_type: "email",
      direction: "outbound",
      subject: args.subject,
      body: args.body.slice(0, 4000),
      occurred_at: args.sentAt,
      is_system: false,
      metadata: { source: "data_room_follow_up", room_id: args.roomId },
    });
}

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", description: "Under 8 words." },
    body: { type: "string", description: "Plain text, 60-140 words, no markdown, signed with the sender's first name if given." },
  },
  required: ["subject", "body"],
} as const;

const SYSTEM =
  "You are Earn, the AI associate in FundExecs OS, drafting a short follow-up email from a private-markets fund manager to a " +
  "prospective investor (LP) who has been reading the fund's data room. Write like a capable person, not a marketer: warm, " +
  "direct, specific. Refer to what they actually spent time on, without saying you tracked them to the second (say 'I saw you " +
  "had a look at the PPM', never quote minutes). Offer one concrete next step (a call, a walkthrough of a named document, or an " +
  "answer on a named topic). Never invent fund facts, numbers, dates or people. Plain text only.";

/** Earn's follow-up for one reader; the template when the model is unavailable. */
export async function draftFollowUp(
  a: InvestorActivity,
  ctx: { roomName: string; recipientName: string | null; senderName: string | null; nextStep: string | null; summary: string | null },
): Promise<FollowUpDraft> {
  const fallback = templateFollowUp(a, ctx);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;
  try {
    const anthropic = anthropicClient(apiKey, LONG_RUN_TIMEOUT_MS);
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "low", DRAFT_SCHEMA),
      messages: [
        {
          role: "user",
          content: [
            `Room: ${ctx.roomName}`,
            `Recipient: ${ctx.recipientName ?? "unknown name"} <${a.email}>`,
            `Sender: ${ctx.senderName ?? "the fund manager"}`,
            ctx.summary ? `Earn's read of their interest: ${ctx.summary}` : null,
            ctx.nextStep ? `Suggested next step: ${ctx.nextStep}` : null,
            "What they did:",
            ...a.documents
              .slice(0, 10)
              .map((d) => `- ${d.name}: read ${formatSeconds(d.seconds)}${d.downloads ? ", downloaded" : ""}`),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    const json = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const raw = JSON.parse(json) as { subject?: string; body?: string };
    const subject = (raw.subject ?? "").trim();
    const body = (raw.body ?? "").trim();
    if (!subject || !body) return fallback;
    return { subject: subject.slice(0, 200), body: body.slice(0, 4000), source: "earn" };
  } catch (err) {
    console.warn("[data-room-crm] draft failed; using template", err instanceof Error ? err.message : "error");
    return fallback;
  }
}
