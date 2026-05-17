"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readLatestOptionSurfaceSnapshot,
  readOptionSurfaceSnapshots,
  readCandles,
  type OptionSurfaceSnapshot,
  type CandleRecord
} from "../../../lib/wheeldesk-storage";

import type { DailyStructureSnapshot as WheelDailyStructureSnapshot } from "../../../lib/daily-structure-store";
import { listPortfolioProfiles } from "../../../lib/portfolio-store";
import { PortfolioProfile } from "../../../lib/portfolio-types";
import { summarizePortfolioCoverage } from "../../../lib/portfolio-coverage-engine";
import { positionsToPortfolioLegs } from "../../../lib/portfolio-leg-adapter";
import { buildWheelWorkspaceDecision, type ManagedWheelLeg } from "../../../lib/wheel-engine";
import DealerPressureCard from "../../../components/DealerPressureCard";
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

function latestSurface(ticker: string): OptionSurfaceSnapshot | null {
    return readLatestOptionSurfaceSnapshot(ticker);
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
  if (action === "avoid_new_trade") return "#b91c1c";
  if (action === "wait") return "#92400e";
  return "#111827";
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
  if (status === "defend") return "#b91c1c";
  if (status === "pressure") return "#c2410c";
  if (status === "watch") return "#92400e";
  return "#15803d";
}

function scoreColor(score?: number | null): string {
  if (score == null || !Number.isFinite(score)) return "#6b7280";
  if (score >= 75) return "#15803d";
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
    setSurfaceSnapshot(latestSurface(startingTicker));
  }, []);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(SELECTED_TICKER_STORAGE_KEY, ticker);
    setSurfaceSnapshot(latestSurface(ticker));
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
    const allSurfaces = readOptionSurfaceSnapshots(ticker);
    const priorSurface = findPriorSurfaceForTicker(allSurfaces, ticker, surfaceSnapshot.snapshotDate);
    return buildWallMigrationSummary({ currentSurface: surfaceSnapshot, priorSurface });
  }, [ticker, surfaceSnapshot]);
  
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
    

  const actionSummary = useMemo(() => {
    return buildActionSummary({ ticker, decision, edge: edgeSummary });
  }, [ticker, decision, edgeSummary]);

  if (!mounted) return null;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "1rem", display: "grid", gap: "1rem" }}>
      <h1 style={{ marginBottom: 0 }}>Wheel Workspace</h1>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "0.9rem", background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Controls</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem", alignItems: "end" }}>
          <label>
            Ticker
            <input value={ticker} onChange={(e) => setTicker(e.target.value.trim().toUpperCase())} />
          </label>

          <label>
            Portfolio
            <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <div>
           <strong>Surface Snapshot:</strong>{" "}
{surfaceSnapshot
? `${surfaceSnapshot.snapshotDate} · ${surfaceSnapshot.chains?.length ?? 0} chains`
: "No OI surface snapshot saved"}
           
          </div>
        </div>
        {selectedProfile && !hasTickerPosition && (
          <p style={{ color: "#92400e" }}>
            Selected portfolio has no {ticker} position. Wheel decision is structure-only.
          </p>
        )}  


        {!surfaceSnapshot && (
          <p style={{ color: "#b45309", marginBottom: 0 }}>
            No daily OI surface snapshot found for {ticker}. Go to Dashboard, fetch the option chain, then save snapshot.
          </p>
        )}
      </section>

      <section style={{ border: "1px solid #334155", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Action Summary</h3>

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
        <section style={{ border: "2px solid #f59e0b", borderRadius: 8, padding: "1rem", background: "#fffbeb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>WheelDesk Action Center</h3>
              <div style={{ fontSize: 13, color: "#4b5563" }}>
                Uses saved OI surface, scanner edge, snapped strikes, and this portfolio profile.
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: scoreColor(edgeSummary.edgeScore) }}>
                {edgeSummary.edgeScore.toFixed(1)} / 100
              </div>
              <div style={{ fontSize: 12 }}>Dominant Edge</div>
            </div>
          </div>

          <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "0.75rem" }}>
            <div style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
              <strong>{edgeSummary.actionBucket}</strong>
              <p style={{ margin: "0.35rem 0 0" }}>{edgeSummary.bestAction}</p>
            </div>
            <div style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
              <strong>Covered-call zone</strong>
              <div>Resistance: {money(edgeSummary.resistance)}</div>
              <div>Cushion target: {money(edgeSummary.coveredCallCushionTarget)}</div>
              <div><strong>Executable floor: {money(edgeSummary.executableCoveredCallFloor)}</strong></div>
            </div>
            <div style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
              <strong>CSP zone</strong>
              <div>Support: {money(edgeSummary.support)}</div>
              <div>Cushion target: {money(edgeSummary.cspCushionTarget)}</div>
              <div><strong>Executable ceiling: {money(edgeSummary.executableCspCeiling)}</strong></div>
            </div>
          </div>

          <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.5rem", fontSize: 12 }}>
            <div><strong>Regime</strong><br />{edgeSummary.regime}</div>
            <div><strong>Compression</strong><br />{edgeSummary.compressionState}</div>
            <div><strong>Chart Bias</strong><br />{edgeSummary.chartBias.toUpperCase()}</div>
            <div><strong>Options Bias</strong><br />{edgeSummary.optionsBias.toUpperCase()}</div>
            <div><strong>Trap Risk</strong><br />{edgeSummary.trapRisk}</div>
            <div><strong>Data Quality</strong><br />{edgeSummary.dataQualityScore}</div>
          </div>

          <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0.5rem", fontSize: 12 }}>
            <div><strong>Realized Vol</strong><br />{pct(edgeSummary.realizedVolPct)}</div>
            <div><strong>ATR</strong><br />{pct(edgeSummary.atrPct)}</div>
            <div><strong>Volume / Flow Thrust</strong><br />{volumeThrustLabel(edgeSummary)}</div>
            <div><strong>Premium Proxy</strong><br />{edgeSummary.premiumProxyScore}</div>
          </div>

          <div style={{ marginTop: "0.75rem", border: "1px solid #fde68a", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
            <strong>Wall migration</strong>
            <div style={{ marginTop: 4 }}>
              <strong>{wallMigration?.label ?? "No prior wall comparison"}</strong> — {wallMigration?.interpretation ?? "Save another daily surface to compare wall movement."}
            </div>
            <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0.5rem", fontSize: 12 }}>
              <div><strong>Prior</strong><br />{wallMigration?.priorDate ?? "N/A"}</div>
              <div><strong>Put Wall</strong><br />{money(wallMigration?.priorSupport)} → {money(wallMigration?.currentSupport)}</div>
              <div><strong>Call Wall</strong><br />{money(wallMigration?.priorResistance)} → {money(wallMigration?.currentResistance)}</div>
              <div><strong>Magnet</strong><br />{money(wallMigration?.priorMagnet)} → {money(wallMigration?.currentMagnet)}</div>
            </div>
          </div>

            <DealerPressureCard summary={dealerPressure} />

          <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <strong>Trap detector</strong>
              <ul style={{ marginTop: 4 }}>
                {edgeSummary.trapNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
            <div>
              <strong>Trigger map</strong>
              <ul style={{ marginTop: 4 }}>
                {edgeSummary.triggerNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section style={{ border: "1px solid #334155", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Wheel Decision</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.75rem", fontSize: 14 }}>
          <div><strong>State:</strong><br />{decision.state.replaceAll("_", " ")}</div>
          <div><strong>Bias:</strong><br />{decision.bias?.toUpperCase()} / {decision.confidence}</div>
          <div><strong>Spot:</strong><br />{fmt(decision.spot)}</div>
          <div><strong>Shares:</strong><br />{decision.shares.toLocaleString()}</div>
          <div><strong>Max CC Contracts:</strong><br />{decision.maxCoveredCallContracts}</div>
        </div>

        <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem" }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.75rem" }}>
            <strong>Support</strong>
            <div>{fmt(edgeSummary?.support ?? decision.support)}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.75rem" }}>
            <strong>OI Magnet</strong>
            <div>{fmt(edgeSummary?.magnet ?? decision.magnet)}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.75rem" }}>
            <strong>Resistance</strong>
            <div>{fmt(edgeSummary?.resistance ?? decision.resistance)}</div>
          </div>
        </div>
      </section>




<section
style={{
border: "1px solid #d1d5db",
borderRadius: 8,
background: "#fff",
padding: "0.9rem"
}}
>
<h3 style={{ marginTop: 0 }}>Position Context</h3>

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
    border: "1px solid #d1d5db",
    borderRadius: 8,
    background: "#fff",
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
      <p style={{ marginTop: 0, color: "#92400e" }}>
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
      border: "1px solid #e5e7eb",
      borderRadius: 6,
      padding: "0.75rem",
      background: "#f8fafc"
    }}
  >
    <strong>Suggested optimized grouping</strong>
    <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4 }}>
      {groupedPositions.debug.capacityFormula}
    </div>
    <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4 }}>
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
      <p style={{ color: "#6b7280", marginBottom: 0 }}>No groups available yet.</p>
    ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0.75rem" }}>
        {(activeManualGroups.length ? activeManualGroups : suggestedUserGroups).map((group) => (
          <div key={`summary-${group.id}`} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.75rem", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <strong>{group.name}</strong>
              <span style={{ color: "#4b5563" }}>{groupTypeLabel(group.strategyType)}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 13 }}>{summarizeGroup(group, tickerPositionLegs)}</div>
            {group.notes && <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{group.notes}</div>}
          </div>
        ))}
      </div>
    )}

    {showGroupEditor && (
      <>
    <h4 style={{ margin: 0 }}>Manual Groups</h4>

    {activeManualGroups.length === 0 ? (
      <p style={{ color: "#6b7280", marginBottom: 0 }}>
        No manual groups saved. Click <strong>Add Manual Group</strong> or accept the suggested groups as a starting point.
      </p>
    ) : (
      activeManualGroups.map((group) => (
        <div
          key={group.id}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: "0.75rem",
            background: "#fff",
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
              <p style={{ color: "#6b7280" }}>No {ticker} legs exist in this portfolio.</p>
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
                        <span style={{ color: "#92400e" }}>
                          assigned elsewhere — checking will move it here
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ fontSize: 13, color: "#4b5563" }}>
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
      border: "1px solid #e5e7eb",
      borderRadius: 6,
      padding: "0.75rem",
      background: "#fff"
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
   


       
        <section style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "1rem", background: "#fff" }}>
  <h3 style={{ marginTop: 0 }}>Existing Contract Management</h3>

  {decision.positionContext.managedLegs.length === 0 ? (
    <p style={{ color: "#6b7280", marginBottom: 0 }}>
      No existing {ticker} legs found in the selected portfolio.
    </p>
  ) : (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {decision.positionContext.managedLegs.map((leg) => (
        <div
          key={leg.id}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: "0.75rem",
            background: "#fff"
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
              <li key={line} style={{ color: "#92400e", fontWeight: 600 }}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )}
</section>

        

      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>
          {decision.action === "avoid_new_trade" || decision.action === "wait" ? "Reference Zones" : "Strike Zones"}
        </h3>

        {(decision.action === "avoid_new_trade" || decision.action === "wait") && (
          <p style={{ color: "#92400e" }}>
            These are reference levels only. Current action does not recommend adding new exposure.
          </p>
        )}
        <p style={{ color: "#4b5563", fontSize: 13 }}>
          Surface-wide reference zones from the saved OI surface. Confirm the exact expiration, premium, liquidity, and assignment/call-away intent before placing an order.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <h4>Cash-Secured Put Zone</h4>
            <p style={{ fontSize: 22, fontWeight: 700, color: "#2563eb" }}>{decision.cspZone}</p>
            <p>Use near support when structure is stable, bullish, or support is rising.</p>
          </div>

          <div>
            <h4>Covered Call Zone</h4>
            <p style={{ fontSize: 22, fontWeight: 700, color: "#dc2626" }}>{decision.coveredCallZone}</p>
            <p>Use near resistance when price approaches capped upside or when full coverage is acceptable.</p>
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #334155", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Trade Plan</h3>

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

      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Readout</h3>
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
    </main>
  );
}