import type { TeamTask } from "@/lib/supabase/database.types";
import { __test } from "@/lib/team-tasks";

const {
  buildTeamTaskEarnPrompt,
  isActiveTeamTask,
  normalizeTeamTaskPriority,
  operatorLearningPreamble,
  summarizeOperatorFeedback,
  topCounts,
} = __test;

describe("team task prompt helpers", () => {
  it("builds a task-specific Earn prompt with hub, priority, due date, and details", () => {
    const prompt = buildTeamTaskEarnPrompt({
      title: "Refresh LP follow-up list",
      description: "Prioritize family offices waiting on the Q3 memo.",
      hub: "source",
      module: "lp_pipeline",
      priority: "high",
      due_at: "2026-06-22T12:00:00.000Z",
    });

    expect(prompt).toContain("Task: Refresh LP follow-up list");
    expect(prompt).toContain("Details: Prioritize family offices");
    expect(prompt).toContain("Hub: source / lp pipeline");
    expect(prompt).toContain("Priority: high");
    expect(prompt).toContain("Due: 2026-06-22T12:00:00.000Z");
    expect(prompt).toContain("fastest credible path");
  });

  it("normalizes unknown priorities", () => {
    expect(normalizeTeamTaskPriority("urgent")).toBe("urgent");
    expect(normalizeTeamTaskPriority("critical")).toBe("normal");
    expect(normalizeTeamTaskPriority(null)).toBe("normal");
  });

  it("identifies active team task statuses", () => {
    expect(isActiveTeamTask({ status: "pending" } as Pick<TeamTask, "status">)).toBe(true);
    expect(isActiveTeamTask({ status: "in_progress" } as Pick<TeamTask, "status">)).toBe(true);
    expect(isActiveTeamTask({ status: "completed" } as Pick<TeamTask, "status">)).toBe(false);
  });
});

describe("operator learning summaries", () => {
  it("ranks counts and humanizes scoped keys", () => {
    expect(topCounts(["source/lp_pipeline", "source/lp_pipeline", "run/risk"], 2)).toEqual([
      "source lp pipeline",
      "run risk",
    ]);
  });

  it("summarizes completion, Earn assistance, and rejection patterns", () => {
    const digest = summarizeOperatorFeedback([
      { signal: "team_task_completed", scope: "source/lp_pipeline", subject: "LP follow-up", agent: null },
      { signal: "approval_approved", scope: "source/lp_pipeline", subject: "Draft outreach", agent: null },
      { signal: "team_task_earn_assisted", scope: "source/lp_pipeline", subject: "LP follow-up", agent: "associate" },
      { signal: "approval_rejected", scope: "execute/reporting", subject: "LP report", agent: "investor_relations" },
    ]);

    expect(digest).toContain("ships most often in source lp pipeline");
    expect(digest).toContain("uses Earn with associate");
    expect(digest).toContain("recently completed LP follow-up");
    expect(digest).toContain("tightens approval in execute reporting");
  });

  it("formats a learned preamble only when there is signal", () => {
    expect(operatorLearningPreamble(undefined)).toBe("");
    expect(operatorLearningPreamble("ships most often in source")).toBe(
      "[Learned operator pattern: ships most often in source.]",
    );
  });
});
