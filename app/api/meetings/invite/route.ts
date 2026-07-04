import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail, escapeHtml } from "@/lib/email";

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { roomCode?: string; emails?: string[]; meetingTitle?: string };
  if (!body.roomCode || !Array.isArray(body.emails) || body.emails.length === 0) {
    return NextResponse.json({ error: "roomCode and emails required" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteUrl = `${origin}/meeting-invite/${body.roomCode}`;
  const title = body.meetingTitle ?? "Meeting";

  const results = await Promise.allSettled(
    body.emails.map((email) =>
      sendEmail({
        to: { name: email.split("@")[0] ?? email, email },
        subject: `You're invited to join "${title}" on FundExecs OS`,
        htmlBody: buildInviteHtml({ inviteUrl, title, senderName: user.email ?? "Someone" }),
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return NextResponse.json({ ok: true, sent, total: body.emails.length });
}

function buildInviteHtml({ inviteUrl, title, senderName }: { inviteUrl: string; title: string; senderName: string }) {
  const safeTitle = escapeHtml(title);
  const safeSender = escapeHtml(senderName);
  const safeUrl = inviteUrl.startsWith("https://") || inviteUrl.startsWith("http://") ? inviteUrl : "#";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#b8a36a;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${safeSender} invited you to a meeting</h1>
  <p style="color:#9ca3af;font-size:14px;margin:0 0 24px">${safeTitle}</p>
  <a href="${safeUrl}"
     style="display:inline-block;background:#b8a36a;color:#0d0d10;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    Join meeting →
  </a>
  <p style="color:#6b7280;font-size:12px;margin:24px 0 0">
    You can join as a guest or sign up for full access with AI transcription and meeting summaries.
  </p>
</body>
</html>`;
}
