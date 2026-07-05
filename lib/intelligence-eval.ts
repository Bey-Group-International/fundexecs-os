import {
  deriveRouting,
  type Executive,
  type LifecycleStage,
  type RoutingConfidence,
  type TargetEngine,
} from "@/lib/intelligence";
import type { AgentKey, Hub } from "@/lib/supabase/database.types";

export interface RoutingGoldenCase {
  id: string;
  prompt: string;
  hub: Hub;
  agents: AgentKey[];
  expected: {
    stage: LifecycleStage;
    engine: TargetEngine;
    executive: Executive;
    confidence?: RoutingConfidence;
  };
}

export interface RoutingGoldenResult {
  id: string;
  ok: boolean;
  actual: {
    stage: LifecycleStage;
    engine: TargetEngine;
    executive: Executive;
    confidence: RoutingConfidence;
  };
  expected: RoutingGoldenCase["expected"];
}

export interface RoutingEvaluationSummary {
  total: number;
  passed: number;
  failed: number;
  score: number;
  failures: RoutingGoldenResult[];
}

export const ROUTING_GOLDENS: RoutingGoldenCase[] = [
  {
    id: "lp-pipeline-family-offices",
    prompt: "Source family offices in the Southeast and build the LP pipeline",
    hub: "source",
    agents: ["capital_raiser"],
    expected: {
      stage: "Fundraising & LP Engagement",
      engine: "Outbound Engine",
      executive: "cmo",
      confidence: "high",
    },
  },
  {
    id: "diligence-red-flags",
    prompt: "Run diligence on the data room and surface red flags for IC",
    hub: "run",
    agents: ["diligence"],
    expected: {
      stage: "Diligence",
      engine: "Diligence Engine",
      executive: "analyst",
      confidence: "high",
    },
  },
  {
    id: "capital-stack-model",
    prompt: "Model the capital stack with senior debt and mezzanine sensitivities",
    hub: "execute",
    agents: ["capital_connector"],
    expected: {
      stage: "Capital Stack Design",
      engine: "Capital Stack Engine",
      executive: "cio",
      confidence: "high",
    },
  },
  {
    id: "compliance-subscription-docs",
    prompt: "Review subscription documents for KYC and AML compliance",
    hub: "execute",
    agents: ["analyst"],
    expected: {
      stage: "Compliance & Documentation",
      engine: "Diligence Engine",
      executive: "cro",
      confidence: "high",
    },
  },
  {
    id: "weekly-automation",
    prompt: "Automate this weekly portfolio reporting workflow",
    hub: "run",
    agents: ["associate"],
    expected: {
      stage: "Workflow Automation",
      engine: "Workflow Builder",
      executive: "associate",
      confidence: "high",
    },
  },
  {
    id: "fallback-source-low-confidence",
    prompt: "Help me think about the quarter",
    hub: "source",
    agents: ["associate"],
    expected: {
      stage: "Sourcing",
      engine: "Outbound Engine",
      executive: "associate",
      confidence: "low",
    },
  },
];

export function evaluateRoutingCase(testCase: RoutingGoldenCase): RoutingGoldenResult {
  const routing = deriveRouting({
    prompt: testCase.prompt,
    hub: testCase.hub,
    agents: testCase.agents,
  });
  const actual = {
    stage: routing.lifecycle_stage,
    engine: routing.target_engine,
    executive: routing.assigned_to,
    confidence: routing.confidence,
  };
  const expected = testCase.expected;
  const ok =
    actual.stage === expected.stage &&
    actual.engine === expected.engine &&
    actual.executive === expected.executive &&
    (expected.confidence == null || actual.confidence === expected.confidence);

  return { id: testCase.id, ok, actual, expected };
}

export function evaluateRoutingGoldens(
  cases: RoutingGoldenCase[] = ROUTING_GOLDENS,
): RoutingEvaluationSummary {
  const results = cases.map(evaluateRoutingCase);
  const failures = results.filter((r) => !r.ok);
  const passed = results.length - failures.length;
  return {
    total: results.length,
    passed,
    failed: failures.length,
    score: results.length === 0 ? 1 : passed / results.length,
    failures,
  };
}
