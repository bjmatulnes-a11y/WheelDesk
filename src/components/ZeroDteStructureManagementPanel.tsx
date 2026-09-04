"use client";

import type React from "react";
import type {
  ExecutionCandidate,
  ExecutionLegProfileRead,
  ExecutionPositionMemory,
  ExecutionSideProfileRead,
  ExecutionStrategy,
  ZeroDteExecutionRead,
} from "../lib/zeroDteExecutionIntelligence";
import type { AdaptiveManagementDecision } from "../lib/zeroDteAdaptiveManagement";

type Props = {
  positions: ExecutionPositionMemory[];
  positionReads: Record<string, ZeroDteExecutionRead>;
  adaptiveDecisions: Record<string, AdaptiveManagementDecision>;
  candidates: Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>;
  evaluateCandidate?: (candidate: ExecutionCandidate) => ZeroDteExecutionRead | null;
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
}: Props) {
  const ironFlyPositions = positions.filter((position) => position.strategy === "iron-fly");
  const putPositions = positions.filter((position) => position.strategy === "put-credit-spread");
  const callPositions = positions.filter((position) => position.strategy === "call-credit-spread");
  const condorPositions = putPositions.length && callPositions.length
    ? [...putPositions, ...callPositions]
    : [];

  const ironFlyCandidate = candidates["iron-fly"] ?? null;
  const putCandidate = candidates["put-credit-spread"] ?? null;
  const callCandidate = candidates["call-credit-spread"] ?? null;

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
        ? `${ironFlyPositions.length} open fly${ironFlyPositions.length === 1 ? "" : "ies"}; put and call center shorts are tracked independently.`
        : "No actual iron-fly position is open. Live candidate analytics remain available above.",
      rows: buildManagedRows(ironFlyPositions, positionReads),
      sideProfiles: aggregateSideProfiles(ironFlyPositions, positionReads),
      decisions: ironFlyPositions.map((position) => adaptiveDecisions[position.id]).filter(Boolean),
    },
  ];

  const condorCandidateReady = Boolean(putCandidate && callCandidate);
  const condorScopes: StructureScope[] = [
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
        ? "Paired actual put-credit and call-credit positions shown as one two-sided book while each spread remains independently managed."
        : putPositions.length || callPositions.length
          ? "One actual credit-spread side is open. The actual condor book forms when the opposite side is added."
          : "No actual paired put/call spreads are open. Live candidate analytics remain available above.",
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
            Live candidates and actual books · every leg · Greeks · side pressure · adaptive state
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
            * Entry is populated for recorded actual shorts. Candidate legs are live hypothetical structures and do not have an entry multiple yet.
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
