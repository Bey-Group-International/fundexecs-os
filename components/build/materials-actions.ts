"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import type { Document, DocumentVersion } from "@/lib/supabase/database.types";
import { sendEmail, shareGrantedEmail, documentUpdatedEmail, escapeHtml } from "@/lib/email";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));
const ROOM = "/build/data_room";

function section(formData: FormData): string {
  const s = String(formData.get("section") ?? "").trim();
  return SECTION_KEYS.has(s) ? s : "other";
}

// Accept only real http(s) links so a stored document URL can never carry a
// javascript:/data: payload into the rendered <a href> (the renderer also guards).
function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    // not a valid absolute URL
  }
  return null;
}

// Add a document as a link (no file storage). The external URL is held in
// `storage_key`; the section is the `doc_type`.
export async function addDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  const link = safeLink(String(formData.get("url") ?? ""));
  if (!name || !link) return;
  const supabase = createServerClient();
  await supabase.from("documents").insert({
    organization_id: ctx.orgId,
    name,
    doc_type: section(formData),
    storage_key: link,
    mime_type: "text/uri-list",
    uploaded_by: ctx.userId,
  });
  revalidatePath(ROOM);
}

// Create a document in-app: a written note/memo stored inline (no file, no link).
export async function createDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!name || !content) return;
  const supabase = createServerClient();
  await supabase.from("documents").insert({
    organization_id: ctx.orgId,
    name,
    doc_type: section(formData),
    content,
    mime_type: "text/markdown",
    uploaded_by: ctx.userId,
  });
  revalidatePath(ROOM);
}

// Rename / re-categorize a document, and update its inline content when present.
export async function updateDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const patch: Partial<Document> = { name, doc_type: section(formData) };
  // Only the fields actually submitted are touched.
  if (formData.get("content") !== null) {
    patch.content = String(formData.get("content") ?? "").trim() || null;
  }
  if (formData.get("url") !== null) {
    patch.storage_key = safeLink(String(formData.get("url") ?? "")) ?? null;
  }

  const supabase = createServerClient();
  await supabase.from("documents").update(patch).eq("id", id).eq("organization_id", ctx.orgId);

  // Snapshot version on every save (content only — links have no content to version).
  if (patch.content !== undefined) {
    await supabase.from("document_versions").insert({
      document_id: id,
      organization_id: ctx.orgId,
      content: patch.content ?? null,
      name: patch.name ?? name,
      saved_by: ctx.userId,
    } as never);
  }
  revalidatePath(ROOM);

  // Notify LP recipients on all active shares for this org.
  void notifyShareRecipientsDocumentUpdated(ctx.orgId, name).catch(() => undefined);
}

async function notifyShareRecipientsDocumentUpdated(orgId: string, docName: string): Promise<void> {
  const supabase = createServerClient();
  // Fetch org name and active shares with recipient emails in one pass.
  const [{ data: orgRow }, { data: shares }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("data_room_shares")
      .select("token, recipient_email")
      .eq("organization_id", orgId)
      .is("revoked_at", null)
      .not("recipient_email", "is", null),
  ]);
  if (!orgRow || !shares || shares.length === 0) return;
  const orgName = orgRow.name as string;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fundexecs.com";
  await Promise.all(
    (shares as Array<{ token: string; recipient_email: string | null }>)
      .filter((s) => s.recipient_email)
      .map((s) => {
        const { subject, html } = documentUpdatedEmail(orgName, docName, `${baseUrl}/dataroom/${s.token}`);
        return sendEmail({ to: { name: "", email: s.recipient_email! }, subject, htmlBody: html });
      }),
  );
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("documents").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// Move a document up/down within its section. Normalizes sort_order across the
// section, then swaps the target with its neighbour.
export async function moveDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!id || (dir !== "up" && dir !== "down")) return;
  const orgId = ctx.orgId;

  const supabase = createServerClient();
  const { data: target } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const doc = target as Document | null;
  if (!doc) return;

  const { data: peerRows } = await supabase
    .from("documents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("doc_type", doc.doc_type ?? "other")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const peers = (peerRows ?? []) as Document[];

  const idx = peers.findIndex((p) => p.id === id);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= peers.length) return;

  // Re-number sequentially after swapping the two neighbours, so order is stable
  // even when prior sort_order values were all 0 (the column default).
  const reordered = [...peers];
  [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
  await Promise.all(
    reordered.map((p, i) =>
      supabase.from("documents").update({ sort_order: i }).eq("id", p.id).eq("organization_id", orgId),
    ),
  );
  revalidatePath(ROOM);
}

// Set a document's publish status (draft | review | ready).
export async function updateDocumentStatus(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const s = String(formData.get("status") ?? "");
  if (!id || !["draft", "review", "ready"].includes(s)) return;
  const supabase = createServerClient();
  await supabase
    .from("documents")
    .update({ status: s as import("@/lib/supabase/database.types").DocumentStatus })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// --- Shareable data-room links --------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const { pbkdf2Sync, randomBytes } = await import("crypto");
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${hash}`;
}

async function comparePassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("pbkdf2:")) {
    // Legacy sha256 hashes: reject and require re-auth with new hash.
    return false;
  }
  const [, salt, expectedHash] = stored.split(":");
  const { pbkdf2Sync } = await import("crypto");
  const actualHash = pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  return actualHash === expectedHash;
}

export async function createShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const label = String(formData.get("label") ?? "").trim() || null;
  const days = Number(String(formData.get("expires_in_days") ?? "").trim());
  const expires_at =
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

  const requireEmail = formData.get("require_email") === "1";
  const requireNda = formData.get("require_nda") === "1";
  const ndaText = String(formData.get("nda_text") ?? "").trim() || null;
  const passwordRaw = String(formData.get("password") ?? "").trim();
  const password_hash = passwordRaw ? await hashPassword(passwordRaw) : null;
  const recipientEmail = String(formData.get("recipient_email") ?? "").trim() || null;
  const notifyOnOpen = formData.get("notify_on_open") === "1";

  const supabase = createServerClient();
  const { data: inserted } = await supabase
    .from("data_room_shares")
    .insert({
      organization_id: ctx.orgId,
      label,
      expires_at,
      created_by: ctx.userId,
      require_email: requireEmail,
      require_nda: requireNda,
      nda_text: ndaText,
      password_hash,
      recipient_email: recipientEmail,
      notify_on_open: notifyOnOpen,
    } as never)
    .select("token")
    .maybeSingle();

  revalidatePath(ROOM);

  // Send share-granted email to the recipient if provided.
  if (recipientEmail && inserted) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", ctx.orgId)
      .maybeSingle();
    if (orgRow) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fundexecs.com";
      const shareUrl = `${baseUrl}/dataroom/${(inserted as { token: string }).token}`;
      const { subject, html } = shareGrantedEmail(orgRow.name as string, label, shareUrl, expires_at);
      void sendEmail({ to: { name: "", email: recipientEmail }, subject, htmlBody: html }).catch(() => undefined);
    }
  }
}

/** Verify a data-room password from the public viewer (no auth required). */
export async function verifySharePassword(token: string, password: string): Promise<boolean> {
  const { createServiceClient, hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return false;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("data_room_shares")
    .select("password_hash, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data?.password_hash) return false;
  if (data.revoked_at) return false;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
  return comparePassword(password, data.password_hash);
}

/**
 * Record section dwell time from the public data-room viewer.
 * Uses the service role because the data_room_views table has no anon insert policy.
 */
export async function trackDwell(formData: FormData): Promise<void> {
  const shareId = String(formData.get("share_id") ?? "").trim();
  const documentId = String(formData.get("document_id") ?? "").trim() || null;
  const durationSeconds = parseInt(String(formData.get("duration_seconds") ?? "0"), 10);
  const viewerEmail = String(formData.get("viewer_email") ?? "").trim() || null;
  const sessionId = String(formData.get("session_id") ?? "").trim() || null;

  if (!shareId || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

  const { createServiceClient, hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return;
  const supabase = createServiceClient();

  // Validate the share exists and is still valid before recording.
  const { data: share } = await supabase
    .from("data_room_shares")
    .select("organization_id, revoked_at, expires_at, label, notify_on_open, created_by")
    .eq("id", shareId)
    .maybeSingle();
  if (!share || share.revoked_at) return;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return;

  const shareData = share as {
    organization_id: string;
    revoked_at: string | null;
    expires_at: string | null;
    label: string | null;
    notify_on_open: boolean;
    created_by: string | null;
  };

  await supabase
    .from("data_room_views")
    .insert({
      organization_id: shareData.organization_id,
      share_id: shareId,
      document_id: documentId,
      kind: documentId ? "document" : "room",
      viewer_email: viewerEmail,
      duration_seconds: durationSeconds,
      session_id: sessionId,
    } as never)
    .then(() => undefined, () => undefined);

  // GP notification: email the share creator when notify_on_open is set.
  if (shareData.notify_on_open && shareData.created_by) {
    void notifyGpOnOpen({
      supabase,
      creatorId: shareData.created_by,
      orgId: shareData.organization_id,
      shareLabel: shareData.label,
      viewerEmail,
    }).catch(() => undefined);
  }
}

async function notifyGpOnOpen(args: {
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>;
  creatorId: string;
  orgId: string;
  shareLabel: string | null;
  viewerEmail: string | null;
}): Promise<void> {
  const { sendEmail: send } = await import("@/lib/email");
  // Fetch creator email from auth.users via the profiles table or org members.
  // Fall back to organization members — use created_by as principal_id.
  const { data: principal } = await args.supabase.auth.admin
    .getUserById(args.creatorId)
    .catch(() => ({ data: null }));
  const gpEmail = (principal as { user?: { email?: string } } | null)?.user?.email;
  if (!gpEmail) return;

  const { data: orgRow } = await args.supabase
    .from("organizations")
    .select("name")
    .eq("id", args.orgId)
    .maybeSingle();
  const orgName = escapeHtml((orgRow as { name: string } | null)?.name ?? "your fund");
  const label = escapeHtml(args.shareLabel ?? "your data room link");
  const safeViewer = args.viewerEmail ? escapeHtml(args.viewerEmail) : null;
  const viewer = safeViewer ? ` by ${safeViewer}` : "";
  const subject = `Your data room link was opened${viewer}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS</span>
    </div>
    <div style="padding: 32px 24px;">
      <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Someone opened your link</h1>
      <p style="margin: 0; font-size: 15px; color: #AAAAAA;">Your share link <strong style="color: #F5F5F5;">${label}</strong> for <strong style="color: #F5F5F5;">${orgName}</strong> was just opened${viewer}.</p>
      ${safeViewer ? `<p style="margin: 16px 0 0; font-size: 13px; color: #888888;">Viewer email: ${safeViewer}</p>` : ""}
    </div>
  </div>
</body>
</html>`;
  await send({ to: { name: "", email: gpEmail }, subject, htmlBody: html });
}

export async function revokeShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase
    .from("data_room_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// --- Document version history --------------------------------------------------
export async function listDocumentVersions(docId: string): Promise<DocumentVersion[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = createServerClient();
  const { data } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", docId)
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as DocumentVersion[];
}

export async function restoreDocumentVersion(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const versionId = String(formData.get("version_id") ?? "");
  const docId = String(formData.get("doc_id") ?? "");
  if (!versionId || !docId) return;
  const supabase = createServerClient();
  const { data } = await supabase
    .from("document_versions")
    .select("*")
    .eq("id", versionId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const version = data as DocumentVersion | null;
  if (!version) return;
  await supabase
    .from("documents")
    .update({ content: version.content, name: version.name })
    .eq("id", docId)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
  revalidatePath(`/document/${docId}`);
}

// Open a section's builder: jump to the section's most recent document, creating
// an empty one first when the section has none. Drives the coverage list — each
// section/document is a click into the document builder.
export async function openSection(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const sectionKey = String(formData.get("section") ?? "").trim();
  const sectionDef = DATA_ROOM_SECTIONS.find((s) => s.key === sectionKey);
  if (!sectionDef) return;

  const supabase = createServerClient();
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("doc_type", sectionDef.key)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let id = existing?.id;
  if (!id) {
    const { data: created } = await supabase
      .from("documents")
      .insert({
        organization_id: ctx.orgId,
        name: sectionDef.label,
        doc_type: sectionDef.key,
        mime_type: "text/markdown",
        uploaded_by: ctx.userId,
      })
      .select("id")
      .maybeSingle();
    id = created?.id;
  }
  if (id) redirect(`/document/${id}`);
}
