# Prototype sources — Execute hub

`execute.jsx.txt` is the prototype's entire Execute module, extracted
verbatim from the uploaded standalone prototype (asset `2c1aac51`): the
`ExecuteHub` composition plus all four tab components — the inline Closings
center (closing switcher, step ladder, closing binder, closed-and-funded
state), `SignaturesWires` (signature room, wire board, accounts strip),
`CapitalCalls` (drawdowns, LP funding funnel, distributions),
`ChainOfTrust` (the 4-layer proof ledger) — and their configs and seeds
(`EX_*`, `SIG_*`, `WIRE_*`, `CALL_*`, `DIST_*`, `COT_*`).

This is the binding spec for the Execute-tab agents (see
`docs/agents/EXECUTE_TABS_PLAYBOOK.md`). Shared references:
`../build/data-layer.jsx.txt` (prototype seeds, options, copy) and
`../build/ui-kit.jsx.txt` (visual primitives).

Reminder: every seed in this file (closings, signatures, wires, accounts,
calls, LP rosters, trust records) is a prototype mock — layout and
copy-tone reference only; none of it may ever appear as real data on the
live surface.
