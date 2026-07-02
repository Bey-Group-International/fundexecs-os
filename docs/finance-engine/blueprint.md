# FundExecs Finance Engine — Native Architecture Blueprint

A native-first, fully self-hosted accounting + finance engine inside FundExecs OS
that clones the functional capabilities of Xero/Jax with **zero external
integrations, zero vendor dependencies, zero API reliance**. Everything is pure
Postgres (Supabase) + app code.

**Stack:** Postgres (Supabase) · timestamped SQL migrations · org RLS
multi-tenancy (`organization_id` + `current_principal_org_ids()` /
`is_org_writer()`) · Next.js server actions as the API layer · reuse of the
existing gate/tier approval system, `tasks`/`task_events`, cron, and the finance
inbox pillar.

**Conventions:** all tables prefixed `fin_`. Money is `numeric(20,4)` (never
float). Timestamps `timestamptz`. Every table carries `organization_id` + RLS.
Signed-amount ledger convention: **debit > 0, credit < 0**; a balanced entry sums
to zero.

---

## 1. Capabilities

- **Ledger** — multi-entity → multi-ledger (books) → hierarchical typed chart of
  accounts → append-only balanced journal entries → immutable postings
  (corrections via reversing entries) → derived materialized balances → accrual
  basis + cash-basis view → multi-currency (txn + base ccy + FX reval) →
  accounting periods (open/closed/locked).
- **Banking** — bank accounts mapped to GL; statement-file ingestion
  (CSV/OFX/QIF/CAMT.053) behind a pluggable adapter seam; staged transactions →
  auto-categorization rules → reconciliation workflow → cashflow engine.
- **Billing/AR/AP** — customer invoices + vendor bills → AR/AP control accounts;
  recurring invoices; payments with multi-invoice allocation; aging; dunning;
  vendor + customer master data.
- **Reporting** — balance sheet, P&L, cashflow, trial balance (entity / period /
  basis / consolidation) + custom report engine + internal export.
- **Automation** — rule DSL (event → conditions → actions); accounting +
  reconciliation bots; anomaly detection; compliance checks; scheduled jobs.
- **Compliance** — RBAC finance roles; approval thresholds (gate tiers);
  segregation of duties; period locks; immutability; append-only hash-chained
  audit log.
- **Events** — internal event bus feeding automation, inbox alerts, report-cache
  invalidation.

---

## 2. Architecture (text diagram)

```
                 Next.js server actions (API): auth + RBAC + gate/tier wrapper
                                     │ commands
   ┌────────────┬────────────┬───────┴──────┬────────────┬────────────┐
   ▼            ▼            ▼              ▼            ▼            ▼
Ledger      Banking      Invoicing/     Reporting    Automation   Compliance
Engine      Engine       AR-AP          Engine       Engine       Engine
   │            │            │             ▲            │            │ guards all
   ▼            ▼            ▼             │            ▼            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Postgres (immutable ledger core)                         │
│  fin_entities · fin_ledgers · fin_accounts · fin_periods                    │
│  fin_journal_entries (append-only) → fin_journal_lines (balanced, signed)   │
│  fin_account_balances (materialized) · fin_fx_rates                         │
│  fin_bank_* · fin_reconciliations · fin_invoices · fin_payments · fin_parties│
│  fin_report_defs · fin_automation_rules · fin_events · fin_audit_log · fin_roles │
└───────────────────────────────┬────────────────────────────────────────────┘
                                 │ triggers emit fin_events
                                 ▼
      Automation Engine ─── Inbox finance pillar ─── Report-cache invalidation
```

**Core invariant flow:** command → RBAC check → gate/tier approval (if over
threshold) → engine builds a *balanced* journal entry → DB trigger enforces
`Σ signed lines = 0` and period-open → append-only insert → trigger updates
`fin_account_balances` + emits `fin_events` → automation / inbox / report-cache
react.

---

## 3. Database schemas

See `supabase/migrations/*_finance_*.sql`. Phase 1 (this migration) ships the
ledger core: `fin_entities`, `fin_ledgers`, `fin_accounts`, `fin_periods`,
`fin_journal_entries`, `fin_journal_lines`, `fin_account_balances`,
`fin_fx_rates`. Later phases add banking, AR/AP, reporting, automation, and
compliance tables per the diagram above.

**Integrity (DB-enforced):**
- `BEFORE UPDATE/DELETE` trigger on `fin_journal_entries` / `fin_journal_lines`
raises unless the row is still `draft` — a posted entry is immutable; a
correction is a new reversing entry.
- Deferred constraint trigger on post: `Σ base_amount = 0`, `Σ amount = 0` per
currency, period `open`, ≥2 distinct accounts.
- `entry_no` from a per-ledger sequence at post time; `hash` chains to the prior
entry's hash for a tamper-evident chain.
- RLS everywhere: `select` for org members, `insert` for `is_org_writer`; no
`update`/`delete` grant on posted ledger rows.

---

## 4. API (server actions; REST-shaped)

```
POST /finance/entities                createEntity({name,baseCurrency,parentEntityId?})
POST /finance/accounts                createAccount({entityId,code,name,type,parentId?})
POST /finance/journal-entries         postJournalEntry({ledgerId,entryDate,memo,lines[]}) → gated
POST /finance/journal-entries/:id/reverse  reverseEntry({entryId,date,memo})
POST /finance/periods/:id/close       closePeriod({id}) → Tier 3 → FX reval + accruals → lock
POST /finance/bank-imports            importBankFile({bankAccountId,format,fileText})
POST /finance/reconciliations/:id/match  matchTransaction({bankTxnId, entryId|newCoding})
POST /finance/invoices                createInvoice(...) ; /:id/issue  issueInvoice(...)
POST /finance/payments                recordPayment({direction,amount,allocations[]})
POST /finance/reports/run             runReport({kind,entityIds,periodId,basis,consolidate})
POST /finance/automation/rules        upsertRule(...) ; /run runAutomation(event)
POST /finance/roles                   grantRole({principalId,entityId?,role})
```

Standard envelope: `{ ok, data?, error?, gated?, tier? }` — gated (Tier 2/3)
commands route to the existing approvals queue before posting.

---

## 5. Frontend blueprints

```
/finance
├─ <EntitySwitcher/>            multi-entity + consolidation toggle (?entity=&consolidate=)
├─ <ChartOfAccountsTree/> · <GeneralLedgerTable/> · <JournalEntryEditor/> (live balance meter)
├─ <BankImportDialog/> · <ReconciliationBoard/> · <CashflowChart/>
├─ <InvoiceBuilder/> · <ARAPDashboard/> (aging) · <PartyDetail/>
├─ <ReportRunner/> · <FinancialStatement/> (drill-through) · <CustomReportBuilder/>
├─ <RuleBuilder/> (event→condition→action)
└─ <AuditLogViewer/> (hash-chain badge) · <RoleMatrix/>
```

Reuse: gate-tier badges (T1/T2/T3), realtime idiom (`GridLive`/`InboxLive`),
URL-driven search/filter, and the finance inbox pillar for alerts.

---

## 6. Automation logic

Rule DSL stored as JSON (`conditions`/`actions`):

```jsonc
{ "event":"bank_txn.imported",
  "conditions":[{"field":"description","op":"matches","value":"(?i)stripe|payout"},
                {"field":"amount","op":">","value":0}],
  "actions":[{"type":"set_category","account_code":"4000"},
             {"type":"set_status","value":"suggested"}] }
```

- **Auto-categorization** — ordered, deterministic, explainable rules over staged
  bank transactions; frequent manual codings become suggested rules (never
  auto-applied).
- **Reconciliation bot** — exact (date±N, amount) single match auto-matches;
  ambiguous → ranked suggestions.
- **Invoice automation** — recurring schedule via cron; payment reminders emit
  inbox threads on the finance pillar.
- **Validation** — pre-post checks + nightly integrity sweep (re-derive balances,
  verify hash chain).
- **Compliance** — segregation of duties, approval thresholds → gate tiers,
  period-lock enforcement, duplicate detection.
- **Anomaly detection** — z-score on account deltas, Benford's-law digit test,
  round-number/duplicate/out-of-hours heuristics → inbox alert + audit.

---

## 7. Implementation modules

Canonical module descriptors: `ledger.posting`, `banking.ingest`,
`banking.reconcile`, `invoicing.arap`, `reporting.engine`, `automation.rules`,
`compliance.controls`, `fx.revaluation`. Each declares purpose, inputs, outputs,
internal logic, dependencies, and example functions. Phase 1 ships
`ledger.posting` (`lib/finance/ledger.ts`).

---

## 8. Final system blueprint

```
Command → compliance.controls (RBAC + gate tier + SoD + period guard)
        → domain engine (ledger.posting | banking.* | invoicing.arap | fx.reval)
        → every financial effect = a BALANCED, IMMUTABLE journal entry
        → Postgres core ──trigger──► fin_account_balances (reporting reads)
                         └─trigger──► fin_events ─► automation / inbox / cache-invalidation
        → fin_audit_log (append-only, hash-chained) + immutable ledger = full audit trail
```

**Phased build (each a PR, merged before the next):**
1. **Ledger foundation** — entities/ledgers/accounts/periods/journal + posting
engine + immutability & balance triggers + gate integration + tests. ← *Phase 1*
2. **Banking** — bank accounts, file-import adapters, staging, categorization,
reconciliation, cashflow.
3. **AR/AP + invoicing** — parties, invoices/bills, tax codes, payments/allocation,
recurring, aging.
4. **Reporting** — BS/P&L/cashflow/TB + custom engine + consolidation + FX reval.
5. **Automation + compliance** — rule engine, bots, anomaly detection, RBAC roles,
controls, audit-hash verification, inbox emission.
