#!/usr/bin/env bash
# setup-ai-stack.sh — materialize the AI-intelligence tooling for this repo.
#
# What it installs (all into gitignored working dirs, so no third-party code is
# committed into fundexecs-os):
#   - tools/apollo-io-mcp        Apollo.io MCP server (Inferensys, MIT) — wired
#                                in .mcp.json so Claude sessions on this repo get
#                                45 Apollo tools (search, enrich, CRM, sequences).
#   - .claude/skills/*           Anthropic Agent Skills (Apache-2.0 subset by
#                                default) — reusable Claude skills. The document
#                                skills (docx/pdf/pptx/xlsx) are source-available
#                                (NOT open source), so they are opt-in.
#   - tools/reference/*          (opt-in) OpenAI Agents SDK + the OpenAI and
#                                Anthropic cookbooks, as reference material.
#
# Usage:
#   scripts/setup-ai-stack.sh                 # Apollo MCP + Apache-2.0 skills
#   scripts/setup-ai-stack.sh --with-doc-skills   # also pull docx/pdf/pptx/xlsx
#   scripts/setup-ai-stack.sh --with-references   # also clone SDK/cookbook refs
#
# Requires: git, node/npm. Optional (for --with-references): python3, pip.
# Idempotent: safe to re-run; existing clones are updated in place.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_DOC_SKILLS=0
WITH_REFERENCES=0
for arg in "$@"; do
  case "$arg" in
    --with-doc-skills) WITH_DOC_SKILLS=1 ;;
    --with-references) WITH_REFERENCES=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;36m[ai-stack]\033[0m %s\n' "$*"; }

mkdir -p tools .claude/skills

# --- 1. Apollo.io MCP server -------------------------------------------------
# Clone + build the Inferensys server. .mcp.json points at tools/apollo-io-mcp/
# dist/index.js and passes APOLLO_API_KEY from the environment.
install_apollo_mcp() {
  local dir="tools/apollo-io-mcp"
  if [ -d "$dir/.git" ]; then
    log "Updating apollo-io-mcp"
    git -C "$dir" pull --ff-only --quiet || true
  else
    log "Cloning apollo-io-mcp"
    git clone --depth 1 https://github.com/Inferensys/apollo-io-mcp.git "$dir"
  fi
  log "Building apollo-io-mcp"
  ( cd "$dir" && npm install --silent && npm run build --silent )
  [ -f "$dir/dist/index.js" ] && log "apollo-io-mcp ready → $dir/dist/index.js"
}

# --- 2. Anthropic Agent Skills ----------------------------------------------
# Sparse-checkout only the skills we want, then copy them under .claude/skills/.
# APACHE_SKILLS are open source; DOC_SKILLS are source-available (opt-in).
APACHE_SKILLS=(claude-api mcp-builder skill-creator doc-coauthoring brand-guidelines webapp-testing)
DOC_SKILLS=(docx pdf pptx xlsx)

install_skills() {
  local wanted=("${APACHE_SKILLS[@]}")
  if [ "$WITH_DOC_SKILLS" -eq 1 ]; then
    log "Including source-available document skills (docx/pdf/pptx/xlsx)"
    wanted+=("${DOC_SKILLS[@]}")
  fi

  local tmp="tools/.skills-src"
  rm -rf "$tmp"
  log "Fetching Anthropic Agent Skills: ${wanted[*]}"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/anthropics/skills.git "$tmp" --quiet
  ( cd "$tmp" && git sparse-checkout set "${wanted[@]/#/skills/}" --quiet )
  for s in "${wanted[@]}"; do
    if [ -d "$tmp/skills/$s" ]; then
      rm -rf ".claude/skills/$s"
      cp -R "$tmp/skills/$s" ".claude/skills/$s"
      log "  installed skill: $s"
    fi
  done
  rm -rf "$tmp"
}

# --- 3. Reference frameworks (opt-in) ---------------------------------------
# OpenAI Agents SDK (Python) + the OpenAI and Anthropic cookbooks. These are
# references / alternative frameworks, not wired into the app — cloned into
# tools/reference and (for the SDK) installed into a local venv.
install_references() {
  local ref="tools/reference"
  mkdir -p "$ref"
  clone_ref() {
    local url="$1" name="$2"
    if [ -d "$ref/$name/.git" ]; then git -C "$ref/$name" pull --ff-only --quiet || true
    else git clone --depth 1 "$url" "$ref/$name" --quiet; fi
    log "  reference: $ref/$name"
  }
  clone_ref https://github.com/openai/openai-agents-python.git openai-agents-python
  clone_ref https://github.com/openai/openai-cookbook.git openai-cookbook
  clone_ref https://github.com/anthropics/anthropic-cookbook.git anthropic-cookbook

  if command -v python3 >/dev/null 2>&1; then
    log "Installing the OpenAI Agents SDK into tools/reference/.venv"
    python3 -m venv "$ref/.venv"
    "$ref/.venv/bin/pip" install --quiet --upgrade pip openai-agents || \
      log "pip install openai-agents failed (network/policy) — SDK source is in $ref/openai-agents-python"
  else
    log "python3 not found — skipping OpenAI Agents SDK venv (source cloned above)"
  fi
}

install_apollo_mcp
install_skills
[ "$WITH_REFERENCES" -eq 1 ] && install_references

log "Done. Set APOLLO_API_KEY in your environment, then restart Claude Code so it"
log "picks up .mcp.json and .claude/skills/. See docs/ai-stack.md for details."
