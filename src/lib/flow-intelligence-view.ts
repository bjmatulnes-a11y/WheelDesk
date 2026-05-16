"use client";

import type { OptionSurfaceSnapshot } from "./wheeldesk-storage";

export type FlowSide = "call" | "put" | "mixed";
export type FlowBias = "bullish" | "bearish" | "neutral" | "conflicted";

export type FlowLevel = {
  strike: number;
  side: FlowSide;
  openInterest: number;
  volume: number;
  volumeToOi: number;
  premiumProxy: number;
  pressureScore: number;
  pressureType: "directional" | "overwriter" | "resting_oi";
  label: string;
  interpretation: string;
};

export type FlowIntelligenceView = {
  rowCount: number;
  callVolume: number;
  putVolume: number;
  callOi: number;
  putOi: number;
  netVolumeBias: number;
  netPressureBias: number;
  bias: FlowBias;
  confidence: number;
  confirmsOi: boolean | null;
  topLevels: FlowLevel[];
  callLevels: FlowLevel[];
  putLevels: FlowLevel[];
  chartLevels: FlowLevel[];
  summary: string;
  warnings: string[];
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getSide(row: any): FlowSide | null {
  const raw = String(
    row?.side ??
      row?.type ??
      row?.optionType ??
      row?.option_type ??
      row?.raw?.side ??
      row?.raw?.type ??
      row?.raw?.optionType ??
      row?.raw?.option_type ??
      ""
  ).toLowerCase();

  if (raw.includes("call")) return "call";
  if (raw.includes("put")) return "put";
  return null;
}

function getStrike(row: any): number | null {
  return toNumber(row?.strike) ?? toNumber(row?.raw?.strike) ?? null;
}

function getOpenInterest(row: any): number {
  return (
    toNumber(row?.openInterest) ??
    toNumber(row?.open_interest) ??
    toNumber(row?.oi) ??
    toNumber(row?.raw?.openInterest) ??
    toNumber(row?.raw?.open_interest) ??
    toNumber(row?.raw?.oi) ??
    0
  );
}

function getVolume(row: any): number {
  return toNumber(row?.volume) ?? toNumber(row?.raw?.volume) ?? 0;
}

function getPrice(row: any): number {
  const bid = toNumber(row?.bid) ?? toNumber(row?.raw?.bid);
  const ask = toNumber(row?.ask) ?? toNumber(row?.raw?.ask);
  const last =
    toNumber(row?.last) ??
    toNumber(row?.lastPrice) ??
    toNumber(row?.last_price) ??
    toNumber(row?.raw?.last) ??
    toNumber(row?.raw?.lastPrice) ??
    toNumber(row?.raw?.last_price);

  if (bid != null && ask != null && bid > 0 && ask > 0) return (bid + ask) / 2;
  return last ?? 0;
}

function flattenRows(surface: OptionSurfaceSnapshot | null) {
  const rows: Array<{
    strike: number;
    side: "call" | "put";
    oi: number;
    volume: number;
    premiumProxy: number;
  }> = [];

  for (const chain of surface?.chains ?? []) {
    for (const row of (chain as any)?.rows ?? []) {
      const strike = getStrike(row);
      const side = getSide(row);
      if (strike == null || !side || side === "mixed") continue;

      const oi = getOpenInterest(row);
      const volume = getVolume(row);
      const price = getPrice(row);

      rows.push({
        strike,
        side,
        oi,
        volume,
        premiumProxy: price * volume * 100,
      });
    }
  }

  return rows;
}

function buildLevels(rows: ReturnType<typeof flattenRows>, side: "call" | "put"): FlowLevel[] {
  const byStrike = new Map<number, { oi: number; volume: number; premiumProxy: number }>();

  for (const row of rows) {
    if (row.side !== side) continue;

    const existing = byStrike.get(row.strike) ?? { oi: 0, volume: 0, premiumProxy: 0 };
    existing.oi += row.oi;
    existing.volume += row.volume;
    existing.premiumProxy += row.premiumProxy;
    byStrike.set(row.strike, existing);
  }

  const maxOi = Math.max(1, ...Array.from(byStrike.values()).map((value) => value.oi));
  const maxVolume = Math.max(1, ...Array.from(byStrike.values()).map((value) => value.volume));
  const maxPremium = Math.max(1, ...Array.from(byStrike.values()).map((value) => value.premiumProxy));

  return Array.from(byStrike.entries())
    .map(([strike, value]) => {
      const volumeToOi = value.volume / Math.max(1, value.oi);
      const oiScore = (value.oi / maxOi) * 45;
      const volumeScore = (value.volume / maxVolume) * 35;
      const premiumScore = (value.premiumProxy / maxPremium) * 20;
      const pressureScore = Math.max(0, Math.min(100, oiScore + volumeScore + premiumScore));

      const pressureType =
        volumeToOi >= 0.35 || value.volume >= maxVolume * 0.65
          ? "directional"
          : value.oi >= maxOi * 0.65 && volumeToOi < 0.15
            ? "overwriter"
            : "resting_oi";

      return {
        strike,
        side,
        openInterest: value.oi,
        volume: value.volume,
        volumeToOi,
        premiumProxy: value.premiumProxy,
        pressureScore,
        pressureType,
        label: `${side === "call" ? "Call" : "Put"} flow ${strike.toFixed(2)}`,
        interpretation:
          pressureType === "directional"
            ? "Fresh volume is active relative to existing OI; watch for confirmation or attack at this strike."
            : pressureType === "overwriter"
              ? "Large resting OI dominates without strong fresh volume confirmation."
              : "Mixed flow/OI level; useful as context but not a standalone trigger.",
      } satisfies FlowLevel;
    })
    .sort((a, b) => b.pressureScore - a.pressureScore || b.volume - a.volume || a.strike - b.strike);
}

export function buildFlowIntelligenceView(args: {
  surface: OptionSurfaceSnapshot | null;
  currentPrice: number;
}): FlowIntelligenceView {
  const rows = flattenRows(args.surface);
  const callRows = rows.filter((row) => row.side === "call");
  const putRows = rows.filter((row) => row.side === "put");

  const callVolume = callRows.reduce((sum, row) => sum + row.volume, 0);
  const putVolume = putRows.reduce((sum, row) => sum + row.volume, 0);
  const callOi = callRows.reduce((sum, row) => sum + row.oi, 0);
  const putOi = putRows.reduce((sum, row) => sum + row.oi, 0);

  const callLevels = buildLevels(rows, "call");
  const putLevels = buildLevels(rows, "put");
  const topLevels = [...callLevels.slice(0, 4), ...putLevels.slice(0, 4)].sort(
    (a, b) => b.pressureScore - a.pressureScore
  );

  const callPressure = callLevels.slice(0, 3).reduce((sum, level) => sum + level.pressureScore, 0);
  const putPressure = putLevels.slice(0, 3).reduce((sum, level) => sum + level.pressureScore, 0);
  const pressureTotal = Math.max(1, callPressure + putPressure);

  const netVolumeBias = (callVolume - putVolume) / Math.max(1, callVolume + putVolume);
  const netPressureBias = (callPressure - putPressure) / pressureTotal;

  let bias: FlowBias = "neutral";
  if (Math.abs(netPressureBias) < 0.12 && Math.abs(netVolumeBias) < 0.12) {
    bias = "neutral";
  } else if (netPressureBias > 0.15 || netVolumeBias > 0.25) {
    bias = "bullish";
  } else if (netPressureBias < -0.15 || netVolumeBias < -0.25) {
    bias = "bearish";
  } else {
    bias = "conflicted";
  }

  const confidence = Math.max(0, Math.min(100, Math.abs(netPressureBias) * 70 + Math.abs(netVolumeBias) * 30));

  const warnings: string[] = [];
  if (!rows.length) warnings.push("No selected-chain rows available for flow intelligence.");
  if (callVolume + putVolume === 0) warnings.push("No option volume available; flow view is based mostly on resting OI.");

  const chartLevels = topLevels
    .filter((level) => level.pressureScore >= 20)
    .slice(0, 6);

  const summary =
    bias === "bullish"
      ? "Call-side flow pressure is leading selected-chain activity."
      : bias === "bearish"
        ? "Put-side flow pressure is leading selected-chain activity."
        : bias === "conflicted"
          ? "Flow pressure is mixed; use OI and dealer pressure for confirmation."
          : "Flow pressure is neutral or not strongly directional.";

  return {
    rowCount: rows.length,
    callVolume,
    putVolume,
    callOi,
    putOi,
    netVolumeBias,
    netPressureBias,
    bias,
    confidence,
    confirmsOi: null,
    topLevels,
    callLevels,
    putLevels,
    chartLevels,
    summary,
    warnings,
  };
}
