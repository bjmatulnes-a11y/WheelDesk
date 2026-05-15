"use client";

import { useEffect, useMemo, useState } from "react";
import { ChainGraph } from "../../components/chain-graph";
import { ChartPanel } from "../../components/ChartPanel";
import { DecisionCard } from "../../components/decision-card";
import { OIProjectionCard } from "../../components/oi-projection-card";
import { OISummaryCard } from "../../components/oi-summary-card";
import { OIChainTable } from "../../components/oi-chain-table";
import { SnapshotComparisonCard } from "../../components/snapshot-comparison-card";
import { SnapshotSelector } from "../../components/snapshot-selector";
import { buildDailyStructureDrift } from "../../lib/daily-structure-compare";
import { buildOISurfaceComparison } from "../../lib/oi-surface-compare";
import { OISurfaceComparisonCard } from "../../components/OISurfaceComparisonCard";
import { TradingViewChartPanel } from "../../components/TradingViewChartPanel";
import { PrevailingStructureLadderCard } from "../../components/PrevailingStructureLadderCard";
import { StructureQualityCard } from "../../components/StructureQualityCard";
import DealerPressureCard from "../../components/DealerPressureCard";
import { buildDealerPressureSummary } from "../../lib/dealer-pressure-engine";
import { hydrateSurfaceSnapshotsFromSupabase } from "../../lib/surface-snapshot-hydration";
import { safeInt } from "../../lib/format";
import {
  deleteChainSnapshots,
  getSavedChainSnapshots,
  makeSnapshotKey,
  getOptionChain,
  getPriceSeries
} from "../../lib/data-provider";
import {
  clearExpiredDashboardCache,
  loadCachedCandles,
  loadCachedOptionChain,
  saveCachedCandles,
  saveCachedOptionChain
} from "../../lib/dashboard-cache";
import {
  buildDailyStructureSnapshot,
  listDailyStructureSnapshots,
  saveDailyStructureSnapshot
} from "../../lib/daily-structure-store";
import { buildSnapshotStructureSeries } from "../../lib/chart-overlay";
import { buildSnapshotComparison } from "../../lib/compare-snapshots";
import { analyzeOIIntelligence } from "../../lib/oi-intelligence-engine";
import { buildOIProjectionReport } from "../../lib/oi-projection-engine";
import { getSurfacePrevailingLevels } from "../../lib/oi-prevailing-levels";
import { rankPrevailingChains } from "../../lib/prevailing-chain";
import { calculateBollinger, runPositionEngine } from "../../lib/position-engine";
import { createLocalPersistenceAdapter } from "../../lib/storage";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { PortfolioPosition, PortfolioProfile } from "../../lib/portfolio-types";
import { buildOptionSurfaceSnapshot } from "../../lib/oi-surface-snapshot-builder";
import {
  readOptionSurfaceSnapshots,
  readOptionSurfaceSnapshot,
  readWheelDeskStorage,
  readCandles,
  saveCandles,
  readPreferences,
  saveOptionSurfaceSnapshot,
  deleteSnapshotsByTickerAndDate,
  type OptionSurfaceSnapshot
} from "../../lib/wheeldesk-storage";

import { buildTraderEdgeSummary } from "../../lib/trader-edge-engine";
import { buildWallMigrationSummary, findPriorSurfaceForTicker, type WallMigrationSummary } from "../../lib/oi-wall-migration-engine";
import { buildOIImpliedPath, type OIImpliedPathResult, type OIPathDisplayMode } from "../../lib/oi-implied-path-engine";
import {
  ChainSnapshot,
  ChainSnapshotEntry,
  DashboardPreferences,
  ExpirationSummary,
  OverlayFlags,
  SUPPORTED_TICKERS,
  SUPPORTED_TIMEFRAMES,
  SupportedTicker,
  Timeframe
} from "../../lib/types";

const today = new Date().toISOString().slice(0, 10);
const SELECTED_PROFILE_STORAGE_KEY = "wheelDesk.selectedPortfolioProfileId";
const WATCHLIST_STORAGE_KEY = "wheelDesk.dashboardWatchlist";

const defaultOverlays: OverlayFlags = {
  showSavedOiHistory: true,
  showOiCenter: true,
  showOiRange: true,
  showWalls: true,
  showOiZones: false
};
function fmtFixed(value: unknown, digits = 2, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}


function summarizeTickerPositions(ticker: string, positions: PortfolioPosition[]) {
  const matching = positions.filter((p) => p.symbol?.toUpperCase() === ticker.toUpperCase());
  const shares = matching
    .filter((p) => p.instrumentType === "stock")
    .reduce((sum, p) => sum + (p.side === "long" ? 1 : -1) * (p.qty ?? 0), 0);

  const shortCalls = matching.filter((p) => p.instrumentType === "call" && p.side === "short");
  const shortPuts = matching.filter((p) => p.instrumentType === "put" && p.side === "short");

  return { matching, shares, shortCalls, shortPuts };
}
function buildSurfaceSnapshotFromSavedEntries(args: {
  ticker: string;
  snapshotDate: string;
  entries: ChainSnapshotEntry[];
}): ChainSnapshot | null {
  const chains = args.entries
    .filter((entry) => entry.snapshotDate === args.snapshotDate)
    .map((entry) => ({
      expiration: entry.expiration,
      rows: entry.rows,
      summary: entry.summary
    }))
    .sort((a, b) => a.expiration.localeCompare(b.expiration));

  if (!chains.length) return null;

  return {
    ticker: args.ticker,
    snapshotDate: args.snapshotDate,
    chains
  } as ChainSnapshot;
}
function snapshotHasRows(snapshot: any): boolean {
  return Boolean(
    snapshot?.chains?.some((chain: any) => Array.isArray(chain?.rows) && chain.rows.length > 0)
  );
}
function PortfolioContextCard({
  ticker,
  profiles,
  selectedProfileId,
  onSelectProfile
}: {
  ticker: string;
  profiles: PortfolioProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
}) {
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const positions = selectedProfile?.positions ?? [];
  const summary = summarizeTickerPositions(ticker, positions);

  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>Portfolio Context</h3>

      <label style={{ display: "grid", gap: 4, maxWidth: 360 }}>
        Selected Portfolio
        <select value={selectedProfileId} onChange={(e) => onSelectProfile(e.target.value)}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      {!selectedProfile ? (
        <p style={{ color: "#6b7280" }}>
          No portfolio profile selected. Market structure can still be used without portfolio context.
        </p>
      ) : summary.matching.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 4 }}>
            <strong>No {ticker} position in selected portfolio.</strong>
          </p>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            You can still analyze {ticker} market structure. Add a {ticker} position on the Portfolio page to enable
            position-aware decisions.
          </p>
          <a href="/portfolio">Open Portfolio</a>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 13 }}>
          <div>
            <strong>{ticker} exposure:</strong>
          </div>
          <div>Shares: {safeInt(summary?.shares)}</div>
          <div>
            Short Calls:{" "}
            {summary.shortCalls.length
              ? summary.shortCalls.map((p) => `${p.qty ?? 0} @ ${p.strike ?? "?"} exp ${p.expiration ?? "?"}`).join(", ")
              : "none"}
          </div>
          <div>
            Short Puts:{" "}
            {summary.shortPuts.length
              ? summary.shortPuts.map((p) => `${p.qty ?? 0} @ ${p.strike ?? "?"} exp ${p.expiration ?? "?"}`).join(", ")
              : "none"}
          </div>
          <div style={{ marginTop: 4 }}>
            <a href="/portfolio">Manage Portfolio</a>
          </div>
        </div>
      )}
    </section>
  );
}

function OIIntelligenceCard({
  report
}: {
  report: ReturnType<typeof analyzeOIIntelligence> | null;
}) {
  if (!report) return null;

  return (
    <section style={{ border: "1px solid #7c3aed", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>OI Intelligence</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Active Call Wall:</strong> {fmtFixed(report.adjustedCallWall, 2)}
        </div>
        <div>
          <strong>Active Put Wall:</strong> {fmtFixed(report.adjustedPutWall, 2)}
        </div>
        <div>
          <strong>Active Center:</strong> {fmtFixed(report.adjustedCenter, 2)}
        </div>
      </div>

      <p style={{ marginBottom: 4 }}>{report.activeStructureSummary}</p>
      <p style={{ marginTop: 0 }}>{report.anomalySummary}</p>

      <h4>Readout</h4>
      <ul>
        {report.intelligenceReadout.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {report.anomalies.length > 0 && (
        <>
          <h4>Anomalies</h4>
          <div style={{ display: "grid", gap: 8 }}>
            {report.anomalies.map((a) => (
              <div
                key={`${a.type}-${a.side}-${a.strike}`}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "0.65rem",
                  background: a.severity === "high" ? "#fef2f2" : "#fffbeb"
                }}
              >
                <div>
                  <strong>{a.severity.toUpperCase()}:</strong> {a.description}
                </div>
                <div>OI: {safeInt(a?.openInterest)} contracts</div>
                <div>Share equivalent: {safeInt(a?.shareEquivalent)} shares</div>
                <div>{a.interpretation}</div>
                <div>
                  <strong>Action:</strong> {a.action}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
function FlowIntelligenceCard({
  levels
}: {
  levels: ReturnType<typeof getSurfacePrevailingLevels> | null;
}) {
  if (!levels) return null;

  const formatChange = (value?: number) => {
    const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
    const sign = n > 0 ? "+" : "";
    return `${sign}${safeInt(n)}`;
  };

  const formatPressure = (value?: number) => {
    const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return `$${fmtFixed(n, 0)} / 100`;
  };

  const allLevels = [
    ...levels.resistances.map((level) => ({ ...level, side: "Call Resistance" })),
    ...levels.supports.map((level) => ({ ...level, side: "Put Support" }))
  ].sort((a, b) => b.pressureScore - a.pressureScore);

  return (
    <section style={{ border: "1px solid #7c3aed", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>OI Flow Intelligence</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Primary Support:</strong>{" "}
          {levels.support
            ? `${fmtFixed(levels.support?.strike, 2)} · ${levels.support.pressureType} · ΔOI ${formatChange(levels.support.oiChange)}`
            : "N/A"}
        </div>

        <div>
          <strong>Primary Resistance:</strong>{" "}
          {levels.resistance
            ? `${fmtFixed(levels.resistance?.strike, 2)} · ${levels.resistance.pressureType} · ΔOI ${formatChange(levels.resistance.oiChange)}`
            : "N/A"}
        </div>

        <div>
          <strong>Magnet:</strong> {fmtFixed(levels.magnet?.strike, 2)}
        </div>
      </div>

      <h4>Top Flow Levels</h4>

      {allLevels.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No active flow levels detected.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: 6 }}>Side</th>
              <th style={{ padding: 6 }}>Strike</th>
              <th style={{ padding: 6 }}>Type</th>
              <th style={{ padding: 6 }}>OI</th>
              <th style={{ padding: 6 }}>ΔOI</th>
              <th style={{ padding: 6 }}>Volume</th>
              <th style={{ padding: 6 }}>Vol/OI</th>
              <th style={{ padding: 6 }}>Pressure</th>
            </tr>
          </thead>
          <tbody>
            {allLevels.slice(0, 6).map((level) => (
              <tr key={`${level.side}-${level.strike}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: 6 }}>{level.side}</td>
                <td style={{ padding: 6 }}>{fmtFixed(level.strike, 2)}</td>
                <td style={{ padding: 6 }}>{level.pressureType.toUpperCase()}</td>
                <td style={{ padding: 6 }}>{safeInt(level?.openInterest)}</td>
                <td style={{ padding: 6 }}>{formatChange(level.oiChange)}</td>
                <td style={{ padding: 6 }}>{safeInt(level?.volume)}</td>
                <td style={{ padding: 6 }}>{fmtFixed(level.volumeToOi, 2)}</td>
                <td style={{ padding: 6 }}>{formatPressure(level.pressureScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginBottom: 0, color: "#4b5563", fontSize: 13 }}>
        Directional = fresh volume plus positive OI build. Overwriter = large existing OI without enough fresh volume confirmation.
      </p>
    </section>
  );
}






function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
 return `${fmtFixed(value, 1)}%`;
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
 return fmtFixed(value, 2);
}

function formatVolumeThrust(edge: { volumeThrust?: number | null; volumeThrustSource?: string }): string {
  if (edge.volumeThrust == null || !Number.isFinite(edge.volumeThrust)) return "N/A";

  const suffix = edge.volumeThrustSource === "option_flow"
    ? "x option-flow proxy"
    : edge.volumeThrustSource === "stock_volume"
      ? "x stock volume"
      : "x";

 return `${fmtFixed(edge.volumeThrust, 2)}${suffix}`;
}

function getSnapshotSpot(surface: OptionSurfaceSnapshot | null, fallback: number): number {
  const daily = surface?.dailyStructure as any;
  const price = surface?.price as any;

  const candidates = [
    price?.close,
    price?.spot,
    daily?.spot,
    daily?.currentPrice,
    daily?.underlyingPrice,
    daily?.prevailingLevels?.spot
  ];

  const found = candidates.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  return found ?? fallback;
}

function getSimpleChartBias(candles: Awaited<ReturnType<typeof getPriceSeries>>): "bullish" | "bearish" | "neutral" {
  if (candles.length < 50) return "neutral";

  const closes = candles.map((c) => c.close).filter((value) => Number.isFinite(value));
  if (closes.length < 50) return "neutral";

  const last = closes.at(-1) ?? 0;
  const sma20 = closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20;
  const sma50 = closes.slice(-50).reduce((sum, value) => sum + value, 0) / 50;

  if (last > sma20 && sma20 >= sma50) return "bullish";
  if (last < sma20 && sma20 <= sma50) return "bearish";
  return "neutral";
}

function getOptionsBias(args: {
  spot: number;
  support?: number;
  resistance?: number;
  magnet?: number;
}): "bullish" | "bearish" | "neutral" {
  if (!args.spot) return "neutral";

  const magnetDeltaPct = args.magnet ? ((args.magnet - args.spot) / args.spot) * 100 : 0;
  const supportCushionPct = args.support ? ((args.spot - args.support) / args.spot) * 100 : null;
  const resistanceCushionPct = args.resistance ? ((args.resistance - args.spot) / args.spot) * 100 : null;

  if (magnetDeltaPct >= 2) return "bullish";
  if (magnetDeltaPct <= -2) return "bearish";

  if (supportCushionPct != null && resistanceCushionPct != null) {
    if (supportCushionPct > resistanceCushionPct * 1.5) return "bearish";
    if (resistanceCushionPct > supportCushionPct * 1.5) return "bullish";
  }

  return "neutral";
}

function getAvailableSurfaceStrikes(surface: OptionSurfaceSnapshot | null): number[] {
  if (!surface?.chains?.length) return [];

  const strikes = new Set<number>();

  for (const chain of surface.chains) {
    for (const row of chain.rows ?? []) {
      const strike = Number((row as any).strike);
      if (Number.isFinite(strike) && strike > 0) strikes.add(strike);
    }
  }

  return Array.from(strikes).sort((a, b) => a - b);
}

function snapCallStrikeFloor(target: number | null, strikes: number[]): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  return strikes.find((strike) => strike >= target) ?? null;
}

function snapPutStrikeCeiling(target: number | null, strikes: number[]): number | null {
  if (target == null || !Number.isFinite(target)) return null;

  for (let index = strikes.length - 1; index >= 0; index -= 1) {
    if (strikes[index] <= target) return strikes[index];
  }

  return null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function getRealizedVolatilityPct(candles: Awaited<ReturnType<typeof getPriceSeries>>, lookback = 20): number | null {
  const closes = candles.map((c) => c.close).filter((value) => Number.isFinite(value) && value > 0);
  if (closes.length < lookback + 1) return null;

  const returns: number[] = [];
  const slice = closes.slice(-(lookback + 1));

  for (let index = 1; index < slice.length; index += 1) {
    returns.push(Math.log(slice[index] / slice[index - 1]));
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function getAtrPct(candles: Awaited<ReturnType<typeof getPriceSeries>>, lookback = 14): number | null {
  if (candles.length < lookback + 1) return null;

  const recent = candles.slice(-(lookback + 1));
  const trueRanges: number[] = [];

  for (let index = 1; index < recent.length; index += 1) {
    const candle = recent[index];
    const priorClose = recent[index - 1].close;
    const tr = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - priorClose),
      Math.abs(candle.low - priorClose)
    );
    trueRanges.push(tr);
  }

  const atr = trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
  const last = candles.at(-1)?.close ?? 0;
  return last > 0 ? (atr / last) * 100 : null;
}

function getVolumeRatio(candles: Awaited<ReturnType<typeof getPriceSeries>>, lookback = 20): number | null {
  const volumes = candles.map((c) => Number((c as any).volume ?? 0)).filter((value) => Number.isFinite(value) && value > 0);
  if (volumes.length < lookback + 1) return null;

  const latest = volumes.at(-1) ?? 0;
  const prior = volumes.slice(-(lookback + 1), -1);
  const average = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  return average > 0 ? latest / average : null;
}

function getPriceActionConfluence(args: {
  candles: Awaited<ReturnType<typeof getPriceSeries>>;
  support?: number;
  resistance?: number;
  spot: number;
}) {
  const recent = args.candles.slice(-30);
  if (!recent.length || !args.spot) {
    return {
      score: 50,
      label: "Limited price-action data",
      notes: ["Not enough candles to confirm whether price agrees with the OI levels."]
    };
  }

  const recentHigh = Math.max(...recent.map((c) => c.high).filter((value) => Number.isFinite(value)));
  const recentLow = Math.min(...recent.map((c) => c.low).filter((value) => Number.isFinite(value)));
  const lastClose = recent.at(-1)?.close ?? args.spot;

  const supportDistancePct = args.support ? Math.abs(args.support - recentLow) / args.spot * 100 : null;
  const resistanceDistancePct = args.resistance ? Math.abs(args.resistance - recentHigh) / args.spot * 100 : null;

  let score = 50;
  const notes: string[] = [];

  if (supportDistancePct != null && supportDistancePct <= 2) {
    score += 18;
    notes.push("OI support aligns with the recent price low/demand area.");
  } else if (args.support) {
    notes.push("OI support does not closely align with the recent swing low.");
  }

  if (resistanceDistancePct != null && resistanceDistancePct <= 2) {
    score += 18;
    notes.push("OI resistance aligns with the recent price high/supply area.");
  } else if (args.resistance) {
    notes.push("OI resistance does not closely align with the recent swing high.");
  }

  if (args.resistance && lastClose > args.resistance) {
    score += 14;
    notes.push("Price is above the OI resistance reference; call-wall breakout/repricing risk is active.");
  }

  if (args.support && lastClose < args.support) {
    score -= 14;
    notes.push("Price is below the OI support reference; put support has failed or is being tested.");
  }

  const label = score >= 75 ? "Strong confluence" : score >= 55 ? "Partial confluence" : "Weak confluence";

  return {
    score: clampScore(score),
    label,
    notes
  };
}

function getPremiumProxyScore(args: {
  realizedVolPct: number | null;
  atrPct: number | null;
  compressionState: string;
}) {
  let score = 50;
  const notes: string[] = [];

  if (args.realizedVolPct != null) {
    if (args.realizedVolPct >= 70) {
      score += 20;
      notes.push("Realized volatility is elevated; premium may be richer, but strike cushion matters more.");
    } else if (args.realizedVolPct >= 45) {
      score += 10;
      notes.push("Realized volatility is moderate/high; premium selling can be attractive if structure confirms.");
    } else if (args.realizedVolPct < 25) {
      score -= 10;
      notes.push("Realized volatility is low; premium may not pay enough for tight strike risk.");
    }
  }

  if (args.atrPct != null) {
    if (args.atrPct >= 4) {
      score += 10;
      notes.push("ATR is wide; avoid strikes inside normal daily movement.");
    } else if (args.atrPct < 1.5) {
      score -= 5;
      notes.push("ATR is tight; the surface may be coiled and vulnerable to expansion.");
    }
  }

  if (args.compressionState !== "Open / not compressed") {
    score -= 8;
    notes.push("Compression lowers premium-sale quality unless strikes are pushed outside the active zone.");
  }

  return {
    score: clampScore(score),
    label: score >= 70 ? "Premium favorable" : score >= 50 ? "Premium acceptable" : "Premium caution",
    notes
  };
}

function getLevelEvidenceScore(level: any | null | undefined) {
  if (!level) return { score: 0, label: "No level", notes: ["No prevailing level detected."] };

  const oi = Number(level.openInterest ?? 0);
  const volume = Number(level.volume ?? 0);
  const oiChange = typeof level.oiChange === "number" ? level.oiChange : null;
  const pressureScore = Number(level.pressureScore ?? 0);
  const volumeToOi = Number(level.volumeToOi ?? 0);

  let score = 25;
  const notes: string[] = [];

  if (oi >= 100000) {
    score += 25;
    notes.push("Large OI wall detected.");
  } else if (oi >= 25000) {
    score += 18;
    notes.push("Meaningful OI wall detected.");
  } else if (oi > 0) {
    score += 8;
    notes.push("OI wall exists, but size is modest.");
  }

  if (oiChange != null && oiChange > 0) {
    score += Math.min(20, 6 + Math.log10(oiChange + 1) * 4);
    notes.push("Positive confirmed OI change supports freshness.");
  } else if (oiChange != null && oiChange < 0) {
    score -= 10;
    notes.push("OI is declining at this level; wall may be weakening.");
  } else {
    notes.push("No confirmed OI-change signal for this level.");
  }

  if (volumeToOi >= 0.25 || volume >= 10000) {
    score += 15;
    notes.push("Current volume confirms active attention at/near this level.");
  } else if (volume > 0) {
    score += 5;
    notes.push("Some current volume exists, but flow confirmation is limited.");
  }

  if (pressureScore >= 70) {
    score += 10;
    notes.push("Pressure score is high.");
  } else if (pressureScore <= 35 && pressureScore > 0) {
    score -= 5;
    notes.push("Pressure score is weak.");
  }

  return {
    score: clampScore(score),
    label: score >= 75 ? "Strong evidence" : score >= 55 ? "Moderate evidence" : "Weak evidence",
    notes
  };
}



type TraderBias = "bullish" | "bearish" | "neutral";

function getSecretSaucePlaybook(args: {
  ticker: string;
  spot: number;
  support?: number;
  resistance?: number;
  magnet?: number;
  chartBias: TraderBias;
  optionsBias: TraderBias;
  compressionState: string;
  edgeScore: number;
  gammaPinRiskScore: number;
  premiumProxyScore: number;
  atrPct: number | null;
  supportCushionPct: number | null;
  resistanceCushionPct: number | null;
  executableCoveredCallFloor: number | null;
  executableCspCeiling: number | null;
}) {
  const isConflict =
    args.chartBias !== "neutral" && args.optionsBias !== "neutral" && args.chartBias !== args.optionsBias;

  const bufferPct = Math.max(0.25, Math.min(1.25, (args.atrPct ?? 2.5) * 0.25));
  const triggerBuffer = args.spot * (bufferPct / 100);

  const bullishUnlock = args.resistance ? args.resistance + triggerBuffer : null;
  const bearishFailure = args.support ? args.support - triggerBuffer : null;

  let setup = "Patience setup";
  let action = "Wait for confirmation or move strikes farther away from spot.";
  let intensity = "Low conviction";
  let actionColor = "#6b7280";

  if (isConflict) {
    setup = "Conflict trap";
    action = "Do not trust a one-sided read. Let price either clear resistance or lose support before leaning directional.";
    intensity = "Defense first";
    actionColor = "#f59e0b";
  } else if (args.compressionState !== "Open / not compressed" && args.gammaPinRiskScore >= 65) {
    setup = "Compression coil";
    action = "Treat this as pin/chop until a wall breaks. Sell only chain-snapped strikes outside the active OI range.";
    intensity = "High caution";
    actionColor = "#dc2626";
  } else if (args.chartBias === "bullish" && args.optionsBias === "bullish" && args.edgeScore >= 55) {
    setup = "Bullish acceptance";
    action = "Favor CSPs below the snapped put ceiling; avoid capping upside with tight covered calls.";
    intensity = "Upside favored";
    actionColor = "#16a34a";
  } else if (args.chartBias === "bearish" && args.optionsBias === "bearish" && args.edgeScore >= 55) {
    setup = "Bearish acceptance";
    action = "Covered calls are cleaner than CSPs; sell puts only far below support or only if assignment is desired.";
    intensity = "Downside favored";
    actionColor = "#dc2626";
  } else if (args.edgeScore >= 75) {
    setup = "Stacked premium edge";
    action = "Premium selling is allowed, but only at chain-snapped levels that respect the trigger map.";
    intensity = "Tradable";
    actionColor = "#16a34a";
  } else if (args.edgeScore >= 55) {
    setup = "Conditional premium edge";
    action = "There is usable structure, but wait for trigger confirmation or demand better premium.";
    intensity = "Conditional";
    actionColor = "#2563eb";
  }

  const traps: string[] = [];

  if ((args.magnet && args.magnet > args.spot && (args.resistanceCushionPct ?? 999) <= 4) || args.optionsBias === "bullish") {
    traps.push("Covered-call trap: upside magnet/near resistance can make tight calls feel safe right before a repricing move.");
  }

  if ((args.chartBias === "bearish" && (args.supportCushionPct ?? 999) <= 4) || (args.support && args.spot < args.support)) {
    traps.push("CSP trap: support is close or already being tested; premium can look attractive while assignment risk is rising.");
  }

  if (args.compressionState !== "Open / not compressed") {
    traps.push("Compression trap: tight OI walls are structure references, not automatic sell strikes.");
  }

  if (args.premiumProxyScore < 55) {
    traps.push("Premium trap: the setup may not pay enough unless the selected strike is pushed farther away.");
  }

  if (!traps.length) {
    traps.push("No major trap dominates, but the trade still needs premium quality and chain liquidity confirmation.");
  }

  const triggers = [
    {
      label: "Bullish unlock",
      value: bullishUnlock,
      meaning: "Acceptance above this level means the call wall may be repricing higher. Avoid tight covered calls below/near this zone."
    },
    {
      label: "Bearish failure",
      value: bearishFailure,
      meaning: "A break below this level means put support is failing. CSPs should move lower or wait."
    },
    {
      label: "Pin/chop zone",
      value: args.support && args.resistance ? `${formatMoney(args.support)} - ${formatMoney(args.resistance)}` : null,
      meaning: "Inside this range, the edge is patience, smaller size, or selling only outside the snapped zones."
    },
    {
      label: "Upside magnet",
      value: args.magnet ?? null,
      meaning: "Price may mean-revert toward this OI center if structure remains intact."
    }
  ];

  return {
    setup,
    action,
    intensity,
    actionColor,
    traps,
    triggers
  };
}

function getGammaPinRiskScore(args: {
  support?: number;
  resistance?: number;
  magnet?: number;
  spot: number;
  rangeWidthPct: number | null;
  minCushionPct: number;
}) {
  let score = 35;
  const notes: string[] = [];

  if (args.rangeWidthPct != null && args.rangeWidthPct <= 4) {
    score += 30;
    notes.push("OI support/resistance are very tight around spot; pin/snap risk is elevated.");
  } else if (args.rangeWidthPct != null && args.rangeWidthPct <= 8) {
    score += 18;
    notes.push("OI support/resistance are moderately tight; compression risk is present.");
  }

  if (args.minCushionPct <= 1.5) {
    score += 25;
    notes.push("One major wall is inside 1.5% of spot.");
  } else if (args.minCushionPct <= 3) {
    score += 15;
    notes.push("One major wall is inside 3% of spot.");
  }

  if (args.magnet && Math.abs(args.magnet - args.spot) / args.spot * 100 <= 1.5) {
    score += 15;
    notes.push("OI magnet is near spot; pinning/chop risk is meaningful.");
  }

  return {
    score: clampScore(score),
    label: score >= 75 ? "High pin/snap risk" : score >= 55 ? "Moderate pin risk" : "Low pin risk",
    notes
  };
}

function scoreTone(score: number): { background: string; color: string } {
  if (score >= 70) return { background: "#dcfce7", color: "#166534" };
  if (score >= 55) return { background: "#fef3c7", color: "#92400e" };
  return { background: "#fee2e2", color: "#991b1b" };
}


function OIImpliedPathScenarioCard({
  path,
  mode,
  onModeChange
}: {
  path: OIImpliedPathResult | null;
  mode: OIPathDisplayMode;
  onModeChange: (mode: OIPathDisplayMode) => void;
}) {
  if (!path) return null;

  const regimeLabel = path.regime.replace(/_/g, " ");
  const confidenceColor =
    path.confidence === "high" ? "#166534" : path.confidence === "medium" ? "#92400e" : "#991b1b";

  const activeScenarioLabel =
    path.activeScenario === "bullish_unlock"
      ? "Bullish unlock active"
      : path.activeScenario === "bearish_failure"
        ? "Bearish failure active"
        : "Base case active";

  const activeScenarioTone =
    path.activeScenario === "bullish_unlock"
      ? { border: "#86efac", background: "#f0fdf4", color: "#166534" }
      : path.activeScenario === "bearish_failure"
        ? { border: "#fca5a5", background: "#fef2f2", color: "#991b1b" }
        : { border: "#ddd6fe", background: "#fff", color: "#5b21b6" };

  const modeDescription =
    mode === "minimal"
      ? "Minimal: base path + trigger rails only."
      : mode === "standard"
        ? "Standard: base path + uncertainty envelope + trigger rails."
        : "Full: base path + envelope + conditional bullish/bearish paths that start at their activation rails.";

  return (
    <section
      style={{
        marginTop: "0.75rem",
        border: "1px solid #c4b5fd",
        borderRadius: 8,
        background: "#faf5ff",
        padding: "0.9rem"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
        <div>
          <h3 style={{ margin: 0 }}>OI Pressure Map / Scenario Path</h3>
          <p style={{ margin: "0.35rem 0 0", color: "#4b5563" }}>
            This is a conditional options-pressure map, not a candle-by-candle forecast. The base path is active while current OI structure holds; the green/red paths are inactive scenarios that begin at their unlock/failure rails.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#6d28d9" }}>{regimeLabel}</div>
          <div style={{ color: confidenceColor, fontWeight: 700 }}>{path.confidence.toUpperCase()} confidence</div>
          <div style={{ color: "#6b7280", fontSize: 12 }}>{path.horizonSessions} session horizon</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", marginTop: "0.75rem" }}>
        <div style={{ fontSize: 12, color: "#4b5563" }}>
          <strong>Display mode:</strong> {modeDescription}
        </div>
        <select value={mode} onChange={(event) => onModeChange(event.target.value as OIPathDisplayMode)}>
          <option value="minimal">Minimal</option>
          <option value="standard">Standard</option>
          <option value="full">Full scenario map</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.75rem", marginTop: "0.75rem", fontSize: 12 }}>
        <div style={{ border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.6rem", background: "#fff" }}>
          <strong>Path Bias</strong><br />{path.pathBias.toUpperCase()}
        </div>
        <div style={{ border: `1px solid ${activeScenarioTone.border}`, borderRadius: 6, padding: "0.6rem", background: activeScenarioTone.background, color: activeScenarioTone.color }}>
          <strong>Active Scenario</strong><br />{activeScenarioLabel}
        </div>
        <div style={{ border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.6rem", background: "#fff" }}>
          <strong>Anchor Expiration</strong><br />{path.anchorExpiration ?? "N/A"}
        </div>
        <div style={{ border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.6rem", background: "#fff" }}>
          <strong>Dominant Chain</strong><br />{path.dominantExpiration ?? "N/A"}
        </div>
        <div style={{ border: "1px solid #bbf7d0", borderRadius: 6, padding: "0.6rem", background: "#fff" }}>
          <strong>Bullish Unlock</strong><br />{formatMoney(path.invalidAbove)}
        </div>
        <div style={{ border: "1px solid #fecaca", borderRadius: 6, padding: "0.6rem", background: "#fff" }}>
          <strong>Bearish Failure</strong><br />{formatMoney(path.invalidBelow)}
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
        <strong>Trade Permission Tags</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem", marginTop: "0.5rem", fontSize: 12 }}>
          <div style={{ border: "1px solid #fed7aa", borderRadius: 6, padding: "0.6rem", background: "#fff7ed" }}>
            <strong>Covered Calls</strong><br />{path.tradePermissions.coveredCalls}
          </div>
          <div style={{ border: "1px solid #bfdbfe", borderRadius: 6, padding: "0.6rem", background: "#eff6ff" }}>
            <strong>Cash-Secured Puts</strong><br />{path.tradePermissions.cashSecuredPuts}
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.6rem", background: "#f9fafb" }}>
            <strong>New Premium</strong><br />{path.tradePermissions.newPremium}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem" }}>
        <div style={{ border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
          <strong>Base Case</strong>
          <p style={{ margin: "0.35rem 0 0" }}>{path.baseCase}</p>
        </div>
        <div style={{ border: "1px solid #bbf7d0", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
          <strong>Bullish Unlock</strong>
          <p style={{ margin: "0.35rem 0 0" }}>{path.bullishUnlockCase}</p>
        </div>
        <div style={{ border: "1px solid #fecaca", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
          <strong>Bearish Failure</strong>
          <p style={{ margin: "0.35rem 0 0" }}>{path.bearishFailureCase}</p>
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
        <strong>OI Path → Wheel Action Matrix</strong>
        <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "0.45rem" }}>Scenario</th>
                <th style={{ padding: "0.45rem" }}>Condition</th>
                <th style={{ padding: "0.45rem" }}>Covered-Call Action</th>
                <th style={{ padding: "0.45rem" }}>CSP Action</th>
                <th style={{ padding: "0.45rem" }}>Existing Position Action</th>
              </tr>
            </thead>
            <tbody>
              {path.actionMatrix.map((row) => (
                <tr key={row.scenario} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "0.45rem", fontWeight: 700 }}>{row.scenario}</td>
                  <td style={{ padding: "0.45rem" }}>{row.condition}</td>
                  <td style={{ padding: "0.45rem" }}>{row.coveredCallAction}</td>
                  <td style={{ padding: "0.45rem" }}>{row.cspAction}</td>
                  <td style={{ padding: "0.45rem" }}>{row.existingPositionAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", border: "1px solid #ddd6fe", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
        <strong>{path.displaySummary}</strong>
        <div style={{ marginTop: "0.5rem", display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0.75rem", fontSize: 12 }}>
          <div>
            <strong>Path Notes</strong>
            <ul style={{ marginTop: 4 }}>
              {path.notes.map((note, index) => <li key={`path-note-${index}`}>{note}</li>)}
            </ul>
          </div>
          <div>
            <strong>Triggers</strong>
            <ul style={{ marginTop: 4 }}>
              {path.triggerNotes.map((note, index) => <li key={`path-trigger-${index}`}>{note}</li>)}
            </ul>
          </div>
          <div>
            <strong>Trade Plan Rules</strong>
            <ul style={{ marginTop: 4 }}>
              {path.tradePlanNotes.map((note, index) => <li key={`path-trade-${index}`}>{note}</li>)}
            </ul>
          </div>
          <div>
            <strong>Confidence / Migration</strong>
            <ul style={{ marginTop: 4 }}>
              {[...path.confidenceDegraders, ...path.migrationNotes].map((note, index) => <li key={`path-conf-${index}`}>{note}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function TraderEdgeSummaryCard({
  ticker,
  levels,
  candles,
  analysisPrice,
  livePrice,
  selectedSurface,
  edgeSummary,
  wallMigration
}: {
  ticker: string;
  levels: ReturnType<typeof getSurfacePrevailingLevels> | null;
  candles: Awaited<ReturnType<typeof getPriceSeries>>;
  analysisPrice: number;
  livePrice: number;
  selectedSurface: OptionSurfaceSnapshot | null;
  edgeSummary: ReturnType<typeof buildTraderEdgeSummary> | null;
  wallMigration: WallMigrationSummary | null;
}) {
  if (!selectedSurface || !edgeSummary) return null;

  const edge = edgeSummary;

  const borderColor =
    edge.regime === "Conflict regime"
      ? "#f59e0b"
      : edge.compressionState === "High compression"
        ? "#dc2626"
        : edge.compressionState === "Moderate compression"
          ? "#f59e0b"
          : "#16a34a";

  const backgroundColor =
    edge.regime === "Conflict regime"
      ? "#fffbeb"
      : edge.compressionState === "High compression"
        ? "#fef2f2"
        : edge.compressionState === "Moderate compression"
          ? "#fffbeb"
          : "#f0fdf4";

  const edgeTone = scoreTone(edge.edgeScore);
  const trapTone = scoreTone(100 - edge.trapRisk);

  return (
    <section
      style={{
        marginTop: "0.75rem",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: "#fff",
        padding: "0.9rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Trader Edge Summary — {ticker.toUpperCase()}</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.75rem", fontSize: 12 }}>
        <div><strong>Source</strong><br />{edge.source}</div>
        <div><strong>Analysis Price</strong><br />{formatMoney(edge.analysisPrice)}</div>
        <div><strong>Live/Chart Price</strong><br />{formatMoney(edge.livePrice)}</div>
        <div><strong>Range Width</strong><br />{formatPct(edge.rangeWidthPct)}</div>
        <div><strong>Support Cushion</strong><br />{formatPct(edge.supportCushionPct)}</div>
        <div><strong>Resistance Cushion</strong><br />{formatPct(edge.resistanceCushionPct)}</div>
      </div>

      <div style={{ marginTop: 10, border: `1px solid ${borderColor}`, borderRadius: 6, padding: "0.75rem", background: backgroundColor }}>
        <strong>{edge.regime}</strong>
        <div style={{ marginTop: 4 }}>
          {edge.compressionState}. Chart bias: <strong>{edge.chartBias.toUpperCase()}</strong>. Options bias: <strong>{edge.optionsBias.toUpperCase()}</strong>.
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          border: "1px solid #111827",
          borderRadius: 6,
          padding: "0.75rem",
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: "1rem",
          alignItems: "center"
        }}
      >
        <div>
          <strong>Dominant Edge Score</strong>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{fmtFixed(edge.edgeScore, 0)} / 100</div>
        </div>
        <div>
          <strong>{edge.actionBucket}</strong>
          <div style={{ color: "#374151", marginTop: 4 }}>{edge.bestAction}</div>
        </div>
      </div>

      <div style={{ marginTop: 10, border: "1px solid #d1d5db", borderRadius: 6, padding: "0.75rem", background: wallMigration?.migrationBias === "bullish" ? "#f0fdf4" : wallMigration?.migrationBias === "bearish" ? "#fef2f2" : wallMigration?.migrationBias === "compression" ? "#fffbeb" : "#f9fafb" }}>
        <strong>Wall Migration</strong>
        <div style={{ marginTop: 4 }}>
          <strong>{wallMigration?.label ?? "No prior wall comparison"}</strong> — {wallMigration?.interpretation ?? "Save another daily surface to compare call-wall, put-wall, and magnet migration."}
        </div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, fontSize: 12 }}>
          <div><strong>Prior Surface</strong><br />{wallMigration?.priorDate ?? "N/A"}</div>
          <div><strong>Put Wall</strong><br />{formatMoney(wallMigration?.priorSupport)} → {formatMoney(wallMigration?.currentSupport)}</div>
          <div><strong>Call Wall</strong><br />{formatMoney(wallMigration?.priorResistance)} → {formatMoney(wallMigration?.currentResistance)}</div>
          <div><strong>Magnet</strong><br />{formatMoney(wallMigration?.priorMagnet)} → {formatMoney(wallMigration?.currentMagnet)}</div>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, fontSize: 12 }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.55rem" }}>
          <strong>Wheel</strong><br />
          <span style={{ ...scoreTone(edge.wheelScore), padding: "2px 6px", borderRadius: 999 }}>{fmtFixed(edge.wheelScore, 0)}</span>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.55rem" }}>
          <strong>CSP</strong><br />
          <span style={{ ...scoreTone(edge.cspScore), padding: "2px 6px", borderRadius: 999 }}>{fmtFixed(edge.cspScore, 0)}</span>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.55rem" }}>
          <strong>Covered Call</strong><br />
          <span style={{ ...scoreTone(edge.coveredCallScore), padding: "2px 6px", borderRadius: 999 }}>{fmtFixed(edge.coveredCallScore, 0)}</span>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.55rem" }}>
          <strong>Trap Risk</strong><br />
          <span style={{ ...trapTone, padding: "2px 6px", borderRadius: 999 }}>{fmtFixed(edge.trapRisk, 0)}</span>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.55rem" }}>
          <strong>Data Quality</strong><br />
          <span style={{ ...scoreTone(edge.dataQualityScore), padding: "2px 6px", borderRadius: 999 }}>{fmtFixed(edge.dataQualityScore, 0)}</span>
        </div>
      </div>

      <div style={{ marginTop: 10, border: `1px solid ${borderColor}`, borderRadius: 6, padding: "0.75rem", background: backgroundColor }}>
        <strong>WheelDesk Playbook</strong>
        <div style={{ marginTop: 4 }}>
          <strong>{edge.actionBucket}</strong> — {edge.bestAction}
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.65rem", background: "#fff" }}>
            <strong>Trap Detector</strong>
            <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
              {edge.trapNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.65rem", background: "#fff" }}>
            <strong>Trigger Map</strong>
            <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
              {edge.triggerNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, fontSize: 12 }}>
        <div><strong>Support Evidence</strong><br />Score: {fmtFixed(edge.supportEvidenceScore, 0)}</div>
        <div><strong>Resistance Evidence</strong><br />Score: {fmtFixed(edge.resistanceEvidenceScore, 0)}</div>
        <div><strong>Price Confluence</strong><br />Score: {fmtFixed(edge.priceConfluenceScore, 0)}</div>
        <div><strong>Pin / Snap Risk</strong><br />Score: {fmtFixed(edge.pinSnapRiskScore, 0)}</div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, fontSize: 12 }}>
        <div><strong>Realized Vol</strong><br />{formatPct(edge.realizedVolPct)}</div>
        <div><strong>ATR</strong><br />{formatPct(edge.atrPct)}</div>
        <div><strong>Volume / Flow Thrust</strong><br />{formatVolumeThrust(edge)}</div>
        <div><strong>Premium Proxy</strong><br />{fmtFixed(edge.premiumProxyScore, 0)}</div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, fontSize: 13 }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.65rem" }}>
          <strong>Covered-call reference</strong>
          <div>Resistance: {formatMoney(edge.resistance)}</div>
          <div>Cushion target: {formatMoney(edge.coveredCallCushionTarget)}</div>
          <div>Executable zone floor: <strong>{formatMoney(edge.executableCoveredCallFloor)}</strong></div>
          <div style={{ color: "#6b7280", marginTop: 4 }}>
            Uses {fmtFixed(edge.cushionPct, 1)}% cushion and snaps to the next available strike at or above target.
          </div>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.65rem" }}>
          <strong>CSP reference</strong>
          <div>Support: {formatMoney(edge.support)}</div>
          <div>Cushion target: {formatMoney(edge.cspCushionTarget)}</div>
          <div>Executable zone ceiling: <strong>{formatMoney(edge.executableCspCeiling)}</strong></div>
          <div style={{ color: "#6b7280", marginTop: 4 }}>
            Uses {fmtFixed(edge.cushionPct, 1)}% cushion and snaps to the next available strike at or below target.
          </div>
        </div>
      </div>

      {edge.dataQualityNotes.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#92400e" }}>
          <strong>Data audit:</strong> {edge.dataQualityNotes.join(" ")}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const storage = createLocalPersistenceAdapter();

  const [ticker, setTicker] = useState<SupportedTicker>("AAPL");
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [watchlist, setWatchlist] = useState<SupportedTicker[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [asOfDate, setAsOfDate] = useState(today);
  const [overlays, setOverlays] = useState<OverlayFlags>(defaultOverlays);
  const [status, setStatus] = useState("No option chain loaded yet.");
  const [lastSaveStatus, setLastSaveStatus] = useState("idle");
  const [chartMode, setChartMode] = useState<"tradingview" | "legacy">("tradingview");
  const [showPrevailingStructure, setShowPrevailingStructure] = useState(true);
  const [showPriorDrift, setShowPriorDrift] = useState(false);
  const [showSelectedChainLevels, setShowSelectedChainLevels] = useState(false);
  const [showOIPath, setShowOIPath] = useState(false);
  const [oiPathMode, setOiPathMode] = useState<OIPathDisplayMode>("standard");  
  const [portfolioProfiles, setPortfolioProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<OptionSurfaceSnapshot[]>([]);
  const [primarySurfaceDate, setPrimarySurfaceDate] = useState("");
  const [compareSurfaceDate, setCompareSurfaceDate] = useState("");
  const [fetchedSnapshot, setFetchedSnapshot] = useState<ChainSnapshot | null>(null);
  const [savedChainSnapshots, setSavedChainSnapshots] = useState<ChainSnapshotEntry[]>([]);
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("");
  const [compareSnapshotDate, setCompareSnapshotDate] = useState("");
  const [selectedExpiration, setSelectedExpiration] = useState("");
  const [selectionOwner, setSelectionOwner] = useState<"manual" | "snapshot" | "auto">("auto");
  const [allowAutoSelection, setAllowAutoSelection] = useState(true);
  const [hasFetchedChain, setHasFetchedChain] = useState(false);
  const [chainSelectionStatus, setChainSelectionStatus] = useState("preserved");
  const [mounted, setMounted] = useState(false);  
  const [dailyStructureHistory, setDailyStructureHistory] = useState(() =>
    listDailyStructureSnapshots("AAPL")
  );


  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlTicker = new URLSearchParams(window.location.search).get("ticker")?.trim().toUpperCase();
    if (!urlTicker) return;

    setTicker(urlTicker as SupportedTicker);
    setTickerInput(urlTicker);
  }, []);
const reloadSurfaceSnapshots = () => {
  const loaded = readOptionSurfaceSnapshots(ticker).sort((a, b) =>
    a.snapshotDate.localeCompare(b.snapshotDate)
  );

  setSurfaceSnapshots(loaded);

  setPrimarySurfaceDate((current) => {
    if (current && loaded.some((s) => s.snapshotDate === current)) {
      return current;
    }

    return loaded.at(-1)?.snapshotDate ?? "";
  });

  setCompareSurfaceDate((current) => {
    if (current && loaded.some((s) => s.snapshotDate === current)) {
      return current;
    }

    return "";
  });
};

  const handleSaveDailySurfaceSnapshot = () => {
  if (!fetchedSnapshot?.chains?.length) {
    alert("No option surface loaded to save.");
    return;
  }

  if (!surfacePrevailingLevels) {
    alert("No daily OI structure calculated yet.");
    return;
  }

  const preferences = readPreferences();

const snapshotDate =
  asOfDate ||
  fetchedSnapshot.snapshotDate ||
  new Date().toISOString().slice(0, 10);

  const surfaceSnapshot = buildOptionSurfaceSnapshot({
    ticker,
    snapshotTimeZone: preferences.snapshotTimeZone,
    chains: fetchedSnapshot.chains.map((chain: any) => ({
      ticker,
      snapshotDate,
      expiration: chain.expiration,
      rows: chain.rows ?? [],
      summary: chain.summary ?? {},
      chainKind: chain.chainKind,
      dteAtCapture: chain.dteAtCapture
    })),
    dailyStructure: {
      ticker,
      snapshotDate,
      spot: currentPrice,

      primarySupport: surfacePrevailingLevels.support?.strike,
      primaryResistance: surfacePrevailingLevels.resistance?.strike,
      magnet: surfacePrevailingLevels.magnet?.strike,
      oiMagnet: surfacePrevailingLevels.magnet?.strike,

      supportStrike: surfacePrevailingLevels.support?.strike,
      resistanceStrike: surfacePrevailingLevels.resistance?.strike,
      magnetStrike: surfacePrevailingLevels.magnet?.strike,

      supportPressureType: surfacePrevailingLevels.support?.pressureType,
      resistancePressureType: surfacePrevailingLevels.resistance?.pressureType,
      supportPressureScore: surfacePrevailingLevels.support?.pressureScore,
      resistancePressureScore: surfacePrevailingLevels.resistance?.pressureScore,
      supportOiChange: surfacePrevailingLevels.support?.oiChange,
      resistanceOiChange: surfacePrevailingLevels.resistance?.oiChange,

      projectedBias:
       oiProjectionReport?.projectedBias ??
             "neutral",

      prevailingLevels: surfacePrevailingLevels,
      impliedPath: oiProjectionReport,
      source: "surface_snapshot"
    },
    price: {
      date: snapshotDate,
      close: currentPrice
    }
  });

  saveOptionSurfaceSnapshot(surfaceSnapshot);
      reloadSurfaceSnapshots();
setPrimarySurfaceDate(snapshotDate);
setSelectedSnapshotDate(snapshotDate);
setLastSaveStatus(`save success: ${ticker}_${snapshotDate}`);
setStatus(`Saved full OI surface snapshot ${snapshotDate} for ${ticker}.`);

  alert(`Saved full OI surface snapshot for ${ticker} on ${snapshotDate}.`);
};  
  const [candles, setCandles] = useState<Awaited<ReturnType<typeof getPriceSeries>>>([]);
  const currentPrice = candles.at(-1)?.close ?? 0;
  useEffect(() => {
  setMounted(true);
}, []);
  useEffect(() => {
  if (!mounted || !ticker) return;

  let cancelled = false;
  const requestedTicker = ticker;

  hydrateSurfaceSnapshotsFromSupabase(requestedTicker, 50)
    .then((result) => {
      if (cancelled) return;

      if (result.fetched > 0) {
        reloadSurfaceSnapshots();

        console.info(
          `[WheelDesk] Hydrated ${result.fetched} Supabase surface snapshots for ${result.ticker}. ` +
            `Added ${result.added}, updated ${result.updated}.`
        );
      }
    })
    .catch((error) => {
      console.warn("[WheelDesk] Supabase surface hydration failed:", error);
    });

  return () => {
    cancelled = true;
  };
}, [mounted, ticker]);

    
  useEffect(() => {
    let cancelled = false;
    const requestedTicker = ticker;
    const requestedTimeframe = timeframe;

    clearExpiredDashboardCache();
    setCandles([]);

    const cachedCandles = loadCachedCandles(requestedTicker, requestedTimeframe);
    if (cachedCandles?.length) {
      setCandles(cachedCandles);
      if (requestedTimeframe === "daily") {
  saveCandles(
    requestedTicker,
    cachedCandles
      .map((c: any) => ({
        date: String(c.date ?? c.time ?? c.timestamp ?? ""),
        open: Number(c.open ?? 0),
        high: Number(c.high ?? 0),
        low: Number(c.low ?? 0),
        close: Number(c.close ?? 0),
        volume: Number(c.volume ?? 0),
      }))
      .filter((c) => c.date && Number.isFinite(c.close))
  );
}
    }

    getPriceSeries(requestedTicker, requestedTimeframe)
      .then((series) => {
        if (cancelled) return;
        setCandles(series);
        saveCachedCandles(requestedTicker, requestedTimeframe, series);

        // v2 candles are used by Scanner/Control Center as daily context.
        // Do not persist intraday rows into the daily candle source of truth.
     if (requestedTimeframe === "daily") {
  saveCandles(
    requestedTicker,
    series
      .map((c: any) => ({
        date: String(c.date ?? c.time ?? c.timestamp ?? ""),
        open: Number(c.open ?? 0),
        high: Number(c.high ?? 0),
        low: Number(c.low ?? 0),
        close: Number(c.close ?? 0),
        volume: Number(c.volume ?? 0),
      }))
      .filter((c) => c.date && Number.isFinite(c.close))
  );
}
      })
      .catch(() => {
        if (!cancelled && !cachedCandles?.length) {
          setStatus("Failed to load price chart.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe]);

useEffect(() => {
  if (primarySurfaceDate) return;

  const cachedChain = loadCachedOptionChain(ticker, asOfDate);
  if (!cachedChain) return;

  setFetchedSnapshot(cachedChain);
  setHasFetchedChain(true);
  setSelectedSnapshotDate(cachedChain.snapshotDate);
  setStatus(`Restored cached option chain for ${ticker} (${cachedChain.snapshotDate}).`);
}, [ticker, asOfDate, primarySurfaceDate]);

  useEffect(() => {
    const profiles = listPortfolioProfiles();
    setPortfolioProfiles(profiles);

    const savedId = window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
    const selected = savedId && profiles.some((p) => p.id === savedId) ? savedId : profiles[0]?.id ?? "";
    setSelectedProfileId(selected);
  }, []);
  useEffect(() => {
  reloadSurfaceSnapshots();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ticker]);
  useEffect(() => {
    if (!selectedProfileId) return;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    const saved = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) {
          setWatchlist(parsed);
          return;
        }
      } catch {
        // ignore bad storage
      }
    }

    setWatchlist([ticker]);
  }, []);

  useEffect(() => {
    if (!watchlist.length) return;
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    try {
      const savedChain = getSavedChainSnapshots(ticker);
      const prefs = storage.getPreferences(ticker);

      setSavedChainSnapshots(savedChain);
      setDailyStructureHistory(listDailyStructureSnapshots(ticker));

      if (prefs) {
        setTimeframe(prefs.selectedTimeframe);
        setSelectedSnapshotDate("");
        setSelectedExpiration("");
        setSelectionOwner("auto");
        setAllowAutoSelection(true);
        setOverlays({ ...defaultOverlays, ...prefs.overlays });
      } else {
        setSelectedSnapshotDate("");
        setSelectedExpiration("");
        setSelectionOwner("auto");
        setAllowAutoSelection(true);
      }

      setCompareSnapshotDate("");
    } catch {
      setSavedChainSnapshots([]);
      setDailyStructureHistory([]);
    }
  }, [ticker]);

useEffect(() => {
  setSelectionOwner((prev) => (prev === "manual" ? "manual" : "auto"));
    
  if (primarySurfaceDate) return;
  const cached = loadCachedOptionChain(ticker, asOfDate);

  if (cached) {
    setFetchedSnapshot(cached);
    setHasFetchedChain(true);
    setSelectedSnapshotDate(cached.snapshotDate);

    setStatus(`Loaded cached chain for ${ticker} (${cached.snapshotDate})`);
  } else {
    setHasFetchedChain(false);
    setFetchedSnapshot(null);
    setSelectedExpiration("");
    setStatus("No option chain loaded yet.");
  }
}, [ticker, asOfDate]);

  useEffect(() => {
    setTickerInput(ticker);
  }, [ticker]);

  useEffect(() => {
    const prefs: DashboardPreferences = {
      ticker,
      selectedTimeframe: timeframe,
      selectedSnapshotDate,
      selectedExpiration,
      overlays,
      updatedAt: new Date().toISOString()
    };

    storage.savePreferences(ticker, prefs);
  }, [ticker, timeframe, selectedSnapshotDate, selectedExpiration, overlays]);

  useEffect(() => {
  if (!ticker) return;

  setWatchlist((prev) => {
    const normalized = ticker.toUpperCase() as SupportedTicker;
    const deduped = prev.filter((item) => item.toUpperCase() !== normalized);

    return [normalized, ...deduped].slice(0, 12);
  });
}, [ticker]);

  const selectedSurface = useMemo(() => {
  if (!ticker || !primarySurfaceDate) return null;

  return readOptionSurfaceSnapshot({
    ticker,
    snapshotDate: primarySurfaceDate
  });
}, [ticker, primarySurfaceDate, surfaceSnapshots]);

const analysisPrice = getSnapshotSpot(selectedSurface, currentPrice);

// Scanner-equivalent candle input: the Dashboard edge card should use the same
// saved v2 candle source as /dashboard/scanner, while the chart can still render
// the currently fetched/live candle series. This prevents the Dashboard from
// producing a different edge score/action bucket than the Scanner for the same
// saved OI surface.
const scannerEquivalentCandles = useMemo(() => {
  if (!ticker) return [];

  const upper = ticker.toUpperCase();
  const stored = readCandles(upper);
  if (stored.length) return stored;

  // Fallback to live/chart candle series so the Dashboard does not show
  // N/A for ATR, realized volatility, volume thrust, or candle trend until
  // cache has been persisted into wheeldesk_storage_v2.
  // Normalize chart candles into CandleRecord shape.
  return candles
    .map((c: any) => ({
      date: String(c.date ?? c.time ?? c.timestamp ?? ""),
      open: Number(c.open ?? 0),
      high: Number(c.high ?? 0),
      low: Number(c.low ?? 0),
      close: Number(c.close ?? 0),
      volume: Number(c.volume ?? 0),
    }))
    .filter((c) => c.date && Number.isFinite(c.close));
}, [ticker, selectedSurface?.snapshotDate, candles]);

const scannerEquivalentDisplayCandles = useMemo(() => {
  return scannerEquivalentCandles.map((c: any) => ({
    time: c.time ?? c.date ?? c.timestamp ?? "",
    open: Number(c.open ?? 0),
    high: Number(c.high ?? 0),
    low: Number(c.low ?? 0),
    close: Number(c.close ?? 0),
    volume: Number(c.volume ?? 0),
  }));
}, [scannerEquivalentCandles]);
    
const dashboardTraderEdge = useMemo(() => {
  if (!selectedSurface) return null;

  return buildTraderEdgeSummary({
    ticker,
    surface: selectedSurface,
    candles: scannerEquivalentCandles,
    livePrice: currentPrice
  });
}, [ticker, selectedSurface, scannerEquivalentCandles, currentPrice]);

const compareSurface = useMemo(() => {
  if (!ticker || !compareSurfaceDate) return null;

  return readOptionSurfaceSnapshot({
    ticker,
    snapshotDate: compareSurfaceDate
  });
}, [ticker, compareSurfaceDate, surfaceSnapshots]);

const dashboardWallMigration = useMemo(() => {
  if (!selectedSurface) return null;

  const priorSurface = compareSurface ?? findPriorSurfaceForTicker(surfaceSnapshots, selectedSurface.ticker, selectedSurface.snapshotDate);
  return buildWallMigrationSummary({ currentSurface: selectedSurface, priorSurface });
}, [selectedSurface, compareSurface, surfaceSnapshots]);


const dealerPressure = useMemo(() => {
  return buildDealerPressureSummary({
    surface: selectedSurface,
    edge: dashboardTraderEdge,
    wallMigration: dashboardWallMigration,
    candles: scannerEquivalentCandles,
    livePrice: currentPrice,
  });
}, [
  selectedSurface,
  dashboardTraderEdge,
  dashboardWallMigration,
  scannerEquivalentCandles,
  currentPrice,
]);
const surfaceSnapshotDates = useMemo(() => {
  return surfaceSnapshots
    .map((snapshot) => snapshot.snapshotDate)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}, [surfaceSnapshots]);

const activeSurfaceSnapshot = useMemo(() => {
  // Fresh fetch has full rows and should always win.
  // Local saved surfaces are now manifest-only after Supabase save.
  if (snapshotHasRows(fetchedSnapshot)) {
    return fetchedSnapshot;
  }

  // Only use selected saved surface if it actually has rows.
  // Manifest-only surfaces have chain shells/summaries but rows are intentionally omitted locally.
if (selectedSurface && snapshotHasRows(selectedSurface)) {
  return {
    ticker: selectedSurface.ticker,
    snapshotDate: selectedSurface.snapshotDate,
    chains: selectedSurface.chains.map((chain: any) => ({
      expiration: chain.expiration,
      rows: chain.rows ?? [],
      summary: chain.summary ?? {},
    })),
  } as ChainSnapshot;
}

  return fetchedSnapshot;
}, [selectedSurface, fetchedSnapshot]);

    
  const chainUniverse = useMemo(() => {
  return activeSurfaceSnapshot?.chains ?? [];
}, [activeSurfaceSnapshot]);
 
  const rankedChains = useMemo(() => {
    if (!chainUniverse.length) return [];
    return rankPrevailingChains(chainUniverse, analysisPrice || chainUniverse[0]?.summary.combinedCenter || 0);
  }, [chainUniverse, analysisPrice]);

  const chainsForSelector = useMemo(() => {
    return [...rankedChains].sort((a, b) => a.expiration.localeCompare(b.expiration));
  }, [rankedChains]);

  useEffect(() => {
    if (!hasFetchedChain) return;
    if (!rankedChains.length) return;

    if (selectedExpiration && rankedChains.some((c) => c.expiration === selectedExpiration)) {
      setAllowAutoSelection(false);
      return;
    }

    if (!allowAutoSelection) return;

    const topByScore = [...rankedChains].sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore)[0];

    if (topByScore) {
      setSelectedExpiration(topByScore.expiration);
      setSelectionOwner("auto");
    }
  }, [hasFetchedChain, rankedChains, selectedExpiration, allowAutoSelection]);

  const activeChain = useMemo(
    () => rankedChains.find((c) => c.expiration === selectedExpiration),
    [rankedChains, selectedExpiration]
  );

  const oiIntelligence = useMemo(() => {
    if (!activeChain || !analysisPrice) return null;

    return analyzeOIIntelligence({
      rows: activeChain.rows,
      summary: activeChain.summary,
      currentPrice: analysisPrice
    });
  }, [activeChain, analysisPrice]);

  const availableSnapshotDates = useMemo(() => {
    if (!selectedExpiration) return [];

    return [...new Set(savedChainSnapshots.filter((s) => s.expiration === selectedExpiration).map((s) => s.snapshotDate))].sort((a, b) =>
      b.localeCompare(a)
    );
  }, [savedChainSnapshots, selectedExpiration]);

  const selectedProfile = useMemo(
    () => portfolioProfiles.find((p) => p.id === selectedProfileId),
    [portfolioProfiles, selectedProfileId]
  );

  const selectedProfilePositions = selectedProfile?.positions ?? [];

  const tickerPortfolioSummary = useMemo(
    () => summarizeTickerPositions(ticker, selectedProfilePositions),
    [ticker, selectedProfilePositions]
  );

  const comparisonResult = useMemo(() =>
      buildSnapshotComparison({
        ticker,
        snapshots: savedChainSnapshots.filter((s) => s.expiration === selectedExpiration),
        primarySnapshotDate: selectedSnapshotDate,
        compareSnapshotDate,
        selectedExpiration,
        currentPrice: analysisPrice
      }),
    [ticker, selectedSnapshotDate, compareSnapshotDate, selectedExpiration, savedChainSnapshots, analysisPrice]
  );

  const comparison = comparisonResult.comparison;
  const bollinger = useMemo(() => calculateBollinger(candles, 20), [candles]);

    const priorSurfaceSnapshot = useMemo(() => {
  if (compareSurface?.chains?.length) {
    return {
      ticker: compareSurface.ticker,
      snapshotDate: compareSurface.snapshotDate,
      chains: compareSurface.chains.map((chain) => ({
        expiration: chain.expiration,
        rows: chain.rows,
        summary: chain.summary
      }))
    } as ChainSnapshot;
  }

  const priorDate = compareSnapshotDate || comparison?.priorSnapshotDate || "";

  if (!priorDate) return null;

  return buildSurfaceSnapshotFromSavedEntries({
    ticker,
    snapshotDate: priorDate,
    entries: savedChainSnapshots
  });
}, [ticker, compareSurface, compareSnapshotDate, comparison, savedChainSnapshots]);

    
  const fallbackSummary: ExpirationSummary = useMemo(
    () => ({
      expiration: "N/A",
      totalCallOi: 0,
      totalPutOi: 0,
      callWeightedStrike: analysisPrice,
      putWeightedStrike: analysisPrice,
      combinedCenter: analysisPrice,
      lowerRange: bollinger.lower || analysisPrice,
      upperRange: bollinger.upper || analysisPrice,
      callWall: analysisPrice,
      putWall: analysisPrice,
      prevailingScore: 0
    }),
    [analysisPrice, bollinger.lower, bollinger.upper]
  );

  const adjustedSummary: ExpirationSummary = useMemo(() => {
    if (!activeChain) return fallbackSummary;
    if (!oiIntelligence) return activeChain.summary;

    return {
      ...activeChain.summary,
      callWall: oiIntelligence.adjustedCallWall,
      putWall: oiIntelligence.adjustedPutWall,
      combinedCenter: oiIntelligence.adjustedCenter
    };
  }, [activeChain, oiIntelligence, fallbackSummary]);

  const oiProjectionReport = useMemo(() => {
  return buildOIProjectionReport({
    snapshot: activeSurfaceSnapshot,
    currentPrice: analysisPrice
  });
}, [activeSurfaceSnapshot, analysisPrice]);

const enhancedOIPath = useMemo(() => {
  return buildOIImpliedPath({
    projectionReport: oiProjectionReport,
    edgeSummary: dashboardTraderEdge,
    wallMigration: dashboardWallMigration,
    currentPrice: analysisPrice
  });
}, [oiProjectionReport, dashboardTraderEdge, dashboardWallMigration, analysisPrice]);

const rawSurfacePrevailingLevels = useMemo(() => {
  return getSurfacePrevailingLevels({
    snapshot: activeSurfaceSnapshot,
    projectionReport: oiProjectionReport,
    currentPrice: analysisPrice,
    priorSnapshot: priorSurfaceSnapshot
  });
}, [activeSurfaceSnapshot, oiProjectionReport, analysisPrice, priorSurfaceSnapshot]);

const surfacePrevailingLevels = useMemo(() => {
  if (!dashboardTraderEdge || !rawSurfacePrevailingLevels) return rawSurfacePrevailingLevels;

  const patchLevel = (level: any, strike: number | null, kind: "support" | "resistance" | "magnet") => {
    if (strike == null || !Number.isFinite(strike)) return level;

    return {
      ...(level ?? {}),
      strike,
      levelType: level?.levelType ?? kind,
      source: "trader-edge-engine",
    };
  };

  // Keep the rich OI metadata from getSurfacePrevailingLevels, but use the
  // validated, sanity-checked levels from trader-edge-engine. This keeps the
  // chart, ladder, dashboard summary, scanner, and wheel workspace aligned.
  return {
    ...rawSurfacePrevailingLevels,
    support: patchLevel(rawSurfacePrevailingLevels.support, dashboardTraderEdge.support, "support"),
    resistance: patchLevel(rawSurfacePrevailingLevels.resistance, dashboardTraderEdge.resistance, "resistance"),
    magnet: patchLevel(rawSurfacePrevailingLevels.magnet, dashboardTraderEdge.magnet, "magnet"),
  };
}, [rawSurfacePrevailingLevels, dashboardTraderEdge]);
    
  const structureDrift = buildDailyStructureDrift({
  history: dailyStructureHistory,
  selectedDate: selectedSnapshotDate
});
  const surfaceComparison = buildOISurfaceComparison(
  surfaceSnapshots,
  primarySurfaceDate,
  compareSurfaceDate
); 
    
  const decision = useMemo(() => {
    return runPositionEngine({
      currentPrice: analysisPrice,
      ticker,
      timeframe,
      oi: adjustedSummary,
      bollinger,
      portfolioProfile: selectedProfile ?? null,
      tickerPositions: tickerPortfolioSummary.matching,
      structureComparison: comparison
    });
  }, [
    adjustedSummary,
    analysisPrice,
    ticker,
    timeframe,
    bollinger,
    selectedProfile,
    tickerPortfolioSummary,
    comparison
  ]);

  const snapshotSeries = useMemo(() => {
    if (!selectedExpiration) return [];

    const chainHistory = savedChainSnapshots.filter((s) => s.expiration === selectedExpiration);
    const historySource = overlays.showSavedOiHistory ? chainHistory : [];

    const primary = buildSnapshotStructureSeries({
      snapshots: historySource,
      role: "primary",
      maxSnapshotDate: selectedSnapshotDate || undefined
    });

    const compareDate = compareSnapshotDate || comparison?.priorSnapshotDate;

    const compare = compareDate
      ? buildSnapshotStructureSeries({
          snapshots: historySource,
          role: "compare",
          maxSnapshotDate: compareDate
        })
      : [];

    return [...primary, ...compare];
  }, [savedChainSnapshots, selectedExpiration, selectedSnapshotDate, compareSnapshotDate, comparison, overlays.showSavedOiHistory]);

  const fallbackOverlayDates = useMemo(
    () =>
      snapshotSeries
        .filter((o) => o.matchType === "fallback_nearest_expiration")
        .map((o) => `${o.role}:${o.snapshotDate}→${o.expirationUsed}`),
    [snapshotSeries]
  );

  const overlayStatus = useMemo(() => {
    if (!selectedExpiration) return "no expiration chain selected";

    const exact = savedChainSnapshots.some(
      (s) => s.snapshotDate === selectedSnapshotDate && s.expiration === selectedExpiration
    );

    if (exact) return "rendered exact chain snapshot";
    return "no saved snapshot for selected date/expiration";
  }, [savedChainSnapshots, selectedSnapshotDate, selectedExpiration]);

  const selectedSavedChainSnapshot = useMemo(() => {
    if (!selectedExpiration || !selectedSnapshotDate) return undefined;

    const lookupKey = makeSnapshotKey(ticker, selectedSnapshotDate, selectedExpiration);
    return savedChainSnapshots.find((s) => s.snapshotKey === lookupKey);
  }, [savedChainSnapshots, ticker, selectedExpiration, selectedSnapshotDate]);

  useEffect(() => {
    if (selectionOwner === "manual") return;

    if (selectedSavedChainSnapshot) {
      setSelectionOwner("snapshot");
      setAllowAutoSelection(false);
    }
  }, [selectedSavedChainSnapshot, selectionOwner]);

  const derivedDte = useMemo(() => {
    if (!selectedExpiration) return null;

    const reference = selectedSnapshotDate || asOfDate || today;
    const expTs = new Date(`${selectedExpiration}T00:00:00Z`).getTime();
    const refTs = new Date(`${reference}T00:00:00Z`).getTime();

    return Math.max(0, Math.round((expTs - refTs) / (1000 * 60 * 60 * 24)));
  }, [selectedExpiration, selectedSnapshotDate, asOfDate]);

  const selectedChainSnapshotCount = useMemo(
    () => savedChainSnapshots.filter((s) => s.expiration === selectedExpiration).length,
    [savedChainSnapshots, selectedExpiration]
  );

  useEffect(() => {
    if (!selectedSnapshotDate && availableSnapshotDates.length) {
      setSelectedSnapshotDate(availableSnapshotDates[0]);
    }
  }, [availableSnapshotDates, selectedSnapshotDate]);

  const fetchChain = async () => {
    try {
      setStatus("Fetching option chain...");
      const snap = await getOptionChain(ticker, asOfDate);

      setFetchedSnapshot(snap);
      saveCachedOptionChain(snap);
      setHasFetchedChain(true);
      setSelectedSnapshotDate(snap.snapshotDate);

      const fetchedExpirations = snap.chains.map((c) => c.expiration);
      const existedInFetched = Boolean(selectedExpiration && fetchedExpirations.includes(selectedExpiration));

      const hasSnapshotBackedSelection = Boolean(
        selectedExpiration &&
          savedChainSnapshots.some(
            (s) => s.snapshotDate === (selectedSnapshotDate || asOfDate) && s.expiration === selectedExpiration
          )
      );

      if (selectionOwner === "manual" && selectedExpiration) {
        setAllowAutoSelection(false);
      } else if (existedInFetched) {
        setAllowAutoSelection(false);
        if (selectionOwner !== "manual") setSelectionOwner("snapshot");
      } else if (hasSnapshotBackedSelection) {
        setAllowAutoSelection(false);
        setSelectionOwner("snapshot");
      } else if (allowAutoSelection || !selectedExpiration) {
        const topByScore = [...snap.chains].sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore)[0];
        setSelectedExpiration(topByScore?.expiration ?? "");
        setSelectionOwner("auto");
      }

      if (!snap.chains.length) {
        setStatus("No expirations returned for selected ticker/date.");
      } else {
        setStatus(`Loaded ${snap.chains.length} expirations and computed OI structure (${ticker} ${snap.snapshotDate}).`);
      }
    } catch {
      setStatus("Fetch failed. Please retry.");
    }
  };

const canSaveSnapshot = Boolean(
  ticker &&
    asOfDate &&
    hasFetchedChain &&
    snapshotHasRows(fetchedSnapshot) &&
    fetchedSnapshot?.chains?.length
  
);

  const saveSnapshot = () => {
    const selectedExp = selectedExpiration;

    if (!selectedExp || !activeChain) {
      setLastSaveStatus("save failed (no active chain selected)");
      return;
    }

    try {
      const saveKey = makeSnapshotKey(ticker, asOfDate, selectedExp);

      const dteAtCapture = Math.max(
        0,
        Math.round(
          (new Date(`${selectedExp}T00:00:00Z`).getTime() - new Date(`${asOfDate}T00:00:00Z`).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );

      const expDate = new Date(`${selectedExp}T00:00:00Z`);
      const chainKind =
        expDate.getUTCDay() === 5 && expDate.getUTCDate() >= 15 && expDate.getUTCDate() <= 21
          ? "monthly"
          : "weekly";

      storage.saveChainSnapshot({
        snapshotKey: saveKey,
        ticker,
        snapshotDate: asOfDate,
        expiration: selectedExp,
        dteAtCapture,
        chainKind,
        rows: activeChain.rows,
        summary: activeChain.summary,
        prevailingScore: activeChain.summary.prevailingScore
      });

      const exact = storage.getChainSnapshot(ticker, asOfDate, selectedExp);

      if (!exact) {
        setLastSaveStatus(`save failed: ${saveKey}`);
        setStatus("Save failed: snapshot did not persist.");
        return;
      }

      if (oiProjectionReport && surfacePrevailingLevels) {
        const dailySnapshot = buildDailyStructureSnapshot({
          ticker,
          snapshotDate: asOfDate,
          spot: currentPrice,
          projection: oiProjectionReport,
          prevailingLevels: surfacePrevailingLevels
        });

        saveDailyStructureSnapshot(dailySnapshot);
        setDailyStructureHistory(listDailyStructureSnapshots(ticker));
      }

      const savedChain = getSavedChainSnapshots(ticker);
      setSavedChainSnapshots(savedChain);
      setSelectedSnapshotDate(asOfDate);
      setLastSaveStatus(`save success: ${saveKey}`);
      setStatus(`Saved daily structure snapshot ${asOfDate} for ${ticker}.`);
    } catch {
      setLastSaveStatus("save failed");
      setStatus("Save failed: exception while writing snapshot.");
    }
  };

  const deleteSnapshotsForChain = () => {
    const selectedExp = selectedExpiration;
    if (!selectedExp) return;

    const ok = window.confirm(`Delete saved snapshots for ${ticker} / ${selectedExp}?\nThis cannot be undone.`);
    if (!ok) return;

    const removed = deleteChainSnapshots(ticker, selectedExp);
    const savedChain = getSavedChainSnapshots(ticker);

    setSavedChainSnapshots(savedChain);
    setDailyStructureHistory(listDailyStructureSnapshots(ticker));
    setStatus(`Deleted ${removed} saved snapshots for ${ticker} ${selectedExp}.`);
  };

  const toggle = (key: keyof OverlayFlags) => setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));

  const commitTickerInput = () => {
    const normalized = tickerInput.trim().toUpperCase();

    if (!normalized || normalized === ticker) return;
    setTicker(normalized as SupportedTicker);
  };

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "1rem", display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ marginBottom: 0 }}>Trading Operator Console</h1>
        <a
          href="/dashboard/scanner"
          style={{
            border: "1px solid #111827",
            borderRadius: 8,
            padding: "0.55rem 0.75rem",
            background: "#111827",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 700
          }}
        >
          Open WheelDesk Scanner
        </a>
      </div>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
        <h3 style={{ marginTop: 0 }}>Top Controls</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.6rem", alignItems: "end" }}>
          <label>
            Ticker
            <input
              list="ticker-list"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTickerInput();
                }
              }}
              placeholder="Type ticker"
            />
            <datalist id="ticker-list">
              {SUPPORTED_TICKERS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          <label>
            Timeframe
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
              {SUPPORTED_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>

          <label>
            Snapshot Date
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </label>

          <button onClick={fetchChain}>Fetch Option Chain</button>
         <button
  onClick={handleSaveDailySurfaceSnapshot}
  disabled={!canSaveSnapshot}
  title={
    canSaveSnapshot
      ? "Save the current fetched option surface to Supabase"
      : "Fetch an option chain before saving"
  }
>
  Save Daily OI Surface
</button>
          <button onClick={deleteSnapshotsForChain} disabled={!selectedExpiration}>
            Delete chain snapshots
          </button>
        </div>
        {mounted && watchlist.length > 0 && (
  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
    <span style={{ fontSize: 12, color: "#4b5563" }}>Watchlist:</span>

    {watchlist.map((w) => (
      <div
        key={w}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: w === ticker ? "#111827" : "#e5e7eb",
          color: w === ticker ? "#fff" : "#111827",
          borderRadius: 14,
          padding: "2px 6px"
        }}
      >
        {/* ticker click */}
        <span
          style={{ cursor: "pointer", padding: "0 4px" }}
          onClick={() => setTicker(w)}
        >
          {w}
        </span>

        {/* remove X */}
        <span
          style={{
            cursor: "pointer",
            fontWeight: 700,
            padding: "0 4px",
            opacity: 0.7
          }}
          onClick={(e) => {
            e.stopPropagation();

            const updated = watchlist.filter((t) => t !== w);

            setWatchlist(updated);
            localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(updated));

            // fallback if you removed current ticker
            if (w === ticker) {
              setTicker(updated[0] ?? "");
            }
          }}
        >
          ×
        </span>
      </div>
    ))}
  </div>
)}
            

        

        <p style={{ marginBottom: 0 }}>
          <strong>Status:</strong> {status}
        </p>

    <section style={{ marginTop: 8, padding: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 6, background: "#ffffff", fontSize: 13 }}>
  <strong>Selected Surface / Chain Summary</strong>

  <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 8 }}>
    <div>Surface Date: {primarySurfaceDate || selectedSnapshotDate || asOfDate || "N/A"}</div>
    <div>Expiration: {selectedExpiration || "N/A"}</div>
    <div>DTE: {derivedDte ?? "N/A"}</div>
    <div>Score: {fmtFixed(activeChain?.summary.prevailingScore,2)}</div>
    <div>Saved surfaces: {mounted ? surfaceSnapshots.length : 0}</div>
    <div>Chains in surface: {selectedSurface?.chains?.length ?? fetchedSnapshot?.chains?.length ?? 0}</div>
  </div>

    {surfacePrevailingLevels && (
  <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
    <div>Surface Support: {fmtFixed(surfacePrevailingLevels.support?.strike, 2)}</div>
    <div>Surface Resistance:{fmtFixed(surfacePrevailingLevels.resistance?.strike, 2)}</div>
    <div>Surface Magnet: {fmtFixed(surfacePrevailingLevels.magnet?.strike, 2)}</div>
    <div>
      Source:{" "}
      {selectedSurface
        ? `Saved surface ${selectedSurface.snapshotDate}`
        : fetchedSnapshot
          ? `Live/cache ${fetchedSnapshot.snapshotDate}`
          : "N/A"}
    </div>
  </div>
)}

          {oiIntelligence && oiIntelligence.anomalies.length > 0 && (
            <div style={{ marginTop: 6, color: "#7c2d12", fontWeight: 600 }}>
              Adjusted structure active: anomaly-filtered walls and center are being used.
            </div>
          )}
        </section>

        <p style={{ marginTop: 4, marginBottom: 0, color: "#4b5563" }}>
          Data source: Yahoo provider through <code>src/lib/data-provider.ts</code>.
        </p>

        <div style={{ marginTop: "0.7rem" }}>
<SnapshotSelector
  snapshotDates={surfaceSnapshotDates.length ? surfaceSnapshotDates : availableSnapshotDates}
  selectedDate={primarySurfaceDate || selectedSnapshotDate}
  onSelectDate={(date) => {
    setPrimarySurfaceDate(date);
    setSelectedSnapshotDate(date);

    if (compareSurfaceDate === date) setCompareSurfaceDate("");
    if (compareSnapshotDate === date) setCompareSnapshotDate("");
  }}
  compareDate={compareSurfaceDate || compareSnapshotDate}
  onSelectCompareDate={(date) => {
    setCompareSurfaceDate(date);
    setCompareSnapshotDate(date);
  }}
  chains={chainsForSelector}
  selectedExpiration={selectedExpiration}
  onSelectExpiration={(exp) => {
    setSelectedExpiration(exp);
    setSelectionOwner("manual");
    setAllowAutoSelection(false);
    setChainSelectionStatus("manual");
  }}
/>
        </div>
      </section>

<div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
  <label>
    <input
      type="checkbox"
      checked={showPrevailingStructure}
      onChange={(e) => setShowPrevailingStructure(e.target.checked)}
    />{" "}
    Prevailing OI Structure
  </label>

  <label>
    <input
      type="checkbox"
      checked={showPriorDrift}
      onChange={(e) => setShowPriorDrift(e.target.checked)}
    />{" "}
    Prior Drift
  </label>

  <label>
    <input
      type="checkbox"
      checked={showSelectedChainLevels}
      onChange={(e) => setShowSelectedChainLevels(e.target.checked)}
    />{" "}
    Selected Chain Levels
  </label>
    <label>
  <input
    type="checkbox"
    checked={showOIPath}
    onChange={(e) => setShowOIPath(e.target.checked)}
  />{" "}
  OI pressure map
</label>

{showOIPath && (
  <label>
    Path mode {" "}
    <select value={oiPathMode} onChange={(event) => setOiPathMode(event.target.value as OIPathDisplayMode)}>
      <option value="minimal">Minimal</option>
      <option value="standard">Standard</option>
      <option value="full">Full</option>
    </select>
  </label>
)}
    
</div>

<TradingViewChartPanel
  title={`Main Stock Chart — ${ticker} (${timeframe})`}
  candles={candles}
  prevailingLevels={surfacePrevailingLevels}
  summary={adjustedSummary}
  structureDrift={structureDrift}
  projectionReport={oiProjectionReport}
  enhancedOIPath={enhancedOIPath}
  showPrevailing={showPrevailingStructure}
  showPrior={showPriorDrift}
  showSelectedChain={showSelectedChainLevels}
  showOIPath={showOIPath}
  oiPathMode={oiPathMode}
  height={520}
/>
{showOIPath && <OIImpliedPathScenarioCard path={enhancedOIPath} mode={oiPathMode} onModeChange={setOiPathMode} />}
<TraderEdgeSummaryCard
  ticker={ticker}
  levels={surfacePrevailingLevels}
 candles={scannerEquivalentDisplayCandles}
  analysisPrice={analysisPrice}
  livePrice={currentPrice}
  selectedSurface={selectedSurface}
  edgeSummary={dashboardTraderEdge}
  wallMigration={dashboardWallMigration}
/>
<DealerPressureCard summary={dealerPressure} />
   <PrevailingStructureLadderCard
  levels={surfacePrevailingLevels}
  currentPrice={analysisPrice}
/>
      <StructureQualityCard
  levels={surfacePrevailingLevels}
  currentPrice={analysisPrice}
/>
<FlowIntelligenceCard levels={surfacePrevailingLevels} />

      {selectedExpiration && selectedSnapshotDate && !selectedSavedChainSnapshot && (
        <div style={{ fontSize: 12, color: "#b45309" }}>
          No saved chain snapshot exists for this expiration on this date.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <PortfolioContextCard
          ticker={ticker}
          profiles={portfolioProfiles}
          selectedProfileId={selectedProfileId}
          onSelectProfile={setSelectedProfileId}
        />
        <OISummaryCard summary={adjustedSummary} currentPrice={currentPrice} />
      </div>

      <OIIntelligenceCard report={oiIntelligence} />

      <OIProjectionCard report={oiProjectionReport} />

     

      {activeChain ? (
        <>
          <ChainGraph rows={activeChain.rows} summary={adjustedSummary} currentPrice={currentPrice} />
          <OIChainTable rows={activeChain.rows} />
        </>
      ) : (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "0.9rem", background: "#fff" }}>
          <p>No option chain loaded yet. Use top controls to fetch and save a snapshot.</p>
        </section>
      )}
      <OISurfaceComparisonCard data={surfaceComparison} />  
      
    
        
    </main>
  );
}