# Prototype sources — Shell & journey modules

Extracted verbatim from the uploaded prototype
(`FundExecs_OS_Reboot_standalone.html`, embedded asset store) — the same bundle
the Build / Source / Run / Execute references come from. Reference only, never
imported by the app.

These four modules cover the app-shell journey that frames every hub: the entry
funnel, the Mandate Brief onboarding (the "Reboot" centerpiece), the team-
activation "aha", and the daily Command Center loop.

| File                     | Prototype module                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry.jsx.txt`          | Entry flow — landing, beta invite, sign in                                                                                                                     |
| `mandate-brief.jsx.txt`  | The Mandate Brief — the staged onboarding wizard (`MandateWizard`, `AutoBuild`, `Activation`) that reframes "make your profile" as "brief your executive team" |
| `command-center.jsx.txt` | Command Center — the daily loop: one ranked next move → Earn runs it → you approve → it executes                                                               |
| `orchestrator.jsx.txt`   | Orchestrator — the journey wiring: Landing → Invite → Sign in → Mandate Brief → Team activates → Command Center                                                |

Live counterparts in the app:

| Prototype module | Real implementation                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `mandate-brief`  | `app/onboarding/*`, `components/onboarding/MandateWizard.tsx` + `MandateActivation.tsx`, `lib/onboarding/mandate.ts` |
| `command-center` | `app/(shell)/command-center/page.tsx`, `components/hubs/Cockpit.tsx`, `lib/command-center/moves.ts`                  |
| `entry`          | `app/(auth)/*` (login / sign-up / invite)                                                                            |

Honest-data rule: seeded rosters/counts/activity in these files are mock demo
data. The live app surfaces real Supabase rows or honest empty states.
