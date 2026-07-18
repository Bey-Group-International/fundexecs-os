# Cultural Review

Several inventory categories depict culturally and religiously specific attire.
These are treated as **distinct, respectful designs** — never interchangeable
skins, never combined across unrelated traditions.

## Items requiring human cultural review before production approval

Head coverings (`buildHeadCoverings`):

- Classic Hijab, Draped Hijab
- Formal Turban, Wrapped Turban, Dastar
- Structured Headwrap, Knotted Headwrap
- Kufi, Taqiyah, Kippah
- Professional Brimmed Hat, Formal Cap

Cultural formalwear outfit systems (`buildOutfits`, flagged
`culturallyReviewed`):

- Cultural Formalwear I
- Cultural Formalwear II

## Principles

1. **Distinct designs.** Each item has its own geometry and drape parameters; a
   hijab is not a re-tinted turban.
2. **No conflation.** Religious/cultural items are never merged (e.g. a dastar
   is authored separately from a turban).
3. **Data-driven, not identity-gated.** Fit tags (`masculine-fit`/
   `feminine-fit`/`universal`) filter *suggestions* only. Any covering renders
   on any base; gender identity is never a rendering restriction.
4. **Dignified, not costume-like.** No exaggeration; institutional silhouettes.
5. **Layer honesty.** Coverings declare which hair layers they hide, retain, or
   replace via `occludes`.

## Status

The procedural geometry in this repository is a **first-pass reference**. Before
these items ship to end users, each must pass review by appropriate community
reviewers. This document is the checklist and the record of that requirement;
the `culturallyReviewed` manifest flag marks items that have been through the
process. Do not mark an item reviewed without an actual review.
