export type ControlBias = "bullish" | "bearish" | "neutral" | "two-way" | "pin" | "warning";

export type ControlAction =
  | "wait"
  | "sell_puts"
  | "sell_calls"
  | "roll_calls"
  | "roll_puts"
  | "repair"
  | "hedge"
  | "reduce_risk"
  | "avoid_premium";

export type ControlScoreTile = {
  key: string;
  label: string;
  score: number;
  bias: ControlBias;
  status: string;
  detail?: string;
  warning?: boolean;
};

export type ControlCenterState = {
  state: string;
  stateLabel: string;
  action: ControlAction;
  actionLabel: string;
  bias: ControlBias;
  confidence: number;
  keyLevels: {
    support?: number | null;
    magnet?: number | null;
    resistance?: number | null;
    bullishTrigger?: number | null;
    bearishFailure?: number | null;
  };
  scoreTiles: ControlScoreTile[];
  explanationBullets: string[];
  warnings: string[];
  traderEdge: {
    score: number;
    posture: string;
    bestZone?: {
      low?: number | null;
      high?: number | null;
      label: string;
    };
    avoidZone?: {
      low?: number | null;
      high?: number | null;
      reason: string;
    };
    bullets: string[];
    warnings: string[];
  };
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(clamp(value));
}

function avg(values: Array<number | null | undefined>, fallback = 50): number {
  const valid = values.filter((value): value is number => Number.isFinite(Number(value)));
  if (!valid.length) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function priceDistanceScore(currentPrice: number, level?: number | null): number {
  if (!currentPrice || !level) return 50;
  const pct = Math.abs(currentPrice - level) / Math.max(1, currentPrice);
  return clamp(100 - pct * 350, 0, 100);
}

function labelAction(action: ControlAction): string {
  switch (action) {
    case "sell_puts":
      return "Sell puts selectively";
    case "sell_calls":
      return "Sell calls selectively";
    case "roll_calls":
      return "Roll / repair calls";
    case "roll_puts":
      return "Roll / defend puts";
    case "repair":
      return "Repair / reduce risk";
    case "hedge":
      return "Hedge";
    case "reduce_risk":
      return "Reduce risk";
    case "avoid_premium":
      return "Avoid premium sale";
    default:
      return "Wait";
  }
}

function deriveAdaptiveAction(adaptiveControl: any): ControlAction | null {
  const raw = String(
    adaptiveControl?.action ??
      adaptiveControl?.primaryAction ??
      adaptiveControl?.recommendedAction ??
      adaptiveControl?.posture ??
      ""
  ).toLowerCase();

  if (!raw) return null;
  if (raw.includes("roll") && raw.includes("call")) return "roll_calls";
  if (raw.includes("roll") && raw.includes("put")) return "roll_puts";
  if (raw.includes("sell") && raw.includes("put")) return "sell_puts";
  if (raw.includes("sell") && raw.includes("call")) return "sell_calls";
  if (raw.includes("hedge")) return "hedge";
  if (raw.includes("reduce")) return "reduce_risk";
  if (raw.includes("avoid")) return "avoid_premium";
  if (raw.includes("repair")) return "repair";
  if (raw.includes("wait")) return "wait";

  return null;
}

function deriveFlowBias(flow: any): ControlBias {
  const bias = String(flow?.bias ?? "").toLowerCase();
  if (bias === "bullish") return "bullish";
  if (bias === "bearish") return "bearish";
  if (bias === "conflicted") return "two-way";
  return "neutral";
}

function deriveIvBias(iv: any): ControlBias {
  const skew = String(iv?.skewBias ?? "").toLowerCase();
  if (skew === "bullish") return "bullish";
  if (skew === "bearish") return "bearish";
  return "neutral";
}

function deriveOiBias(args: {
  currentPrice: number;
  oi: any;
}): ControlBias {
  const adjustedCenter = finite(args.oi?.report?.adjustedCenter);
  const adjustedCallWall = finite(args.oi?.report?.adjustedCallWall);
  const adjustedPutWall = finite(args.oi?.report?.adjustedPutWall);

  if (!args.currentPrice || adjustedCenter == null) return "neutral";
  if (adjustedCallWall != null && args.currentPrice > adjustedCallWall) return "bullish";
  if (adjustedPutWall != null && args.currentPrice < adjustedPutWall) return "bearish";
  if (args.currentPrice > adjustedCenter) return "bullish";
  if (args.currentPrice < adjustedCenter) return "bearish";
  return "neutral";
}

function deriveState(args: {
  currentPrice: number;
  oiBias: ControlBias;
  flowBias: ControlBias;
  ivBias: ControlBias;
  matrix: any;
  support?: number | null;
  resistance?: number | null;
}) {
  const bullishUnlock = finite(args.matrix?.bullishUnlock ?? args.matrix?.bullishTrigger);
  const bearishFailure = finite(args.matrix?.bearishFailure ?? args.matrix?.bearishTrigger);
  const nearResistance = priceDistanceScore(args.currentPrice, args.resistance) > 78;
  const nearSupport = priceDistanceScore(args.currentPrice, args.support) > 78;

  if (bullishUnlock != null && args.currentPrice >= bullishUnlock * 0.995) {
    return {
      state: "bullish_unlock_watch",
      stateLabel: "Bullish Unlock Watch",
      bias: "bullish" as ControlBias,
    };
  }

  if (bearishFailure != null && args.currentPrice <= bearishFailure * 1.005) {
    return {
      state: "bearish_failure_watch",
      stateLabel: "Bearish Failure Watch",
      bias: "bearish" as ControlBias,
    };
  }

  if (args.flowBias === "bullish" && args.oiBias === "bullish") {
    return {
      state: "bullish_confluence",
      stateLabel: "Bullish Confluence",
      bias: "bullish" as ControlBias,
    };
  }

  if (args.flowBias === "bearish" && args.oiBias === "bearish") {
    return {
      state: "bearish_confluence",
      stateLabel: "Bearish Confluence",
      bias: "bearish" as ControlBias,
    };
  }

  if (nearResistance || nearSupport) {
    return {
      state: "pin_chop",
      stateLabel: "Pin / Control-Zone Chop",
      bias: "pin" as ControlBias,
    };
  }

  if (args.flowBias === "two-way" || args.oiBias !== args.flowBias) {
    return {
      state: "mixed_signals",
      stateLabel: "Mixed Signal Regime",
      bias: "two-way" as ControlBias,
    };
  }

  return {
    state: "neutral_control",
    stateLabel: "Neutral Control Regime",
    bias: "neutral" as ControlBias,
  };
}

function statusForBias(bias: ControlBias): string {
  switch (bias) {
    case "bullish":
      return "Bullish";
    case "bearish":
      return "Bearish";
    case "pin":
      return "Pin";
    case "two-way":
      return "Mixed";
    case "warning":
      return "Warning";
    default:
      return "Neutral";
  }
}

export function buildControlCenterState(args: {
  ticker: string;
  currentPrice: number;
  oi: any;
  flow: any;
  dealer: any;
  iv: any;
  wallMigration: any;
  path: any;
  matrix: any;
  adaptiveControl: any;
  selectedChainDominance: any;
  portfolio?: any;
}): ControlCenterState {
  const currentPrice = finite(args.currentPrice) ?? 0;

  const oiAnomalies = Number(args.oi?.report?.anomalies?.length ?? 0);
  const oiRows = Number(args.oi?.rows?.length ?? 0);
  const dominanceScore = finite(args.selectedChainDominance?.score);
  const oiBias = deriveOiBias({ currentPrice, oi: args.oi });

  const oiScore = round(
    avg(
      [
        dominanceScore,
        oiRows > 0 ? 85 : 20,
        clamp(100 - oiAnomalies * 12, 30, 100),
      ],
      55
    )
  );

  const dealerSupport = finite(args.dealer?.support);
  const dealerMagnet = finite(args.dealer?.magnet);
  const dealerResistance = finite(args.dealer?.resistance);
  const dealerScore = round(avg([
    priceDistanceScore(currentPrice, dealerMagnet),
    dealerSupport != null && dealerResistance != null ? 75 : 45,
  ]));

  const ivAtm = finite(args.iv?.atmIv);
  const expectedMove = finite(args.iv?.expectedMove?.oneSigma);
  const ivBias = deriveIvBias(args.iv);
  const ivScore = round(avg([
    ivAtm != null ? clamp(ivAtm * 180, 25, 95) : 45,
    expectedMove != null ? 70 : 45,
  ]));

  const flowBias = deriveFlowBias(args.flow);
  const flowScore = round(avg([
    finite(args.flow?.confidence) ?? 45,
    Number(args.flow?.callVolume ?? 0) + Number(args.flow?.putVolume ?? 0) > 0 ? 75 : 35,
  ]));

  const migrationWarnings = Array.isArray(args.wallMigration?.warnings)
    ? args.wallMigration.warnings.length
    : 0;
  const migrationScore = round(clamp(70 - migrationWarnings * 10, 25, 90));

  const adaptiveWarnings = [
    ...(Array.isArray(args.adaptiveControl?.riskNotes) ? args.adaptiveControl.riskNotes : []),
    ...(Array.isArray(args.adaptiveControl?.warnings) ? args.adaptiveControl.warnings : []),
  ];
  const portfolioScore = round(clamp(78 - adaptiveWarnings.length * 12, 25, 90));

  const traderEdgeScore = round(avg([oiScore, dealerScore, ivScore, flowScore, portfolioScore], 65));

  const derived = deriveState({
    currentPrice,
    oiBias,
    flowBias,
    ivBias,
    matrix: args.matrix,
    support: dealerSupport,
    resistance: dealerResistance,
  });

  const confidence = round(avg([oiScore, dealerScore, ivScore, flowScore, migrationScore, portfolioScore], 65));

  let action: ControlAction =
    deriveAdaptiveAction(args.adaptiveControl) ??
    (derived.bias === "bullish"
      ? "wait"
      : derived.bias === "bearish"
        ? "reduce_risk"
        : "wait");

  if (derived.state === "pin_chop") action = "wait";
  if (adaptiveWarnings.length >= 3) action = "repair";

  const bullishTrigger = finite(args.matrix?.bullishUnlock ?? args.path?.invalidAbove);
  const bearishFailure = finite(args.matrix?.bearishFailure ?? args.path?.invalidBelow);

  const support =
    finite(args.oi?.report?.adjustedPutWall) ??
    dealerSupport ??
    null;
  const magnet =
    finite(args.oi?.report?.adjustedCenter) ??
    dealerMagnet ??
    null;
  const resistance =
    finite(args.oi?.report?.adjustedCallWall) ??
    dealerResistance ??
    null;

  const warnings = [
    ...adaptiveWarnings,
    ...(oiAnomalies ? [`${oiAnomalies} OI anomaly/anomalies detected in the selected chain.`] : []),
    ...(Array.isArray(args.flow?.warnings) ? args.flow.warnings : []),
  ].slice(0, 5);

  const explanationBullets: string[] = [
    `OI Intelligence is ${statusForBias(oiBias).toLowerCase()} with ${oiRows.toLocaleString()} rows and ${oiAnomalies} anomalies.`,
    `Selected chain dominance is ${dominanceScore != null ? `${dominanceScore.toFixed(1)} / 100` : "not available"}.`,
    `Dealer pressure is centered near ${dealerMagnet != null ? dealerMagnet.toFixed(2) : "N/A"} with support/resistance ${dealerSupport != null ? dealerSupport.toFixed(2) : "N/A"} / ${dealerResistance != null ? dealerResistance.toFixed(2) : "N/A"}.`,
    `Flow bias is ${String(args.flow?.bias ?? "neutral").toUpperCase()} with confidence ${finite(args.flow?.confidence)?.toFixed(0) ?? "N/A"} / 100.`,
  ];

  if (bullishTrigger != null || bearishFailure != null) {
    explanationBullets.push(
      `Key triggers: bullish unlock ${bullishTrigger != null ? bullishTrigger.toFixed(2) : "N/A"} / bearish failure ${bearishFailure != null ? bearishFailure.toFixed(2) : "N/A"}.`
    );
  }

  const scoreTiles: ControlScoreTile[] = [
    {
      key: "oi",
      label: "OI Intel",
      score: oiScore,
      bias: oiBias,
      status: `${oiRows.toLocaleString()} rows`,
      detail: `${oiAnomalies} anomalies`,
      warning: oiAnomalies > 0,
    },
    {
      key: "dealer",
      label: "Dealer",
      score: dealerScore,
      bias: "pin",
      status: dealerMagnet != null ? `Magnet ${dealerMagnet.toFixed(2)}` : "No magnet",
      detail: dealerSupport != null && dealerResistance != null ? `${dealerSupport.toFixed(2)}–${dealerResistance.toFixed(2)}` : undefined,
    },
    {
      key: "iv",
      label: "IV Regime",
      score: ivScore,
      bias: ivBias,
      status: args.iv?.skewBias ? String(args.iv.skewBias).toUpperCase() : "Neutral",
      detail: ivAtm != null ? `ATM ${Math.round(ivAtm * 100)}%` : undefined,
    },
    {
      key: "flow",
      label: "Flow",
      score: flowScore,
      bias: flowBias,
      status: String(args.flow?.bias ?? "neutral").toUpperCase(),
      detail: `${Number(args.flow?.callVolume ?? 0).toLocaleString()}C / ${Number(args.flow?.putVolume ?? 0).toLocaleString()}P`,
    },
    {
      key: "migration",
      label: "Migration",
      score: migrationScore,
      bias: migrationWarnings ? "warning" : "neutral",
      status: migrationWarnings ? `${migrationWarnings} warnings` : "Stable",
      warning: migrationWarnings > 0,
    },
    {
      key: "edge",
      label: "Trader Edge",
      score: traderEdgeScore,
      bias: derived.bias,
      status: labelAction(action),
      detail: derived.stateLabel,
      warning: warnings.length > 0,
    },
    {
      key: "portfolio",
      label: "Portfolio Fit",
      score: portfolioScore,
      bias: adaptiveWarnings.length ? "warning" : "neutral",
      status: adaptiveWarnings.length ? "Caution" : "Acceptable",
      detail: adaptiveWarnings[0],
      warning: adaptiveWarnings.length > 0,
    },
  ];

  return {
    state: derived.state,
    stateLabel: derived.stateLabel,
    action,
    actionLabel: labelAction(action),
    bias: derived.bias,
    confidence,
    keyLevels: {
      support,
      magnet,
      resistance,
      bullishTrigger,
      bearishFailure,
    },
    scoreTiles,
    explanationBullets,
    warnings,
    traderEdge: {
      score: traderEdgeScore,
      posture: labelAction(action),
      bestZone:
        support != null && magnet != null
          ? {
              low: support,
              high: magnet,
              label: "Put-side / support-side premium zone",
            }
          : undefined,
      avoidZone:
        magnet != null && resistance != null
          ? {
              low: magnet,
              high: resistance,
              reason: "Avoid initiating short calls into a compressed magnet-to-resistance zone unless the strategy is repair/hedge.",
            }
          : undefined,
      bullets: explanationBullets.slice(0, 4),
      warnings,
    },
  };
}
