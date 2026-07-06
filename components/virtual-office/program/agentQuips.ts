import type { AgentId } from "./officeProgram";

/**
 * A few short, role-flavored lines per executive. The proximity presence card
 * cycles through these (after the agent's idle line) while you linger nearby,
 * so standing next to someone feels alive rather than static.
 */
export const AGENT_QUIPS: Record<AgentId, string[]> = {
  earn:               ["Everything routes through me first.", "Say the word and I'll assemble the plan."],
  associate:          ["The data room's already half-built.", "Point me at a deal and I'll screen it."],
  principal:          ["I'll tell you if this clears the bar.", "Bring me the decision, not the noise."],
  analyst:            ["The model's warm — give me assumptions.", "I stress every number twice."],
  risk:               ["Nothing capital-binding ships without a gate.", "Better to flag it early than explain it late."],
  legal:              ["Redlines are my love language.", "I'll have the NDA back before your coffee refills."],
  investor_relations: ["The LPs will love this update.", "Positioning is half the raise."],
  treasury:           ["Wires stay locked until you approve.", "I reconcile to the penny."],
  portfolio_ops:      ["KPIs are green across the book.", "Operating plans, on schedule."],
  ops_admin:          ["The compliance calendar is current.", "Reporting's filed and tidy."],
  business_dev:       ["The pipeline's never been warmer.", "I map every relationship that matters."],
};
