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

type FlatFlowRow = {
  strike: number;
  side: "call" | "put";
  oi: number;
  volume: number;
  premiumProxy: number;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function getSide(row: any): "call" | "put" | null {
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

  if (raw.includes("call") || raw === "c") return "call";
  if (raw.includes("put") || raw === "p") return "put";
  return null;
}

function getStrike(row: any): number | null {
  return firstNumber(row?.strike, row?.strikePrice, row?.raw?.strike, row?.raw?.strikePrice);
}

function sideOpenInterest(row: any, side: "call" | "put"): number | null {
  if (side === "call") {
    return firstNumber(
      row?.callOi,
      row?.callOI,
      row?.call_oi,
      row?.callOpenInterest,
      row?.call_open_interest,
      row?.callsOpenInterest,
      row?.call?.openInterest,
      row?.call?.open_interest,
      row?.raw?.callOi,
      row?.raw?.callOI,
      row?.raw?.call_oi,
      row?.raw?.callOpenInterest,
      row?.raw?.call_open_interest,
      row?.raw?.callsOpenInterest,
      row?.raw?.call?.openInterest,
      row?.raw?.call?.open_interest
    );
  }

  return firstNumber(
    row?.putOi,
    row?.putOI,
    row?.put_oi,
    row?.putOpenInterest,
    row?.put_open_interest,
    row?.putsOpenInterest,
    row?.put?.openInterest,
    row?.put?.open_interest,
    row?.raw?.putOi,
    row?.raw?.putOI,
    row?.raw?.put_oi,
    row?.raw?.putOpenInterest,
    row?.raw?.put_open_interest,
    row?.raw?.putsOpenInterest,
    row?.raw?.put?.openInterest,
    row?.raw?.put?.open_interest
  );
}

function genericOpenInterest(row: any): number | null {
  return firstNumber(
    row?.openInterest,
    row?.open_interest,
    row?.oi,
    row?.raw?.openInterest,
    row?.raw?.open_interest,
    row?.raw?.oi
  );
}

function getOpenInterest(row: any, side: "call" | "put"): number {
  return sideOpenInterest(row, side) ?? genericOpenInterest(row) ?? 0;
}

function sideVolume(row: any, side: "call" | "put"): number | null {
  if (side === "call") {
    return firstNumber(
      row?.callVolume,
      row?.call_volume,
      row?.callsVolume,
      row?.call?.volume,
      row?.raw?.callVolume,
      row?.raw?.call_volume,
      row?.raw?.callsVolume,
      row?.raw?.call?.volume
    );
  }

  return firstNumber(
    row?.putVolume,
    row?.put_volume,
    row?.putsVolume,
    row?.put?.volume,
    row?.raw?.putVolume,
    row?.raw?.put_volume,
    row?.raw?.putsVolume,
    row?.raw?.put?.volume
  );
}

function genericVolume(row: any): number | null {
  return firstNumber(row?.volume, row?.raw?.volume);
}

function getVolume(row: any, side: "call" | "put"): number {
  return sideVolume(row, side) ?? genericVolume(row) ?? 0;
}

function sidePrice(row: any, side: "call" | "put"): number | null {
  const source = side === "call" ? row?.call : row?.put;
  const rawSource = side === "call" ? row?.raw?.call : row?.raw?.put;

  const bid = firstNumber(
    side === "call" ? row?.callBid : row?.putBid,
    side === "call" ? row?.call_bid : row?.put_bid,
    source?.bid,
    source?.bidPrice,
    rawSource?.bid,
    rawSource?.bidPrice
  );
  const ask = firstNumber(
    side === "call" ? row?.callAsk : row?.putAsk,
    side === "call" ? row?.call_ask : row?.put_ask,
    source?.ask,
    source?.askPrice,
    rawSource?.ask,
    rawSource?.askPrice
  );

  if (bid !== null && ask !== null && bid > 0 && ask > 0) return (bid + ask) / 2;

  return firstNumber(
    side === "call" ? row?.callLast : row?.putLast,
    side === "call" ? row?.call_last : row?.put_last,
    side === "call" ? row?.callMark : row?.putMark,
    side === "call" ? row?.call_mark : row?.put_mark,
    source?.last,
    source?.lastPrice,
    source?.mark,
    rawSource?.last,
    rawSource?.lastPrice,
    rawSource?.mark
  );
}

function genericPrice(row: any): number | null {
  const bid = firstNumber(row?.bid, row?.raw?.bid);
  const ask = firstNumber(row?.ask, row?.raw?.ask);
  const last = firstNumber(
    row?.last,
    row?.lastPrice,
    row?.last_price,
    row?.mark,
    row?.mid,
    row?.raw?.last,
    row?.raw?.lastPrice,
    row?.raw?.last_price,
    row?.raw?.mark,
    row?.raw?.mid
  );

  if (bid !== null && ask !== null && bid > 0 && ask > 0) return (bid + ask) / 2;
  return last;
}

function getPrice(row: any, side: "call" | "put"): number {
  return sidePrice(row, side) ?? genericPrice(row) ?? 0;
}

function hasSideData(row: any, side: "call" | "put"): boolean {
  return (
    sideOpenInterest(row, side) !== null ||
    sideVolume(row, side) !== null ||
    sidePrice(row, side) !== null ||
    Boolean(side === "call" ? row?.call ?? row?.raw?.call : row?.put ?? row?.raw?.put)
  );
}

function pushFlatRow(rows: FlatFlowRow[], row: any, side: "call" | "put", strike: number) {
  const oi = getOpenInterest(row, side);
  const volume = getVolume(row, side);
  const price = getPrice(row, side);

  if (oi <= 0 && volume <= 0) return;

  rows.push({
    strike,
    side,
    oi,
    volume,
    premiumProxy: price * volume * 100,
  });
}

function flattenRows(surface: OptionSurfaceSnapshot | null): FlatFlowRow[] {
  const rows: FlatFlowRow[] = [];

  for (const chain of surface?.chains ?? []) {
    const chainRows =
      Array.isArray((chain as any)?.rows)
        ? (chain as any).rows
        : Array.isArray((chain as any)?.optionRows)
          ? (chain as any).optionRows
          : Array.isArray((chain as any)?.chainRows)
            ? (chain as any).chainRows
            : [];

    for (const row of chainRows) {
      const strike = getStrike(row);
      if (strike === null) continue;

      const explicitSide = getSide(row);
      if (explicitSide) {
        pushFlatRow(rows, row, explicitSide, strike);
        continue;
      }

      // Supabase-reconstructed surfaces are usually one row per strike with
      // callOi/putOi and callVolume/putVolume. Rehydrate those rows into the
      // same side-level shape the flow engine expects.
      if (hasSideData(row, "call")) pushFlatRow(rows, row, "call", strike);
      if (hasSideData(row, "put")) pushFlatRow(rows, row, "put", strike);
    }

    for (const row of Array.isArray((chain as any)?.calls) ? (chain as any).calls : []) {
      const strike = getStrike(row);
      if (strike !== null) pushFlatRow(rows, row, "call", strike);
    }

    for (const row of Array.isArray((chain as any)?.puts) ? (chain as any).puts : []) {
      const strike = getStrike(row);
      if (strike !== null) pushFlatRow(rows, row, "put", strike);
    }
  }

  return rows;
}

function moneynessRelevance(strike: number, currentPrice: number): number {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(strike)) return 1;
  const pctAway = Math.abs(strike - currentPrice) / currentPrice;
  if (pctAway <= 0.12) return 1;
  if (pctAway <= 0.25) return 0.85;
  if (pctAway <= 0.5) return 0.55;
  return 0.25;
}

function buildLevels(rows: FlatFlowRow[], side: "call" | "put", currentPrice: number): FlowLevel[] {
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
      const oiScore = (value.oi / maxOi) * 40;
      const volumeScore = (value.volume / maxVolume) * 35;
      const premiumScore = (value.premiumProxy / maxPremium) * 15;
      const relevanceScore = moneynessRelevance(strike, currentPrice) * 10;
      const pressureScore = Math.max(0, Math.min(100, oiScore + volumeScore + premiumScore + relevanceScore));

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

  const callLevels = buildLevels(rows, "call", args.currentPrice);
  const putLevels = buildLevels(rows, "put", args.currentPrice);
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
  warnings.push("Flow Intelligence is current selected-chain activity/resting OI. Use What Changed ΔOI for confirmed positioning change.");

  const chartLevels = topLevels
    .filter((level) => level.pressureScore >= 20)
    .slice(0, 6);

  const summary =
    bias === "bullish"
      ? "Call-side flow pressure is leading selected-chain activity."
      : bias === "bearish"
        ? "Put-side flow pressure is leading selected-chain activity."
        : bias === "conflicted"
          ? "Flow pressure is mixed; use OI and ΔOI change reads for confirmation."
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
