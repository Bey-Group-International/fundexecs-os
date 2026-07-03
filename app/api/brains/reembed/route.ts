import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getEmbedder, toVectorLiteral } from "@/lib/brains/embed";

// POST /api/brains/reembed — the re-embed backfill for the Brain KB.
//
// When the active embedder changes vector space (hash-v1 → voyage, or a future
// model/dimension change), existing brain_kb_chunks rows are stranded in the
// old space: retrieval filters them out rather than mis-ranking them, so the
// corpus silently shrinks until it is re-embedded. This route migrates one
// batch per call — find rows whose embedding_model differs from the active
// embedder's, re-embed their content, and update embedding + embedding_model
// in place. Run it repeatedly (cron or a loop) until `remaining` reaches 0.
//
// Guarded like the ingest route's scripted path: Authorization: Bearer
// <BRAIN_INGEST_SECRET> (or CRON_SECRET, so a scheduled sweep can drive it).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BATCH_SIZE = 50;

function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;
  for (const secret of [process.env.BRAIN_INGEST_SECRET, process.env.CRON_SECRET]) {
    if (secret && header === `Bearer ${secret}`) return true;
  }
  return false;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Backfill requires SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const embedder = getEmbedder();
  const supabase = createServiceClient();

  // One batch of rows stranded outside the active vector space.
  const { data: stale, error: readError } = await supabase
    .from("brain_kb_chunks")
    .select("id, content")
    .neq("embedding_model", embedder.model)
    .limit(BATCH_SIZE);
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!stale || stale.length === 0) {
    return NextResponse.json({ model: embedder.model, reembedded: 0, remaining: 0 });
  }

  let embeddings: number[][];
  try {
    embeddings = await embedder.embedBatch(
      stale.map((row) => row.content),
      "document",
    );
  } catch (err) {
    // Nothing was touched — the batch simply retries on the next run.
    const message = err instanceof Error ? err.message : "embedding failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let updated = 0;
  const failures: string[] = [];
  for (let i = 0; i < stale.length; i++) {
    const { error: upError } = await supabase
      .from("brain_kb_chunks")
      .update({
        embedding: toVectorLiteral(embeddings[i]),
        embedding_model: embedder.model,
      })
      .eq("id", stale[i].id);
    if (upError) failures.push(upError.message);
    else updated++;
  }

  const { count } = await supabase
    .from("brain_kb_chunks")
    .select("id", { count: "exact", head: true })
    .neq("embedding_model", embedder.model);

  return NextResponse.json({
    model: embedder.model,
    reembedded: updated,
    failed: failures.length,
    remaining: count ?? null,
    ...(failures.length ? { firstError: failures[0] } : {}),
  });
}
