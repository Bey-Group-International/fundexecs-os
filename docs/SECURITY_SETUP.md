# GitHub security hardening + Advanced Security + org-migration playbook

How to take FundExecs OS from "private repo with CI" to "hardened, Advanced-
Security-ready, audit-friendly" — and, if/when you want it, how to move the repo
into a GitHub Enterprise org without losing anything.

Three lanes, in priority order:

1. **Harden now** — config-as-code already in this repo (free, no Enterprise).
2. **Prep for Advanced Security** — what you flip on at the org/billing level.
3. **Org migration** — the "clone details over" plan.

> Capability note: items marked **[in repo]** are shipped here as code. Items
> marked **[you, in GitHub]** are owner/billing/UI actions that can't be done
> from code or from the agent's repo-scoped access — they're yours to click.

---

## 1) Harden now — what this PR adds **[in repo]**

| File                                           | What it does                                                                                                                                                                                                                       | How to activate                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `.github/CODEOWNERS`                           | Auto-requests review from owners; high-blast-radius lanes (`supabase/`, `lib/supabase`, `lib/actions`, `middleware.ts`, `proxy.ts`, `app/login`, `.github/`) flagged for extra scrutiny                                            | Active once merged. Swap `@BGI-Pres` for a team handle when teams exist                                                    |
| `.github/dependabot.yml`                       | Weekly grouped dependency PRs (npm) + Actions version bumps                                                                                                                                                                        | Active once merged; pair with Dependabot alerts (step 2)                                                                   |
| `.github/workflows/codeql.yml`                 | CodeQL static analysis (security-extended)                                                                                                                                                                                         | **Dormant** until `ENABLE_CODEQL=true` repo variable is set (after step 2) — so it never red-lights a PR before GHAS is on |
| `.github/rulesets/main-branch-protection.json` | Importable branch ruleset: PR + 1 approval, Code-Owner review, dismiss-stale, conversation resolution, required checks (`Typecheck, lint & build`, `Playwright e2e smoke`), linear history, block force-push/deletion, squash-only | Import in step 2                                                                                                           |

These capture most of the "enterprise hardening" value at $0.

---

## 2) Prep for Advanced Security **[you, in GitHub]**

### 2a. Pick the plan

- **Cheapest path to the security goal:** GitHub's standalone **Code Security**
  - **Secret Protection** add-ons (per active committer) — gets you CodeQL +
    secret scanning on the **private** repo **without** full Enterprise.
- **Full GitHub Enterprise Cloud** — add this when you need **SSO/SAML + SCIM**,
  org-wide policy, longer audit-log retention + **audit-log streaming**. Your
  "CI scale / org policy" goal (org rulesets, larger runners, more Actions
  minutes, deploy gates) also lives here.
- **Skip GitHub Enterprise _Server_ (self-hosted)** unless an LP/regulator
  mandates data residency — it's ops overhead you don't need pre-beta.

### 2b. Turn it on (Org → Settings)

- [ ] **Secret Protection**: enable **secret scanning** + **push protection**
      (blocks commits that contain Supabase service-role keys, Stripe, Voyage,
      Anthropic tokens, etc.). Highest ROI for you.
- [ ] **Code Security**: enable **code scanning**, then set repo variable
      **`ENABLE_CODEQL=true`** (Settings → Secrets and variables → Actions →
      Variables) to wake `codeql.yml`.
- [ ] **Dependabot**: enable **Dependabot alerts** + **security updates** (free)
      so CVE bumps are raised even between weekly runs.
- [ ] **Require 2FA** for all org members.
- [ ] **Dependency review** on PRs (comes with Code Security) — blocks pulling in
      a dependency with a known vuln.

### 2c. Import the branch ruleset

Settings → **Rules → Rulesets → New ruleset → Import** →
`.github/rulesets/main-branch-protection.json`. After CodeQL's first green run,
add **`CodeQL`** to the ruleset's required checks too.

> Private-repo rulesets/branch protection require **Team** or **Enterprise** —
> the JSON is ready regardless of when you upgrade.

### 2d. CI scale / org policy hardening **[you, in GitHub]**

- [ ] **Default workflow token = read-only** (Org/Repo → Actions → General →
      Workflow permissions). Our workflows request the few write scopes they need
      explicitly.
- [ ] **Pin/limit actions** to verified creators + the ones we use; Dependabot
      keeps them patched.
- [ ] **Environments**: add a `production` environment with **required
      reviewers** so deploys gate on a human approval (pairs with Vercel).
- [ ] On Enterprise: **org rulesets** (apply the branch policy across every repo) + **larger runners** / Actions-minute pool for faster CI.

---

## 3) Org migration — "clone details over" **[you, in GitHub]**

If the goal is to move FundExecs into a (new or existing) **Enterprise org**.

### Decide the method

- **Transfer** (recommended if you're _moving_): preserves history, issues, PRs,
  releases, wiki, stars, and watchers; sets up redirects from the old URL.
- **Mirror** (if you're _duplicating_, e.g. keeping the original): create the
  empty target repo, then
  `git clone --mirror <old> && cd <old>.git && git push --mirror <new>`. Note:
  a mirror copies **git data only** — issues/PRs/settings do **not** come along.

### Pre-transfer checklist

- [ ] You're an **owner** on both source and destination orgs.
- [ ] Inventory integrations to re-wire (below).
- [ ] Note current **secrets/variables** (names only) to recreate — values don't
      transfer.
- [ ] Freeze merges briefly to avoid in-flight PR churn.

### Transfer steps

1. Repo → Settings → **Danger Zone → Transfer** → destination org.
2. Confirm name; GitHub moves history/issues/PRs and adds URL redirects.

### Post-transfer re-wire (the part people forget)

- [ ] **Actions secrets + variables** — recreate (`SUPABASE_*`, `STRIPE_*`,
      `ANTHROPIC_*`, `VOYAGE_*`, `ENABLE_CODEQL`, etc.). Re-confirm the default
      token is read-only.
- [ ] **Vercel** — reconnect the Git repo to the project (Vercel → Project →
      Settings → Git) so preview/prod deploys keep working; re-add env vars there
      if the project is also recreated.
- [ ] **Supabase** — reconnect the GitHub branch integration (Supabase →
      Integrations → GitHub) for preview branches/migrations.
- [ ] **CodeRabbit** — install the CodeRabbit GitHub App on the new org;
      `.coderabbit.yaml` travels with the repo.
- [ ] **GitHub Apps / OAuth** — reinstall any others on the new org.
- [ ] **Branch ruleset** — re-import `main-branch-protection.json` (rulesets are
      per-repo/org, not carried by transfer).
- [ ] **CODEOWNERS** — switch `@BGI-Pres` to the new org's team handle.
- [ ] **Enable Advanced Security** on the repo in the new org (step 2) and flip
      `ENABLE_CODEQL=true` again.
- [ ] Update any **hardcoded repo URLs** (README badges, docs, the
      `claude/...` automation remotes) to the new org.

---

## Recommended sequence

1. Merge this PR → CODEOWNERS + Dependabot + ruleset JSON + dormant CodeQL land.
2. Import the ruleset; enable Dependabot alerts + secret scanning/push protection
   (cheap, immediate).
3. Add Code Security (CodeQL), set `ENABLE_CODEQL=true`, add `CodeQL` to required
   checks.
4. Only then evaluate full Enterprise (SSO/SCIM/audit streaming/CI scale) and/or
   an org migration using §3.
