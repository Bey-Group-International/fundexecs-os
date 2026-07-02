// AI-drafted outreach + warm intro message generation.
// Produces draft messages for direct outreach or intro requests.
// Dispatches via the existing Gmail/Slack adapter when approved.

import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export interface DraftOutreachParams {
  targetName: string;
  targetTitle: string | null;
  targetCompany: string | null;
  context: string;         // Why you want to connect / what you're looking for
  senderName: string;
  senderTitle: string | null;
  messageType: "direct" | "intro_request";
  introducerName?: string; // For intro_request type
}

export interface DraftedMessage {
  subject: string;
  body: string;
  linkedinNote?: string; // 300-char LinkedIn note variant
}

export async function draftOutreachMessage(
  params: DraftOutreachParams,
): Promise<DraftedMessage> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      subject: `Introduction: ${params.senderName} → ${params.targetName}`,
      body: `Hi ${params.targetName.split(" ")[0]},\n\nI'd love to connect.\n\nBest,\n${params.senderName}`,
      linkedinNote: `Hi ${params.targetName.split(" ")[0]}, I'd love to connect. – ${params.senderName}`,
    };
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt =
    params.messageType === "direct"
      ? `You are a professional relationship advisor for a PE/family office fund manager.
Draft a concise, warm, and professional outreach email.
- Subject line: clear and specific (not generic)
- Body: 3–4 short paragraphs, conversational not salesy, specific to context
- End with a low-friction ask (15-min call, happy to share more)
- LinkedIn note: under 300 chars, friendly opener`
      : `You are a professional relationship advisor.
Draft a warm introduction request email to ${params.introducerName ?? "a mutual connection"}.
- Subject: "Introduction request: [sender] → [target]"
- Body: 2–3 paragraphs explaining why you'd like the intro, what value you offer, make it easy to forward
- LinkedIn note: under 300 chars for the direct ask`;

  const userPrompt = `Draft ${params.messageType === "direct" ? "a direct outreach" : "an intro request"} message.

Sender: ${params.senderName}${params.senderTitle ? `, ${params.senderTitle}` : ""}
Target: ${params.targetName}${params.targetTitle ? `, ${params.targetTitle}` : ""}${params.targetCompany ? ` at ${params.targetCompany}` : ""}
${params.introducerName ? `Introducer: ${params.introducerName}` : ""}
Context / Goal: ${params.context}

Return JSON: {"subject":"...","body":"...","linkedinNote":"..."}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  try {
    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    return JSON.parse(json);
  } catch {
    return {
      subject: `Introduction: ${params.senderName} → ${params.targetName}`,
      body: `Hi ${params.targetName.split(" ")[0]},\n\n${params.context}\n\nBest,\n${params.senderName}`,
      linkedinNote: `Hi, I'd love to connect. – ${params.senderName}`,
    };
  }
}

// Save an intro request to the DB.
export async function saveIntroRequest(params: {
  targetContactId?: string;
  targetName: string;
  targetCompany?: string;
  introPath: string[];
  introducerName?: string;
  draftMessage: string;
}): Promise<string> {
  const auth = await requireOrgContext();
  if (!auth.ok) throw new Error(auth.error);
  const { ctx } = auth;
  const supabase = createServerClient();

  const { data } = await supabase
    .from("intro_requests")
    .insert({
      organization_id: ctx.orgId,
      requested_by: ctx.userId,
      target_contact_id: params.targetContactId ?? null,
      target_name: params.targetName,
      target_company: params.targetCompany ?? null,
      intro_path: params.introPath,
      introducer_name: params.introducerName ?? null,
      draft_message: params.draftMessage,
      status: "draft",
    })
    .select("id")
    .single();

  if (!data) throw new Error("Failed to save intro request");
  return data.id;
}
