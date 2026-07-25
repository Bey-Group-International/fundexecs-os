#!/usr/bin/env bash
# ingest-brains.sh — re-seed the Brain knowledge-base corpus into pgvector.
#
# The per-Brain corpora live in lib/brains/knowledge/ (+ workflow/, reference/)
# and are the RETRIEVAL source: they are embedded at ingest time, not read live.
# So after editing any corpus you must re-run ingestion or the Brains keep
# reasoning over the previous embeddings. This script drives that in one step.
#
# What it does:
#   1. POST /api/brains/ingest  — re-embeds every Brain's corpus and upserts it
#      (idempotent: each Brain's rows are cleared, then re-inserted).
#   2. (opt) --reembed          — after ingest, drives POST /api/brains/reembed
#      in a loop until `remaining` is 0. Only needed when the EMBEDDER model /
#      vector space changed; a plain content refresh does not need it.
#
# Usage:
#   BRAIN_INGEST_SECRET=... scripts/ingest-brains.sh
#   BRAIN_INGEST_SECRET=... BASE_URL=https://app.example.com scripts/ingest-brains.sh
#   BRAIN_INGEST_SECRET=... scripts/ingest-brains.sh --reembed
#
# Env:
#   BRAIN_INGEST_SECRET   (required) shared secret the ingest/reembed routes accept.
#   BASE_URL              (optional) app origin; defaults to http://localhost:3000.
#
# Requires: curl. The server env must also hold SUPABASE_SERVICE_ROLE_KEY (the
# routes write via the service-role client); this script never sees it.
# Idempotent: safe to re-run.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
REEMBED=0
for arg in "$@"; do
  case "$arg" in
    --reembed) REEMBED=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${BRAIN_INGEST_SECRET:-}" ]]; then
  echo "ERROR: BRAIN_INGEST_SECRET is not set (the ingest/reembed routes require it)." >&2
  echo "       export BRAIN_INGEST_SECRET=... and re-run." >&2
  exit 1
fi

AUTH=(-H "Authorization: Bearer ${BRAIN_INGEST_SECRET}")

echo "→ Ingesting Brain corpora at ${BASE_URL}/api/brains/ingest ..."
code="$(curl -sS -o /tmp/brain-ingest.json -w '%{http_code}' -X POST "${AUTH[@]}" "${BASE_URL}/api/brains/ingest")"
cat /tmp/brain-ingest.json
echo
if [[ "$code" != "200" ]]; then
  echo "✗ Ingest failed (HTTP ${code})." >&2
  exit 1
fi
echo "✓ Ingest complete (HTTP 200)."

if [[ "$REEMBED" == "1" ]]; then
  echo "→ Draining re-embed backfill at ${BASE_URL}/api/brains/reembed ..."
  for _ in $(seq 1 100); do
    code="$(curl -sS -o /tmp/brain-reembed.json -w '%{http_code}' -X POST "${AUTH[@]}" "${BASE_URL}/api/brains/reembed")"
    cat /tmp/brain-reembed.json; echo
    [[ "$code" != "200" ]] && { echo "✗ Re-embed failed (HTTP ${code})." >&2; exit 1; }
    # Stop once the route reports nothing left to migrate.
    grep -q '"remaining":0' /tmp/brain-reembed.json && { echo "✓ Re-embed drained."; break; }
  done
fi
