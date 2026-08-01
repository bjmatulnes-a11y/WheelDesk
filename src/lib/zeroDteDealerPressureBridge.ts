import {
  buildDealerPressureSummary,
  type DealerPressureSummary,
} from "./dealer-pressure-engine";
import type { ZeroDteChainRow } from "./zeroDteOiIntelligence";
import { buildZeroDteFlowState, type ZeroDteFlowStateRead } from "./zeroDteFlowState";

export type ZeroDteDealerPressureRead = {
  source: "dealer-pressure-engine" | "local-fallback";
  signedPressure: number;
  summary: DealerPressureSummary | null;
  flowState: ZeroDteFlowStateRead | null;
  notes: string[];
};

type BuildDealerPressureReadArgs = {
  ticker: "SPX" | "SPY";
  spot: number;
  rows: ZeroDteChainRow[];
  snapshotDate?: string | null;
  expiration?: string | null;
  support?: number | null;
  resistance?: number | null;
  magnet?: number | null;
};

export function buildZeroDteDealerPressureRead(
  args: BuildDealerPressureReadArgs
): ZeroDteDealerPressureRead {
  try {
    const summary = buildDealerPressureSummary({
      surface: buildZeroDteSurface(args) as any,
      livePrice: args.spot,
    });

    if (!summary) {
      return {
        source: "local-fallback",
        signedPressure: 0,
        summary: null,
        flowState: null,
        notes: ["dealer-pressure-engine returned no summary for the 0DTE surface."],
      };
    }

    const signedPressure = dealerSummaryToSignedPressure(summary);
    const flowState = buildZeroDteFlowState({ summary, signedPressure });

    return {
      source: "dealer-pressure-engine",
      signedPressure,
      summary,
      flowState,
      notes: [
        `Dealer engine regime: ${summary.regime}.`,
        `Hedge-flow bias: ${summary.hedgeFlowBias}.`,
        `Pin risk ${Math.round(summary.pinRiskScore)} / snap risk ${Math.round(summary.snapRiskScore)} / confidence ${Math.round(summary.confidenceScore)}.`,
        `Flow state: ${flowState.label}; hose ${flowState.hoseScore}, viscosity ${flowState.viscosityScore}, release risk ${flowState.releaseRiskScore}.`,
      ],
    };
  } catch (error) {
    return {
      source: "local-fallback",
      signedPressure: 0,
      summary: null,
      flowState: null,
      notes: [
        `dealer-pressure-engine adapter failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      ],
    };
  }
}

function buildZeroDteSurface(args: BuildDealerPressureReadArgs) {
  const snapshotDate = args.snapshotDate ?? new Date().toISOString().slice(0, 10);
  const capturedAt = new Date().toISOString();

  return {
    surfaceKey: `zero-dte-${args.ticker}-${snapshotDate}`,
    ticker: args.ticker,
    snapshotDate,
    snapshotTimeZone: "America/New_York",
    capturedAt,
    price: {
      date: snapshotDate,
      close: args.spot,
      spot: args.spot,
    },
    chains: [
      {
        ticker: args.ticker,
        snapshotDate,
        expiration: args.expiration ?? snapshotDate,
        chainKind: "zero-dte",
        dteAtCapture: 0,
        summary: { dte: 0, source: "zero-dte-yahoo-harvest" },
        rows: args.rows.map((row) => ({
          strike: row.strike,
          optionType: row.optionType,
          side: row.optionType,
          openInterest: row.openInterest ?? 0,
          volume: row.volume ?? 0,
          gamma: row.gamma ?? null,
          delta: row.delta ?? null,
          theta: row.theta ?? null,
          impliedVolatility: row.iv ?? null,
          iv: row.iv ?? null,
          bid: row.bid ?? null,
          ask: row.ask ?? null,
          mid: row.mid ?? null,
          last: row.last ?? null,
        })),
      },
    ],
    dailyStructure: {
      ticker: args.ticker,
      snapshotDate,
      spot: args.spot,
      support: args.support ?? undefined,
      resistance: args.resistance ?? undefined,
      magnet: args.magnet ?? undefined,
      oiMagnet: args.magnet ?? undefined,
      primarySupport: args.support ?? undefined,
      primaryResistance: args.resistance ?? undefined,
      supportStrike: args.support ?? undefined,
      resistanceStrike: args.resistance ?? undefined,
      source: "zero-dte-command",
    },
  };
}

function dealerSummaryToSignedPressure(summary: DealerPressureSummary) {
  const sharePressure =
    summary.callPressureSharePct != null && summary.putPressureSharePct != null
      ? summary.putPressureSharePct - summary.callPressureSharePct
      : 0;

  const biasPressure =
    summary.hedgeFlowBias === "bullish"
      ? 38
      : summary.hedgeFlowBias === "bearish"
      ? -38
      : summary.hedgeFlowBias === "conflict"
      ? 0
      : 0;

  const regimeMultiplier =
    summary.regime === "Volatility expansion / amplification"
      ? 1.25
      : summary.regime === "Pin-to-snap"
      ? 1.1
      : summary.regime === "Volatility suppression / pinning"
      ? 0.65
      : 1;

  const confidenceMultiplier = Math.max(0.35, Math.min(1, summary.confidenceScore / 75));
  const signed = (sharePressure * 0.65 + biasPressure * 0.35) * regimeMultiplier * confidenceMultiplier;

  return clamp(Math.round(signed), -100, 100);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
