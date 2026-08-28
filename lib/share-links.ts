// lib/share-links.ts
//
// Minting a share link for a session. Server-side only — it takes a Supabase
// client rather than creating one, so both server actions that share a session
// go through the same code path.
//
// There used to be two, and they disagreed. `createSessionShare` inserted
// unconditionally, one row and one live token per click; `shareEarnConversation`
// looked up first, then re-read afterwards to survive a race. Neither could be
// atomic, because nothing stopped two rows existing for the same
// (session, org, scope).
//
// Migration 20260828193000 adds that uniqueness, which lets this collapse to a
// single upsert: one row per session per scope, and the same URL handed back
// however many times it is asked for.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
// One definition of the scope, in the pure module the viewer's access policy
// already lives in — a second copy here could drift out of step with it.
import type { ShareScope } from "@/lib/session-share";

/** Matches the alias every other lib module uses for a typed client. */
type Client = SupabaseClient<Database>;

export type { ShareScope };

export interface MintShareLinkResult {
  ok: boolean;
  /** Path, not an absolute URL — the caller knows its own origin. */
  url?: string;
  error?: string;
}

export interface MintShareLinkInput {
  orgId: string;
  userId: string;
  sessionId: string;
  scope: ShareScope;
}

/**
 * Create the share for `(sessionId, orgId, scope)`, or return the one already
 * there. Verifies the session belongs to the caller's org first: RLS enforces
 * that too, but checking here turns a silent empty result into a clear answer.
 */
export async function mintShareLink(
  supabase: Client,
  { orgId, userId, sessionId, scope }: MintShareLinkInput,
): Promise<MintShareLinkResult> {
  if (!sessionId) return { ok: false, error: "There's nothing to share yet." };

  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!session) return { ok: false, error: "That conversation is no longer available." };

  // One statement, so concurrent callers cannot each create a token. The
  // conflict target is the unique index from 20260828193000; `ignoreDuplicates`
  // keeps the existing row's token rather than rotating it, which matters
  // because that token may already be circulating.
  const { data, error } = await supabase
    .from("session_shares")
    .upsert(
      {
        organization_id: orgId,
        session_id: sessionId,
        scope,
        created_by: userId,
      },
      { onConflict: "session_id,organization_id,scope", ignoreDuplicates: true },
    )
    .select("token")
    .maybeSingle();

  if (error) {
    console.error("[mintShareLink]", error.message);
    return { ok: false, error: "Couldn't create a share link just now." };
  }

  // `ignoreDuplicates` returns no row when one already existed, which is the
  // common case for a second share of the same conversation — read it back.
  let token = data?.token;
  if (!token) {
    const { data: existing } = await supabase
      .from("session_shares")
      .select("token")
      .eq("session_id", sessionId)
      .eq("organization_id", orgId)
      .eq("scope", scope)
      .maybeSingle();
    token = existing?.token;
  }

  if (!token) return { ok: false, error: "Couldn't create a share link just now." };
  return { ok: true, url: `/s/${token}` };
}
