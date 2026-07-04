// Outreach profile: per-user intro blurb + Earn-assisted generation from org context.
// Pulls fund name, strategy, AUM from organizations table to ground AI drafts.

import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export interface OutreachProfile {
  senderName: string;
  senderTitle: string | null;
  introBlurb: string | null;         // user-written or AI-generated
  fundName: string | null;
  fundStrategy: string | null;
  aumRange: string | null;
  location: string | null;
}

// Fetch the current user's outreach profile (org + principal fields).
export async function getOutreachProfile(): Promise<OutreachProfile | null> {
  const auth = await requireOrgContext();
  if (!auth.ok) return null;
  const { ctx } = auth;

  const supabase = await createServerClient();
  const db = supabase as any;
  const [principalRes, orgRes] = await Promise.all([
    db
      .from("principals")
      .select("full_name, title, intro_blurb")
      .eq("id", ctx.userId)
      .single(),
    db
      .from("organizations")
      .select("name, primary_strategy, aum_range, hq_location")
      .eq("id", ctx.orgId)
      .single(),
  ]);

  const principal = principalRes.data;
  const org = orgRes.data;

  return {
    senderName: principal?.full_name ?? ctx.email ?? "You",
    senderTitle: principal?.title ?? null,
    introBlurb: principal?.intro_blurb ?? null,
    fundName: org?.name ?? null,
    fundStrategy: org?.primary_strategy ?? null,
    aumRange: org?.aum_range ?? null,
    location: org?.hq_location ?? null,
  };
}

// Save a user-written or AI-generated intro blurb to principals.
export async function saveIntroBlurb(blurb: string): Promise<void> {
  const auth = await requireOrgContext();
  if (!auth.ok) throw new Error(auth.error);
  const { ctx } = auth;

  const db = await createServerClient() as any;
  await db
    .from("principals")
    .update({ intro_blurb: blurb.trim(), intro_blurb_updated_at: new Date().toISOString() })
    .eq("id", ctx.userId);
}

// Earn-assisted: generate an intro blurb from the org profile.
// Returns a suggested blurb the user can edit and save.
export async function generateIntroBlurb(profile: OutreachProfile): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `${profile.senderName}${profile.senderTitle ? `, ${profile.senderTitle}` : ""}${profile.fundName ? ` at ${profile.fundName}` : ""}.`;
  }

  const client = anthropicClient(apiKey);

  const context = [
    profile.fundName && `Fund: ${profile.fundName}`,
    profile.fundStrategy && `Strategy: ${profile.fundStrategy}`,
    profile.aumRange && `AUM: ${profile.aumRange}`,
    profile.location && `Location: ${profile.location}`,
    profile.senderTitle && `My role: ${profile.senderTitle}`,
  ].filter(Boolean).join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: `You are a professional ghostwriter for PE/family office fund managers.
Write a concise, confident 2–3 sentence "about me" intro blurb for outreach emails and LinkedIn messages.
Tone: warm but professional. No fluff. First person. No generic phrases like "passionate about".`,
    messages: [
      {
        role: "user",
        content: `Write my intro blurb based on this context:\n${context}\n\nName: ${profile.senderName}\n\nReturn only the blurb text, no quotes or labels.`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";
  return text || `${profile.senderName}, ${profile.senderTitle ?? "investor"} at ${profile.fundName ?? "our firm"}.`;
}
