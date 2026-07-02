// PipelineRoad-style composite deal score: fit × urgency × momentum (0–100).

export interface DealScoreInputs {
  thesisFitScore: number | null;   // 0–100
  stageMomentum: number | null;    // 0–100 (how fast moving through pipeline)
  urgencySignal: number | null;    // 0–100 (deadline, competing bids, etc.)
  teamStrength: number | null;     // 0–100
  marketSizePct: number | null;    // 0–100
}

export interface DealScore {
  composite: number;  // 0–100
  fit: number;
  urgency: number;
  momentum: number;
  tier: "A" | "B" | "C" | "D";
}

const W = { fit: 0.35, urgency: 0.25, momentum: 0.25, team: 0.1, market: 0.05 };

export function scoreDeal(inputs: DealScoreInputs): DealScore {
  const fit = inputs.thesisFitScore ?? 50;
  const urgency = inputs.urgencySignal ?? 40;
  const momentum = inputs.stageMomentum ?? 50;
  const team = inputs.teamStrength ?? 50;
  const market = inputs.marketSizePct ?? 50;

  const composite = Math.round(
    fit * W.fit +
    urgency * W.urgency +
    momentum * W.momentum +
    team * W.team +
    market * W.market
  );

  const tier: DealScore["tier"] =
    composite >= 75 ? "A" : composite >= 55 ? "B" : composite >= 35 ? "C" : "D";

  return { composite, fit, urgency, momentum, tier };
}
