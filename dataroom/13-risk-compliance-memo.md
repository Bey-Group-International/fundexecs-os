# Risk & Compliance Memo

*Confidential · July 2026*

> Purpose: candid statement of the company's regulatory posture, security architecture, AI governance, and principal risks, with mitigations. This memo is a management document, not legal advice; positions marked "counsel" are or will be confirmed with securities/technology counsel.

---

## 1. Regulatory posture

### 1.1 What FundExecs Technologies is — and is not

- **We are a software provider.** FundExecs OS is workflow, records, and drafting software used by private-market operators. The company is **not** an investment adviser, broker-dealer, placement agent, or fund administrator of record, and the product is designed to keep it that way:
  - Agents **draft and prepare**; the operator **approves and sends**. The gate layer ensures a human principal takes every counterparty-facing action.
  - The platform provides no investment recommendations to investors, performs no solicitation on its own behalf, handles no customer funds, and takes no transaction-based compensation on securities transactions.
- **Marketplace design constraint (counsel):** matching/introduction features will be structured to avoid broker-dealer characterization — no success-based fees on securities transactions, no negotiation on behalf of parties. Take-rate mechanics apply to services and data products; anything touching securities transactions ships only after counsel sign-off.
- **Customer compliance is customer-owned:** tools (audit trails, provenance, retention/export) support the customer's own Advisers Act / Reg D obligations; the platform does not assume them.

### 1.2 Tokenization layer (specified, staged)

The access/reputation/attestation layer is deliberately **off-chain, non-transferable, and internal-ledger-first**:
- **Credits** are prepaid service units (spendable, non-redeemable, non-transferable outside the platform) — a conventional SaaS metering pattern.
- **Reputation and attestations** assert that something happened; they are not transferable value.
- Any future transferable or on-chain unit (e.g., anchored attestations, transferable claims) is a **per-unit decision gated on securities counsel review** — the architecture (settlement field: internal → anchored → onchain) was designed so compliance can gate each step without a rewrite.

### 1.3 Privacy & data protection

- Org-scoped tenancy; customers own their data and graphs; **we do not sell or cross-pollinate customer data** across orgs.
- GDPR/CCPA alignment path: data export and deletion tooling on the roadmap with the enterprise tier; DPAs offered to Scale customers.
- Sensitive-communication handling in the Unified Inbox follows least-privilege scopes per connected channel.

## 2. Security architecture (current state)

|        Control        |                                                                 State                                                                 |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| Tenancy               | Row-level security on **every table**; org-membership checks via database helper functions                                            |
| AuthN/Z               | Supabase Auth (email/password + Google OAuth), JWT, middleware session refresh; role-based seats by plan                              |
| Auditability          | Append-only ledgers (credits, operator feedback, dispatch log), audit log migration, artifact provenance/grounding                    |
| Secrets               | Never in-repo; deployment-env only (API keys, cron secret, service-role key)                                                          |
| Encryption            | At rest (managed Postgres/S3) and in transit (TLS)                                                                                    |
| Automation guardrails | Secret-guarded cron endpoint; per-sweep spend caps; opt-in auto-approve only                                                          |
| SDLC                  | CI gates (typecheck/lint/test), versioned migrations, PR review; CodeRabbit review on PRs                                             |
| Roadmap               | SOC 2 Type I within 12 months of seed close; observability stack (OpenTelemetry/Sentry/Grafana) per spec; pen-test before public beta |

## 3. AI governance

The central AI risk in this domain is an agent taking a wrong action toward an LP, seller, or lender, or producing confidently wrong analysis. Controls:

1. **Approval gates by architecture.** The `prompt → plan → approve → execute` spine is the only path; counterparty-facing actions sit behind Tier 1/2/3 gates. Autonomy is per-automation, opt-in, and revocable.
2. **Provenance and grounding.** Artifacts carry provenance and grounding records — what produced them and from what inputs — making outputs inspectable rather than oracular.
3. **Durable audit.** Every run leaves typed artifacts, task events, and ledger entries; automation runs link to their automation for after-the-fact review.
4. **Cost/abuse bounds.** Cost-tiered model routing, per-sweep caps, and metered credits bound both spend and blast radius.
5. **Human-fallback honesty.** Where the model is unavailable, deterministic fallbacks keep the loop functional and clearly non-intelligent rather than silently degraded.
6. **Learning stays org-scoped.** Operator-feedback learning and (future) artifact recall are per-org; no cross-tenant model contamination.

Residual risk: LLM error inside an *approved* deliverable (e.g., a flawed pro forma). Mitigations: grounding display, sensitivity/stress-test agents as cross-checks, and positioning discipline — outputs are decision support requiring professional review, stated in ToS.

## 4. Principal business risks

| # |                                     Risk                                     |       Severity       |                                                          Mitigation                                                           |
|---|------------------------------------------------------------------------------|----------------------|-------------------------------------------------------------------------------------------------------------------------------|
| 1 | **Model dependency** (pricing, availability, terms of frontier-model supply) | High                 | Provider-adapter design (multi-model routing planned); deterministic fallbacks; credits pass cost changes through to price    |
| 2 | **Incumbent response** (Intapp/Carta ship agentic layers)                    | High                 | Architecture head start (task engine, gates, graphs); beachhead segment incumbents don't serve; speed                         |
| 3 | **Key-person concentration** (solo founder)                                  | High                 | Seed round funds founding team; AGENT.md/living-documentation practice makes the build unusually transferable; advisory bench |
| 4 | **Beachhead fragility** (emerging managers churn/fail)                       | Medium               | Usage pricing, family-office segment, expansion into established GPs                                                          |
| 5 | **Related-party optics** (BGI/Fund I as first customer)                      | Medium               | Arm's-length terms, disclosure, and separation governance — document 14                                                       |
| 6 | **Repricing risk** (early cohort anchored on $5–100/mo)                      | Medium               | Grandfathering + usage growth; institutional tiers for new cohorts with documented value evidence                             |
| 7 | **Security incident** in a trust-sensitive market                            | Medium (high impact) | Controls in §2; SOC 2 path; incident-response plan pre-beta; insurance (E&O/cyber) at seed close                              |
| 8 | **Regulatory drift** (AI rules, broker-dealer boundary, token regimes)       | Medium               | Counsel-gated feature releases (§1); conservative defaults; the product's audit-trail DNA is itself the compliance asset      |
| 9 | **Pre-revenue execution risk** (alpha product, projections unproven)         | High                 | Disclosed throughout this data room; milestone-based use of funds (document 09)                                               |

## 5. Insurance & corporate hygiene (at/near seed close)

- D&O, E&O/professional liability, and cyber policies
- IP assignment confirmations for all contributors; standard PIIA for hires
- Terms of Service / acceptable-use with AI-output disclaimer; privacy policy; DPA template
- Formalization of the FundExecs Technologies ↔ BGI agreements per document 14

## 6. Summary position

The company's compliance strategy is to make **the same architecture that sells the product be the control environment**: gates, ledgers, provenance, and org-scoped isolation. We take conservative regulatory defaults (software provider, human-in-the-loop, off-chain units, counsel-gated marketplace/token features) so that compliance never has to be retrofitted onto an autonomous system after the fact.
