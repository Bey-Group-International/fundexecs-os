# FundExecs OS

[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/Bey-Group-International/fundexecs-os?utm_source=oss&utm_medium=github&utm_campaign=Bey-Group-International%2Ffundexecs-os&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

FundExecs OS is an AI-native private-market command center for funds, LPs,
operators, capital providers, and ecosystem partners. It turns the deal
loop — sourcing, allocation, governance, partnerships, evidence-backed
trust, and execution intelligence — into one workspace.

Built with **Next.js 16** (App Router + Server Actions), **Supabase**
(Auth + Postgres + pgvector + Storage), **Tailwind v4**, and an
**Anthropic Claude** specialist team (Earn is the COO, never called
"copilot"; specialists / executive team is the canonical wording).

This README gets a new contributor productive in under 30 minutes.

---

## Member types — what each dashboard shows

Every member picks one of five `member_type` values at signup. The
choice routes them to a dashboard layout tuned to the workflow.

| `member_type`         | Layout file                         | Hero KPIs (4)                                                     | List sections                                         |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `investment_firm`     | `InvestmentFirmLayout.tsx` (GP)     | Pipeline value · Active deals · Capital deployed · Sourced 30d    | Active deals, Capital providers, Partnerships         |
| `individual_investor` | `IndividualInvestorLayout.tsx` (LP) | Active deals · Allocations $ · Syndicate · Watchlist              | Active positions, Watchlist, Syndicate contacts       |
| `startup`             | `StartupLayout.tsx`                 | Raise progress · Capital committed · Pipeline · Founder check-ins | Raise progress, Active rounds, Cap table teaser       |
| `service_provider`    | `ServiceProviderLayout.tsx`         | Active engagements · Hours billed · Pipeline · Reviews            | Active engagements, Recent referrals, Service catalog |
| `student`             | `StudentLayout.tsx`                 | Brains learned · XP · Streak · Next milestone                     | Recent brains, Mentor connections, Live opportunities |

All five share a common header (`MemberDashboardChrome`): COO greeting +
Chain-of-Trust strip + right-rail Earn next-best-actions.

---

## Chain of Trust

Every entity (deal, member, startup, partnership) earns a four-layer
verifiable record:

```
Proof of Truth  →  Proof of Concept  →  Proof of Execution  →  Proof of Work
```

End-to-end flow:

1. Click a `Start CoT` chip on a deal row (or `View trust` if one
   exists). Drawer opens.
2. Upload evidence (PDF, DOCX, image, JSON, code) to a layer. The form
   does a **two-step signed-URL upload**: the server action mints a
   token, the client PUTs the blob directly to private Supabase Storage
   (`trust-evidence` bucket), the server finalizes + kicks off AI
   validation.
3. **AI validation is never-block.** `aiValidateEvidence` writes
   `evidence.ai_validation_notes` + `ai_validated_at` on every exit
   path — missing API key, missing context, Claude error, 8-second
   abort timeout. The fallback note (`AI validation unavailable;
proceed with manual review.`) keeps approvals unblocked.
4. The org owner or admin clicks `Approve` (or `Reject` with a reason).
   Approval cascades: evidence → `approved`, the proof layer → 100% +
   `approved`, the chain advances to the next layer, the uploader
   earns +15 XP, and a `trust_events` audit row is written.
5. Pipeline / Command-Center / LP dashboards reflect the new
   `Trust · N%` chip immediately (server-action `revalidatePath`).

Schema (additive, idempotent migrations under `supabase/migrations/`):

- `chain_of_trust_records {id, org_id, entity_type, entity_id, current_layer, completion_percentage}`
- `proof_layers {id, chain_record_id, layer_name, completion_percentage, human_approval_status}`
- `evidence {id, proof_layer_id, storage_path, file_name, mime_type, size_bytes, approval_status, ai_validation_notes, ai_validated_at, …}`
- `trust_events {id, org_id, actor_id, entity_type, entity_id, action, metadata}`

---

## Integrations (Phase 6 — owned by Codex on a separate PR)

Real OAuth for **Slack** and **Calendly** is in flight; **Gmail**,
**Google Calendar**, **Apollo**, and **Outlook** are wired through a
mock-or-real adapter pattern that lets the rest of the product code
stay identical when the user has not yet connected a provider.

Required env vars (provided to Codex separately):

```
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_SIGNING_SECRET
CALENDLY_CLIENT_ID
CALENDLY_CLIENT_SECRET
```

---

## Local setup

```bash
# 1. Install
yarn install

# 2. Configure
cp .env.local.example .env.local      # then fill in the secrets listed below
# (or grab a fresh copy from 1Password — Phase-7-OS shared vault)

# 3. Apply migrations (one-shot, idempotent)
#   either via Supabase Dashboard SQL editor or the Supabase CLI:
npx supabase db push                  # requires `supabase login` + project link

# 4. Seed 5 test users (one per member_type)
yarn seed:test-users                  # idempotent, re-applies canonical password

# 5. Run dev
yarn dev                              # http://localhost:3000
```

Production build sanity:

```bash
yarn format:check && yarn build && yarn typecheck && yarn lint
```

---

## Env vars

Set in `.env.local` (gitignored — never committed). No defaults; missing
values fail fast.

| Name                            | Used by                                 | Notes                                            |
| ------------------------------- | --------------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server Supabase clients        | Public                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + auth flows                     | Public                                           |
| `SUPABASE_SERVICE_ROLE_KEY`     | server-only (admin client, AI uploads)  | NEVER exposed to client                          |
| `SUPABASE_DB_URL`               | migrations / scripts                    | Postgres pooler URL                              |
| `ANTHROPIC_API_KEY`             | AI validation (`lib/ai/trust-validate`) | Optional — fallback note still writes without it |
| `VOYAGE_API_KEY`                | brain embedding pipeline                | Optional in dev                                  |
| `EARN_MODEL`                    | Claude model override                   | Default `claude-sonnet-4-6`                      |
| `SLACK_CLIENT_ID`               | Phase 6 OAuth                           | Codex-owned                                      |
| `SLACK_CLIENT_SECRET`           | Phase 6 OAuth                           | Codex-owned                                      |
| `SLACK_SIGNING_SECRET`          | Phase 6 webhooks                        | Codex-owned                                      |
| `CALENDLY_CLIENT_ID`            | Phase 6 OAuth                           | Codex-owned                                      |
| `CALENDLY_CLIENT_SECRET`        | Phase 6 OAuth                           | Codex-owned                                      |

---

## Test users

Five users seeded by `yarn seed:test-users`, one per `member_type`:

```
test+investment_firm@fundexecs-staging.dev
test+individual_investor@fundexecs-staging.dev
test+startup@fundexecs-staging.dev
test+service_provider@fundexecs-staging.dev
test+student@fundexecs-staging.dev
```

Shared password lives at `/app/memory/test_credentials.md` (not in this
README so the docs file can rotate it). The script is idempotent and
re-applies the canonical password on every run.

The `investment_firm` user starts at
`member_profiles.status='complete'` so the GP dashboard renders against
real data; the other four start at `'in_progress'` so onboarding flows
are exercisable.

---

## Code map

```
app/
  command-center/    → 5 member-type layouts, shared chrome, Earn rail
  pipeline/          → Phase 4 deals + allocations
  connections/       → Warm intros + warmth-scored contacts
  strategy/          → 100/30/10 governance plan
  notifications/     → Read / dismiss / mark-all server actions
  admin/             → Owner-only org admin panels
  settings/          → Org + member profile + brand (Codex Deliverable F)
  integrations/      → Phase 6 — owned by Codex
  ask-earn/          → Streaming chat with Earn (COO)

components/
  shell/             → AppShell, sidebar, Earn dock, trust toaster
  shell/trust/       → Drawer + Host (context) + layer metadata
  drawers/           → Drawer primitive + per-entity drawers
  dashboard/         → KPI tiles, Earn actions, CoT strip, deal trust chip
  proof-of-truth/    → Onboarding step-through (signup)
  ui/                → Card, Button, Badge, ProgressBar, etc.

lib/
  actions/           → Server actions (one file per domain)
  queries/           → Read-side query helpers (server-only)
  ai/                → trust-validate, earn (streaming chat), embeddings
  team/              → 15 specialists registry (frozen)
  supabase/          → server / client / admin / middleware helpers
                       + database.types.ts (additive Phase-4/5 augments)

supabase/
  migrations/        → Numbered, additive, idempotent SQL
```

---

## Invariants (enforced by CI + reviews)

- "Copilot" is retired. Use "specialist" / "executive team".
- All Supabase secrets read from `process.env`. No defaults.
- Migrations are additive + idempotent; no `DROP`.
- Brain slugs and `lib/team/*` are frozen.
- AI calls are **never-block**: missing key / timeout / API failure
  must degrade gracefully and never block an approval path.
- Server actions handle all writes under RLS. Service role is used
  only for signed URLs and the AI's read-side object download.

---

## Status

Working beta — Phase 1–7 shipped on the FundExecs / Bey Group sprint.
Codex's Phase 6 integration PR is the final piece before unified merge.
