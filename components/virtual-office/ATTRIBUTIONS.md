# Virtual Office — third-party attributions

The virtual office draws **concepts and design patterns** from the open-source
projects below. No source code or art assets from these projects are copied into
this repository — each listed module is an independent native reimplementation
in the FundExecs stack (TypeScript / React / Three.js). Attribution is provided
as a courtesy and to record provenance.

| Project | License | What we ported (natively) | Where |
|---------|---------|---------------------------|-------|
| [arturitu/the-delegation](https://github.com/arturitu/the-delegation) | MIT (code) · CC BY-NC 4.0 (assets) | NPC **navmesh pathfinding** concept — reimplemented as native A* over the office tile grid (no `three-pathfinding` dependency) | `nav/officePathfinding.ts` |
| [bagidea/bagidea-office](https://github.com/bagidea/bagidea-office) | MIT (code) · CC0/free (art) | **Multi-model agent routing** (per-agent provider/model selection) and the **plugin panel/command** ecosystem | `../../lib/office/agentModelRouter.ts`, `plugins/officePluginRegistry.ts` |
| [ChristianFJung/AIOffice](https://github.com/ChristianFJung/AIOffice) | MIT | **Agent-as-employee panel** concept (interactive per-agent HUD panels) | `plugins/officePluginRegistry.ts` |

## Asset licensing note

`the-delegation`'s 3D models/assets are **CC BY-NC 4.0** (non-commercial).
FundExecs OS is a commercial product, so **none of those assets are used**; any
3D models the office ships are original or CC0. Only MIT-licensed *logic* was
used as a reference, and it was reimplemented rather than copied.
