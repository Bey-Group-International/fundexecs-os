// Every workflow's checkout must leave the job's token out of .git/config.
//
// `actions/checkout` defaults `persist-credentials` to true, which writes the
// job's GITHUB_TOKEN into .git/config where anything later in the job can read
// it: an npm lifecycle script, a compromised action, or a step that uploads the
// workspace as an artifact.
//
// WHY THIS EXISTS ALONGSIDE ZIZMOR. zizmor runs on every PR (see
// .github/workflows/workflow-security.yml) and its `artipacked` audit covers
// exactly this, so most of the time it catches a regression first and this file
// is redundant. It is here for the case where it does not, which was found by
// measurement rather than guessed at:
//
//   Delete `persist-credentials: false` but leave the comment lines above it,
//   and `with:` parses as null. zizmor then reports NOTHING — the gate goes
//   green while the credential is persisted again. Verified: removing the whole
//   `with:` block fails zizmor's gate (exit 13), removing only the key leaves it
//   passing (exit 0).
//
// That is a plausible edit — deleting a setting and leaving its explanation —
// and it is the one shape of this regression zizmor misses. Asking the PARSED
// value for `persist-credentials` catches it, because a null `with` yields
// undefined rather than false.
//
// Workflows are DISCOVERED rather than listed, so a new one is covered by
// existing at all.
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { load } from "js-yaml";

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

/**
 * Workflows that must KEEP their credentials, each because it pushes with them.
 *
 * This is not a way to silence the rule: the test below independently checks
 * that anything named here actually declares `contents: write`, so an entry
 * added to a read-only workflow fails rather than excusing it.
 */
const PUSHES_WITH_CHECKOUT_CREDENTIALS = new Set(["office-hourly.yml"]);

interface Step {
  uses?: string;
  with?: Record<string, unknown> | null;
}
interface Job {
  steps?: Step[];
  permissions?: Record<string, string> | string;
}
interface Workflow {
  jobs?: Record<string, Job>;
  permissions?: Record<string, string> | string;
}

const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

function parse(file: string): Workflow {
  return load(readFileSync(join(WORKFLOW_DIR, file), "utf8")) as Workflow;
}

/** Every checkout step in a workflow, paired with the job it belongs to. */
function checkoutSteps(wf: Workflow): Array<{ job: string; step: Step }> {
  const out: Array<{ job: string; step: Step }> = [];
  for (const [job, def] of Object.entries(wf.jobs ?? {})) {
    for (const step of def.steps ?? []) {
      if (typeof step?.uses === "string" && step.uses.includes("actions/checkout")) {
        out.push({ job, step });
      }
    }
  }
  return out;
}

function writesContents(wf: Workflow, job: string): boolean {
  const scopes = [wf.permissions, wf.jobs?.[job]?.permissions];
  return scopes.some((p) => typeof p === "object" && p !== null && p.contents === "write");
}

describe("workflow checkout credentials", () => {
  // Guard the guard. If discovery breaks, or checkout stops being spelled the
  // way this looks for it, every assertion below would pass over an empty list
  // and prove nothing.
  it("finds the workflows and their checkout steps", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    const total = files.reduce((n, f) => n + checkoutSteps(parse(f)).length, 0);
    expect(total).toBeGreaterThanOrEqual(7);
  });

  describe.each(files)("%s", (file) => {
    const wf = parse(file);
    const steps = checkoutSteps(wf);

    if (PUSHES_WITH_CHECKOUT_CREDENTIALS.has(file)) {
      // The exception has to earn itself. A workflow that cannot write contents
      // has no use for persisted credentials, so listing it above would be a
      // mistake rather than a decision.
      it("actually needs the credentials it keeps", () => {
        expect(steps.length).toBeGreaterThan(0);
        for (const { job } of steps) {
          expect(writesContents(wf, job)).toBe(true);
        }
      });
      return;
    }

    it("checks out the repository", () => {
      expect(steps.length).toBeGreaterThan(0);
    });

    // `toBe(false)` and not `toBeFalsy()`, on purpose. A null `with` gives
    // undefined here, which is falsy but is precisely the evasion described at
    // the top of this file.
    it.each(steps.map(({ job, step }) => [job, step] as const))(
      "job %s does not persist the token into .git/config",
      (_job, step) => {
        expect(step.with?.["persist-credentials"]).toBe(false);
      },
    );

    // A read-only workflow that starts pushing needs the credentials back, and
    // should be added to the set above deliberately rather than by quietly
    // dropping the line.
    it.each(steps.map(({ job }) => job))("job %s does not claim write access", (job) => {
      expect(writesContents(wf, job)).toBe(false);
    });
  });
});
