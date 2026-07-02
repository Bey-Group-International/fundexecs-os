// Relationship strength scoring for network contacts.
// Signals: in-app activity (meetings, deal shares, tasks) + AI inference from notes.
// Score 0–100. Label: cold (<25) | warm (25–49) | active (50–74) | strong (75+).

import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export type StrengthLabel = "cold" | "warm" | "active" | "strong";

export function labelFromScore(score: number): StrengthLabel {
  if (score >= 75) return "strong";
  if (score >= 50) return "active";
  if (score >= 25) return "warm";
  return "cold";
}

// AI-infer strength from free-text notes.
async function inferStrengthFromNotes(notes: string): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !notes.trim()) return 0;

  const client = new Anthropic({ apiKey });
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

// Compute and persist strength scores for all contacts in the org.
// Called by cron or on-demand when scores are stale.
export async function refreshNetworkStrength(orgId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: contacts } = await supabase
    .from("network_contacts")
    .select("id, email, notes, connected_on, strength_updated_at")
    .eq("organization_id", orgId);

  if (!contacts || contacts.length === 0) return;

  // Pull in-app activity signals: meetings involving these contacts (by email).
  const emails = contacts.map((c) => c.email).filter(Boolean) as string[];

  // Count meetings per email (approximate — meetings store attendees as JSONB).
  // We use a simpler proxy: meeting_briefs where contact appears in attendees.
  const { data: briefs } = await supabase
    .from("meeting_briefs")
    .select("attendees")
    .eq("organization_id", orgId);

  const meetingCountByEmail = new Map<string, number>();
  for (const brief of briefs ?? []) {
    const attendees: string[] = Array.isArray(brief.attendees) ? brief.attendees : [];
    for (const email of emails) {
      if (attendees.some((a) => typeof a === "string" && a.toLowerCase().includes(email.toLowerCase()))) {
        meetingCountByEmail.set(email, (meetingCountByEmail.get(email) ?? 0) + 1);
      }
    }
  }

  // Score each contact.
  const BATCH = 20;
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH);
    const updates = await Promise.all(
      batch.map(async (c) => {
        let score = 0;

        // LinkedIn connection recency (max 20 pts).
        if (c.connected_on) {
          const days = Math.floor(
            (Date.now() - new Date(c.connected_on).getTime()) / 86_400_000,
          );
          if (days < 30) score += 20;
          else if (days < 180) score += 12;
          else if (days < 365) score += 6;
          else score += 2;
        }

        // In-app meeting activity (max 40 pts).
        const meetingCount = c.email ? (meetingCountByEmail.get(c.email) ?? 0) : 0;
        score += Math.min(40, meetingCount * 10);

        // AI inference from notes (max 40 pts).
        if (c.notes) {
          score += await inferStrengthFromNotes(c.notes);
        }

        score = Math.min(100, score);
        return { id: c.id, strength_score: score, strength_label: labelFromScore(score), strength_updated_at: new Date().toISOString() };
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

// Update strength for a single contact after a new interaction.
export async function bumpStrength(
  contactId: string,
  interactionType: "meeting" | "deal_share" | "task" | "email",
): Promise<void> {
  const supabase = createServerClient();
  const { data: contact } = await supabase
    .from("network_contacts")
    .select("strength_score")
    .eq("id", contactId)
    .single();
  if (!contact) return;

  const bumps: Record<string, number> = { meeting: 10, deal_share: 8, task: 5, email: 4 };
  const newScore = Math.min(100, (contact.strength_score ?? 0) + (bumps[interactionType] ?? 4));
  await supabase
    .from("network_contacts")
    .update({ strength_score: newScore, strength_label: labelFromScore(newScore), strength_updated_at: new Date().toISOString() })
    .eq("id", contactId);
}
