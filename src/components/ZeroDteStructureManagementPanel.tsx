"use client";

import type React from "react";
import type {
  ExecutionCandidate,
  ExecutionLeg,
  ExecutionLegProfileRead,
  ExecutionPositionMemory,
  ExecutionSideProfileRead,
  ExecutionStrategy,
  ZeroDteExecutionRead,
} from "../lib/zeroDteExecutionIntelligence";
import type { AdaptiveManagementDecision } from "../lib/zeroDteAdaptiveManagement";
import type { ZeroDteShadowTrade } from "../lib/zeroDteShadowTrade";
import type { ZeroDteChainRow } from "../lib/zeroDteOiIntelligence";

type Props = {
  positions: ExecutionPositionMemory[];
  positionReads: Record<string, ZeroDteExecutionRead>;
  adaptiveDecisions: Record<string, AdaptiveManagementDecision>;
  candidates: Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>;
  evaluateCandidate?: (candidate: ExecutionCandidate) => ZeroDteExecutionRead | null;
  shadowTrades: ZeroDteShadowTrade[];
  spxRows: ZeroDteChainRow[];
  spot: number | null;
};

type ManagedLegRow = ExecutionLegProfileRead & {
  rowId: string;
  rowLabel: string;
};

type StructureScope = {
  key: string;
  label: string;
  subtitle: string;
  rows: ManagedLegRow[];
  sideProfiles: ExecutionSideProfileRead[];
  decisions: AdaptiveManagementDecision[];
};

export function ZeroDteStructureManagementPanel({
  positions,
  positionReads,
  adaptiveDecisions,
  candidates,
  evaluateCandidate,
  shadowTrades,
  spxRows,
  spot,
}: Props) {
  const ironFlyPositions = positions.filter((position) => position.strategy === "iron-fly");
  const putPositions = positions.filter((position) => position.strategy === "put-credit-spread");
  const callPositions = positions.filter((position) => position.strategy === "call-credit-spread");
  const condorPositions = [...putPositions, ...callPositions];
  const ironFlyActualQty = ironFlyPositions.reduce((sum, position) => sum + Math.max(1, position.quantity), 0);
  const actualPutQty = putPositions.reduce((sum, position) => sum + Math.max(1, position.quantity), 0);
  const actualCallQty = callPositions.reduce((sum, position) => sum + Math.max(1, position.quantity), 0);
  const actualCondorCapacity = Math.min(actualPutQty, actualCallQty);

  const ironFlyCandidate = candidates["iron-fly"] ?? null;
  const putCandidate = candidates["put-credit-spread"] ?? null;
  const callCandidate = candidates["call-credit-spread"] ?? null;

  // Shadow Lab is the authoritative paper portfolio. Every admitted SELL_READY
  // row is one independently managed lot, so structure quantity is the count
  // of currently-open admitted lots sharing the same live geometry.
  const managedShadowTrades = shadowTrades.filter(isManagedShadowOpen);
  const shadowFlyTrades = managedShadowTrades.filter((trade) => trade.strategy === "iron-fly");
  const shadowPutTrades = managedShadowTrades.filter((trade) => trade.strategy === "put-credit-spread");
  const shadowCallTrades = managedShadowTrades.filter((trade) => trade.strategy === "call-credit-spread");
  const shadowCondorTrades = [...shadowPutTrades, ...shadowCallTrades];
  const shadowFlyRows = buildShadowManagedRows(shadowFlyTrades, spxRows, spot);
  const shadowCondorRows = buildShadowManagedRows(shadowCondorTrades, spxRows, spot);
  const shadowFlyProfiles = buildSideProfilesFromManagedRows(shadowFlyRows);
  const shadowCondorProfiles = buildSideProfilesFromManagedRows(shadowCondorRows);

  const ironFlyCandidateRead = ironFlyCandidate && evaluateCandidate
    ? evaluateCandidate(ironFlyCandidate)
    : null;
  const putCandidateRead = putCandidate && evaluateCandidate
    ? evaluateCandidate(putCandidate)
    : null;
  const callCandidateRead = callCandidate && evaluateCandidate
    ? evaluateCandidate(callCandidate)
    : null;

  const ironFlyScopes: StructureScope[] = [
    {
      key: "if-shadow",
      label: "SHADOW LAB BOOK",
      subtitle: summarizeShadowFlyBook(shadowFlyTrades),
      rows: shadowFlyRows,
      sideProfiles: shadowFlyProfiles,
      decisions: [],
    },
    {
      key: "if-candidate",
      label: "LIVE CANDIDATE",
      subtitle: ironFlyCandidate
        ? `${ironFlyCandidate.label} · ${money(ironFlyCandidateRead?.currentSellableCredit ?? ironFlyCandidate.sellableCredit ?? ironFlyCandidate.estimatedCredit)} live sellable package`
        : "No live iron-fly candidate is currently available from the execution engine.",
      rows: buildCandidateRows(ironFlyCandidate, ironFlyCandidateRead, "Live IF candidate"),
      sideProfiles: ironFlyCandidateRead?.sideProfiles ?? [],
      decisions: [],
    },
    {
      key: "if-actual",
      label: "ACTUAL BOOK",
      subtitle: ironFlyPositions.length
        ? `${ironFlyActualQty} actual fly contract${ironFlyActualQty === 1 ? "" : "s"} across ${ironFlyPositions.length} recorded build${ironFlyPositions.length === 1 ? "" : "s"}; put and call center shorts are tracked independently.`
        : "No actual iron-fly position is open. Shadow and live-candidate analytics remain available above.",
      rows: buildManagedRows(ironFlyPositions, positionReads),
      sideProfiles: aggregateSideProfiles(ironFlyPositions, positionReads),
      decisions: ironFlyPositions.map((position) => adaptiveDecisions[position.id]).filter(Boolean),
    },
  ];

  const condorCandidateReady = Boolean(putCandidate && callCandidate);
  const condorScopes: StructureScope[] = [
    {
      key: "ic-shadow",
      label: "SHADOW LAB BOOK",
      subtitle: summarizeShadowCondorBook(shadowPutTrades, shadowCallTrades),
      rows: shadowCondorRows,
      sideProfiles: shadowCondorProfiles,
      decisions: [],
    },
    {
      key: "ic-candidate",
      label: "LIVE CANDIDATE",
      subtitle: condorCandidateReady
        ? "Current put-credit and call-credit candidates combined as one hypothetical 0DTE condor risk book."
        : "WheelDesk needs both a live put-credit and call-credit candidate to populate the hypothetical condor.",
      rows: condorCandidateReady
        ? [
            ...buildCandidateRows(putCandidate, putCandidateRead, "Live put side"),
            ...buildCandidateRows(callCandidate, callCandidateRead, "Live call side"),
          ]
        : [],
      sideProfiles: condorCandidateReady
        ? aggregateRawSideProfiles([
            ...(putCandidateRead?.sideProfiles ?? []),
            ...(callCandidateRead?.sideProfiles ?? []),
          ])
        : [],
      decisions: [],
    },
    {
      key: "ic-actual",
      label: "ACTUAL BOOK",
      subtitle: condorPositions.length
        ? `Actual side inventory: PUT ${actualPutQty} · CALL ${actualCallQty} · condor capacity ${actualCondorCapacity}. Each recorded spread keeps its own contract quantity and remains independently managed.`
        : "No actual put/call credit-spread inventory is open. Shadow and live-candidate analytics remain available above.",
      rows: buildManagedRows(condorPositions, positionReads),
      sideProfiles: aggregateSideProfiles(condorPositions, positionReads),
      decisions: condorPositions.map((position) => adaptiveDecisions[position.id]).filter(Boolean),
    },
  ];

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>0DTE Structure Manager</div>
          <strong style={styles.title}>Iron Fly + Iron Condor Leg Intelligence</strong>
          <div style={styles.headerNote}>
            Shadow Lab book + live candidates + actual books · true lot quantity · every leg · Greeks · adaptive state
          </div>
        </div>
        <span style={styles.livePill}>LIVE CHAIN</span>
      </div>

      <div style={styles.structureGrid}>
        <StructureCard
          title="Iron Fly 0DTE"
          subtitle="Lower wing · put short · call short · upper wing. Center shorts are evaluated independently."
          scopes={ironFlyScopes}
        />
        <StructureCard
          title="Iron Condor 0DTE"
          subtitle="Long put · short put · short call · long call, with independent put-side and call-side profiles."
          scopes={condorScopes}
        />
      </div>
    </section>
  );
}

function StructureCard({
  title,
  subtitle,
  scopes,
}: {
  title: string;
  subtitle: string;
  scopes: StructureScope[];
}) {
  return (
    <div style={styles.structureCard}>
      <div style={styles.structureHeader}>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {scopes.map((scope) => (
        <ScopeTable key={scope.key} scope={scope} />
      ))}
    </div>
  );
}

function ScopeTable({ scope }: { scope: StructureScope }) {
  const totals = scope.rows.reduce(
    (acc, row) => ({
      delta: acc.delta + row.exposureDelta,
      gamma: acc.gamma + row.exposureGamma,
      theta: acc.theta + row.exposureTheta,
      vega: acc.vega + row.exposureVega,
    }),
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );
  const actionable = scope.decisions.find((decision) =>
    decision.action === "RELEASE_SHORT" ||
    decision.action === "REINSTATE_SHORT" ||
    decision.action === "CLOSE_RUNNER",
  ) ?? null;

  return (
    <div style={styles.scope}>
      <div style={styles.scopeHeader}>
        <div>
          <div style={styles.scopeLabel}>{scope.label}</div>
          <span>{scope.subtitle}</span>
        </div>
        {scope.rows.length ? (
          <div style={styles.greekStrip}>
            <MiniGreek label="Net Δ" value={totals.delta} />
            <MiniGreek label="Net Γ" value={totals.gamma} digits={4} />
            <MiniGreek label="Net Θ" value={totals.theta} />
            <MiniGreek label="Net Vega" value={totals.vega} />
          </div>
        ) : null}
      </div>

      {actionable ? (
        <div style={styles.actionAlert}>
          <strong>{actionable.action.replaceAll("_", " ")}</strong>
          <span>{actionable.structureTransition?.detail ?? actionable.reasons[0]}</span>
        </div>
      ) : null}

      {scope.rows.length ? (
        <>
          <div style={styles.tableScroll}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {[
                    "Source", "Role", "Leg", "Qty", "Strike", "Entry*", "Bid", "Ask", "Mid", "IV",
                    "Δ", "Γ", "Θ", "Vega", "Close", "Short ×", "Dist",
                  ].map((heading) => (
                    <th key={heading} style={{ ...styles.cell, ...styles.headerCell }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scope.rows
                  .slice()
                  .sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType))
                  .map((row, index) => (
                    <tr key={`${row.rowId}-${row.optionType}-${row.strike}-${row.action}-${index}`}>
                      <td title={row.rowLabel} style={styles.cell}>{shortLabel(row.rowLabel)}</td>
                      <td style={styles.cell}><span style={rolePill(row.role)}>{row.role.replaceAll("_", " ")}</span></td>
                      <td style={styles.cell}>{row.optionType.toUpperCase()} {row.action === "sell" ? "SHORT" : "LONG"}</td>
                      <td style={styles.cell}>{row.quantity}</td>
                      <td style={styles.cell}><strong>{row.strike.toFixed(0)}</strong></td>
                      <td style={styles.cell}>{money(row.shortEntryPrice)}</td>
                      <td style={styles.cell}>{money(row.bid)}</td>
                      <td style={styles.cell}>{money(row.ask)}</td>
                      <td style={styles.cell}>{money(row.mid)}</td>
                      <td style={styles.cell}>{formatIv(row.iv)}</td>
                      <td style={styles.cell}>{greek(row.delta)}</td>
                      <td style={styles.cell}>{greek(row.gamma, 4)}</td>
                      <td style={styles.cell}>{greek(row.theta)}</td>
                      <td style={styles.cell}>{greek(row.vega)}</td>
                      <td style={styles.cell}>{money(row.closePrice)}</td>
                      <td style={{ ...styles.cell, ...multipleStyle(row.shortPremiumMultiple) }}>{multiple(row.shortPremiumMultiple)}</td>
                      <td style={styles.cell}>{signed(row.distanceFromSpot, 1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div style={styles.footnote}>
            * Qty is source-aware: live candidate = 1 hypothetical lot; Shadow Lab = current admitted lot count by exact build; actual = recorded contract quantity. Entry on shadow shorts is the average recorded sell price for that exact build; Short × shows the worst live multiple across those lots.
          </div>
          <div style={styles.sideGrid}>
            {scope.sideProfiles.map((profile) => (
              <SideProfile key={profile.side} profile={profile} />
            ))}
          </div>
        </>
      ) : (
        <div style={styles.empty}>{scope.subtitle}</div>
      )}
    </div>
  );
}

function SideProfile({ profile }: { profile: ExecutionSideProfileRead }) {
  const stateColor = sideStateColor(profile.state);
  return (
    <div style={{ ...styles.sideCard, borderColor: stateColor }}>
      <div style={styles.sideHeader}>
        <strong>{profile.side.toUpperCase()} SIDE</strong>
        <span style={{ color: stateColor }}>{profile.state.replaceAll("_", " ")}</span>
      </div>
      <div style={styles.metricGrid}>
        <Metric label="Short / Wing" value={`${profile.shortStrike?.toFixed(0) ?? "—"} / ${profile.wingStrike?.toFixed(0) ?? "—"}`} />
        <Metric label="Width" value={profile.widthPoints == null ? "—" : `${profile.widthPoints.toFixed(0)} pt`} />
        <Metric label="Short ×" value={multiple(profile.shortPremiumMultiple)} />
        <Metric label="Short Dist" value={profile.shortDistancePoints == null ? "—" : signed(profile.shortDistancePoints, 1)} />
        <Metric label="Close Value" value={money(profile.closeValuePoints)} />
        <Metric label="Net Δ" value={signed(profile.netDelta)} />
        <Metric label="Net Γ" value={signed(profile.netGamma, 4)} />
        <Metric label="Net Θ" value={signed(profile.netTheta)} />
        <Metric label="Net Vega" value={signed(profile.netVega)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}

function MiniGreek({ label, value, digits = 2 }: { label: string; value: number; digits?: number }) {
  return <span style={styles.miniGreek}><small>{label}</small><strong>{signed(value, digits)}</strong></span>;
}

function buildCandidateRows(
  candidate: ExecutionCandidate | null,
  read: ZeroDteExecutionRead | null,
  label: string,
): ManagedLegRow[] {
  if (!candidate || !read) return [];
  return (read.legProfiles ?? []).map((row, index) => ({
    ...row,
    rowId: `candidate:${candidate.setupKey}:${index}`,
    rowLabel: label,
  }));
}

function buildManagedRows(
  positions: ExecutionPositionMemory[],
  positionReads: Record<string, ZeroDteExecutionRead>,
): ManagedLegRow[] {
  return positions.flatMap((position) => {
    const read = positionReads[position.id];
    return (read?.legProfiles ?? []).map((row) => ({
      ...row,
      rowId: position.id,
      rowLabel: position.label,
    }));
  });
}

function isManagedShadowOpen(trade: ZeroDteShadowTrade) {
  if (trade.portfolioDecision && trade.portfolioDecision !== "TAKE") return false;
  if (trade.adaptiveState === "open") return true;
  return trade.adaptiveState === null && trade.state === "open";
}

function shadowActiveLegs(trade: ZeroDteShadowTrade): ExecutionLeg[] {
  return trade.adaptiveState === "open" && trade.adaptiveActiveLegs.length
    ? trade.adaptiveActiveLegs
    : trade.legs;
}

function buildShadowManagedRows(
  trades: ZeroDteShadowTrade[],
  rows: ZeroDteChainRow[],
  spot: number | null,
): ManagedLegRow[] {
  const groups = new Map<string, ZeroDteShadowTrade[]>();
  for (const trade of trades) {
    const key = shadowGeometryKey(trade);
    const current = groups.get(key) ?? [];
    current.push(trade);
    groups.set(key, current);
  }

  return [...groups.entries()].flatMap(([groupKey, group]) => {
    const representative = group[0];
    const legs = shadowActiveLegs(representative);
    const quantity = group.length;
    const buildLabel = `${shadowBuildLabel(representative)} ×${quantity}`;

    return legs.map((leg, legIndex) => {
      const row = rows.find(
        (item) => item.optionType === leg.optionType && Math.abs(item.strike - leg.strike) < 0.01,
      );
      const bid = finite(row?.bid);
      const ask = finite(row?.ask);
      const mid = finite(row?.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
      const delta = finite(row?.delta);
      const gamma = finite(row?.gamma);
      const theta = finite(row?.theta);
      const vega = finite(row?.vega);
      const sign = leg.action === "buy" ? 1 : -1;
      const entryPrices = leg.action === "sell"
        ? group.map((trade) => shadowShortEntryPrice(trade, leg)).filter((value): value is number => value !== null)
        : [];
      const shortEntryPrice = entryPrices.length
        ? entryPrices.reduce((sum, value) => sum + value, 0) / entryPrices.length
        : null;
      const shortMultiples = leg.action === "sell" && ask !== null
        ? entryPrices.filter((value) => value > 0).map((value) => ask / value)
        : [];

      return {
        optionType: leg.optionType,
        action: leg.action,
        strike: leg.strike,
        role: executionRoleForShadow(representative.strategy, leg, legs),
        quantity,
        bid,
        ask,
        mid,
        last: finite(row?.last),
        iv: finite(row?.iv),
        delta,
        gamma,
        theta,
        vega,
        closePrice: leg.action === "sell" ? ask : bid,
        shortEntryPrice,
        shortPremiumMultiple: shortMultiples.length ? Math.max(...shortMultiples) : null,
        distanceFromSpot:
          spot === null
            ? 0
            : leg.optionType === "put"
              ? spot - leg.strike
              : leg.strike - spot,
        exposureDelta: roundGreek((delta ?? 0) * sign * quantity * 100),
        exposureGamma: roundGreek((gamma ?? 0) * sign * quantity * 100),
        exposureTheta: roundGreek((theta ?? 0) * sign * quantity * 100),
        exposureVega: roundGreek((vega ?? 0) * sign * quantity * 100),
        rowId: `shadow:${groupKey}:${legIndex}`,
        rowLabel: buildLabel,
      };
    });
  });
}

function buildSideProfilesFromManagedRows(rows: ManagedLegRow[]): ExecutionSideProfileRead[] {
  return (["put", "call"] as const).flatMap((side) => {
    const legs = rows.filter((leg) => leg.optionType === side);
    if (!legs.length) return [];
    const shorts = legs.filter((leg) => leg.action === "sell");
    const longs = legs.filter((leg) => leg.action === "buy");
    const short = shorts
      .slice()
      .sort((a, b) => (b.shortPremiumMultiple ?? -1) - (a.shortPremiumMultiple ?? -1))[0] ?? null;
    const wing = short
      ? longs.slice().sort((a, b) => Math.abs(a.strike - short.strike) - Math.abs(b.strike - short.strike))[0] ?? null
      : longs[0] ?? null;
    const closeReady = legs.every((leg) => leg.closePrice !== null);
    const closeValuePoints = closeReady
      ? roundGreek(legs.reduce(
          (sum, leg) => sum + (leg.action === "sell" ? 1 : -1) * Number(leg.closePrice) * leg.quantity,
          0,
        ))
      : null;
    const shortCount = shorts.reduce((sum, leg) => sum + leg.quantity, 0);
    const longCount = longs.reduce((sum, leg) => sum + leg.quantity, 0);

    return [{
      side,
      legCount: shortCount + longCount,
      shortCount,
      longCount,
      shortStrike: short?.strike ?? null,
      wingStrike: wing?.strike ?? null,
      widthPoints: short && wing ? Math.abs(short.strike - wing.strike) : null,
      shortPremiumMultiple: short?.shortPremiumMultiple ?? null,
      shortDistancePoints: short?.distanceFromSpot ?? null,
      closeValuePoints,
      netDelta: roundGreek(legs.reduce((sum, leg) => sum + leg.exposureDelta, 0)),
      netGamma: roundGreek(legs.reduce((sum, leg) => sum + leg.exposureGamma, 0)),
      netTheta: roundGreek(legs.reduce((sum, leg) => sum + leg.exposureTheta, 0)),
      netVega: roundGreek(legs.reduce((sum, leg) => sum + leg.exposureVega, 0)),
      state: sideProfileState(short?.shortPremiumMultiple ?? null, shortCount, longCount),
    }];
  });
}

function summarizeShadowFlyBook(trades: ZeroDteShadowTrade[]) {
  if (!trades.length) {
    return "No admitted open Shadow Lab iron-fly lots. This section will populate from Shadow Lab automatically.";
  }
  const grouped = groupShadowBuilds(trades);
  return `Shadow Lab currently carries ${trades.length} fly lot${trades.length === 1 ? "" : "s"}: ${grouped.join(" · ")}.`;
}

function summarizeShadowCondorBook(
  putTrades: ZeroDteShadowTrade[],
  callTrades: ZeroDteShadowTrade[],
) {
  if (!putTrades.length && !callTrades.length) {
    return "No admitted open Shadow Lab put/call credit-spread lots. Condor inventory will build here as Shadow Lab admits each side.";
  }
  const activePutVerticals = putTrades.filter(hasActiveVertical).length;
  const activeCallVerticals = callTrades.filter(hasActiveVertical).length;
  const pairedCapacity = Math.min(activePutVerticals, activeCallVerticals);
  const putRemainder = Math.max(0, activePutVerticals - pairedCapacity);
  const callRemainder = Math.max(0, activeCallVerticals - pairedCapacity);
  const runners = [...putTrades, ...callTrades].filter((trade) => {
    const legs = shadowActiveLegs(trade);
    return legs.length > 0 && legs.every((leg) => leg.action === "buy");
  }).length;
  const builds = groupShadowBuilds([...putTrades, ...callTrades]);
  return `Shadow Lab side inventory: PUT ${activePutVerticals} · CALL ${activeCallVerticals} · condor capacity ${pairedCapacity}${putRemainder ? ` · +${putRemainder} put-only` : ""}${callRemainder ? ` · +${callRemainder} call-only` : ""}${runners ? ` · ${runners} runner${runners === 1 ? "" : "s"}` : ""}. Builds: ${builds.join(" · ")}.`;
}

function groupShadowBuilds(trades: ZeroDteShadowTrade[]) {
  const grouped = new Map<string, { trade: ZeroDteShadowTrade; quantity: number }>();
  for (const trade of trades) {
    const key = shadowGeometryKey(trade);
    const existing = grouped.get(key);
    if (existing) existing.quantity += 1;
    else grouped.set(key, { trade, quantity: 1 });
  }
  return [...grouped.values()]
    .sort((a, b) => b.quantity - a.quantity || shadowBuildLabel(a.trade).localeCompare(shadowBuildLabel(b.trade)))
    .map(({ trade, quantity }) => `${shadowBuildLabel(trade)} ×${quantity}`);
}

function hasActiveVertical(trade: ZeroDteShadowTrade) {
  const legs = shadowActiveLegs(trade);
  return legs.some((leg) => leg.action === "sell") && legs.some((leg) => leg.action === "buy");
}

function shadowGeometryKey(trade: ZeroDteShadowTrade) {
  const legs = shadowActiveLegs(trade)
    .slice()
    .sort((a, b) => a.optionType.localeCompare(b.optionType) || a.action.localeCompare(b.action) || a.strike - b.strike)
    .map((leg) => `${leg.optionType}:${leg.action}:${leg.strike.toFixed(2)}`)
    .join("|");
  return `${trade.strategy}|${legs}`;
}

function shadowBuildLabel(trade: ZeroDteShadowTrade) {
  const legs = shadowActiveLegs(trade);
  const sold = legs.filter((leg) => leg.action === "sell");
  const bought = legs.filter((leg) => leg.action === "buy");
  if (trade.strategy === "iron-fly") {
    const shortPut = sold.find((leg) => leg.optionType === "put");
    const shortCall = sold.find((leg) => leg.optionType === "call");
    const putWing = bought.find((leg) => leg.optionType === "put");
    const callWing = bought.find((leg) => leg.optionType === "call");
    if (shortPut && shortCall && putWing && callWing) {
      return `IF ${putWing.strike.toFixed(0)}/${shortPut.strike.toFixed(0)}/${callWing.strike.toFixed(0)}`;
    }
  }
  if (legs.length === 1 && legs[0].action === "buy") {
    return `${legs[0].optionType.toUpperCase()} RUNNER ${legs[0].strike.toFixed(0)}`;
  }
  const short = sold[0] ?? null;
  const wing = bought[0] ?? null;
  if (short && wing) {
    return `${short.optionType.toUpperCase()} ${short.strike.toFixed(0)}/${wing.strike.toFixed(0)}`;
  }
  return legs.map((leg) => `${leg.action === "sell" ? "-" : "+"}${leg.strike.toFixed(0)}${leg.optionType === "call" ? "C" : "P"}`).join(" ");
}

function shadowShortEntryPrice(trade: ZeroDteShadowTrade, leg: ExecutionLeg) {
  const original = trade.entryShortLegs.find(
    (item) => item.optionType === leg.optionType && Math.abs(item.strike - leg.strike) < 0.01,
  );
  if (original?.sellPrice && original.sellPrice > 0) return original.sellPrice;
  const repaired = trade.adaptiveStructureHistory
    .slice()
    .reverse()
    .find(
      (item) => item.action === "REINSTATE_SHORT" && item.strike !== null && Math.abs(item.strike - leg.strike) < 0.01,
    );
  return repaired?.price && repaired.price > 0 ? repaired.price : null;
}

function executionRoleForShadow(
  strategy: ExecutionStrategy,
  leg: ExecutionLeg,
  legs: ExecutionLeg[],
): ExecutionLegProfileRead["role"] {
  if (legs.length > 0 && legs.every((item) => item.action === "buy")) return "LONG_RUNNER";
  if (strategy === "iron-fly") {
    if (leg.action === "buy" && leg.optionType === "put") return "LOWER_WING";
    if (leg.action === "sell" && leg.optionType === "put") return "PUT_SHORT";
    if (leg.action === "sell" && leg.optionType === "call") return "CALL_SHORT";
    return "UPPER_WING";
  }
  return leg.action === "sell" ? "SHORT" : "WING";
}

function sideProfileState(
  shortMultiple: number | null,
  shortCount: number,
  longCount: number,
): ExecutionSideProfileRead["state"] {
  if (shortCount === 0 && longCount > 0) return "LONG_RUNNER";
  if (shortMultiple !== null && shortMultiple >= 3) return "RELEASE";
  if (shortMultiple !== null && shortMultiple >= 2) return "PRESSURED";
  if (shortMultiple !== null && shortMultiple >= 1.5) return "WATCH";
  return "HEALTHY";
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : null;
}

function roundGreek(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function aggregateSideProfiles(
  positions: ExecutionPositionMemory[],
  positionReads: Record<string, ZeroDteExecutionRead>,
) {
  return aggregateRawSideProfiles(
    positions.flatMap((position) => positionReads[position.id]?.sideProfiles ?? []),
  );
}

function aggregateRawSideProfiles(rawProfiles: ExecutionSideProfileRead[]): ExecutionSideProfileRead[] {
  return (["put", "call"] as const).flatMap((side) => {
    const profiles = rawProfiles.filter((profile) => profile.side === side);
    if (!profiles.length) return [];
    const shortProfiles = profiles.filter((profile) => profile.shortCount > 0);
    const worst = shortProfiles
      .slice()
      .sort((a, b) => (b.shortPremiumMultiple ?? -1) - (a.shortPremiumMultiple ?? -1))[0] ?? null;
    const representative = worst ?? profiles[0];
    const state = profiles
      .map((profile) => profile.state)
      .sort((a, b) => sideStateRank(b) - sideStateRank(a))[0] ?? "HEALTHY";
    const finiteClose = profiles.every((profile) => profile.closeValuePoints !== null);
    return [{
      side,
      legCount: profiles.reduce((sum, profile) => sum + profile.legCount, 0),
      shortCount: profiles.reduce((sum, profile) => sum + profile.shortCount, 0),
      longCount: profiles.reduce((sum, profile) => sum + profile.longCount, 0),
      shortStrike: representative.shortStrike,
      wingStrike: representative.wingStrike,
      widthPoints: representative.widthPoints,
      shortPremiumMultiple: worst?.shortPremiumMultiple ?? null,
      shortDistancePoints: worst?.shortDistancePoints ?? null,
      closeValuePoints: finiteClose
        ? profiles.reduce((sum, profile) => sum + Number(profile.closeValuePoints), 0)
        : null,
      netDelta: profiles.reduce((sum, profile) => sum + profile.netDelta, 0),
      netGamma: profiles.reduce((sum, profile) => sum + profile.netGamma, 0),
      netTheta: profiles.reduce((sum, profile) => sum + profile.netTheta, 0),
      netVega: profiles.reduce((sum, profile) => sum + profile.netVega, 0),
      state,
    }];
  });
}

function sideStateRank(state: ExecutionSideProfileRead["state"]) {
  if (state === "RELEASE") return 5;
  if (state === "PRESSURED") return 4;
  if (state === "WATCH") return 3;
  if (state === "LONG_RUNNER") return 2;
  return 1;
}

function sideStateColor(state: ExecutionSideProfileRead["state"]) {
  if (state === "RELEASE") return "#fb7185";
  if (state === "PRESSURED") return "#fb923c";
  if (state === "WATCH") return "#f5c542";
  if (state === "LONG_RUNNER") return "#60a5fa";
  return "#71e0b4";
}

function rolePill(role: ExecutionLegProfileRead["role"]): React.CSSProperties {
  const short = role === "PUT_SHORT" || role === "CALL_SHORT" || role === "SHORT";
  return {
    display: "inline-block",
    padding: "2px 6px",
    borderRadius: 999,
    border: `1px solid ${short ? "rgba(245,197,66,.42)" : "rgba(96,165,250,.30)"}`,
    color: short ? "#f5c542" : "#9ecbff",
    whiteSpace: "nowrap",
  };
}

function multipleStyle(value: number | null): React.CSSProperties {
  if (value == null) return {};
  if (value >= 3) return { color: "#fb7185", fontWeight: 800 };
  if (value >= 2) return { color: "#fb923c", fontWeight: 800 };
  if (value >= 1.5) return { color: "#f5c542", fontWeight: 700 };
  return { color: "#71e0b4" };
}

function shortLabel(value: string) {
  return value.length <= 24 ? value : `${value.slice(0, 21)}…`;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function multiple(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}×`;
}

function formatIv(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = Math.abs(value) <= 3 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

function greek(value: number | null | undefined, digits = 3) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function signed(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid rgba(148,163,184,.16)",
    borderRadius: 16,
    background: "linear-gradient(180deg, rgba(10,18,31,.98), rgba(7,14,25,.98))",
    padding: 16,
    display: "grid",
    gap: 14,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "#71e0b4",
    textTransform: "uppercase",
    letterSpacing: ".13em",
    fontSize: 11,
    fontWeight: 800,
    marginBottom: 4,
  },
  title: { fontSize: 16, color: "#e6edf6" },
  headerNote: { color: "#8296aa", fontSize: 12, marginTop: 4 },
  livePill: {
    padding: "5px 9px",
    borderRadius: 999,
    border: "1px solid rgba(113,224,180,.35)",
    color: "#71e0b4",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: ".08em",
  },
  structureGrid: { display: "grid", gap: 14 },
  structureCard: {
    border: "1px solid rgba(148,163,184,.14)",
    borderRadius: 12,
    overflow: "hidden",
    background: "rgba(6,12,22,.54)",
  },
  structureHeader: {
    padding: "11px 12px",
    borderBottom: "1px solid rgba(148,163,184,.12)",
    display: "grid",
    gap: 3,
  },
  scope: { padding: 12, display: "grid", gap: 10, borderTop: "1px solid rgba(148,163,184,.09)" },
  scopeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    color: "#8296aa",
    fontSize: 12,
  },
  scopeLabel: { color: "#9ecbff", fontSize: 10, fontWeight: 800, letterSpacing: ".12em" },
  greekStrip: { display: "flex", gap: 8, flexWrap: "wrap" },
  miniGreek: {
    minWidth: 66,
    display: "grid",
    gap: 2,
    padding: "5px 7px",
    borderRadius: 8,
    background: "rgba(148,163,184,.07)",
  },
  actionAlert: {
    border: "1px solid rgba(251,113,133,.42)",
    background: "rgba(127,29,29,.18)",
    borderRadius: 9,
    padding: "8px 10px",
    display: "flex",
    gap: 10,
    alignItems: "center",
    color: "#fda4af",
  },
  tableScroll: { overflowX: "auto", width: "100%" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 1260, fontSize: 11 },
  cell: {
    padding: "7px 8px",
    textAlign: "right",
    borderBottom: "1px solid rgba(148,163,184,.09)",
    color: "#cbd5e1",
    whiteSpace: "nowrap",
  },
  headerCell: { color: "#8296aa", fontSize: 10, fontWeight: 700 },
  footnote: { color: "#60758a", fontSize: 10 },
  sideGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 10 },
  sideCard: {
    border: "1px solid rgba(113,224,180,.45)",
    borderRadius: 10,
    padding: 10,
    background: "rgba(10,18,31,.75)",
  },
  sideHeader: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 6 },
  metric: {
    display: "grid",
    gap: 2,
    padding: "6px 7px",
    borderRadius: 7,
    background: "rgba(148,163,184,.06)",
    fontSize: 11,
  },
  empty: {
    padding: 12,
    borderRadius: 8,
    border: "1px dashed rgba(148,163,184,.18)",
    color: "#60758a",
    fontSize: 12,
  },
};
