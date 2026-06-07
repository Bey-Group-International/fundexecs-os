# GitHub Enterprise deep dive — value to the FundExecs agentic dev loop

Focused on what accelerates **this** build/review/merge workflow (multi-agent
PRs, CI, CodeRabbit, Codex/Claude lanes, Supabase migrations, security), not
generic platform marketing. Companion to `docs/SECURITY_SETUP.md`.

> Capability note: items marked **[shipped]** are config-as-code in this repo.
> **[enable]** items are owner/billing/UI actions. Plan tiers noted per item.

---

## The features that most add value (ranked)

### 1. Merge queue — biggest workflow win **[shipped: ruleset rule + CI `merge_group` trigger]**

Today PRs merge one at a time: check CI → mark ready → squash → re-pull main →
repeat (and hit API rate limits doing it). A merge queue lets PRs be **enqueued**;
GitHub batches them, **re-runs required checks against the post-merge state**, and
merges only if still green — handling ordering and base-staleness automatically.

- Shipped: `merge_queue` rule in `.github/rulesets/main-branch-protection.json`
  (squash, all-green grouping) + `merge_group` added to `ci.yml` triggers so the
  required checks resolve inside the queue.
- **[enable]** Import the ruleset (Settings → Rules → Rulesets). _Plan: Team /
  Enterprise for private repos._

### 2. Push rulesets — auto-enforce guardrails **[shipped: `push-protection.json`]**

Converts discipline ("no `yarn.lock`/`pnpm-lock.yaml`", "no giant binaries") into
server-enforced rules that no agent (Claude/Codex/Copilot) or human can violate.

- Shipped: `.github/rulesets/push-protection.json` — `file_path_restriction`
  blocks lockfiles; `max_file_size` (50 MB) blocks accidental large blobs.
- **[enable]** Import it. _Plan: Team+._ (Sensitive **code** paths stay governed
  by CODEOWNERS review, not push blocks, so legitimate PRs aren't blocked.)

### 3. Least-privilege Actions token **[shipped: `ci.yml`]**

Set the default `GITHUB_TOKEN` to `contents: read` at the workflow level — a cheap
supply-chain win (a compromised action can't write to the repo). Shipped in
`ci.yml`. _Plan: any._

> Note on **build-provenance attestations**: proposed initially, but **not shipped
> here** — this app publishes no distributable artifact (Vercel builds + deploys;
> CI only validates), so there's nothing meaningful to attest. Revisit if we ever
> publish a container/package/release binary.

### 4. Org / Enterprise rulesets (GA Mar 2025) **[enable]**

Define the standards once at the org/enterprise level — required checks, required
PR + approvals, **squash-only** merge method, linear history, CODEOWNERS review —
with rule-insights and bypass visibility across every repo. _Plan: Enterprise for
org/enterprise scope; the repo-level JSON here is the same shape._

### 5. Copilot coding agent — a native third agent lane **[enable]**

Assign a GitHub **issue** (or a code-scanning alert) to `@copilot`; it spins a
sandboxed Actions environment, plans a task checklist, pushes commits, opens a PR,
and self-validates with CodeQL + secret scanning. Slots into the existing
Claude/Codex multi-lane model — route well-scoped backlog issues (the #115-style
briefs) to Copilot for parallel autonomous execution. _Plan: Copilot Enterprise._

### 6. Code Security + Copilot Autofix / Code Quality / Copilot code review **[enable]**

- **Autofix**: CodeQL/secret findings get one-click — or auto-assigned — Copilot
  fix PRs, so security issues self-remediate.
- **Code Quality** (public preview): reliability/maintainability scores + fixes,
  enforceable via rulesets.
- **Copilot code review**: an agentic reviewer that can run CodeQL/ESLint as tools
  and hand fixes to the coding agent; complements CodeRabbit (enforce via the
  "Request review from Copilot" ruleset rule). _Plan: Code Security add-on (works
  on private without full Enterprise) / Copilot Enterprise._

---

## Recommended sequencing

1. **Now (Pro/Team):** import the upgraded branch ruleset (merge queue) +
   `push-protection.json`. Immediately makes the agent loop faster and safer.
2. **Add Code Security** (standalone add-on): Copilot Autofix on private code.
3. **At Enterprise:** org/enterprise rulesets + Copilot coding agent (3rd lane) +
   Copilot code review + audit-log streaming + SSO/SCIM.

## Sources

- Enterprise rulesets + merge-method GA — github.blog/changelog 2025-03-24
- Available rules for rulesets — docs.github.com (managing-rulesets)
- Managing a merge queue — docs.github.com
- Copilot coding agent — github.blog product-news
- Assign code-scanning alerts to Copilot — github.blog/changelog 2025-10-28
- Copilot code review preview — github.blog/changelog 2025-10-28
