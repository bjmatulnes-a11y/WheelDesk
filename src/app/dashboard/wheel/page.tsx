"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readCandles,
  type OptionSurfaceSnapshot,
  type CandleRecord
} from "../../../lib/wheeldesk-storage";
import { WheelDeskSideNav } from "../../../components/WheelDeskSideNav";

import type { DailyStructureSnapshot as WheelDailyStructureSnapshot } from "../../../lib/daily-structure-store";
import { listPortfolioProfiles } from "../../../lib/portfolio-store";
import { PortfolioProfile } from "../../../lib/portfolio-types";
import { summarizePortfolioCoverage } from "../../../lib/portfolio-coverage-engine";
import { positionsToPortfolioLegs } from "../../../lib/portfolio-leg-adapter";
import { buildWheelWorkspaceDecision, type ManagedWheelLeg } from "../../../lib/wheel-engine";
import { buildDealerPressureSummary } from "../../../lib/dealer-pressure-engine";
import {
  buildTraderEdgeSummary,
  getSnapshotSpot,
  getSurfaceStructure as getValidatedSurfaceLevels,
  type TraderEdgeSummary
} from "../../../lib/trader-edge-engine";
import { buildWallMigrationSummary, findPriorSurfaceForTicker } from "../../../lib/oi-wall-migration-engine";
import { 
    groupTickerPositions,
    buildSuggestedUserPositionGroups
} from "../../../lib/position-grouping-engine";
import {
  readUserPositionGroups,
  saveUserPositionGroups,
  clearUserPositionGroups,
  makePositionLegId,
  type UserPositionGroup,
  type UserPositionGroupType
} from "../../../lib/position-group-store";

const SELECTED_PROFILE_STORAGE_KEY = "wheelDesk.selectedPortfolioProfileId";
const SELECTED_TICKER_STORAGE_KEY = "wheelDesk.wheel.selectedTicker";

const wheelColors = {
  bg: "#020b14",
  panel: "rgba(7, 21, 35, 0.78)",
  panelSolid: "#071523",
  border: "#20384d",
  text: "#e5f6ff",
  muted: "#9fb4c7",
  teal: "#22d3ee",
  green: "#22c55e",
  red: "#fb7185",
  amber: "#f59e0b",
  purple: "#c084fc",
};

function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "");
}

function dateOnly(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, 10) : "";
}

function dteFromExpiration(expiration?: string, snapshotDate?: string): number | null {
  if (!expiration || !snapshotDate) return null;
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function expirationOf(chain: any): string {
  return dateOnly(chain?.expiration ?? chain?.expirationDate ?? chain?.expiry ?? chain?.date);
}

function surfaceDateOf(raw: any): string {
  return dateOnly(raw?.snapshotDate ?? raw?.snapshot_date ?? raw?.date ?? raw?.asOfDate);
}

function normalizeSurfaceSnapshot(raw: any): OptionSurfaceSnapshot | null {
  if (!raw) return null;

  const ticker = normalizeTicker(raw.ticker ?? raw.symbol);
  const snapshotDate = surfaceDateOf(raw);
  const rawChains = raw.chains ?? raw.optionChains ?? raw.surface?.chains ?? [];

  if (!ticker || !snapshotDate || !Array.isArray(rawChains)) return null;

  const chains = rawChains
    .map((chain: any) => {
      const expiration = expirationOf(chain);
      if (!expiration) return null;

      return {
        ...chain,
        expiration,
        rows: Array.isArray(chain?.rows)
          ? chain.rows
          : Array.isArray(chain?.optionRows)
            ? chain.optionRows
            : Array.isArray(chain?.chainRows)
              ? chain.chainRows
              : [],
        summary: chain?.summary ?? chain?.chainSummary ?? {},
        dteAtCapture:
          chain?.dteAtCapture ??
          chain?.dte ??
          dteFromExpiration(expiration, snapshotDate) ??
          null,
      };
    })
    .filter(Boolean);

  return {
    ...raw,
    ticker,
    snapshotDate,
    surfaceKey: raw.surfaceKey ?? raw.surface_key ?? `${ticker}_${snapshotDate}`,
    chains,
    dailyStructure: raw.dailyStructure ?? raw.daily_structure ?? raw.structure ?? null,
    price: raw.price ?? {
      date: snapshotDate,
      close: Number(raw.spot ?? raw.dailyStructure?.spot ?? raw.daily_structure?.spot ?? 0),
    },
  } as OptionSurfaceSnapshot;
}

function extractSnapshots(payload: any): OptionSurfaceSnapshot[] {
  const candidates = [
    payload?.snapshots,
    payload?.surfaces,
    payload?.data,
    payload?.items,
    payload?.surfaceSnapshots,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(normalizeSurfaceSnapshot)
        .filter((snapshot): snapshot is OptionSurfaceSnapshot => Boolean(snapshot));
    }
  }

  const single = payload?.snapshot ?? payload?.surface ?? payload;
  const normalized = normalizeSurfaceSnapshot(single);
  return normalized ? [normalized] : [];
}

async function fetchSupabaseSurfaces(ticker: string): Promise<OptionSurfaceSnapshot[]> {
  const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Supabase surface request failed: ${response.status}`);
  }

  return extractSnapshots(payload).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
}

function getSurfaceStructure(surface: OptionSurfaceSnapshot | null): WheelDailyStructureSnapshot | null {
  if (!surface?.dailyStructure) return null;

  const raw = surface.dailyStructure as any;
  const spot = getSnapshotSpot(surface, 0);
  const levels = getValidatedSurfaceLevels(surface);

   return {
    ticker: surface.ticker,
    snapshotDate: surface.snapshotDate,
    spot,

    projectedBias:
      raw.projectedBias ??
      raw.bias ??
      raw.impliedPath?.projectedBias ??
      "neutral",

    confidence:
      raw.confidence ??
      raw.impliedPath?.confidence ??
      "medium",

    slope:
      raw.slope ??
      raw.impliedPath?.slope ??
      0,

    spotOffset:
      raw.spotOffset ??
      (typeof spot === "number" && typeof levels.magnet === "number"
        ? spot - levels.magnet
        : 0),

    curveDelta:
      raw.curveDelta ??
      raw.impliedPath?.curveDelta ??
      0,

    magnet:
      levels.magnet ?? raw.magnet ?? raw.oiMagnet ?? null,

    support:
      levels.support ?? raw.support ?? raw.primarySupport ?? null,

    resistance:
      levels.resistance ?? raw.resistance ?? raw.primaryResistance ?? null,

    supportOi:
      raw.supportOi ??
      raw.prevailingLevels?.support?.oi ??
      raw.prevailingLevels?.support?.openInterest ??
      null,

    resistanceOi:
      raw.resistanceOi ??
      raw.prevailingLevels?.resistance?.oi ??
      raw.prevailingLevels?.resistance?.openInterest ??
      null,

    projectionPoints:
      raw.projectionPoints ??
      raw.impliedPath?.projectionPoints ??
      raw.impliedPath?.points ??
      [],

    createdAt:
      raw.createdAt ??
      surface.createdAt ??
      new Date().toISOString()
  };
}

function getSurfaceSpot(surface: OptionSurfaceSnapshot | null): number {
  return getSnapshotSpot(surface, 0);
}

function actionLabel(action: string): string {
  return action.replaceAll("_", " ").toUpperCase();
}

function primaryActionLabel(action: string, state: string): string {
  if (action === "avoid_new_trade" && state === "covered_call_and_short_put") {
    return "MANAGE EXISTING EXPOSURE";
  }
  if (action === "avoid_new_trade") return "AVOID ADDING EXPOSURE";
  return actionLabel(action);
}

function primaryActionColor(action: string, state: string): string {
  if (action === "avoid_new_trade" && state === "covered_call_and_short_put") return "#92400e";
  if (action === "avoid_new_trade") return wheelColors.red;
  if (action === "wait") return "#92400e";
  return wheelColors.text;
}

function groupTypeLabel(value: string): string {
  return GROUP_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value.replaceAll("_", " ");
}

function summarizeGroup(group: UserPositionGroup, legs: { legId: string; label: string }[]): string {
  const labels = group.legIds
    .map((legId) => legs.find((leg) => leg.legId === legId)?.label)
    .filter(Boolean) as string[];

  if (!labels.length) return "No legs assigned.";
  if (labels.length <= 3) return labels.join(" | ");
  return `${labels.slice(0, 3).join(" | ")} + ${labels.length - 3} more`;
}

function buildActionSummary(args: {
  ticker: string;
  decision: { action: string; state: string; tradePlan: { reasoning: string[] }; support?: number | null; resistance?: number | null; magnet?: number | null };
  edge: TraderEdgeSummary | null;
}): string[] {
  const notes: string[] = [];
  const action = primaryActionLabel(args.decision.action, args.decision.state);
  notes.push(`${args.ticker.toUpperCase()} state: ${action}.`);

  if (args.edge) {
    notes.push(`Regime: ${args.edge.regime}; chart ${args.edge.chartBias}, options ${args.edge.optionsBias}.`);
    if (args.edge.actionBucket) {
      const scannerRead =
        args.edge.actionBucket.toLowerCase().includes("low-edge") || args.edge.actionBucket.toLowerCase().includes("wait")
          ? `${args.edge.actionBucket} for new trades. Existing positions should be managed, not expanded.`
          : `${args.edge.actionBucket}. ${args.edge.bestAction}`;
      notes.push(`Scanner read: ${scannerRead}`);
    }
    if (args.edge.magnet != null && args.edge.magnet > args.edge.analysisPrice) {
      notes.push(`Main upside trigger: magnet reclaim / resistance acceptance near ${money(args.edge.magnet)} - ${money(args.edge.resistance)}.`);
    } else if (args.edge.resistance != null) {
      notes.push(`Main upside trigger: acceptance above resistance ${money(args.edge.resistance)}.`);
    }
    if (args.edge.support != null) {
      notes.push(`Main downside defense: support failure below ${money(args.edge.support)}.`);
    }
  }

  const firstReason = args.decision.tradePlan.reasoning[0];
  if (firstReason) notes.push(firstReason);

  if (args.edge?.magnet != null && args.edge?.support != null) {
    notes.push(
      `Do next: watch ${money(args.edge.magnet)} magnet reclaim and ${money(args.edge.support)} support; avoid stacking new premium until one side resolves.`
    );
  } else if (args.edge?.support != null || args.edge?.resistance != null) {
    notes.push(
      `Do next: watch the active support/resistance rails and avoid stacking new premium until one side resolves.`
    );
  }

  return notes;
}

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}
function statusColor(status: string): string {
  if (status === "defend") return wheelColors.red;
  if (status === "pressure") return wheelColors.amber;
  if (status === "watch") return "#92400e";
  return wheelColors.green;
}

function scoreColor(score?: number | null): string {
  if (score == null || !Number.isFinite(score)) return wheelColors.muted;
  if (score >= 75) return wheelColors.green;
  if (score >= 60) return "#92400e";
  return "#b91c1c";
}

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function volumeThrustLabel(edge?: TraderEdgeSummary | null): string {
  if (!edge || edge.volumeThrust == null || !Number.isFinite(edge.volumeThrust)) return "N/A";
  const suffix =
    edge.volumeThrustSource === "stock_volume"
      ? "stock volume"
      : edge.volumeThrustSource === "option_flow"
        ? "option-flow proxy"
        : "";
  return `${edge.volumeThrust.toFixed(2)}x${suffix ? ` ${suffix}` : ""}`;
}

function buildLegEdgeNotes(leg: ManagedWheelLeg, edge: TraderEdgeSummary | null): string[] {
  if (!edge) return [];

  const notes: string[] = [];
  const strike = leg.strike;

  if (leg.type === "short_call" && strike != null) {
    if (edge.executableCoveredCallFloor != null && strike < edge.executableCoveredCallFloor) {
      notes.push(`Short call is below the chain-snapped covered-call floor ${money(edge.executableCoveredCallFloor)}.`);
    }
    if (edge.resistance != null && strike <= edge.resistance) {
      notes.push(`Strike is at/below OI resistance ${money(edge.resistance)}; this is where call-away pressure can show up.`);
    }
    if (edge.actionBucket === "Compression coil") {
      notes.push("Compression coil: avoid adding more short calls inside the active OI range.");
    }
  }

  if (leg.type === "short_put" && strike != null) {
    if (edge.executableCspCeiling != null && strike > edge.executableCspCeiling) {
      notes.push(`Short put is above the chain-snapped CSP ceiling ${money(edge.executableCspCeiling)}.`);
    }
    if (edge.support != null && strike >= edge.support) {
      notes.push(`Strike is at/above OI support ${money(edge.support)}; assignment risk is elevated if support fails.`);
    }
  }

  if (leg.type === "long_call" && strike != null) {
    const moneynessPct = edge.analysisPrice > 0 ? ((strike - edge.analysisPrice) / edge.analysisPrice) * 100 : null;
    if (moneynessPct != null && moneynessPct > 50) {
      notes.push(`Far OTM / convexity exposure: strike is ${moneynessPct.toFixed(1)}% above spot, so it needs major trend expansion, not just a small magnet reclaim.`);
    }
    if (edge.resistance != null && edge.analysisPrice < edge.resistance) {
      notes.push(`Long call wants acceptance above resistance ${money(edge.resistance)} for cleaner upside.`);
    }
    if (edge.magnet != null && edge.analysisPrice < edge.magnet) {
      notes.push(`OI magnet ${money(edge.magnet)} sits above spot; reclaim supports nearer long-call exposure.`);
    }
  }

  if (leg.type === "long_put" && strike != null) {
    if (edge.support != null) {
      notes.push(`Long put is hedge exposure; support ${money(edge.support)} is the first breakdown level.`);
    }
  }

  if (leg.type === "shares") {
    if (edge.executableCoveredCallFloor != null) {
      notes.push(`Covered-call sales should generally start at or above ${money(edge.executableCoveredCallFloor)} unless call-away is acceptable.`);
    }
    if (edge.actionBucket === "Compression coil") {
      notes.push("Shares are inside a compression structure; avoid capping upside too tightly before a wall break.");
    }
  }

  return notes;
}
const GROUP_TYPE_OPTIONS: { value: UserPositionGroupType; label: string }[] = [
  { value: "stock_base", label: "Stock Base" },
  { value: "covered_call", label: "Covered Call" },
  { value: "cash_secured_put", label: "Cash-Secured Put" },
  { value: "debit_spread", label: "Debit Spread" },
  { value: "credit_spread", label: "Credit Spread" },
  { value: "pmcc", label: "PMCC / LEAPS Coverage" },
  { value: "long_call", label: "Long Call / LEAPS" },
  { value: "long_put", label: "Long Put" },
  { value: "short_put", label: "Short Put" },
  { value: "custom", label: "Custom" }
];

function labelPositionLeg(position: PortfolioProfile["positions"][number]): string {
  const symbol = position.symbol?.toUpperCase() ?? "";
  const side = position.side ?? "";
  const qty = position.qty ?? 0;
  const type = position.instrumentType ?? "";

  if (type === "stock") {
    return `${symbol} ${side} ${qty} shares`;
  }

  return [
    symbol,
    side,
    qty,
    position.expiration ?? "no exp",
    typeof position.strike === "number" ? `$${position.strike}` : "no strike",
    type.toUpperCase()
  ].join(" · ");
}

function makeManualGroupId(ticker: string): string {
  return `${ticker.toUpperCase()}-manual-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function cleanGroupsAgainstLegs(
  groups: UserPositionGroup[],
  validLegIds: Set<string>
): UserPositionGroup[] {
  return groups
    .map((group) => ({
      ...group,
      legIds: group.legIds.filter((legId) => validLegIds.has(legId)),
      userLocked: true
    }))
    .filter((group) => group.legIds.length > 0 || group.name.trim().length > 0);
}








function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function readNumberPath(source: any, path: string): number | null {
  const value = path.split(".").reduce((obj, part) => obj?.[part], source);
  return finiteNumber(value);
}

function readFirstNumber(source: any, paths: string[]): number | null {
  for (const path of paths) {
    const value = readNumberPath(source, path);
    if (value != null) return value;
  }
  return null;
}

function readFirstText(source: any, paths: string[]): string | null {
  for (const path of paths) {
    const value = path.split(".").reduce((obj, part) => obj?.[part], source);
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function proximityScore(price?: number | null, level?: number | null): number {
  if (!price || !level || !Number.isFinite(price) || !Number.isFinite(level)) return 50;
  const distancePct = Math.abs(price - level) / Math.max(1, Math.abs(price));
  return clampScore(100 - distancePct * 450);
}

function compressionScore(compressionState?: string): number {
  const state = String(compressionState ?? "").toLowerCase();
  if (state.includes("high")) return 90;
  if (state.includes("moderate")) return 68;
  if (state.includes("low")) return 35;
  if (state.includes("open")) return 30;
  return 50;
}

function buildWheelDealerReadout(args: {
  dealerPressure: any;
  edgeSummary: any;
  wallMigration: any;
  spot: number;
}) {
  const { dealerPressure, edgeSummary, wallMigration, spot } = args;

  const pinFromDealer = readFirstNumber(dealerPressure, [
    "pinRisk",
    "pinRiskScore",
    "pinScore",
    "scores.pinRisk",
    "scores.pin",
    "risk.pin",
    "pin",
  ]);

  const snapFromDealer = readFirstNumber(dealerPressure, [
    "snapRisk",
    "snapRiskScore",
    "snapScore",
    "scores.snapRisk",
    "scores.snap",
    "risk.snap",
    "snap",
  ]);

  const gammaFromDealer = readFirstNumber(dealerPressure, [
    "gammaConcentration",
    "gammaConcentrationScore",
    "gammaScore",
    "scores.gammaConcentration",
    "scores.gamma",
    "gamma",
  ]);

  const confidenceFromDealer = readFirstNumber(dealerPressure, [
    "confidence",
    "confidenceScore",
    "modelScore",
    "scores.confidence",
    "score",
  ]);

  const support = finiteNumber(edgeSummary?.support ?? wallMigration?.currentSupport);
  const resistance = finiteNumber(edgeSummary?.resistance ?? wallMigration?.currentResistance);
  const magnet = finiteNumber(edgeSummary?.magnet ?? wallMigration?.currentMagnet);

  const magnetProximity = proximityScore(spot, magnet);
  const supportProximity = proximityScore(spot, support);
  const resistanceProximity = proximityScore(spot, resistance);
  const railProximity = Math.max(supportProximity, resistanceProximity);

  const pinSnap = finiteNumber(edgeSummary?.pinSnapRiskScore) ?? 50;
  const trap = finiteNumber(edgeSummary?.trapRisk) ?? 50;
  const compression = compressionScore(edgeSummary?.compressionState);
  const supportEvidence = finiteNumber(edgeSummary?.supportEvidenceScore) ?? 50;
  const resistanceEvidence = finiteNumber(edgeSummary?.resistanceEvidenceScore) ?? 50;
  const priceConfluence = finiteNumber(edgeSummary?.priceConfluenceScore) ?? 50;
  const dataQuality = finiteNumber(edgeSummary?.dataQualityScore) ?? 60;
  const edgeScore = finiteNumber(edgeSummary?.edgeScore) ?? 50;

  const pinRisk =
    pinFromDealer ??
    clampScore(pinSnap * 0.46 + compression * 0.28 + magnetProximity * 0.26);

  const snapRisk =
    snapFromDealer ??
    clampScore(trap * 0.42 + railProximity * 0.33 + Math.max(0, 100 - pinRisk) * 0.25);

  const gammaConcentration =
    gammaFromDealer ??
    clampScore(Math.max(supportEvidence, resistanceEvidence) * 0.45 + priceConfluence * 0.35 + compression * 0.2);

  const confidence =
    confidenceFromDealer ??
    clampScore(dataQuality * 0.45 + edgeScore * 0.35 + (100 - Math.min(45, Math.abs(pinRisk - snapRisk))) * 0.2);

  const dealerPressureBias = readFirstText(dealerPressure, [
    "pressureBias",
    "bias",
    "dealerPressureBias",
    "summary.pressureBias",
  ]);

  const pressureBias =
    dealerPressureBias ??
    (Math.abs(pinRisk - snapRisk) < 8
      ? "conflict"
      : pinRisk >= snapRisk
        ? "pinning"
        : "snap / rail risk");

  const dealerRegime = readFirstText(dealerPressure, ["regime", "gammaRegime", "summary.regime"]);
  const regime =
    dealerRegime ??
    (pinRisk >= 65 && pinRisk >= snapRisk
      ? "Volatility suppression / pinning"
      : snapRisk >= 65
        ? "Expansion / snap risk"
        : "Neutral / mixed");

  const modelScore = readFirstNumber(dealerPressure, ["modelScore", "score", "scores.modelScore"]) ?? confidence;

  return {
    pinRisk,
    snapRisk,
    gammaConcentration,
    confidence,
    railProximity,
    modelScore,
    pressureBias,
    regime,
  };
}


export default function WheelWorkspacePage() {
  const [mounted, setMounted] = useState(false);
  const [ticker, setTicker] = useState("SOFI");
  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlTicker = new URLSearchParams(window.location.search).get("ticker")?.trim().toUpperCase();
    if (urlTicker) setTicker(urlTicker);
  }, []);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [surfaceSnapshot, setSurfaceSnapshot] = useState<OptionSurfaceSnapshot | null>(null);
  const [allSurfaceSnapshots, setAllSurfaceSnapshots] = useState<OptionSurfaceSnapshot[]>([]);
  const [surfaceStatus, setSurfaceStatus] = useState("");
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [manualGroups, setManualGroups] = useState<UserPositionGroup[]>([]);
  const [showGroupEditor, setShowGroupEditor] = useState(false);
    

  const structure = useMemo(() => getSurfaceStructure(surfaceSnapshot),[surfaceSnapshot]);
  const spot = useMemo(() => getSurfaceSpot(surfaceSnapshot),[surfaceSnapshot]);  

 const acceptSuggestedGrouping = () => {
if (!selectedProfile?.id || !ticker) return;

saveUserPositionGroups(selectedProfile.id, ticker, suggestedUserGroups);
setManualGroups(suggestedUserGroups);
};

const resetManualGrouping = () => {
if (!selectedProfile?.id || !ticker) return;

clearUserPositionGroups(selectedProfile.id, ticker);
setManualGroups([]);
};

async function loadSupabaseSurface(nextTicker = ticker) {
  const normalized = normalizeTicker(nextTicker);
  if (!normalized) return;

  setSurfaceLoading(true);
  setSurfaceStatus(`Loading ${normalized} OI surface from Supabase...`);

  try {
    const snapshots = await fetchSupabaseSurfaces(normalized);
    setAllSurfaceSnapshots(snapshots);
    setSurfaceSnapshot(snapshots[0] ?? null);
    setSurfaceStatus(
      snapshots[0]
        ? `Loaded ${snapshots.length} Supabase surface(s) for ${normalized}. Latest: ${snapshots[0].snapshotDate}.`
        : `No Supabase OI surface found for ${normalized}. Run Dashboard Harvest first.`
    );
  } catch (error: any) {
    setAllSurfaceSnapshots([]);
    setSurfaceSnapshot(null);
    setSurfaceStatus(error?.message ?? `Failed to load Supabase surface for ${normalized}.`);
  } finally {
    setSurfaceLoading(false);
  }
}


  



    
  useEffect(() => {
    setMounted(true);

    const savedTicker = window.localStorage.getItem(SELECTED_TICKER_STORAGE_KEY);
    const startingTicker = savedTicker || "SOFI";
    setTicker(startingTicker);

    const loadedProfiles = listPortfolioProfiles();
    setProfiles(loadedProfiles);

    const savedProfileId = window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
    const activeProfile =
      savedProfileId && loadedProfiles.some((p) => p.id === savedProfileId)
        ? savedProfileId
        : loadedProfiles[0]?.id ?? "";

    setSelectedProfileId(activeProfile);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const normalized = normalizeTicker(ticker);
    window.localStorage.setItem(SELECTED_TICKER_STORAGE_KEY, normalized);
    void loadSupabaseSurface(normalized);
  }, [ticker, mounted]);

  useEffect(() => {
    if (!mounted || !selectedProfileId) return;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, selectedProfileId);
  }, [selectedProfileId, mounted]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

 useEffect(() => {
     if (!selectedProfile?.id || !ticker) {
         setManualGroups([]);
         return;
     }
     setManualGroups(readUserPositionGroups(selectedProfile.id, ticker));
 }, [selectedProfile?.id, ticker]);


    
  const hasTickerPosition = selectedProfile?.positions?.some(
  (p) => p.symbol?.toUpperCase() === ticker.toUpperCase()
  );    

  const groupedPositions = useMemo(() => {
      return groupTickerPositions(ticker, selectedProfile?.positions ?? []);
  }, [ticker, selectedProfile]);


    
  const suggestedUserGroups = useMemo(() => {
    return buildSuggestedUserPositionGroups(ticker, selectedProfile?.positions ?? []);
}, [ticker, selectedProfile]);

const activeUserGroups = useMemo(() => {
    return manualGroups.length ? manualGroups : suggestedUserGroups;
}, [manualGroups, suggestedUserGroups]);

const groupingMode = manualGroups.length ? "Manual" : "Suggested";

const tickerPositionLegs = useMemo(() => {
  return (selectedProfile?.positions ?? [])
    .filter((position) => position.symbol?.toUpperCase() === ticker.toUpperCase())
    .map((position) => ({
      position,
      legId: makePositionLegId(position),
      label: labelPositionLeg(position)
    }));
}, [selectedProfile, ticker]);

const validTickerLegIds = useMemo(() => {
  return new Set(tickerPositionLegs.map((leg) => leg.legId));
}, [tickerPositionLegs]);

const activeManualGroups = useMemo(() => {
  return cleanGroupsAgainstLegs(manualGroups, validTickerLegIds);
}, [manualGroups, validTickerLegIds]);

const assignedLegIds = useMemo(() => {
  return new Set(activeManualGroups.flatMap((group) => group.legIds));
}, [activeManualGroups]);

const unassignedTickerLegs = useMemo(() => {
  return tickerPositionLegs.filter((leg) => !assignedLegIds.has(leg.legId));
}, [tickerPositionLegs, assignedLegIds]);

function persistManualGroups(nextGroups: UserPositionGroup[]) {
  if (!selectedProfile?.id || !ticker) return;

  const cleaned = cleanGroupsAgainstLegs(nextGroups, validTickerLegIds);
  saveUserPositionGroups(selectedProfile.id, ticker, cleaned);
  setManualGroups(cleaned);
}

function createManualGroup() {
  const firstUnassignedLeg = unassignedTickerLegs[0];

  const nextGroup: UserPositionGroup = {
    id: makeManualGroupId(ticker),
    name: firstUnassignedLeg
      ? `${ticker.toUpperCase()} manual group`
      : `${ticker.toUpperCase()} empty group`,
    strategyType: "custom",
    legIds: firstUnassignedLeg ? [firstUnassignedLeg.legId] : [],
    notes: "",
    userLocked: true
  };

  persistManualGroups([...activeManualGroups, nextGroup]);
}

function updateManualGroup(
  groupId: string,
  patch: Partial<Pick<UserPositionGroup, "name" | "strategyType" | "notes">>
) {
  persistManualGroups(
    activeManualGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            ...patch,
            userLocked: true
          }
        : group
    )
  );
}

function deleteManualGroup(groupId: string) {
  persistManualGroups(activeManualGroups.filter((group) => group.id !== groupId));
}

function toggleLegInManualGroup(groupId: string, legId: string) {
  persistManualGroups(
    activeManualGroups.map((group) => {
      if (group.id !== groupId) return group;

      const hasLeg = group.legIds.includes(legId);

      return {
        ...group,
        legIds: hasLeg
          ? group.legIds.filter((existingLegId) => existingLegId !== legId)
          : [...group.legIds, legId],
        userLocked: true
      };
    })
  );
}

function moveLegToManualGroup(groupId: string, legId: string) {
  persistManualGroups(
    activeManualGroups.map((group) => {
      const withoutLeg = group.legIds.filter((existingLegId) => existingLegId !== legId);

      if (group.id !== groupId) {
        return {
          ...group,
          legIds: withoutLeg,
          userLocked: true
        };
      }

      return {
        ...group,
        legIds: Array.from(new Set([...withoutLeg, legId])),
        userLocked: true
      };
    })
  );
}


    
 function positionKeyForUi(position: {
symbol?: string;
instrumentType?: string;
side?: string;
qty?: number;
strike?: number;
expiration?: string;
}) {
return [
position.symbol ?? "",
position.instrumentType ?? "",
position.side ?? "",
position.qty ?? "",
position.strike ?? "",
position.expiration ?? "",
Math.random().toString(36).slice(2)
].join("-");
}

  


    
  const decision = useMemo(() => {
    return buildWheelWorkspaceDecision({
      ticker,
      profile: selectedProfile,
      structure,
      spot
    });
  }, [ticker, selectedProfile, structure, spot]);

  const edgeCandles = useMemo<CandleRecord[]>(() => {
    if (!ticker) return [];
    return readCandles(ticker);
  }, [ticker, surfaceSnapshot?.snapshotDate]);

  const edgeSummary = useMemo(() => {
    if (!surfaceSnapshot) return null;
    return buildTraderEdgeSummary({
      ticker,
      surface: surfaceSnapshot,
      candles: edgeCandles,
      livePrice: spot || null
    });
  }, [ticker, surfaceSnapshot, edgeCandles, spot]);

  const wallMigration = useMemo(() => {
    if (!surfaceSnapshot) return null;
    const priorSurface = findPriorSurfaceForTicker(allSurfaceSnapshots, ticker, surfaceSnapshot.snapshotDate);
    return buildWallMigrationSummary({ currentSurface: surfaceSnapshot, priorSurface });
  }, [ticker, surfaceSnapshot, allSurfaceSnapshots]);
  
  const dealerPressure = useMemo(() => {
  return buildDealerPressureSummary({
    surface: surfaceSnapshot,
    edge: edgeSummary,
    wallMigration: wallMigration,
    candles: edgeCandles,
    livePrice: spot,
  });
}, [
  surfaceSnapshot,
  edgeSummary,
  wallMigration,
  edgeCandles,
  spot,
]);
    

  const dealerReadout = useMemo(() => {
    return buildWheelDealerReadout({
      dealerPressure,
      edgeSummary,
      wallMigration,
      spot,
    });
  }, [dealerPressure, edgeSummary, wallMigration, spot]);

  const actionSummary = useMemo(() => {
    return buildActionSummary({ ticker, decision, edge: edgeSummary });
  }, [ticker, decision, edgeSummary]);

  if (!mounted) return null;

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), #020b14",
      }}
    >
      <WheelDeskSideNav active="wheel" />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: "1.1rem 1.4rem 2rem",
          display: "grid",
          gap: "1rem",
          alignContent: "start",
          color: wheelColors.text,
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                color: wheelColors.teal,
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              WheelDesk
            </div>
            <h1 style={{ margin: 0, color: wheelColors.text, letterSpacing: "-0.04em" }}>
              Wheel Workspace
            </h1>
            <p style={{ margin: "0.35rem 0 0", color: wheelColors.muted, fontSize: 13 }}>
              Supabase-driven wheel management for the selected ticker and portfolio profile.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="/dashboard" style={wheelStyles.topLink}>Dashboard Harvest</a>
            <a href={`/control-center?ticker=${encodeURIComponent(ticker)}`} style={wheelStyles.topLink}>Control Center</a>
            <button
              type="button"
              onClick={() => void loadSupabaseSurface(ticker)}
              disabled={surfaceLoading}
              style={wheelStyles.topButton}
            >
              {surfaceLoading ? "Loading..." : "Reload Supabase Surface"}
            </button>
          </div>
        </header>

      <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "0.9rem", background: wheelColors.panel }}>
        <h3 style={wheelStyles.sectionTitle}>Controls</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem", alignItems: "end" }}>
          <label style={wheelStyles.fieldLabel}>
            Ticker
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.trim().toUpperCase())}
              style={wheelStyles.input}
            />
          </label>

          <label style={wheelStyles.fieldLabel}>
            Portfolio
            <select
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              style={wheelStyles.input}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ color: wheelColors.muted }}>
           <strong style={{ color: wheelColors.text }}>Supabase Surface:</strong>{" "}
{surfaceSnapshot
? `${surfaceSnapshot.snapshotDate} · ${surfaceSnapshot.chains?.length ?? 0} chains`
: "No OI surface snapshot saved"}
           
          </div>
        </div>
        {selectedProfile && !hasTickerPosition && (
          <p style={{ color: wheelColors.amber }}>
            Selected portfolio has no {ticker} position. Wheel decision is structure-only.
          </p>
        )}  


        {!surfaceSnapshot && (
          <p style={{ color: wheelColors.amber, marginBottom: 0 }}>
            No Supabase OI surface found for {ticker}. Go to Dashboard Harvest, fetch the option chain, then save the surface to Supabase.
          </p>
        )}
      </section>

      <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "1rem", background: wheelColors.panel }}>
        <h3 style={wheelStyles.sectionTitle}>Action Summary</h3>

        <div style={{ fontSize: 24, fontWeight: 800, color: primaryActionColor(decision.action, decision.state) }}>
          {primaryActionLabel(decision.action, decision.state)}
        </div>

        <ul style={{ marginBottom: 0 }}>
          {actionSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {edgeSummary && (
        <section
          style={{
            border: `1px solid ${wheelColors.border}`,
            borderRadius: 12,
            padding: "1rem",
            background:
              "linear-gradient(180deg, rgba(7, 21, 35, 0.92), rgba(7, 21, 35, 0.76))",
            display: "grid",
            gap: "0.9rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ color: wheelColors.teal, fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                WheelDesk Action Center
              </div>
              <h3 style={{ ...wheelStyles.sectionTitle, marginBottom: 4 }}>Trade posture from OI + portfolio context</h3>
              <p style={{ ...wheelStyles.muted, margin: 0, fontSize: 13 }}>
                Saved Supabase surface, Trader Edge, snapped wheel strikes, wall migration, dealer pressure proxy, and current position exposure.
              </p>
            </div>

            <div
              style={{
                border: `1px solid ${scoreColor(edgeSummary.edgeScore)}55`,
                background: "rgba(2, 11, 20, 0.65)",
                borderRadius: 12,
                padding: "0.75rem 1rem",
                minWidth: 150,
                textAlign: "right",
              }}
            >
              <div style={{ color: scoreColor(edgeSummary.edgeScore), fontSize: 28, fontWeight: 950, lineHeight: 1 }}>
                {edgeSummary.edgeScore.toFixed(1)}
              </div>
              <div style={{ color: wheelColors.muted, fontSize: 11, marginTop: 4, fontWeight: 900, textTransform: "uppercase" }}>
                Dominant Edge / 100
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.95fr 0.95fr",
              gap: "0.75rem",
              alignItems: "stretch",
            }}
          >
            <div style={wheelStyles.commandCard}>
              <div style={wheelStyles.cardKicker}>Current action</div>
              <div style={{ color: wheelColors.amber, fontSize: 20, fontWeight: 950 }}>
                {edgeSummary.actionBucket}
              </div>
              <p style={{ ...wheelStyles.muted, margin: "0.45rem 0 0", lineHeight: 1.45 }}>
                {edgeSummary.bestAction}
              </p>
            </div>

            <div style={wheelStyles.commandCard}>
              <div style={wheelStyles.cardKicker}>Covered-call zone</div>
              <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                <span><strong>Resistance:</strong> {money(edgeSummary.resistance)}</span>
                <span><strong>Cushion target:</strong> {money(edgeSummary.coveredCallCushionTarget)}</span>
                <span style={{ color: wheelColors.amber, fontWeight: 950 }}>Sell at/above {money(edgeSummary.executableCoveredCallFloor)}</span>
              </div>
            </div>

            <div style={wheelStyles.commandCard}>
              <div style={wheelStyles.cardKicker}>CSP zone</div>
              <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                <span><strong>Support:</strong> {money(edgeSummary.support)}</span>
                <span><strong>Cushion target:</strong> {money(edgeSummary.cspCushionTarget)}</span>
                <span style={{ color: wheelColors.green, fontWeight: 950 }}>Sell at/below {money(edgeSummary.executableCspCeiling)}</span>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
              gap: "0.6rem",
            }}
          >
            <div style={wheelStyles.signalTile}>
              <span>Regime</span>
              <strong>{edgeSummary.regime}</strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>Compression</span>
              <strong>{edgeSummary.compressionState}</strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>Chart Bias</span>
              <strong style={{ color: edgeSummary.chartBias === "bullish" ? wheelColors.green : edgeSummary.chartBias === "bearish" ? wheelColors.red : wheelColors.text }}>
                {edgeSummary.chartBias.toUpperCase()}
              </strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>Options Bias</span>
              <strong style={{ color: edgeSummary.optionsBias === "bullish" ? wheelColors.green : edgeSummary.optionsBias === "bearish" ? wheelColors.red : wheelColors.text }}>
                {edgeSummary.optionsBias.toUpperCase()}
              </strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>Trap Risk</span>
              <strong style={{ color: edgeSummary.trapRisk >= 70 ? wheelColors.red : edgeSummary.trapRisk >= 50 ? wheelColors.amber : wheelColors.green }}>
                {edgeSummary.trapRisk.toFixed(0)}
              </strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>Data Quality</span>
              <strong style={{ color: edgeSummary.dataQualityScore >= 70 ? wheelColors.green : wheelColors.amber }}>
                {edgeSummary.dataQualityScore.toFixed(0)}
              </strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>ATR</span>
              <strong>{pct(edgeSummary.atrPct)}</strong>
            </div>
            <div style={wheelStyles.signalTile}>
              <span>Premium Proxy</span>
              <strong>{edgeSummary.premiumProxyScore.toFixed(0)}</strong>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
              alignItems: "stretch",
            }}
          >
            <div style={wheelStyles.detailPanel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
                <h4 style={{ margin: 0, color: wheelColors.text }}>Wall Migration</h4>
                <span style={{ color: wheelColors.muted, fontSize: 12 }}>{wallMigration?.priorDate ?? "No prior surface"}</span>
              </div>
              <p style={{ ...wheelStyles.muted, margin: "0.35rem 0 0", lineHeight: 1.45 }}>
                <strong style={{ color: wheelColors.text }}>{wallMigration?.label ?? "No prior wall comparison"}</strong>
                {" — "}
                {wallMigration?.interpretation ?? "Save another daily surface to compare wall movement."}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.55rem", marginTop: "0.75rem" }}>
                <div style={wheelStyles.microTile}><span>Put wall</span><strong>{money(wallMigration?.priorSupport)} → {money(wallMigration?.currentSupport)}</strong></div>
                <div style={wheelStyles.microTile}><span>Call wall</span><strong>{money(wallMigration?.priorResistance)} → {money(wallMigration?.currentResistance)}</strong></div>
                <div style={wheelStyles.microTile}><span>Magnet</span><strong>{money(wallMigration?.priorMagnet)} → {money(wallMigration?.currentMagnet)}</strong></div>
              </div>
            </div>

            <div style={wheelStyles.detailPanel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
                <h4 style={{ margin: 0, color: wheelColors.text }}>Dealer Pressure / Gamma Regime</h4>
                <span style={{ color: wheelColors.muted, fontSize: 12 }}>Proxy read</span>
              </div>
              <p style={{ ...wheelStyles.muted, margin: "0.35rem 0 0", lineHeight: 1.45 }}>
                Dealer-pressure proxy from saved OI structure. Pin, snap, gamma, and confidence are derived from Trader Edge, wall levels, rail proximity, compression, trap risk, and data quality when the dealer engine does not expose a direct field.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0.55rem", marginTop: "0.75rem" }}>
                <div style={wheelStyles.microTile}><span>Pin</span><strong style={{ color: wheelColors.amber }}>{dealerReadout.pinRisk.toFixed(0)}</strong></div>
                <div style={wheelStyles.microTile}><span>Snap</span><strong style={{ color: wheelColors.green }}>{dealerReadout.snapRisk.toFixed(0)}</strong></div>
                <div style={wheelStyles.microTile}><span>Gamma</span><strong style={{ color: wheelColors.red }}>{dealerReadout.gammaConcentration.toFixed(0)}</strong></div>
                <div style={wheelStyles.microTile}><span>Confidence</span><strong style={{ color: wheelColors.teal }}>{dealerReadout.confidence.toFixed(0)}</strong></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0.55rem", marginTop: "0.55rem" }}>
                <div style={wheelStyles.microTile}><span>Pressure bias</span><strong>{dealerReadout.pressureBias}</strong></div>
                <div style={wheelStyles.microTile}><span>Regime</span><strong>{dealerReadout.regime}</strong></div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
            }}
          >
            <div style={wheelStyles.detailPanel}>
              <h4 style={{ margin: 0, color: wheelColors.text }}>Trap Detector</h4>
              <ul style={{ margin: "0.5rem 0 0", color: wheelColors.muted, lineHeight: 1.45 }}>
                {edgeSummary.trapNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
            <div style={wheelStyles.detailPanel}>
              <h4 style={{ margin: 0, color: wheelColors.text }}>Trigger Map</h4>
              <ul style={{ margin: "0.5rem 0 0", color: wheelColors.muted, lineHeight: 1.45 }}>
                {edgeSummary.triggerNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "1rem", background: wheelColors.panel }}>
        <h3 style={wheelStyles.sectionTitle}>Wheel Decision</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.75rem", fontSize: 14 }}>
          <div><strong>State:</strong><br />{decision.state.replaceAll("_", " ")}</div>
          <div><strong>Bias:</strong><br />{decision.bias?.toUpperCase()} / {decision.confidence}</div>
          <div><strong>Spot:</strong><br />{fmt(decision.spot)}</div>
          <div><strong>Shares:</strong><br />{decision.shares.toLocaleString()}</div>
          <div><strong>Max CC Contracts:</strong><br />{decision.maxCoveredCallContracts}</div>
        </div>

        <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem" }}>
          <div style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 6, padding: "0.75rem" }}>
            <strong>Support</strong>
            <div>{fmt(edgeSummary?.support ?? decision.support)}</div>
          </div>
          <div style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 6, padding: "0.75rem" }}>
            <strong>OI Magnet</strong>
            <div>{fmt(edgeSummary?.magnet ?? decision.magnet)}</div>
          </div>
          <div style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 6, padding: "0.75rem" }}>
            <strong>Resistance</strong>
            <div>{fmt(edgeSummary?.resistance ?? decision.resistance)}</div>
          </div>
        </div>
      </section>




<section
style={{
border: `1px solid ${wheelColors.border}`,
borderRadius: 8,
background: wheelColors.panel,
padding: "0.9rem"
}}
>
<h3 style={wheelStyles.sectionTitle}>Position Context</h3>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(7,minmax(0,1fr))",
gap: "0.75rem",
fontSize: 13
}}
>
<div>
<strong>Shares</strong>
<br />
{groupedPositions.shares.toLocaleString()}
</div>

<div>
<strong>Share Lots</strong>
<br />
{groupedPositions.shareLots}
</div>

<div>
<strong>Long Call Lots</strong>
<br />
{groupedPositions.longCallLots}
</div>

<div>
<strong>Short Call Lots</strong>
<br />
{groupedPositions.shortCallLots}
</div>

<div>
<strong>Short Puts</strong>
<br />
{groupedPositions.shortPutLots}
</div>

<div>
<strong>Total Call Capacity</strong>
<br />
{groupedPositions.totalCallSideCapacity}
</div>

<div>
<strong>Remaining Capacity</strong>
<br />
{groupedPositions.remainingCallSideCapacity}
</div>
</div>
</section>

     <section
  style={{
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 8,
    background: wheelColors.panel,
    padding: "0.9rem"
  }}
>
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "1rem"
    }}
  >
    <div>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Position Grouping</h3>
      <p style={{ marginTop: 0, color: wheelColors.amber }}>
        Mode: <strong>{groupingMode}</strong>. Groups are user-controlled. Suggested grouping is only advisory.
      </p>
    </div>

    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      <button type="button" onClick={createManualGroup}>
        Add Manual Group
      </button>

      <button type="button" onClick={acceptSuggestedGrouping}>
        Accept Suggested Groups
      </button>

      <button type="button" onClick={resetManualGrouping} disabled={!manualGroups.length}>
        Reset Manual Grouping
      </button>
    </div>
  </div>

  <div
    style={{
      marginTop: "0.75rem",
      border: `1px solid ${wheelColors.border}`,
      borderRadius: 6,
      padding: "0.75rem",
      background: wheelColors.panelSolid
    }}
  >
    <strong>Suggested optimized grouping</strong>
    <div style={{ fontSize: 13, color: wheelColors.muted, marginTop: 4 }}>
      {groupedPositions.debug.capacityFormula}
    </div>
    <div style={{ fontSize: 13, color: wheelColors.muted, marginTop: 4 }}>
      This is the optimizer view only. Manual groups below should control how the user wants positions managed.
    </div>
  </div>

  <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
      <h4 style={{ margin: 0 }}>Group Summary</h4>
      <button type="button" onClick={() => setShowGroupEditor((value) => !value)}>
        {showGroupEditor ? "Hide Group Editor" : "Edit Groups"}
      </button>
    </div>

    {(activeManualGroups.length ? activeManualGroups : suggestedUserGroups).length === 0 ? (
      <p style={{ color: wheelColors.muted, marginBottom: 0 }}>No groups available yet.</p>
    ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0.75rem" }}>
        {(activeManualGroups.length ? activeManualGroups : suggestedUserGroups).map((group) => (
          <div key={`summary-${group.id}`} style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 6, padding: "0.75rem", background: wheelColors.panel }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <strong>{group.name}</strong>
              <span style={{ color: wheelColors.muted }}>{groupTypeLabel(group.strategyType)}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 13 }}>{summarizeGroup(group, tickerPositionLegs)}</div>
            {group.notes && <div style={{ marginTop: 4, fontSize: 12, color: wheelColors.muted }}>{group.notes}</div>}
          </div>
        ))}
      </div>
    )}

    {showGroupEditor && (
      <>
    <h4 style={{ margin: 0 }}>Manual Groups</h4>

    {activeManualGroups.length === 0 ? (
      <p style={{ color: wheelColors.muted, marginBottom: 0 }}>
        No manual groups saved. Click <strong>Add Manual Group</strong> or accept the suggested groups as a starting point.
      </p>
    ) : (
      activeManualGroups.map((group) => (
        <div
          key={group.id}
          style={{
            border: `1px solid ${wheelColors.border}`,
            borderRadius: 6,
            padding: "0.75rem",
            background: wheelColors.panel,
            display: "grid",
            gap: "0.75rem"
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr auto",
              gap: "0.75rem",
              alignItems: "end"
            }}
          >
            <label>
              Group Name
              <input
                value={group.name}
                onChange={(event) =>
                  updateManualGroup(group.id, {
                    name: event.target.value
                  })
                }
                style={{ width: "100%" }}
              />
            </label>

            <label>
              Strategy
              <select
                value={group.strategyType}
                onChange={(event) =>
                  updateManualGroup(group.id, {
                    strategyType: event.target.value as UserPositionGroupType
                  })
                }
                style={{ width: "100%" }}
              >
                {GROUP_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" onClick={() => deleteManualGroup(group.id)}>
              Delete
            </button>
          </div>

          <label>
            Notes
            <textarea
              value={group.notes ?? ""}
              onChange={(event) =>
                updateManualGroup(group.id, {
                  notes: event.target.value
                })
              }
              rows={2}
              style={{ width: "100%" }}
              placeholder="Example: Use these LEAPS as synthetic coverage before selling more calls."
            />
          </label>

          <div>
            <strong>Assigned Legs</strong>

            {tickerPositionLegs.length === 0 ? (
              <p style={{ color: wheelColors.muted }}>No {ticker} legs exist in this portfolio.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                {tickerPositionLegs.map((leg) => {
                  const checked = group.legIds.includes(leg.legId);
                  const assignedToAnotherGroup =
                    !checked &&
                    activeManualGroups.some(
                      (otherGroup) =>
                        otherGroup.id !== group.id && otherGroup.legIds.includes(leg.legId)
                    );

                  return (
                    <label
                      key={`${group.id}-${leg.legId}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: 13,
                        color: assignedToAnotherGroup ? "#6b7280" : "#111827"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (assignedToAnotherGroup) {
                            moveLegToManualGroup(group.id, leg.legId);
                          } else {
                            toggleLegInManualGroup(group.id, leg.legId);
                          }
                        }}
                      />
                      <span>{leg.label}</span>
                      {assignedToAnotherGroup && (
                        <span style={{ color: wheelColors.amber }}>
                          assigned elsewhere — checking will move it here
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ fontSize: 13, color: wheelColors.muted }}>
            Legs in group: <strong>{group.legIds.length}</strong>
          </div>
        </div>
      ))
    )}

      </>
    )}

  <div
    style={{
      marginTop: "1rem",
      border: `1px solid ${wheelColors.border}`,
      borderRadius: 6,
      padding: "0.75rem",
      background: wheelColors.panel
    }}
  >
    <strong>Unassigned {ticker.toUpperCase()} Legs</strong>

    {unassignedTickerLegs.length === 0 ? (
      <p style={{ color: "#15803d", marginBottom: 0 }}>
        All current {ticker.toUpperCase()} legs are assigned to a manual group.
      </p>
    ) : (
      <ul style={{ marginBottom: 0 }}>
        {unassignedTickerLegs.map((leg) => (
          <li key={leg.legId}>{leg.label}</li>
        ))}
      </ul>
    )}
  </div>
  </div>
</section>
   


       
        <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "1rem", background: wheelColors.panel }}>
  <h3 style={{ marginTop: 0 }}>Existing Contract Management</h3>

  {decision.positionContext.managedLegs.length === 0 ? (
    <p style={{ color: wheelColors.muted, marginBottom: 0 }}>
      No existing {ticker} legs found in the selected portfolio.
    </p>
  ) : (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {decision.positionContext.managedLegs.map((leg) => (
        <div
          key={leg.id}
          style={{
            border: `1px solid ${wheelColors.border}`,
            borderRadius: 6,
            padding: "0.75rem",
            background: wheelColors.panel
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.5rem", fontSize: 13 }}>
            <div><strong>Leg</strong><div>{leg.type.replaceAll("_", " ")}</div></div>
            <div><strong>Qty</strong><div>{leg.qty}</div></div>
            <div><strong>Strike</strong><div>{fmt(leg.strike)}</div></div>
            <div><strong>Expiration</strong><div>{leg.expiration}</div></div>
            <div><strong>Dist. to Spot</strong><div>{pct(leg.distanceToSpotPct)}</div></div>
            <div>
              <strong>Status</strong>
              <div style={{ color: statusColor(leg.status), fontWeight: 700 }}>
                {leg.status.toUpperCase()}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0.5rem", fontSize: 12 }}>
            <div>Distance to Support: {pct(leg.distanceToSupportPct)}</div>
            <div>Distance to Resistance: {pct(leg.distanceToResistancePct)}</div>
          </div>

          <ul style={{ marginBottom: 0 }}>
            {leg.guidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {buildLegEdgeNotes(leg, edgeSummary).map((line) => (
              <li key={line} style={{ color: wheelColors.amber, fontWeight: 600 }}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )}
</section>

        

      <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "1rem", background: wheelColors.panel }}>
        <h3 style={{ marginTop: 0 }}>
          {decision.action === "avoid_new_trade" || decision.action === "wait" ? "Reference Zones" : "Strike Zones"}
        </h3>

        {(decision.action === "avoid_new_trade" || decision.action === "wait") && (
          <p style={{ color: wheelColors.amber }}>
            These are reference levels only. Current action does not recommend adding new exposure.
          </p>
        )}
        <p style={{ color: wheelColors.muted, fontSize: 13 }}>
          Surface-wide reference zones from the saved OI surface. Confirm the exact expiration, premium, liquidity, and assignment/call-away intent before placing an order.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <h4>Cash-Secured Put Zone</h4>
            <p style={{ fontSize: 22, fontWeight: 700, color: wheelColors.teal }}>{decision.cspZone}</p>
            <p>Use near support when structure is stable, bullish, or support is rising.</p>
          </div>

          <div>
            <h4>Covered Call Zone</h4>
            <p style={{ fontSize: 22, fontWeight: 700, color: wheelColors.red }}>{decision.coveredCallZone}</p>
            <p>Use near resistance when price approaches capped upside or when full coverage is acceptable.</p>
          </div>
        </div>
      </section>

      <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "1rem", background: wheelColors.panel }}>
        <h3 style={wheelStyles.sectionTitle}>Trade Plan</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.75rem" }}>
          <div><strong>Type</strong><div>{decision.tradePlan.type}</div></div>
          <div><strong>Strike</strong><div>{fmt(decision.tradePlan.strike)}</div></div>
          <div><strong>Option Chain</strong><div>{decision.tradePlan.chain}</div></div>
          <div><strong>Contracts</strong><div>{decision.tradePlan.contracts}</div></div>
          <div><strong>Coverage</strong><div>{decision.tradePlan.coverage}</div></div>
          <div><strong>DTE Target</strong><div>{decision.tradePlan.dteTarget}</div></div>
          <div><strong>Gamma Pressure</strong><div>{decision.tradePlan.gammaPressure.toUpperCase()}</div></div>
          <div><strong>Structure Shift</strong><div>{decision.tradePlan.structureShift}</div></div>  
        </div>
        <h4>Roll Guidance</h4>
            <ul>
          {decision.tradePlan.rollGuidance.map((line) => (
            <li key={line}>{line}</li>
                          ))}
                </ul>

        <div style={{ marginTop: 12 }}>
          <strong>Expiration</strong>
          <div>{decision.tradePlan.expiration}</div>
        </div>

        <div style={{ marginTop: 12 }}>
          <strong>Reasoning</strong>
          <ul>
            {decision.tradePlan.reasoning.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section style={{ border: `1px solid ${wheelColors.border}`, borderRadius: 8, padding: "1rem", background: wheelColors.panel }}>
        <h3 style={wheelStyles.sectionTitle}>Readout</h3>
        <ul>
          {decision.readout.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <h4>Triggers</h4>
        <ul>
          {decision.triggers.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {decision.riskNotes.length > 0 && (
          <>
            <h4>Risk Notes</h4>
            <ul>
              {decision.riskNotes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      </div>
    </main>
  );
}


const wheelStyles: Record<string, any> = {
  topLink: {
    border: "1px solid #22d3ee55",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    textDecoration: "none",
    color: "#67e8f9",
    background: "#071523",
    fontWeight: 900,
  },
  topButton: {
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    color: wheelColors.text,
    background: "#071523",
    fontWeight: 900,
    cursor: "pointer",
  },
  fieldLabel: {
    display: "grid",
    gap: 4,
    color: wheelColors.muted,
    fontSize: 12,
    fontWeight: 900,
  },
  input: {
    width: "100%",
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 8,
    background: "#020b14",
    color: wheelColors.text,
    padding: "0.48rem 0.6rem",
    fontWeight: 800,
  },
  smallButton: {
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 8,
    background: "#071523",
    color: wheelColors.text,
    padding: "0.4rem 0.65rem",
    fontWeight: 900,
    cursor: "pointer",
  },
  sectionTitle: {
    marginTop: 0,
    color: wheelColors.text,
    letterSpacing: "-0.02em",
  },
  muted: {
    color: wheelColors.muted,
  },
  commandCard: {
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 10,
    background: "rgba(2, 11, 20, 0.48)",
    padding: "0.8rem",
    color: wheelColors.text,
  },
  cardKicker: {
    color: wheelColors.muted,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  signalTile: {
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 10,
    background: "rgba(2, 11, 20, 0.45)",
    padding: "0.65rem",
    display: "grid",
    gap: 4,
    minHeight: 72,
  },
  detailPanel: {
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 10,
    background: "rgba(2, 11, 20, 0.45)",
    padding: "0.85rem",
    color: wheelColors.text,
  },
  microTile: {
    border: `1px solid ${wheelColors.border}`,
    borderRadius: 8,
    background: "rgba(7, 21, 35, 0.65)",
    padding: "0.55rem",
    display: "grid",
    gap: 3,
    color: wheelColors.text,
    minWidth: 0,
  },
};

