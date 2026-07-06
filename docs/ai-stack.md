# AI Intelligence Stack

The AI tooling wired into this repo for Claude Code sessions — MCP servers and
Agent Skills — plus reference frameworks. This is **developer/agent tooling**,
not application runtime code: it augments Claude sessions working on
`fundexecs-os`, and never ships to production.

## One-command setup

```bash
scripts/setup-ai-stack.sh                 # Apollo MCP + Apache-2.0 skills
scripts/setup-ai-stack.sh --with-doc-skills   # + docx/pdf/pptx/xlsx (source-available)
scripts/setup-ai-stack.sh --with-references   # + OpenAI Agents SDK & cookbooks
```

The script clones/builds third-party code into `/tools/` and copies skills into
`.claude/skills/` — **both gitignored**, so no third-party code is committed
into this repo. Only the config (`.mcp.json`), the setup script, and this doc
are versioned. Re-running is safe (idempotent).

After running it, set `APOLLO_API_KEY` in your environment and restart Claude
Code so it picks up `.mcp.json` and the skills.

---

## MCP servers (`.mcp.json`)

| Server | Source | What it adds |
|--------|--------|--------------|
| `apollo-io` | [Inferensys/apollo-io-mcp](https://github.com/Inferensys/apollo-io-mcp) (MIT) | 45 Apollo.io tools — people/company search, contact enrichment (verified email/phone), CRM (contacts/accounts/deals/tasks/notes), email sequences, pipeline stages. |

`.mcp.json` launches it as `node tools/apollo-io-mcp/dist/index.js` and passes
`APOLLO_API_KEY` from the environment. Run the setup script first so the build
exists at that path.

> **Note on overlap.** claude.ai already exposes a hosted **Apollo.io connector**
> in Claude sessions, and the app itself calls Apollo over REST
> (`lib/integrations/providers/apollo.ts`). This committed `.mcp.json` makes the
> same Apollo tooling **portable and self-contained** for any Claude Code session
> on the repo (e.g. local dev), independent of the hosted connector.

---

## Agent Skills (`.claude/skills/`)

Reusable Claude skills from [anthropics/skills](https://github.com/anthropics/skills).
The setup script installs this Apache-2.0 subset by default, chosen for a
private-markets / fund-ops codebase:

| Skill | Why it's here |
|-------|---------------|
| `claude-api` | Building Claude features — the app *is* Claude-native (`lib/claude.ts`, `lib/brains/`). |
| `mcp-builder` | Authoring/extending MCP servers (we just added one). |
| `skill-creator` | Scaffolding new project-specific skills. |
| `doc-coauthoring` | Drafting IC memos, LP updates, and other deliverables. |
| `brand-guidelines` | Consistent investor-facing materials (decks, one-pagers). |
| `webapp-testing` | Driving the Next.js app end-to-end. |

### Document skills (opt-in)

`docx`, `pdf`, `pptx`, `xlsx` are the most functionally relevant (models → xlsx,
memos → docx, decks → pptx) **but are source-available, not open source** —
Anthropic shares them as reference implementations, not under an OSS license. To
avoid a licensing conflict in this MIT repo they are **not** installed or
committed by default. Pull them locally only if your use complies with their
terms:

```bash
scripts/setup-ai-stack.sh --with-doc-skills
```

---

## Reference frameworks (`--with-references`)

Cloned into `/tools/reference/` as reference material — not wired into the app,
which is Claude-native:

| Reference | Source | Use |
|-----------|--------|-----|
| OpenAI Agents SDK | [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | Alternative agent framework; installed into `tools/reference/.venv`. |
| OpenAI cookbook | [openai/openai-cookbook](https://github.com/openai/openai-cookbook) | Example patterns. |
| Anthropic cookbook | [anthropics/anthropic-cookbook](https://github.com/anthropics/anthropic-cookbook) | Claude example patterns (the app already depends on `@anthropic-ai/sdk`). |

Adding OpenAI as a *runtime* provider would be a separate, larger decision (a
second LLM vendor alongside Claude) — this only makes the SDK/examples available
for reference.

---

## Not installed

- **[mmh5309/apollo](https://github.com/mmh5309/apollo)** — a marketing/review
  article about Apollo.io, not code. Nothing to install.
- **[loosehose/Apollonator](https://github.com/loosehose/Apollonator)** — a Go
  OSINT email-enumeration CLI. Deliberately excluded: its bulk name→email
  scraping pattern risks Apollo.io ToS violations and doesn't fit a production
  financial app. The app already does verified, per-record Apollo enrichment
  through the official API.
