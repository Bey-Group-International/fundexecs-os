# External Adoption Plan

> Scoring 30 candidate open-source repos for what FundExecs OS should adopt
> **natively** — reimplementing the valuable *logic* in our own
> TypeScript / Next.js / Supabase stack, matching `lib/` conventions
> (pure + deterministic core, Claude-optional with a keyless fallback, RLS-scoped
> best-effort DB helpers). We do **not** import foreign runtimes (Python /
> Solidity / Java / Excel) or vendor code.

## How to read this

Each repo is scored on **Fit** (does it solve a real FundExecs gap, given what
already exists in `lib/`?) and **Effort** to adopt natively. Most of the list is
a different stack and/or duplicates engines we already have — the value is in the
*patterns*, not the code.

Legend — Verdict:

- 🟢 **Adopt** — clear gap, native reimplementation planned.
- 🟡 **Harvest** — take specific ideas/params into an existing module.
- ⚪ **Reference** — read for design/UX; nothing to port.
- 🔴 **Skip** — duplicates an existing engine or is a toy CRUD project.

---

## Cluster 1 — Web-data ingestion (SHIPPING IN THIS PR) 🟢

The biggest real gap: `source-radar` / `sourcing-signals` explicitly note that
"a real third-party feed plugs in behind this seam" — but there was no ingestion
backbone. This PR builds it, compliant-only, in `lib/ingestion/`.

|                                                 Repo                                                  |   Verdict   |                                                                                    What we take                                                                                     |
|-------------------------------------------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [apify/crawlee](https://github.com/apify/crawlee)                                                     | 🟢 Adopt    | Compliant-crawler posture: identify the bot, honor `robots.txt`, per-host rate-limit. Distilled into `lib/ingestion/robots.ts` + `CompliantFetcher`.                                |
| [ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai)                       | 🟢 Adopt    | "Point an LLM at a page → structured records." Reimplemented as `extractEntities` on our Claude-optional seam, with a deterministic JSON-LD/`<title>`/meta fallback for keyless CI. |
| [etkinbgronawnk/franchise-direct-scraper](https://github.com/etkinbgronawnk/franchise-direct-scraper) | 🟡 Harvest  | Seed-list → normalize → dedupe entity pattern; informs `normalizeEntities` and `runIngestion` seed model.                                                                           |
| [getmaxun/maxun](https://github.com/getmaxun/maxun)                                                   | ⚪ Reference | No-code robot recorder. Good UX reference for a future "recorded extraction template" surface; no native port now.                                                                  |
| [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser)                                       | 🔴 Skip     | Anti-detection / stealth browsing. Out of stance for a regulated financial product (see decision below). Seam left open via `FetcherStrategy` if ever justified per-source.         |
| [pinchtab/pinchtab](https://github.com/pinchtab/pinchtab)                                             | 🔴 Skip     | Same stealth category as CloakBrowser.                                                                                                                                              |
| [cporter202/API-mega-list](https://github.com/cporter202/API-mega-list)                               | ⚪ Reference | Curated public-API directory. Source of **official-API** seeds (the compliant alternative to scraping) — feed URLs into `IngestSeed`, no code to port.                              |

**Decision recorded:** compliant sources only — public pages, official APIs,
`robots.txt`-respecting, rate-limited. No anti-detection layer. The
`FetcherStrategy` interface keeps a stealth backend *pluggable per-source* but we
ship none.

### What landed

```
lib/ingestion/
  robots.ts      # pure robots.txt parser + allow check (longest-match, *, $, crawl-delay)
  fetcher.ts     # CompliantFetcher: robots gate + per-host politeness + timeout + size cap
  extract.ts     # Claude-optional structured extraction; deterministic JSON-LD/title/meta fallback
  normalize.ts   # pure trim/clamp/dedupe → IntelEntityInput
  pipeline.ts    # seeds → fetch → extract → normalize → sourcing-intel.ingestEntities
  index.ts       # public surface
  *.test.ts      # 37 unit tests, pure, keyless
```

Feeds directly into the existing `sourcing_entities` catalog (migration 0042)
via `ingestEntities`, so ingested rows are immediately discoverable by
`sourcing-intel` semantic search and rankable by `source-radar`.

---

## Cluster 2 — Agent orchestration 🟡

FundExecs already has a six-agent engine (`lib/engine.ts`, `lib/agents.ts`,
`lib/brain-routing.ts`, `lib/handoff.ts`, `lib/tool-dispatch.ts`). The value here
is *patterns*, not a framework swap.

|                                                Repo                                                 |  Verdict   |                                                                                                                                                           What we take                                                                                                                                                           |
|-----------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) | 🟡 Harvest | A catalog, not a library. Mine it for three concrete upgrades to our engine: (1) an explicit **planner → router → worker → critic** loop with a verification/critic pass before `/approve`; (2) **supervisor** hierarchy for multi-agent handoff (maps onto `handoff.ts`); (3) **typed tool-use graphs** for `tool-dispatch.ts`. |

**Proposed next slice:** add a `critic`/verification step to the engine's
approval loop (`lib/engine.ts` + `verification-engine.ts`) — the single highest-
leverage pattern from the catalog, and it strengthens an approval path a
financial product already cares about.

---

## Cluster 3 — Treasury / yield modeling 🟡

We already have native waterfall, LBO, cap-table, 409A, dilution, and
convertibles engines — so DeFi *protocol* code is a **Skip**; the math worth
harvesting is liquidity-pool / yield mechanics for the Earn/Wallet surface.

|                                                   Repo                                                    |   Verdict   |                                                                                    What we take                                                                                    |
|-----------------------------------------------------------------------------------------------------------|-------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [kupietools/excel-liquidity-pool-simulator](https://github.com/kupietools/excel-liquidity-pool-simulator) | 🟡 Harvest  | The constant-product (x·y=k) LP + impermanent-loss math, reimplemented as a pure `lib/earn/lp-sim.ts` (deterministic, testable) powering a treasury "what-if" on the Earn surface. |
| [hifi-finance/hifi-protocol](https://github.com/hifi-finance/hifi-protocol)                               | 🟡 Harvest  | Fixed-rate/fixed-term yield curve concepts → treasury allocation modeling. Math only, no Solidity.                                                                                 |
| [ChainInsighter/Ondo-Flux-Finance](https://github.com/ChainInsighter/Ondo-Flux-Finance)                   | ⚪ Reference | Tokenized-treasury (RWA) mechanics; useful mental model for a cash-management module.                                                                                              |
| [OctoFi/octofi-app-aquafarm](https://github.com/OctoFi/octofi-app-aquafarm)                               | ⚪ Reference | DeFi dashboard UX (listed twice by the user). Reference for multi-asset yield UI; no port.                                                                                         |
| [iloveitaly/openbook](https://github.com/iloveitaly/openbook)                                             | ⚪ Reference | Order-book concepts; not applicable to private markets.                                                                                                                            |

**Proposed next slice:** pure `lib/earn/lp-sim.ts` (x·y=k, IL, fee APR) + tests,
wired to an Earn "simulate" panel.

---

## Cluster 4 — Wallet / Pay banking UX 🟡

`app/pay`, `app/wallet`, and the Earn copilot already exist. Most banking repos
in the list are student CRUD projects with nothing to port; one is a polished
Next.js reference.

|                                                                                  Repo                                                                                   |   Verdict   |                                                                                           What we take                                                                                           |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [adrianhajdin/banking](https://github.com/adrianhajdin/banking)                                                                                                         | 🟡 Harvest  | Real Next.js app with Plaid (account-linking) + Dwolla (transfers). Take the **linked-account + transfer flow model** and statement UX for `app/pay`; use our existing Stripe rails, not Dwolla. |
| [Aritra-Basak/spring-boot-upi-wallet](https://github.com/Aritra-Basak/spring-boot-upi-wallet)                                                                           | ⚪ Reference | UPI wallet flow (Java). Reference for P2P transfer UX only.                                                                                                                                      |
| [GoldenThrust/Virtual-Bank](https://github.com/GoldenThrust/Virtual-Bank)                                                                                               | ⚪ Reference | Virtual-account modeling reference.                                                                                                                                                              |
| [yagnesh-lakshman-sai/VaultEdge-Enterprise-Banking-System](https://github.com/yagnesh-lakshman-sai/VaultEdge-Enterprise-Banking-System)                                 | 🔴 Skip     | Enterprise-banking CRUD; nothing native to gain.                                                                                                                                                 |
| [Nachoxt17/AKERU-CAPITAL-FUNDS](https://github.com/Nachoxt17/AKERU-CAPITAL-FUNDS)                                                                                       | ⚪ Reference | Fund-structure reference.                                                                                                                                                                        |
| [sboysel/open-source-funding-toolkit](https://github.com/sboysel/open-source-funding-toolkit)                                                                           | ⚪ Reference | Funding-model reference.                                                                                                                                                                         |
| [Bilovodskyi/ai-investor](https://github.com/Bilovodskyi/ai-investor)                                                                                                   | 🟡 Harvest  | AI-investing signal patterns → `deal-scoring.ts` / `market-intel.ts` inputs.                                                                                                                     |
| [Nevvyboi/SentiVest](https://github.com/Nevvyboi/SentiVest)                                                                                                             | 🟡 Harvest  | News/sentiment scoring → a signal source for `sourcing-signals.ts` (`news` type already exists).                                                                                                 |
| [SIDD44CHAMPS/Loan_Prediction](https://github.com/SIDD44CHAMPS/Loan_Prediction)                                                                                         | ⚪ Reference | Credit-scoring features; reference for a future underwriting-risk signal.                                                                                                                        |
| `Banking_system`, `mangoO-Microfinance`, `BasicBankingSystem`, `online-banking-system-with-python`, `iamvikash28/BankApp-master`, `thivyavignesh/DApp_Banking_Solidity` | 🔴 Skip     | Student / demo CRUD banking apps. No native value beyond what `app/pay` already does.                                                                                                            |

---

## Sequencing

1. Cluster 1 — ingestion engine (native, compliant, tested). ✅ **Shipped (#744)**
2. Cluster 2 — engine `critic`/verification pass. ✅ **Shipped** — `lib/engine-critic.ts`
   (deterministic pre-screen for refusals / stubs / off-topic drift, complements
   `grounding.ts`), wired into the engine's `artifact.created` event so the
   approval gate leads with red flags. No schema change.
3. Cluster 3 — `lib/earn/lp-sim.ts` treasury what-if. ✅ **Shipped** — pure
   constant-product (x·y=k) swap / price-impact / impermanent-loss / fee-APR math
   for an Earn "simulate" panel.
4. Cluster 4 — sentiment signal source. ✅ **Shipped** — `lib/market-sentiment.ts`
   (deterministic finance-lexicon scorer) → `buildNewsSignal` emits a `news`
   `EntitySignalInput` for `sourcing-signals`.
5. Cluster 4 (banking UX) — linked accounts + ACH transfers. ✅ **Shipped** —
   `lib/treasury/` on **Stripe rails** (extends the existing Stripe integration,
   no Plaid/Dwolla/Connect): Financial Connections for bank linking + ACH via
   PaymentIntents (deposit) and payouts (withdrawal). New `linked_accounts` +
   `treasury_transfers` tables (RLS, migration `20260708170000`), a pure
   validation + status-machine core, and a live "Linked accounts & transfers"
   panel on the Wallet page. Distilled from **adrianhajdin/banking**'s linked-
   account + transfer flow, native to FundExecs' own Stripe rails.

Each slice is native TS, pure + deterministic where possible, keyless in CI, and
matches the existing `lib/` conventions and test discipline.
