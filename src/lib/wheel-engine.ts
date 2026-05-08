import { DailyStructureSnapshot } from "./daily-structure-store";
import { PortfolioPosition, PortfolioProfile } from "./portfolio-types";
import { groupTickerPositions } from "./position-grouping-engine";

export type WheelState =
  | "no_position"
  | "cash_secured_put"
  | "shares_only"
  | "covered_call"
  | "covered_call_and_short_put"
  | "unknown";

export type WheelAction =
  | "wait"
  | "sell_csp"
  | "sell_covered_call"
  | "manage_short_call"
  | "manage_short_put"
  | "avoid_new_trade";

export type WheelTradePlan = {
  type: "CSP" | "CC" | "MANAGE" | "NONE";
  strike: number | null;
  expiration: string;
  contracts: number;
  coverage: "none" | "partial" | "full";
  chain: string;
  dteTarget: string;
  structureShift: string;
  gammaPressure: "low" | "medium" | "high";
  rollGuidance: string[];
  reasoning: string[];
};
export type ManagedWheelLeg = {
  id: string;
  type: "short_call" | "short_put" | "long_call" | "long_put" | "shares";
  qty: number;
  strike: number | null;
  expiration: string;
  distanceToSpotPct: number | null;
  distanceToSupportPct: number | null;
  distanceToResistancePct: number | null;
  status: "safe" | "watch" | "pressure" | "defend";
  guidance: string[];
};

export type WheelPositionContext = {
  hasTickerPosition: boolean;
  shares: number;
  coveredLots: number;
  uncoveredShares: number;
  shortCallCount: number;
  shortPutCount: number;
  managedLegs: ManagedWheelLeg[];
};
export type WheelWorkspaceDecision = {
  ticker: string;
  spot: number;
  state: WheelState;
  action: WheelAction;
  shares: number;
  existingShortCalls: PortfolioPosition[];
  existingShortPuts: PortfolioPosition[];
  maxCoveredCallContracts: number;
  support?: number | null;
  resistance?: number | null;
  magnet?: number | null;
  bias?: string;
  confidence?: string;
  cspZone: string;
  coveredCallZone: string;
  tradePlan: WheelTradePlan;
  readout: string[];
  triggers: string[];
  riskNotes: string[];
  positionContext: WheelPositionContext;  
};

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function positionsForTicker(profile: PortfolioProfile | null, ticker: string): PortfolioPosition[] {
  return (profile?.positions ?? []).filter((p) => p.symbol?.toUpperCase() === ticker.toUpperCase());
}
function pctDistance(level?: number | null, ref?: number | null): number | null {
  if (level == null || ref == null || !Number.isFinite(level) || !Number.isFinite(ref) || ref === 0) return null;
  return (level - ref) / ref;
}

function buildManagedLegs(args: {
  positions: PortfolioPosition[];
  spot: number;
  support?: number | null;
  resistance?: number | null;
  magnet?: number | null;
}): ManagedWheelLeg[] {
  const legs: ManagedWheelLeg[] = [];

  for (const p of args.positions) {
    const qty = p.qty ?? 0;
    const strike = p.strike ?? null;
    const expiration = p.expiration ?? "N/A";
    const distance = strike ? pctDistance(strike, args.spot) : null;
    const distanceToSupport = args.support && strike ? pctDistance(strike, args.support) : null;
    const distanceToResistance = args.resistance && strike ? pctDistance(strike, args.resistance) : null;

    if (p.instrumentType === "stock") {
      const shareQty = p.side === "short" ? -qty : qty;
      legs.push({
        id: `${p.symbol}-shares-${p.side}-${qty}`,
        type: "shares",
        qty: shareQty,
        strike: null,
        expiration: "N/A",
        distanceToSpotPct: null,
        distanceToSupportPct: args.support ? pctDistance(args.support, args.spot) : null,
        distanceToResistancePct: args.resistance ? pctDistance(args.resistance, args.spot) : null,
        status: shareQty >= 100 ? "safe" : shareQty > 0 ? "watch" : "safe",
        guidance: [
          shareQty >= 100
            ? `Share position provides ${Math.floor(Math.max(0, shareQty) / 100)} covered-call lot(s).`
            : shareQty > 0
              ? "Share position is below one full covered-call lot."
              : "No long-share covered-call capacity from this leg."
        ]
      });
      continue;
    }

    if (p.instrumentType === "call" && p.side === "short") {
      let status: ManagedWheelLeg["status"] = "safe";
      const guidance: string[] = [];

      if (strike != null) {
        if (args.spot >= strike) {
          status = "defend";
          guidance.push("Spot is above the short-call strike. Assignment/roll risk is active.");
        } else if (args.spot >= strike * 0.98) {
          status = "pressure";
          guidance.push("Spot is within 2% of the short-call strike. Monitor roll timing.");
        } else if (args.resistance != null && strike <= args.resistance) {
          status = "watch";
          guidance.push("Short-call strike is at or below OI resistance; upside structure may pressure the call.");
        } else {
          guidance.push("Short call is currently outside immediate pressure.");
        }

        if (args.magnet != null && args.spot < args.magnet && strike <= args.magnet) {
          guidance.push("Spot is below magnet; avoid rolling too low if magnet reclaim is likely.");
        }
      }

      legs.push({
        id: `${p.symbol}-short-call-${expiration}-${strike ?? "NA"}-${qty}`,
        type: "short_call",
        qty,
        strike,
        expiration,
        distanceToSpotPct: distance,
        distanceToSupportPct: distanceToSupport,
        distanceToResistancePct: distanceToResistance,
        status,
        guidance
      });
      continue;
    }

    if (p.instrumentType === "put" && p.side === "short") {
      let status: ManagedWheelLeg["status"] = "safe";
      const guidance: string[] = [];

      if (strike != null) {
        if (args.spot <= strike) {
          status = "defend";
          guidance.push("Spot is below the short-put strike. Assignment/defense risk is active.");
        } else if (args.spot <= strike * 1.02) {
          status = "pressure";
          guidance.push("Spot is within 2% of the short-put strike. Monitor support and extrinsic value.");
        } else if (args.support != null && strike >= args.support) {
          status = "watch";
          guidance.push("Short-put strike is at or above OI support; assignment risk is structurally elevated.");
        } else {
          guidance.push("Short put is currently outside immediate pressure.");
        }
      }

      legs.push({
        id: `${p.symbol}-short-put-${expiration}-${strike ?? "NA"}-${qty}`,
        type: "short_put",
        qty,
        strike,
        expiration,
        distanceToSpotPct: distance,
        distanceToSupportPct: distanceToSupport,
        distanceToResistancePct: distanceToResistance,
        status,
        guidance
      });
      continue;
    }

    if (p.instrumentType === "call" && p.side === "long") {
      let status: ManagedWheelLeg["status"] = "safe";
      const guidance: string[] = [];

      if (strike != null) {
        const moneynessPct = args.spot > 0 ? ((strike - args.spot) / args.spot) * 100 : null;

        if (moneynessPct != null && moneynessPct > 50) {
          status = "watch";
          guidance.push(`Far OTM / convexity exposure: strike is ${moneynessPct.toFixed(1)}% above spot, so it needs major trend expansion, not just a small level reclaim.`);
        } else if (args.resistance != null && args.spot < args.resistance) {
          status = "watch";
          guidance.push(`Long call needs price acceptance above resistance ${fmt(args.resistance)} for cleaner continuation.`);
        } else if (args.spot >= strike) {
          guidance.push("Long call is in-the-money; monitor whether it is being used as upside exposure or PMCC coverage.");
        } else {
          guidance.push("Long call is out-of-the-money; monitor decay, resistance, and liquidity.");
        }

        if (args.magnet != null && args.spot < args.magnet) {
          guidance.push(`OI magnet ${fmt(args.magnet)} is above spot; reclaim supports nearer long-call exposure.`);
        }
      }

      legs.push({
        id: `${p.symbol}-long-call-${expiration}-${strike ?? "NA"}-${qty}`,
        type: "long_call",
        qty,
        strike,
        expiration,
        distanceToSpotPct: distance,
        distanceToSupportPct: distanceToSupport,
        distanceToResistancePct: distanceToResistance,
        status,
        guidance
      });
      continue;
    }

    if (p.instrumentType === "put" && p.side === "long") {
      let status: ManagedWheelLeg["status"] = "safe";
      const guidance: string[] = [];

      if (strike != null) {
        if (args.support != null && args.spot > args.support) {
          status = "watch";
          guidance.push(`Long put is hedge exposure; support ${fmt(args.support)} is the first level to watch for hedge activation.`);
        } else if (args.spot <= strike) {
          guidance.push("Long put is in-the-money; monitor hedge value and whether protection should be monetized.");
        } else {
          guidance.push("Long put is out-of-the-money protection; monitor decay versus downside risk.");
        }
      }

      legs.push({
        id: `${p.symbol}-long-put-${expiration}-${strike ?? "NA"}-${qty}`,
        type: "long_put",
        qty,
        strike,
        expiration,
        distanceToSpotPct: distance,
        distanceToSupportPct: distanceToSupport,
        distanceToResistancePct: distanceToResistance,
        status,
        guidance
      });
    }
  }

  return legs;
}

function netShares(positions: PortfolioPosition[]): number {
  return positions
    .filter((p) => p.instrumentType === "stock")
    .reduce((sum, p) => sum + (p.side === "long" ? 1 : -1) * (p.qty ?? 0), 0);
}

function shortCalls(positions: PortfolioPosition[]): PortfolioPosition[] {
  return positions.filter((p) => p.instrumentType === "call" && p.side === "short");
}

function shortPuts(positions: PortfolioPosition[]): PortfolioPosition[] {
  return positions.filter((p) => p.instrumentType === "put" && p.side === "short");
}

function detectState(positions: PortfolioPosition[]): WheelState {
  const shares = netShares(positions);
  const calls = shortCalls(positions);
  const puts = shortPuts(positions);

  if (!positions.length) return "no_position";
  if (shares >= 100 && calls.length && puts.length) return "covered_call_and_short_put";
  if (shares >= 100 && calls.length) return "covered_call";
  if (shares >= 100) return "shares_only";
  if (puts.length) return "cash_secured_put";
  return "unknown";
}

function zoneAround(value?: number | null, width = 0.5): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value - width).toFixed(2)} – ${(value + width).toFixed(2)}`;
}

function distancePct(a?: number | null, b?: number | null): number {
  if (a == null || b == null || !a || !b) return 999;
  return Math.abs(a - b) / Math.max(Math.abs(b), 0.01);
}

function gammaPressure(args: {
  spot: number;
  support?: number | null;
  resistance?: number | null;
  magnet?: number | null;
}): "low" | "medium" | "high" {
  const nearest = Math.min(
    distancePct(args.spot, args.support),
    distancePct(args.spot, args.resistance),
    distancePct(args.spot, args.magnet)
  );

  if (nearest <= 0.01) return "high";
  if (nearest <= 0.025) return "medium";
  return "low";
}

function chooseDteTarget(args: {
  state: WheelState;
  bias: string;
  confidence: string;
  gamma: "low" | "medium" | "high";
}): string {
  if (args.gamma === "high") return "14–30 DTE";
  if (args.state === "covered_call_and_short_put") return "manage existing expiration";
  if (args.confidence === "high" && args.bias !== "neutral") return "30–45 DTE";
  return "21–45 DTE";
}

function chooseExpirationFromSurface(structure: DailyStructureSnapshot | null, dteTarget: string): string {
  const points = structure?.projectionPoints ?? [];
  if (!points.length) return dteTarget;

  const target =
    dteTarget.includes("14–30") ? 21 :
    dteTarget.includes("21–45") ? 30 :
    dteTarget.includes("30–45") ? 35 :
    30;

  const best = [...points]
    .filter((p) => p.dte >= 7 && p.dte <= 60)
    .sort((a, b) => {
      const aScore = Math.abs(a.dte - target) + a.anomalyCount * 10;
      const bScore = Math.abs(b.dte - target) + b.anomalyCount * 10;
      return aScore - bScore;
    })[0];

  return best ? `${best.expiration} (${best.dte} DTE)` : dteTarget;
}
function compressionCushionPct(args: {
  gamma: "low" | "medium" | "high";
  bias: string;
  side: "call" | "put";
}): number {
  if (args.gamma === "high") return 0.04;
  if (args.gamma === "medium") return 0.03;

  if (args.side === "call" && args.bias === "bullish") return 0.05;
  if (args.side === "put" && args.bias === "bearish") return 0.05;

  return 0.025;
}
function shiftedCoveredCallStrike(args: {
  resistance?: number | null;
  magnet?: number | null;
  spot: number;
  bias: string;
  gamma?: "low" | "medium" | "high";
}): { strike: number | null; shift: string } {
  if (args.resistance == null) {
    return { strike: null, shift: "No resistance level available." };
  }

  const cushionPct = compressionCushionPct({
    gamma: args.gamma ?? "low",
    bias: args.bias,
    side: "call"
  });

  const minimumStrike = args.spot * (1 + cushionPct);

  let strike = Math.max(args.resistance, minimumStrike);

  if (args.bias === "bullish" && args.magnet != null && args.spot < args.magnet) {
    strike = Math.max(strike, args.magnet);
  }

  return {
    strike,
    shift:
      strike > args.resistance
        ? "Shifted covered-call strike above resistance because structure is compressed or upside risk remains."
        : "Using resistance as the covered-call reference strike."
  };
}
function shiftedPutStrike(args: {
  support?: number | null;
  magnet?: number | null;
  spot: number;
  bias: string;
  gamma?: "low" | "medium" | "high";
}): { strike: number | null; shift: string } {
  if (args.support == null) {
    return { strike: null, shift: "No support level available." };
  }

  const cushionPct = compressionCushionPct({
    gamma: args.gamma ?? "low",
    bias: args.bias,
    side: "put"
  });

  const maximumStrike = args.spot * (1 - cushionPct);

  let strike = Math.min(args.support, maximumStrike);

  if (args.bias === "bearish") {
    strike = Math.min(strike, args.spot * 0.97);
  }

  return {
    strike,
    shift:
      strike < args.support
        ? "Shifted CSP strike below support because structure is compressed or downside risk remains."
        : "Using support as the CSP reference strike."
  };
}
function buildRollGuidance(args: {
  spot: number;
  resistance?: number | null;
  support?: number | null;
  magnet?: number | null;
  shortCalls: PortfolioPosition[];
  shortPuts: PortfolioPosition[];
}): string[] {
  const notes: string[] = [];

  for (const call of args.shortCalls) {
    if (call.strike == null) continue;

    if (args.spot >= call.strike * 0.98) {
      notes.push(`Short call ${fmt(call.strike)} is under pressure; evaluate rolling up/out if extrinsic value remains.`);
    }

    if (args.resistance != null && call.strike < args.resistance) {
      notes.push(`Short call ${fmt(call.strike)} is below resistance ${fmt(args.resistance)}; upside may not be fully covered by structure.`);
    }

    if (args.magnet != null && args.spot < args.magnet && call.strike <= args.magnet) {
      notes.push(`Spot below magnet ${fmt(args.magnet)}; avoid rolling calls too low if magnet reclaim is likely.`);
    }
  }

  for (const put of args.shortPuts) {
    if (put.strike == null) continue;

    if (args.spot <= put.strike * 1.02) {
      notes.push(`Short put ${fmt(put.strike)} is under pressure; defend if price loses support.`);
    }

    if (args.support != null && put.strike > args.support) {
      notes.push(`Short put ${fmt(put.strike)} is above support ${fmt(args.support)}; assignment risk is structurally elevated.`);
    }
  }

  if (!notes.length) notes.push("No urgent roll condition detected.");

  return notes;
}

function buildTradePlan(args: {
  state: WheelState;
  spot: number;
  support?: number | null;
  resistance?: number | null;
  magnet?: number | null;
  shares: number;
  shortCalls: PortfolioPosition[];
  shortPuts: PortfolioPosition[];
  bias: string;
  confidence: string;
  structure: DailyStructureSnapshot | null;
}): WheelTradePlan {
  const gamma = gammaPressure(args);
  const dteTarget = chooseDteTarget({
    state: args.state,
    bias: args.bias,
    confidence: args.confidence,
    gamma
  });

  const expiration = chooseExpirationFromSurface(args.structure, dteTarget);
  const rollGuidance = buildRollGuidance(args);
  const maxCoveredCallContracts = Math.floor(Math.max(0, args.shares) / 100);

  if (args.state === "covered_call_and_short_put") {
    return {
      type: "MANAGE",
      strike: null,
      expiration: "manage existing chains",
      contracts: 0,
      coverage: "none",
      chain: "existing short call / short put chains",
      dteTarget,
      structureShift: "No new structure-based trade; existing exposure already spans both sides.",
      gammaPressure: gamma,
      rollGuidance,
      reasoning: [
        "Existing short-call and short-put exposure already spans both sides of the wheel.",
        "Manage existing exposure; do not stack additional wheel risk until one side is reduced or resolved.",
        "Use support, resistance, and magnet as management levels."
      ]
    };
  }

  if ((args.state === "shares_only" || args.state === "covered_call") && maxCoveredCallContracts > 0) {
    const shifted = shiftedCoveredCallStrike(args);
    if (shifted.strike == null) {
      return {
        type: "NONE",
        strike: null,
        expiration: "N/A",
        contracts: 0,
        coverage: "none",
        chain: "N/A",
        dteTarget,
        structureShift: shifted.shift,
        gammaPressure: gamma,
        rollGuidance,
        reasoning: ["No clean covered-call strike available."]
      };
    }

    let contracts = maxCoveredCallContracts;
    let coverage: WheelTradePlan["coverage"] = "full";

    if (args.spot < shifted.strike * 0.97 || args.bias === "bullish") {
      contracts = Math.max(1, Math.floor(maxCoveredCallContracts * 0.5));
      coverage = contracts >= maxCoveredCallContracts ? "full" : "partial";
    }

    return {
      type: "CC",
      strike: shifted.strike,
      expiration,
      contracts,
      coverage,
      chain: `${shifted.strike.toFixed(2)} call / ${expiration}`,
      dteTarget,
      structureShift: shifted.shift,
      gammaPressure: gamma,
      rollGuidance,
      reasoning: [
        `Use ${shifted.strike.toFixed(2)} as the covered-call reference strike.`,
        coverage === "full"
          ? "Full coverage is acceptable when upside appears capped."
          : "Partial coverage preserves upside because price is below resistance or surface bias is bullish.",
        `Gamma pressure is ${gamma}; avoid aggressive full coverage when pressure is high.`,
        `Surface bias is ${args.bias.toUpperCase()} with ${args.confidence} confidence.`
      ]
    };
  }

  if ((args.state === "no_position" || args.state === "cash_secured_put")) {
    const shifted = shiftedPutStrike(args);
    if (shifted.strike == null) {
      return {
        type: "NONE",
        strike: null,
        expiration: "N/A",
        contracts: 0,
        coverage: "none",
        chain: "N/A",
        dteTarget,
        structureShift: shifted.shift,
        gammaPressure: gamma,
        rollGuidance,
        reasoning: ["No clean CSP strike available."]
      };
    }

    return {
      type: "CSP",
      strike: shifted.strike,
      expiration,
      contracts: 1,
      coverage: "partial",
      chain: `${shifted.strike.toFixed(2)} put / ${expiration}`,
      dteTarget,
      structureShift: shifted.shift,
      gammaPressure: gamma,
      rollGuidance,
      reasoning: [
        `Use ${shifted.strike.toFixed(2)} as the CSP reference strike.`,
        "Start with conservative sizing unless support is rising and confidence is high.",
        `Gamma pressure is ${gamma}; avoid over-sizing near high-pressure levels.`,
        `Surface bias is ${args.bias.toUpperCase()} with ${args.confidence} confidence.`
      ]
    };
  }

  return {
    type: "NONE",
    strike: null,
    expiration: "N/A",
    contracts: 0,
    coverage: "none",
    chain: "N/A",
    dteTarget,
    structureShift: "No clean setup detected.",
    gammaPressure: gamma,
    rollGuidance,
    reasoning: ["No clean wheel trade is currently selected."]
  };
}

export function buildWheelWorkspaceDecision(args: {
  ticker: string;
  profile: PortfolioProfile | null;
  structure: DailyStructureSnapshot | null;
  spot: number;
}): WheelWorkspaceDecision {
  const positions = positionsForTicker(args.profile, args.ticker);
  const state = detectState(positions);

  const support = args.structure?.support ?? null;
  const resistance = args.structure?.resistance ?? null;
  const magnet = args.structure?.magnet ?? null;
  const bias = args.structure?.projectedBias ?? "neutral";
  const confidence = args.structure?.confidence ?? "low";

  const calls = shortCalls(positions);
  const puts = shortPuts(positions);
  const shares = netShares(positions);
  const maxCoveredCallContracts = Math.floor(Math.max(0, shares) / 100);

  let action: WheelAction = "wait";

  if (state === "no_position") action = bias === "bearish" ? "wait" : "sell_csp";
  if (state === "shares_only") action = resistance != null && args.spot >= resistance * 0.97 ? "sell_covered_call" : "wait";
  if (state === "covered_call") action = "manage_short_call";
  if (state === "cash_secured_put") action = "manage_short_put";
  if (state === "covered_call_and_short_put") action = "avoid_new_trade";

  const tradePlan = buildTradePlan({
    state,
    spot: args.spot,
    support,
    resistance,
    magnet,
    shares,
    shortCalls: calls,
    shortPuts: puts,
    bias,
    confidence,
    structure: args.structure
  });

  const readout = [
    `Spot ${fmt(args.spot)} vs support ${fmt(support)}, resistance ${fmt(resistance)}, magnet ${fmt(magnet)}.`,
    `Surface bias is ${bias.toUpperCase()} with ${confidence} confidence.`,
    `Share coverage allows up to ${maxCoveredCallContracts} covered-call contract(s).`,
    tradePlan.structureShift,
    `Gamma pressure proxy: ${tradePlan.gammaPressure.toUpperCase()}.`
  ];

  const triggers = [
    `Bullish trigger: price reclaims and holds above magnet ${fmt(magnet)}.`,
    `Bearish trigger: price loses support ${fmt(support)}.`,
    `Premium trigger: price approaches resistance ${fmt(resistance)}.`
  ];
  const managedLegs = buildManagedLegs({
  positions,
  spot: args.spot,
  support,
  resistance,
  magnet
  });

  const positionContext: WheelPositionContext = {
      hasTickerPosition: positions.length > 0,
      shares,
      coveredLots: maxCoveredCallContracts,
      uncoveredShares: Math.max(0, shares % 100),
      shortCallCount: calls.reduce((sum, p) => sum + (p.qty ?? 0), 0),
      shortPutCount: puts.reduce((sum, p) => sum + (p.qty ?? 0), 0),
      managedLegs
    };
    

  const riskNotes: string[] = [];

  if (action === "avoid_new_trade") {
    riskNotes.push("Both short-call and short-put exposure exist; avoid stacking more wheel risk until one side resolves.");
  }

  if (shares < 100 && state !== "no_position" && state !== "cash_secured_put") {
    riskNotes.push("Share count is below one full covered-call lot.");
  }

  return {
    ticker: args.ticker,
    spot: args.spot,
    state,
    action,
    shares,
    existingShortCalls: calls,
    existingShortPuts: puts,
    maxCoveredCallContracts,
    support,
    resistance,
    magnet,
    bias,
    confidence,
    cspZone: zoneAround(support),
    coveredCallZone: zoneAround(resistance),
    tradePlan,
    readout,
    triggers,
    riskNotes,
    positionContext  
  };
}