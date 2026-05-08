export type RollInput = {
  currentDelta: number;
  dte: number;
  ivPercentile: number;
  earningsSoon: boolean;
};

export type RollDecision = {
  action: "hold" | "consider_roll" | "urgent_roll_review";
  reasons: string[];
};

export function evaluateRollDecision(input: RollInput): RollDecision {
  const reasons: string[] = [];
  let score = 0;

  if (input.currentDelta >= 0.4) {
    score += 2;
    reasons.push("Delta has moved into higher assignment risk zone.");
  }

  if (input.dte <= 7) {
    score += 1;
    reasons.push("Contract is near expiry.");
  }

  if (input.ivPercentile >= 70) {
    score += 1;
    reasons.push("Elevated IV may improve roll credits.");
  }

  if (input.earningsSoon) {
    score += 2;
    reasons.push("Earnings event before/near expiry increases uncertainty.");
  }

  if (score >= 4) return { action: "urgent_roll_review", reasons };
  if (score >= 2) return { action: "consider_roll", reasons };
  return { action: "hold", reasons: reasons.length ? reasons : ["Risk profile remains within configured bounds."] };
}
