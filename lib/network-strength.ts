// Relationship strength scoring for network contacts.
// Signals: in-app activity (meetings, deal shares, tasks) + AI inference from notes.
// Score 0–100. Label: cold (<25) | warm (25–49) | active (50–74) | strong (75+).
// New tables not in database.types.ts — cast supabase client to bypass strict typing.

import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { createServerClient } from "@/lib/supabase/server";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export type StrengthLabel = "cold" | "warm" | "active" | "strong";

export function labelFromScore(score: number): StrengthLabel {
  if (score >= 75) return "strong";
  if (score >= 50) return "active";
  if (score >= 25) return "warm";
  return "cold";
}

async function inferStrengthFromNotes(notes: string): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !notes.trim()) return 0;

  const client = anthropicClient(apiKey);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: `Rate the relationship strength implied by these notes on a scale of 0–40 (integer only, no other text).

0 = no real relationship, 40 = very close / trusted advisor.

Notes: "${notes.slice(0, 800)}"`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "0";
  const score = parseInt(text, 10);
  return isNaN(score) ? 0 : Math.min(40, Math.max(0, score));
}

export async function refreshNetworkStrength(orgId: string): Promise<void> {
  const supabase = createServerClient() as any;

  const { data: rawContacts } = await supabase
    .from("network_contacts")
    .select("id, email, notes, connected_on, strength_updated_at")
    .eq("organization_id", orgId);

  interface ContactStrengthRow {
    id: string;
    email: string | null;
    notes: string | null;
    connected_on: string | null;
    strength_updated_at: string | null;
  }

  const contacts: ContactStrengthRow[] = (rawContacts ?? []) as ContactStrengthRow[];
  if (contacts.length === 0) return;

  const emails = contacts.map((c) => c.email).filter(Boolean) as string[];

  const { data: rawBriefs } = await supabase
    .from("meeting_briefs")
    .select("attendees")
    .eq("organization_id", orgId);

  interface BriefRow { attendees: unknown }
  const briefs: BriefRow[] = (rawBriefs ?? []) as BriefRow[];

  const meetingCountByEmail = new Map<string, number>();
  for (const brief of briefs) {
    const attendees: string[] = Array.isArray(brief.attendees) ? brief.attendees as string[] : [];
    for (const email of emails) {
      if (attendees.some((a) => typeof a === "string" && a.toLowerCase().includes(email.toLowerCase()))) {
        meetingCountByEmail.set(email, (meetingCountByEmail.get(email) ?? 0) + 1);
      }
    }
  }

  const BATCH = 20;
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH);
    const updates = await Promise.all(
      batch.map(async (c) => {
        let score = 0;

        if (c.connected_on) {
          const days = Math.floor(
            (Date.now() - new Date(c.connected_on).getTime()) / 86_400_000,
          );
          if (days < 30) score += 20;
          else if (days < 180) score += 12;
          else if (days < 365) score += 6;
          else score += 2;
        }

        const meetingCount = c.email ? (meetingCountByEmail.get(c.email) ?? 0) : 0;
        score += Math.min(40, meetingCount * 10);

        if (c.notes) {
          score += await inferStrengthFromNotes(c.notes);
        }

        score = Math.min(100, score);
        return {
          id: c.id,
          strength_score: score,
          strength_label: labelFromScore(score),
          strength_updated_at: new Date().toISOString(),
        };
      }),
    );

    for (const u of updates) {
      await supabase
        .from("network_contacts")
        .update({ strength_score: u.strength_score, strength_label: u.strength_label, strength_updated_at: u.strength_updated_at })
        .eq("id", u.id);
    }
  }
}

export async function bumpStrength(
  contactId: string,
  interactionType: "meeting" | "deal_share" | "task" | "email",
): Promise<void> {
  const supabase = createServerClient() as any;
  const { data: contact } = await supabase
    .from("network_contacts")
    .select("strength_score")
    .eq("id", contactId)
    .single();
  if (!contact) return;

  const bumps: Record<string, number> = { meeting: 10, deal_share: 8, task: 5, email: 4 };
  const currentScore = (contact as { strength_score: number }).strength_score ?? 0;
  const newScore = Math.min(100, currentScore + (bumps[interactionType] ?? 4));
  await supabase
    .from("network_contacts")
    .update({ strength_score: newScore, strength_label: labelFromScore(newScore), strength_updated_at: new Date().toISOString() })
    .eq("id", contactId);
}
