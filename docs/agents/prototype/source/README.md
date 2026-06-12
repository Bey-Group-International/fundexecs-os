# Prototype sources — Source hub

`source.jsx.txt` is the prototype's entire Source module, extracted verbatim
from the uploaded standalone prototype (asset `d9690d36`): the `SourceHub`
composition plus all four tab components — `LpCapitalMap`, `DealPipeline`,
`PartnerNetwork`, `LeadEngine` — and their configs and seeds (`LP_STAGES`,
`DEAL_STAGES`, `PROV_*`, `LEAD_*`, `SRC_TITLE`/`SRC_NOUN`).

This is the binding spec for the Source-tab agents (see
`docs/agents/SOURCE_TABS_PLAYBOOK.md`). Shared references:
`../build/data-layer.jsx.txt` (prototype seeds, options, copy) and
`../build/ui-kit.jsx.txt` (visual primitives).

Reminder: the seeds in this file (`LP_SEED`, `DEAL_SEED`, `PROVIDER_SEED`,
`LEAD_SEED`) are prototype mocks — they inform layout and copy tone only and
must NEVER appear as real data on the live surface.
