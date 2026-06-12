# Prototype sources — Run hub

`run.jsx.txt` is the prototype's entire Run module, extracted verbatim from
the uploaded standalone prototype (asset `c0bb1a79`): the `RunHub`
composition plus all four tab components — the inline Diligence center
(deal switcher, verdict engine, agent risk register, resolution drawer),
`WorkflowsBoard`, `ComplianceCenter`, `IRCenter`, the shared `RunSection`
row primitive — and their configs and seeds (`DD_AGENTS`/`DD_DEALS`,
`WF_*`, `CO_*`, `IR_*`, `AUTOMATIONS`, `RUN_TONE`).

This is the binding spec for the Run-tab agents (see
`docs/agents/RUN_TABS_PLAYBOOK.md`). Shared references:
`../build/data-layer.jsx.txt` (prototype seeds, options, copy) and
`../build/ui-kit.jsx.txt` (visual primitives).

Reminder: every seed in this file (deals, agent findings, workflow tasks,
compliance items, IR deliverables, LP rosters, performance figures) is a
prototype mock — layout and copy-tone reference only; none of it may ever
appear as real data on the live surface.
