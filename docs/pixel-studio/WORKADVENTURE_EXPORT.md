# WorkAdventure Export

## Character bundle (`{characterId}_workadventure.zip`)

The adapter (`adapters/workadventure.ts`) collapses the internal layer model to
the six Woka categories and renders **one 96×128 walk sheet per category**:

```
layers/body.png        layers/eyes.png       layers/hairs.png
layers/clothes.png     layers/hats.png       layers/accessories.png
layers/preview.png     (flattened walk preview)
character.json         woka.json             compatibility-report.json
ATTRIBUTION.txt        README.txt
```

- **96×128**, 3 columns × 4 rows.
- Row order: **down, left, right, up**.
- Three frames per direction, 8 fps default.
- Transparent outside the silhouette; skin ships in the `body` layer.

## What is NOT in the WA bundle

The WorkAdventure Woka format only defines the **walk** sheet. Idle, talk, and
approve are FundExecs extensions — they are exported in the **extended bundle**
and require FundExecs / custom runtime support. The compatibility report marks
them `unsupported` so this is never misrepresented.

## Extended bundle (`{characterId}_fundexecs-extended.zip`)

```
native/{id}_{idle,walk,talk,approve}_1x.png     32px state sheets
native/layers/walk_{category}.png               per-category walk breakdown
review-8x/{id}_{state}_8x.png                    exact 8× enlargements
pbr-showcase/materials.json                      PBR material metadata sidecar
manifest.json   character.json   ATTRIBUTION.txt   README.md
```

State sheet dimensions: idle 64×128 (2 frames), walk 96×128 (3), talk 128×128
(4), approve 128×128 (4).

## Determinism

Bundles are byte-stable for a given `(config, timestamp)` — no `Date.now()` in
the assembly path, `STORE` ZIP with a fixed DOS timestamp. `validate:exports`
asserts required files are present and the WA report is `ok`.
