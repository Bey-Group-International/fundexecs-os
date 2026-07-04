# Competitive Landscape

*Confidential · July 2026*

---

## 1. The map

Private-market software today is a patchwork of category owners, each holding one fragment of the operator's workflow. FundExecs OS competes with all of them and none of them: our claim is the **loop** — prompt → plan → approve → execute → record — not any single fragment.

```
                    DOES THE WORK (agentic)
                            ▲
                            │
        Horizontal agents   │   ★ FundExecs OS
        (generic autonomy,  │   (private-markets native,
         no domain model)   │    approval-gated, full lifecycle)
                            │
  GENERIC ◄─────────────────┼─────────────────────► PRIVATE-MARKETS NATIVE
                            │
        Notion/Slack/Zapier │   DealCloud · Affinity · Carta
        Excel/Email         │   Juniper Square · Dynamo
                            │   Hebbia · AlphaSense
                            ▼
                    HOLDS THE RECORD (passive)
```

## 2. Category-by-category

### Deal CRM / pipeline — DealCloud (Intapp), Affinity, Dynamo, 4Degrees
- **What they are:** relationship and pipeline databases with reporting; DealCloud is the enterprise standard, $50K–$250K+/yr plus implementation.
- **Gaps:** data-entry-hungry; no execution of work; AI limited to enrichment/scoring; priced and implemented for the top ~500 firms.
- **Our answer:** the Capital Map + deal pipeline populate from agent work rather than manual entry; relationship temperature and warm-intro pathfinding are native graph queries; a fraction of the price.

### Fund admin / LP tooling — Carta, Juniper Square, Passthrough, Visible
- **What they are:** systems of record for cap tables, fund accounting, subscriptions, LP portals.
- **Gaps:** back-office only; nothing for sourcing, raising, diligence; workflow lives in email around the tool.
- **Our answer:** capital events, waterfall engine, investor portal, and LP reporting inside the same OS where the raise and the deals happen — with the IR and Fund Admin agents preparing the work.

### AI research / document intelligence — Hebbia, AlphaSense, Rogo
- **What they are:** best-in-class document Q&A and market research for finance.
- **Gaps:** analysis stops at the answer; no task engine, no records, no counterparty actions; another silo to move information out of.
- **Our answer:** document intelligence is one capability of the Diligence agent inside a workflow that ends in a memo artifact, a risk flag on the deal record, and a graph update.

### Horizontal glue — Notion, Airtable, Slack, Zapier, Excel
- **What they are:** the actual incumbent for our beachhead (most emerging managers run on these).
- **Gaps:** no domain model, no compounding, integration tax paid in operator hours.
- **Our answer:** this is the spend we convert first. Migration is easy because there is no structured system to migrate from.

### Horizontal agent platforms — generic autonomous-agent products
- **What they are:** broad agent frameworks and assistants (including incumbents embedding copilots).
- **Gaps:** no private-markets schema, no fiduciary trust model (approval gates, audit, provenance), no waterfalls/IC memos/capital calls out of the box; autonomy without domain guardrails is a liability for an LP-facing firm.
- **Our answer:** vertical depth — fifteen domain agents with encoded playbooks, an org-scoped RLS data model, and a gate layer designed for fiduciaries.

### Vertical AI upstarts (emerging)
- A wave of "AI analyst for PE" point tools is appearing (deal screening, memo drafting, CIM parsing). They validate the category and will be feature-level competitors.
- **Our answer:** point tools re-create the fragmentation problem; the system-of-record + agent-team architecture is the consolidating position. We watch this tier most closely for talent and acquisition opportunities.

## 3. Feature-position matrix

| Capability | DealCloud | Affinity | Carta | Juniper Sq | Hebbia | Notion+Zapier | **FundExecs OS** |
|---|---|---|---|---|---|---|---|
| Deal pipeline | ● | ● | ○ | ○ | ○ | ◐ | ● |
| Relationship graph | ◐ | ● | ○ | ○ | ○ | ○ | ● |
| Fund admin / waterfalls | ○ | ○ | ● | ● | ○ | ○ | ◐→● |
| LP portal / reporting | ○ | ○ | ◐ | ● | ○ | ○ | ● |
| Document intelligence | ○ | ○ | ○ | ○ | ● | ○ | ● |
| Agents execute workflows | ○ | ○ | ○ | ○ | ◐ | ○ | ● |
| Approval-gated autonomy | — | — | — | — | — | — | ● |
| Compounding org memory | ◐ | ◐ | ○ | ○ | ◐ | ○ | ● |
| Priced for emerging managers | ○ | ◐ | ◐ | ○ | ○ | ● | ● |

● strong · ◐ partial · ○ absent

## 4. Moat summary

1. **Architecture:** event-driven task engine + gate layer + artifact provenance + three native graphs — the parts incumbents would have to rebuild, not bolt on.
2. **Data compounding:** every workflow enriches org-private graphs and Brains; switching cost grows with tenure and is *earned from usage*, not lock-in contracts.
3. **Domain playbooks:** fifteen agents encode elite capital-raising, sourcing, and diligence practice (the Brain corpus) — content competitors can't scrape.
4. **Trust posture:** approval-gated by default is a durable brand position with fiduciaries; "more autonomous" competitors concede it to us.
5. **Distribution wedge:** the founder's salon/network motion reaches a segment enterprise sales economics can't serve.

## 5. Honest weaknesses

- **Breadth vs. polish:** covering the lifecycle means some modules trail category leaders' depth (e.g., Carta's cap-table depth, Hebbia's retrieval). Strategy: be 80%-good everywhere the work connects, best-in-class at the loop itself.
- **Brand trust takes time:** back-office adoption (fund accounting of record) will lag front-office adoption; we enter as prep/copilot there and graduate to record over time.
- **Model dependency:** core intelligence rides frontier models; mitigated by provider-adapter design and deterministic fallbacks, but a real dependency to manage.
