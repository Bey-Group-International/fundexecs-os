import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { chunkText } from "@/lib/brains/vector";
import { embedder, toVectorLiteral } from "@/lib/brains/embed";
import { BRAINS } from "@/lib/brains/catalog";
import type { BrainKey } from "@/lib/brains/types";

// POST /api/brains/ingest — seed the shared Brain knowledge-base corpus.
//
// Reads lib/brains/knowledge/<brain_key>.md, chunks + embeds each file with the
// zero-cost local embedder, and upserts into brain_kb_chunks via the service-role
// client (RLS-bypassing — the table has no write policy by design). Idempotent:
// it deletes a brain's existing rows before inserting, so it is safe to run
// repeatedly.
//
// Guard mirrors the cron pattern: a shared secret OR an authenticated org writer.
//   - Authorization: Bearer <BRAIN_INGEST_SECRET>  (CI / scripted, no session), or
//   - a logged-in user who can write in at least one org (manual re-seed).
//
// Force dynamic so file reads + DB writes never run at build time.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KNOWLEDGE_DIR = path.join(process.cwd(), "lib", "brains", "knowledge");

async function isAuthorized(request: Request): Promise<boolean> {
  // 1) Shared-secret path (scripted/CI), mirrors CRON_SECRET in app/api/cron.
  const secret = process.env.BRAIN_INGEST_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }
  // 2) Authenticated-org-writer path (manual re-seed from a logged-in session).
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id")
      .in("role", ["owner", "admin", "member"])
      .limit(1);
    return !error && Boolean(data && data.length > 0);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Ingestion requires SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const results: { brainKey: string; source: string; chunks: number; status: string }[] = [];

  for (const brain of BRAINS) {
    const brainKey = brain.key as BrainKey;
    const source = `${brainKey}.md`;
    let content: string;
    try {
      content = await fs.readFile(path.join(KNOWLEDGE_DIR, source), "utf8");
    } catch {
      results.push({ brainKey, source, chunks: 0, status: "skipped: no KB file" });
      continue;
    }

    const chunks = chunkText(content);
    if (chunks.length === 0) {
      results.push({ brainKey, source, chunks: 0, status: "skipped: empty" });
      continue;
    }

    // Idempotent: clear this brain's existing rows before re-inserting.
    const { error: delError } = await supabase
      .from("brain_kb_chunks")
      .delete()
      .eq("brain_key", brainKey);
    if (delError) {
      results.push({ brainKey, source, chunks: 0, status: `failed: ${delError.message}` });
      continue;
    }

    const rows = chunks.map((text, i) => ({
      brain_key: brainKey,
      source,
      chunk_index: i,
      content: text,
      embedding: toVectorLiteral(embedder.embed(text)),
    }));

    const { error: insError } = await supabase.from("brain_kb_chunks").insert(rows);
    if (insError) {
      results.push({ brainKey, source, chunks: 0, status: `failed: ${insError.message}` });
      continue;
    }

    results.push({ brainKey, source, chunks: rows.length, status: "ok" });
  }

  const totalChunks = results.reduce((n, r) => n + r.chunks, 0);
  return NextResponse.json({ ingested: results.length, totalChunks, results });
}
