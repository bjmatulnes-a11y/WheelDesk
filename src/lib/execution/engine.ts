import type { BuildExecutionReadInput, ExecutionRead, IronFlyLegs, ScoreComponent } from "./types";
import { estimateIronFlyCredit, premiumStats } from "./premium";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function buildExecutionRead(
  input: BuildExecutionReadInput,
): ExecutionRead {
  const { recommendation, rows, generatedAt, premiumHistory, position } = input;

  const legs: IronFlyLegs = {
    lowerWing: recommendation.lowerWing,
    shortPut: recommendation.suggestedCenter,
    shortCall: recommendation.suggestedCenter,
    upperWing: recommendation.upperWing,
  };

  const liveCredit = estimateIronFlyCredit(rows, legs);
  const stats = premiumStats(
    liveCredit !== null && premiumHistory.length === 0
      ? [{ timestamp: generatedAt, credit: liveCredit, velocityPerMinute: 0 }]
      : premiumHistory,
  );

  const currentCredit = liveCredit ?? stats.currentCredit;
  const centerDistance = Math.abs(
    recommendation.spxPrice - recommendation.suggestedCenter,
  );
  const centerDistancePctOfExpectedMove =
    recommendation.expectedMove > 0
      ? centerDistance / recommendation.expectedMove
      : 1;

  const centerScore = clamp(
    22 - centerDistancePctOfExpectedMove * 22,
    0,
    22,
  );

  const confidenceScore = clamp(
    (recommendation.confidenceScore / 100) * 20,
    0,
    20,
  );

  const dealerScore = clamp(
    18 - Math.abs(recommendation.dealerPressure) * 0.12,
    0,
    18,
  );

  const pinDistance = recommendation.spx.strongestPin
    ? Math.abs(
        recommendation.spxPrice - recommendation.spx.strongestPin,
      )
    : recommendation.expectedMove;

  const pinScore = clamp(
    15 -
      (pinDistance / Math.max(recommendation.expectedMove, 1)) * 15,
    0,
    15,
  );

  const premiumPeakScore =
    stats.creditOffPeakPct === null
      ? 4
      : clamp(stats.creditOffPeakPct * 1.1, 0, 14);

  const velocityScore =
    stats.velocityPerMinute < -0.05
      ? clamp(Math.abs(stats.velocityPerMinute) * 22, 0, 11)
      : stats.velocityPerMinute > 0.08
        ? 0
        : 5;

  const components: ScoreComponent[] = [
    {
      key: "center",
      label: "Center attraction",
      score: centerScore,
      max: 22,
      reason: `${centerDistance.toFixed(1)} points from IF center`,
    },
    {
      key: "confidence",
      label: "Model confidence",
      score: confidenceScore,
      max: 20,
      reason: `${recommendation.confidenceScore}% structure confidence`,
    },
    {
      key: "dealer",
      label: "Dealer stability",
      score: dealerScore,
      max: 18,
      reason: `Dealer pressure ${recommendation.dealerPressure}`,
    },
    {
      key: "pin",
      label: "Pin attraction",
      score: pinScore,
      max: 15,
      reason: recommendation.spx.strongestPin
        ? `${pinDistance.toFixed(1)} points from strongest pin`
        : "No confirmed pin",
    },
    {
      key: "peak",
      label: "Premium off peak",
      score: premiumPeakScore,
      max: 14,
      reason:
        stats.creditOffPeakPct === null
          ? "Building premium history"
          : `${stats.creditOffPeakPct.toFixed(1)}% below peak`,
    },
    {
      key: "velocity",
      label: "Premium velocity",
      score: velocityScore,
      max: 11,
      reason: `${stats.velocityPerMinute.toFixed(3)} credit/min`,
    },
  ];

  const harvestScore = clamp(
    Math.round(
      components.reduce((sum, component) => sum + component.score, 0),
    ),
    0,
    100,
  );

  const buybackScore = clamp(
    Math.round(
      (stats.creditOffPeakPct ?? 0) * 0.7 +
        Math.max(0, -stats.velocityPerMinute * 45) +
        (position?.open ? 18 : 0),
    ),
    0,
    100,
  );

  let action: ExecutionRead["action"] = "WAIT";
  let zone: ExecutionRead["zone"] = "avoid";

  if (position?.open) {
    if (buybackScore >= 75) {
      action = "BUYBACK";
      zone = "manage";
    } else {
      action = "MANAGE";
      zone = "manage";
    }
  } else if (harvestScore >= 80) {
    action = "SELL";
    zone = "harvest";
  } else if (harvestScore >= 58) {
    action = "WATCH";
    zone = "watch";
  }

  const reasons = components
    .filter((component) => component.score >= component.max * 0.58)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((component) => component.reason);

  const warningReasons = components
    .filter((component) => component.score <= component.max * 0.3)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((component) => component.reason);

  const confidence =
    action === "BUYBACK"
      ? buybackScore
      : action === "SELL"
        ? harvestScore
        : Math.max(harvestScore, buybackScore);

  return {
    generatedAt,
    action,
    zone,
    confidence,
    harvestScore,
    buybackScore,
    currentCredit,
    peakCredit: stats.peakCredit,
    premiumVelocityPerMinute: stats.velocityPerMinute,
    creditOffPeakPct: stats.creditOffPeakPct,
    centerDistance,
    centerDistancePctOfExpectedMove,
    legs,
    components,
    reasons,
    warningReasons,
  };
}
