# Connecting Meshy.ai for character generation

How to wire **[Meshy.ai](https://www.meshy.ai)** (AI 3D-model generation) into the
Virtual Office as a source of member/staff characters. This is a *setup guide* —
the office today renders 2D pixel-sprite characters
(`lib/office/avatarSprite.ts` → `public/office/map.html`), and Meshy produces
**3D models** (GLB/FBX/USDZ), so §5 covers the two ways to actually get a Meshy
model onto the floor.

> Status: **not yet implemented.** No Meshy code or key exists in the repo. This
> doc is the blueprint; follow it to add the integration behind an env flag, the
> same mock-or-real discipline the other integrations use (`.env.example`).

---

## 1 · What Meshy gives you, and how it fits

| Meshy capability | Endpoint (verify against current docs) | Use here |
| --- | --- | --- |
| **Text → 3D** | `POST /openapi/v2/text-to-3d` | Generate a character from a text prompt built out of the member's `AvatarConfig` labels. |
| **Image → 3D** | `POST /openapi/v1/image-to-3d` | Turn a reference image (e.g. the procedural sprite, or an uploaded photo) into a 3D model. Best fidelity to the existing look. |
| **Rigging / animation** | `POST /openapi/v1/rigging` | Auto-rig a humanoid model and apply walk/idle animations for the floor. |
| **Text → texture / remesh** | texture / remesh endpoints | Re-skin or lighten a base body mesh per member instead of a full regen (cheaper). |

Output formats: **GLB** (use this — web-native), FBX, USDZ, OBJ. Generation is
**asynchronous**: create a task → poll (or receive a webhook) → download the
asset URL when `status === "SUCCEEDED"`.

---

## 2 · Get an API key

1. Create/sign in to an account at <https://www.meshy.ai>.
2. Open **Settings → API Keys** (<https://www.meshy.ai/api>).
3. Create a key. Note the plan's **credit** balance — every generation spends
   credits; the free tier is limited and rate-capped.
4. Keep the key **server-side only**. Never ship it to the browser (it can spend
   money).

---

## 3 · Configure the environment

Add to `.env.example` (documented, blank) and set the real value as a deploy
secret — mirroring how `ANTHROPIC_API_KEY` / `APOLLO_API_KEY` are handled:

```bash
# Meshy.ai 3D character generation (server-only, OPTIONAL). When set, the
# Character Studio can generate a 3D model from a member's avatar. Without it,
# the feature stays disabled and the procedural pixel sprite is used.
MESHY_API_KEY=
# Optional — override the model/quality tier or polling budget.
MESHY_MODEL=meshy-5
```

Resolve it exactly like `resolvePortraitGenerator()` did (return `null` when the
key is absent so the UI shows a "not configured" state instead of throwing).

---

## 4 · The API flow (server-side)

Use raw `fetch` (no SDK dependency needed), the same pattern as the other
providers. All calls send `Authorization: Bearer ${MESHY_API_KEY}`.

```ts
// lib/office/meshy.ts  (server-only)
import "server-only";

const BASE = "https://api.meshy.ai";

// 1) Create a task (text→3D shown; image→3D takes { image_url } instead).
async function createTask(prompt: string): Promise<string> {
  const res = await fetch(`${BASE}/openapi/v2/text-to-3d`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.MESHY_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      mode: "preview",            // "preview" then "refine", or one-shot per docs
      prompt,                      // built from AvatarConfig — see §6
      art_style: "realistic",     // or "sculpture" / "cartoon"
      should_remesh: true,
    }),
  });
  if (!res.ok) throw new Error(`Meshy create failed (${res.status})`);
  const { result } = await res.json();  // task id
  return result;
}

// 2) Poll until the task finishes (or wire a webhook — see §4.1).
async function pollTask(id: string, signal?: AbortSignal) {
  for (;;) {
    const res = await fetch(`${BASE}/openapi/v2/text-to-3d/${id}`, {
      headers: { authorization: `Bearer ${process.env.MESHY_API_KEY}` },
      signal,
    });
    const task = await res.json();
    if (task.status === "SUCCEEDED") return task;       // task.model_urls.glb
    if (task.status === "FAILED") throw new Error(task.task_error?.message ?? "Meshy failed");
    await new Promise((r) => setTimeout(r, 5000));       // 5s between polls
  }
}
```

> Endpoint paths and body fields are **version-sensitive** — confirm the current
> shape at <https://docs.meshy.ai> before shipping. The two-stage
> *preview → refine* flow and credit cost per stage in particular change between
> versions.

### 4.1 Webhooks (recommended over long polling)

A Studio generation can take **1–3+ minutes** — longer than a serverless
function should block. Prefer Meshy's webhook: register a callback URL, return
the task id to the client immediately, and let the webhook (a route like
`/api/office/meshy/webhook`) persist the finished model URL. The Studio polls
*your* row, not Meshy. This avoids function-timeout issues entirely.

---

## 5 · Getting a Meshy model onto the office floor

The office renders 2D sprite atlases via `postMessage({type:"fx-you", atlas})`
into `public/office/map.html`. A Meshy GLB is 3D, so pick one:

- **A · Bake to a sprite atlas (smallest change, keeps the current look).**
  Render the GLB off-screen (server-side with a headless GL renderer, or in a
  one-time browser/worker pass) from the 4 facing angles × 3 walk frames and
  composite the existing 768×1024 atlas. The office code is unchanged — it still
  receives an atlas. Meshy becomes a *higher-fidelity sprite source*.

- **B · Render 3D in the office (bigger change, true 3D).** Add a
  [three.js](https://threejs.org) / [react-three-fiber](https://r3f.docs.pmnd.rs)
  layer that loads the GLB and animates the rig. `map.html` is a self-contained
  static asset today; you'd either embed a small GLTF viewer there or replace the
  member sprite with a WebGL canvas overlay. Heavier runtime, best payoff for the
  "2.5D / 3D feel" goal.

Recommendation: ship **A** first (fidelity win, zero office-runtime risk), keep
**B** as a follow-up once one 3D character looks right end-to-end.

---

## 6 · Where it plugs into this repo

The scaffolding from the (removed) AI-portrait attempt maps cleanly onto Meshy:

| Concern | Reuse / add |
| --- | --- |
| Prompt from the character | A `meshyPromptFor(config)` builder — same idea as the old `portraitPrompt.ts`: turn `AvatarConfig` catalog **labels** (skin/hair/outfit/…) into a text prompt (Text→3D), or pass the sprite PNG (Image→3D). |
| Provider resolution | `resolveMeshyGenerator()` keyed on `MESHY_API_KEY`, returning `null` when unset (degrade cleanly). |
| Server action | A `generateAvatarModel(config)` server action in `app/(app)/office/builder/actions.ts`, alongside `saveAvatarConfig`. |
| Storage | The **`office-portraits`** public bucket + the **`office_member_prefs.portrait_url`** column already exist (migrations `20260720150000`). Store the GLB (or baked atlas) there and reuse `portrait_url`, or add a parallel `model_url` column if you keep both. |
| Studio UI | A "Generate 3D character" button + status/preview panel in `CharacterBuilder.tsx`, disabled when `MESHY_API_KEY` is unset. |
| Async | Persist a `generating | ready | failed` state on the member's row so the Studio can show progress across the multi-minute job (see §4.1). |

Keep the procedural sprite as the **fallback and the on-floor default** until a
generated character is confirmed good — same hybrid discipline as before.

---

## 7 · Cost, limits, safety

- **Credits:** every generation (and each refine stage) spends credits. Gate the
  button server-side (per-user/day cap) so a member can't burn the balance.
- **Latency:** 1–3+ min per model — use webhooks, show progress, never block a
  request thread on the poll loop.
- **Content:** Image→3D from **user-uploaded photos** raises consent/PII
  questions — prefer generating from the in-app avatar, or require explicit
  opt-in and store under the member's own RLS-scoped path.
- **Key hygiene:** server-only, never in a client component or `NEXT_PUBLIC_*`.

---

## 8 · Quick checklist

- [ ] Meshy account + API key (§2)
- [ ] `MESHY_API_KEY` in `.env.example` + deploy secret (§3)
- [ ] `lib/office/meshy.ts` adapter: create + poll/webhook (§4)
- [ ] `meshyPromptFor(config)` prompt builder (§6)
- [ ] `generateAvatarModel` server action + async state on `office_member_prefs` (§6)
- [ ] Studio button + progress/preview panel, disabled when unconfigured (§6)
- [ ] Render path: bake-to-atlas (A) or three.js (B) (§5)
- [ ] Per-user generation cap + webhook endpoint (§4.1, §7)
