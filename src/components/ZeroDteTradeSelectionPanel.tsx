"use client";

import type React from "react";
import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";
import type { ZeroDteCreditSpreadSelection } from "../lib/zeroDteCreditSpreadSelector";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";
import type { ZeroDteStrikeFlowRead } from "../lib/zeroDteStrikeFlow";
import { makeExecutionSetupKey } from "../lib/zeroDteExecutionIntelligence";
import type {
  ExecutionCandidateTracking,
  ExecutionStrategy,
} from "../lib/zeroDteExecutionIntelligence";
import type { ZeroDteCashSessionStatus } from "../lib/zeroDteSessionClock";

export function ZeroDteTradeSelectionPanel({
  mood,
  tradeSelection,
  strikeFlow,
  tracking,
  sessionStatus = "OPEN",
  openSetupKeys = [],
}: {
  mood: ZeroDteMoodRead | null | undefined;
  tradeSelection: ZeroDteTradeSelection | null | undefined;
  strikeFlow?: ZeroDteStrikeFlowRead | null;
  tracking?: Partial<Record<ExecutionStrategy, ExecutionCandidateTracking>>;
  sessionStatus?: ZeroDteCashSessionStatus;
  openSetupKeys?: string[];
}) {
  const book = tradeSelection?.creditSpreadBook ?? null;
  const put = book?.put ?? null;
  const call = book?.call ?? null;
  const putTrack = tracking?.["put-credit-spread"] ?? null;
  const callTrack = tracking?.["call-credit-spread"] ?? null;
  const preferredSide =
    tradeSelection?.tradeType === "put-credit-spread"
      ? "put"
      : tradeSelection?.tradeType === "call-credit-spread"
        ? "call"
        : "none";
  const finalTradeLabel =
    tradeSelection?.tradeType === "put-credit-spread"
      ? "Put spread"
      : tradeSelection?.tradeType === "call-credit-spread"
        ? "Call spread"
        : tradeSelection?.tradeType === "iron-fly"
          ? "Iron fly"
          : tradeSelection?.tradeType === "no-trade"
            ? "No trade"
            : "Review";

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>Live Strategy Scanner + Stable Tracker</h2>
          <p style={styles.muted}>
            Scanner cards show what ranks best now. Tracked cards show the exact spread collecting candle-close and premium evidence. A scanner score is not an entry signal.
          </p>
        </div>
        <div style={styles.badgeWrap}>
          <div style={styles.smallCaps}>Live directional read</div>
          <div style={{ ...styles.badgeValue, color: preferredSide === "put" ? "#34d399" : preferredSide === "call" ? "#fb7185" : "#fde047" }}>
            {finalTradeLabel}
          </div>
          <div style={styles.sourceLine}>
            {sessionStatus === "CLOSED" ? "EOD QUOTES · NO NEW ENTRY" : tradeSelection?.selectionMode ?? "not selected"}
          </div>
        </div>
      </div>

      <div style={styles.grid4}>
        <Metric title="Mood" value={mood?.moodPercent == null ? "—" : `${mood.moodPercent.toFixed(1)}%`} tone={moodTone(mood?.moodPercent)} />
        <Metric title="Mood Bias" value={mood?.tradeBias ?? "—"} />
        <Metric title="Mood Coverage" value={mood?.coverage?.status ?? "UNAVAILABLE"} tone={coverageTone(mood?.coverage?.status)} />
        <Metric title="Final Trade" value={tradeSelection?.label ?? "—"} />
        <Metric title="Strategy Scan" value={tradeSelection?.confidence == null ? "—" : `${tradeSelection.confidence}%`} tone={tone(tradeSelection?.confidence ?? 0)} />
        <Metric title="Flow Guard" value={!strikeFlow?.hasPriorSnapshot ? "Baseline" : `${strikeFlow.callWall.state} / ${strikeFlow.putWall.state}`} />
      </div>

      {mood?.coverage ? (
        <div style={styles.coverageCard}>
          <div style={styles.coverageHeader}>
            <div>
              <div style={styles.smallCaps}>SPX Mood Coverage</div>
              <div style={{ ...styles.coverageStatus, color: coverageTone(mood.coverage.status) }}>
                {mood.coverage.status}
              </div>
            </div>
            <div style={styles.coverageSource}>
              {mood.source.replaceAll("-", " ")}
            </div>
          </div>
          <div style={styles.coverageGrid}>
            <CoverageItem label="Schwab option chain" value={mood.coverage.schwabOptionChain} />
            <CoverageItem label="SPX leadership" value={mood.coverage.spxLeadership} />
            <CoverageItem label="Breadth internals" value={mood.coverage.breadthInternals} />
            <CoverageItem label="Calculated coverage" value={`${mood.coverage.calculatedCoverageScore}%`} />
          </div>
          <div style={styles.coverageSummary}>{mood.coverage.summary}</div>
        </div>
      ) : null}

      {tradeSelection?.strategyRankings?.length ? (
        <StrategyRankingBoard tradeSelection={tradeSelection} />
      ) : null}

      <div style={styles.grid2}>
        <SpreadCard spread={put} preferred={preferredSide === "put"} track={putTrack} sessionStatus={sessionStatus} />
        <SpreadCard spread={call} preferred={preferredSide === "call"} track={callTrack} sessionStatus={sessionStatus} />
      </div>

      <div style={styles.grid2}>
        <ReasonList title="Why" items={[...(book?.notes ?? []), ...(tradeSelection?.reasons ?? [])]} empty="No selection notes yet." />
        <ReasonList title="Warnings" items={[...(book?.warnings ?? []), ...(tradeSelection?.warnings ?? [])]} empty="No warnings." warning />
      </div>

      <div style={styles.grid2}>
        <CandidateTable title="Top Put Spread Candidates" spread={put} track={putTrack} openSetupKeys={openSetupKeys} />
        <CandidateTable title="Top Call Spread Candidates" spread={call} track={callTrack} openSetupKeys={openSetupKeys} />
      </div>
    </section>
  );
}

function StrategyRankingBoard({
  tradeSelection,
}: {
  tradeSelection: ZeroDteTradeSelection;
}) {
  const map = tradeSelection.mapContext;
  const rankings = tradeSelection.strategyRankings ?? [];

  return (
    <div style={styles.rankingCard}>
      <div style={styles.rankingHeader}>
        <div>
          <div style={styles.smallCaps}>Layer 6 · Map-Aware Strategy Ranking</div>
          <div style={styles.rankingTitle}>
            {map
              ? `${map.phase} · ${map.railBreached} rail · ${map.confirmationCount}/${map.confirmationRequired}`
              : "Building map context"}
          </div>
        </div>
        <div style={styles.mapCenter}>
          <span>Controlling center</span>
          <strong>{map?.controllingCenter?.toFixed(0) ?? "—"}</strong>
        </div>
      </div>

      <div style={styles.rankingGrid}>
        {rankings.map((ranking) => (
          <div
            key={ranking.tradeType}
            style={{
              ...styles.rankingRow,
              ...(ranking.rank === 1 ? styles.rankingWinner : {}),
              opacity: ranking.eligible ? 1 : 0.62,
            }}
          >
            <div style={styles.rankNumber}>#{ranking.rank}</div>
            <div style={styles.rankMain}>
              <div style={styles.rankLabel}>
                {ranking.label}
                {!ranking.eligible ? <span style={styles.blockedPill}>Blocked</span> : null}
              </div>
              <div style={styles.rankStrikes}>{ranking.strikes}</div>
              <div style={styles.rankReason}>
                {(ranking.blockers[0] ?? ranking.reasons[0] ?? "Building context")}
              </div>
            </div>
            <div style={styles.rankMetrics}>
              <strong style={{ color: tone(ranking.score) }}>{ranking.score}</strong>
              <span>M {ranking.mapAlignment}</span>
              <span>D {ranking.dealerAlignment}</span>
              <span>F {ranking.flowAlignment}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpreadCard({
  spread,
  preferred,
  track,
  sessionStatus,
}: {
  spread: ZeroDteCreditSpreadSelection | null;
  preferred: boolean;
  track: ExecutionCandidateTracking | null;
  sessionStatus: ZeroDteCashSessionStatus;
}) {
  const sideSuffix = spread?.side === "put" ? "P" : spread?.side === "call" ? "C" : "";
  const sideTitle = spread?.side === "put" ? "Put Credit Spread" : "Call Credit Spread";
  const trackedLegs = track?.candidate?.legs ?? [];

  return (
    <div style={{ ...styles.tradeBox, borderColor: preferred ? "rgba(103,232,249,0.75)" : "#1e3a5f" }}>
      <div style={styles.tradeHeaderRow}>
        <div>
          <div style={styles.smallCaps}>{sideTitle} Scanner</div>
          {preferred ? <div style={styles.preferredPill}>Scanner leader</div> : null}
          {sessionStatus === "CLOSED" ? <div style={styles.eodPill}>EOD · diagnostic only</div> : null}
        </div>
        <div>
          <div style={styles.scoreCaption}>Scanner quality</div>
          <div style={{ ...styles.score, color: tone(spread?.shortStrike ? spread.confidence : 0) }}>
            {spread?.shortStrike ? `${spread.confidence}%` : "—"}
          </div>
        </div>
      </div>

      {spread?.shortStrike && spread.longStrike ? (
        <>
          <div style={styles.tradeText}>
            SELL {fmt(spread.shortStrike)}{sideSuffix} / BUY {fmt(spread.longStrike)}{sideSuffix}
          </div>
          <div style={styles.widthNote}>
            Width selected by optimizer: {spread.actualWidth}-wide. Max allowed width: {spread.maxAllowedWidth}. Risk mode: {spread.riskMode}.
          </div>
          <div style={styles.statsGrid}>
            <MiniStat label="Credit" value={money(spread.estimatedCredit)} />
            <MiniStat label="Width" value={spread.actualWidth ?? spread.requestedWidth} />
            <MiniStat label="Max Risk" value={money(spread.maxLoss)} />
            <MiniStat label="$ Risk" value={moneyDollars(spread.maxLossDollars)} />
            <MiniStat label="Credit/Risk" value={spread.creditToRiskPct == null ? "—" : `${(spread.creditToRiskPct * 100).toFixed(1)}%`} />
            <MiniStat label="Credit/Width" value={spread.creditToWidthPct == null ? "—" : `${(spread.creditToWidthPct * 100).toFixed(1)}%`} />
            <MiniStat label="BE" value={fmt(spread.breakeven)} />
            <MiniStat label="EM Used" value={spread.distanceAsExpectedMovePct == null ? "—" : `${Math.round(spread.distanceAsExpectedMovePct * 100)}%`} />
            <MiniStat label="Delta" value={spread.shortDeltaAbs == null ? "—" : spread.shortDeltaAbs.toFixed(2)} />
          </div>
          <div style={styles.wallText}>{spread.wallRelationship}</div>
          {spread.reasons.slice(0, 4).map((reason, idx) => <div key={idx} style={styles.reasonLine}>• {reason}</div>)}
        </>
      ) : (
        <>
          <div style={styles.emptySpread}>No scanner candidate currently clears all quote and risk-policy gates.</div>
          {spread ? <ScannerRejectionDiagnostics spread={spread} /> : null}
        </>
      )}

      <div style={styles.trackedBox}>
        <div style={styles.trackedHeader}>
          <div style={styles.smallCaps}>Tracked Signal Candidate</div>
          <span style={styles.trackState}>{track?.status?.replaceAll("_", " ") ?? "NO CANDIDATE"}</span>
        </div>
        {track?.candidate ? (
          <>
            <div style={styles.trackedLegs}>{formatCandidateLegs(trackedLegs)}</div>
            <div style={styles.trackedMeta}>
              <span>Score {track.candidate.score}</span>
              <span>Age {track.ageCandles} candle{track.ageCandles === 1 ? "" : "s"}</span>
              <span>{track.lockedAt ? `Locked ${new Date(track.lockedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Lock pending"}</span>
            </div>
            {track.scannerCandidate && track.scannerCandidate.setupKey !== track.candidate.setupKey ? (
              <div style={styles.challengerLine}>
                Challenger: {formatCandidateLegs(track.scannerCandidate.legs)} · score {track.scannerCandidate.score}
              </div>
            ) : null}
          </>
        ) : (
          <div style={styles.muted}>No exact spread is currently locked for candle-close evaluation.</div>
        )}
      </div>
    </div>
  );
}

function ScannerRejectionDiagnostics({ spread }: { spread: ZeroDteCreditSpreadSelection }) {
  const d = spread.rejectionDiagnostics;
  const labels: Record<string, string> = {
    missing_expected_move: "Expected move missing",
    missing_long_leg: "Long leg unavailable",
    incomplete_quote: "Incomplete bid/ask",
    nonpositive_mark: "Package mark ≤ 0",
    nonpositive_sellable: "Crossed sellable ≤ 0",
    invalid_width: "Width invalid",
    below_min_credit: "Sellable < min credit",
    below_credit_risk: "Credit/risk below floor",
    above_max_risk: "Max risk exceeded",
    inside_absolute_distance: "Inside absolute distance",
    inside_expected_move_distance: "Inside EM distance",
    missing_delta: "Delta missing",
    above_delta_limit: "Delta above cap",
  };
  const top = Object.entries(d.rejected).filter(([,n]) => n > 0).sort((a,b) => b[1]-a[1]).slice(0,6);
  const f = d.filters;
  return (
    <div style={styles.diagnosticBox}>
      <div style={styles.diagnosticTitle}>Filter diagnostics · {d.tested} combinations tested · {d.accepted} passed</div>
      <div style={styles.diagnosticPolicy}>
        Policy: {f.minWidth}–{f.maxWidth} wide · max risk {f.maxRiskDollars == null ? "OFF" : `$${Math.round(f.maxRiskDollars)}`} · min sellable ${f.minCredit.toFixed(2)} · C/R ≥ {(f.minCreditToRiskPct*100).toFixed(0)}% · Δ ≤ {f.shortDeltaMax.toFixed(2)} · abs ≥ {f.minAbsoluteDistancePoints.toFixed(1)} pts · EM ≥ {(f.minDistancePctOfExpectedMove*100).toFixed(0)}%
      </div>
      <div style={styles.diagnosticGrid}>
        {top.map(([reason,count]) => <div key={reason} style={styles.diagnosticChip}><strong>{count}</strong><span>{labels[reason] ?? reason}</span></div>)}
      </div>
    </div>
  );
}

function CandidateTable({
  title,
  spread,
  track,
  openSetupKeys,
}: {
  title: string;
  spread: ZeroDteCreditSpreadSelection | null;
  track: ExecutionCandidateTracking | null;
  openSetupKeys: string[];
}) {
  const sideSuffix = spread?.side === "put" ? "P" : spread?.side === "call" ? "C" : "";
  const strategy: ExecutionStrategy = spread?.side === "call" ? "call-credit-spread" : "put-credit-spread";
  const candidates = spread?.candidates ?? [];
  const openKeys = new Set(openSetupKeys);

  return (
    <div style={styles.tableWrap}>
      <div style={styles.smallCaps}>{title}</div>
      {candidates.length ? (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Short</th>
              <th style={styles.th}>Long</th>
              <th style={styles.th}>Width</th>
              <th style={styles.th}>Credit</th>
              <th style={styles.th}>Risk</th>
              <th style={styles.th}>C/R</th>
              <th style={styles.th}>Score</th>
              <th style={styles.th}>EM</th>
              <th style={styles.th}>Δ</th>
              <th style={styles.th}>State</th>
            </tr>
          </thead>
          <tbody>
            {candidates.slice(0, 8).map((candidate, index) => {
              const legs = [
                { optionType: spread?.side ?? "put", action: "sell" as const, strike: candidate.strike },
                { optionType: spread?.side ?? "put", action: "buy" as const, strike: candidate.longStrike },
              ];
              const setupKey = makeExecutionSetupKey(strategy, legs);
              const state = openKeys.has(setupKey)
                ? "OPEN"
                : track?.candidate?.setupKey === setupKey
                  ? "TRACKED"
                  : index === 0
                    ? "SCANNER"
                    : "BOOK";
              return (
                <tr key={`${candidate.strike}-${candidate.longStrike}-${candidate.actualWidth}`} style={{ ...styles.tr, ...(state === "TRACKED" ? styles.trTracked : {}), ...(state === "OPEN" ? styles.trOpen : {}) }}>
                  <td style={styles.tdStrong}>{fmt(candidate.strike)}{sideSuffix}</td>
                  <td style={styles.td}>{fmt(candidate.longStrike)}{sideSuffix}</td>
                  <td style={styles.td}>{candidate.actualWidth}</td>
                  <td style={styles.td}>{money(candidate.estimatedCredit)}</td>
                  <td style={styles.td}>{money(candidate.maxLoss)}</td>
                  <td style={styles.td}>{(candidate.creditToRiskPct * 100).toFixed(1)}%</td>
                  <td style={styles.td}>{candidate.score}</td>
                  <td style={styles.td}>{Math.round(candidate.distanceAsExpectedMovePct * 100)}%</td>
                  <td style={styles.td}>{candidate.shortDeltaAbs == null ? "—" : candidate.shortDeltaAbs.toFixed(2)}</td>
                  <td style={styles.tdState}>{state}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={styles.muted}>No candidates available.</div>
      )}
    </div>
  );
}

function formatCandidateLegs(legs: Array<{ action: "sell" | "buy"; optionType: "put" | "call"; strike: number }>) {
  if (!legs.length) return "—";
  return legs
    .map((leg) => `${leg.action === "sell" ? "SELL" : "BUY"} ${leg.strike.toFixed(0)}${leg.optionType === "put" ? "P" : "C"}`)
    .join(" · ");
}

function Metric({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.smallCaps}>{title}</div>
      <div style={{ ...styles.metricValue, color: tone ?? "#f8fafc" }}>{value}</div>
    </div>
  );
}

function CoverageItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.coverageItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={styles.miniStat}>
      <div style={styles.miniLabel}>{label}</div>
      <div style={styles.miniValue}>{value ?? "—"}</div>
    </div>
  );
}

function ReasonList({ title, items, empty, warning }: { title: string; items: string[]; empty: string; warning?: boolean }) {
  return (
    <div style={styles.reasonBox}>
      <div style={styles.smallCaps}>{title}</div>
      {items.length ? items.slice(0, 8).map((item, idx) => <div key={`${item}-${idx}`} style={warning ? styles.warningLine : styles.reasonLine}>• {item}</div>) : <div style={styles.muted}>{empty}</div>}
    </div>
  );
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function moneyDollars(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Math.round(value).toLocaleString()}`;
}

function tone(score: number) {
  if (score >= 70) return "#34d399";
  if (score <= 40) return "#fb7185";
  return "#fde047";
}

function coverageTone(
  value: string | null | undefined,
) {
  if (value === "FULL") return "#34d399";
  if (value === "PARTIAL") return "#fde047";
  if (value === "MANUAL") return "#67e8f9";
  return "#94a3b8";
}

function moodTone(mood: number | null | undefined) {
  if (mood === null || mood === undefined) return "#94a3b8";
  if (mood >= 40) return "#34d399";
  if (mood <= -40) return "#fb7185";
  return "#fde047";
}

const styles: Record<string, React.CSSProperties> = {
  card: { border: "1px solid rgba(34,211,238,0.28)", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  headerRow: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: 950, margin: "0 0 4px" },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.45, margin: 0 },
  smallCaps: { color: "#93b5d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" },
  sourceLine: { marginTop: 3, color: "#94a3b8", fontSize: 12 },
  badgeWrap: { textAlign: "right", minWidth: 230 },
  badgeValue: { marginTop: 4, fontSize: 18, fontWeight: 950 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 },
  coverageCard: {
    border: "1px solid #1e3a5f",
    background: "#07111f",
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  coverageHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  coverageStatus: {
    marginTop: 3,
    fontWeight: 900,
    fontSize: 18,
  },
  coverageSource: {
    color: "#94a3b8",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  coverageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 8,
    marginTop: 10,
  },
  coverageItem: {
    display: "grid",
    gap: 3,
    border: "1px solid #17324a",
    borderRadius: 9,
    padding: "8px 10px",
    color: "#7f95a8",
    fontSize: 9,
  },
  coverageSummary: {
    marginTop: 9,
    color: "#9fb2c4",
    fontSize: 10,
  },

  metricCard: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  metricValue: { marginTop: 6, fontSize: 19, fontWeight: 950, wordBreak: "break-word" },
  tradeBox: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 16, padding: 16 },
  tradeHeaderRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  preferredPill: { display: "inline-block", marginTop: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(34,211,238,0.14)", color: "#67e8f9", fontSize: 11, fontWeight: 900 },
  eodPill: { display: "inline-block", marginTop: 6, marginLeft: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(148,163,184,.12)", color: "#a8b7c5", fontSize: 10, fontWeight: 850 },
  scoreCaption: { color: "#7890a4", fontSize: 9, textTransform: "uppercase", textAlign: "right" },
  score: { fontSize: 24, fontWeight: 950 },
  tradeText: { marginTop: 10, fontSize: 23, fontWeight: 950, color: "#67e8f9" },
  widthNote: { marginTop: 8, color: "#93b5d9", fontSize: 12, fontWeight: 800 },
  emptySpread: { marginTop: 16, color: "#fca5a5", fontSize: 14, fontWeight: 800 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 },
  miniStat: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 10, padding: 9 },
  miniLabel: { color: "#93b5d9", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 900 },
  miniValue: { marginTop: 4, color: "#f8fafc", fontSize: 15, fontWeight: 900 },
  wallText: { marginTop: 10, color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 },
  trackedBox: { marginTop: 14, paddingTop: 12, borderTop: "1px solid #1e3a5f" },
  trackedHeader: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" },
  trackState: { color: "#fde047", fontSize: 10, fontWeight: 900 },
  trackedLegs: { marginTop: 8, color: "#e5eef6", fontSize: 14, fontWeight: 900 },
  trackedMeta: { marginTop: 7, display: "flex", gap: 10, flexWrap: "wrap", color: "#8da2b4", fontSize: 10 },
  challengerLine: { marginTop: 8, color: "#facc15", fontSize: 11, lineHeight: 1.4 },
  reasonBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  reasonLine: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.55, marginTop: 5 },
  warningLine: { color: "#fde68a", fontSize: 13, lineHeight: 1.55, marginTop: 5 },
  tableWrap: { overflowX: "auto", border: "1px solid #1e3a5f", borderRadius: 14, padding: 12, background: "#07111f" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 },
  th: { textAlign: "left", color: "#93b5d9", borderBottom: "1px solid #1e3a5f", padding: "8px 10px", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(30,58,95,0.6)" },
  trTracked: { background: "rgba(34,211,238,.08)" },
  trOpen: { background: "rgba(52,211,153,.08)" },
  td: { color: "#cbd5e1", padding: "8px 10px", whiteSpace: "nowrap" },
  tdState: { color: "#fde047", padding: "8px 10px", whiteSpace: "nowrap", fontSize: 10, fontWeight: 900 },
  tdStrong: { color: "#67e8f9", padding: "8px 10px", fontWeight: 900, whiteSpace: "nowrap" },
  rankingCard: {
    marginTop: 14,
    background: "#081521",
    border: "1px solid #1d3b53",
    borderRadius: 14,
    padding: 14,
  },
  rankingHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  rankingTitle: {
    marginTop: 4,
    color: "#e6f1f8",
    fontWeight: 850,
    fontSize: 15,
  },
  mapCenter: {
    display: "grid",
    gap: 2,
    color: "#6f8599",
    fontSize: 10,
    textAlign: "right",
  },
  diagnosticBox: { marginTop: 8, display: "grid", gap: 6, border: "1px solid rgba(251,113,133,.28)", borderRadius: 9, padding: 8, background: "rgba(90,18,29,.10)" },
  diagnosticTitle: { color: "#f4b4bb", fontSize: 9, fontWeight: 850 },
  diagnosticPolicy: { color: "#8296aa", fontSize: 8, lineHeight: 1.45 },
  diagnosticGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 },
  diagnosticChip: { minWidth: 0, display: "grid", gap: 2, border: "1px solid #22384b", borderRadius: 7, padding: 6, background: "#08131c", color: "#8da1b4", fontSize: 8 },

  rankingGrid: {
    display: "grid",
    gap: 8,
    marginTop: 12,
  },
  rankingRow: {
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    background: "#0b1a27",
    border: "1px solid #19364b",
    borderRadius: 10,
    padding: "10px 12px",
  },
  rankingWinner: {
    borderColor: "rgba(103,232,249,.72)",
    boxShadow: "0 0 0 1px rgba(103,232,249,.08) inset",
  },
  rankNumber: {
    color: "#67e8f9",
    fontWeight: 900,
    fontSize: 16,
  },
  rankMain: {
    minWidth: 0,
  },
  rankLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#f8fafc",
    fontWeight: 850,
  },
  blockedPill: {
    color: "#fda4af",
    border: "1px solid rgba(251,113,133,.45)",
    borderRadius: 999,
    padding: "2px 6px",
    fontSize: 8,
    textTransform: "uppercase",
  },
  rankStrikes: {
    color: "#9fb2c4",
    fontSize: 11,
    marginTop: 2,
  },
  rankReason: {
    color: "#6f8599",
    fontSize: 10,
    marginTop: 4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rankMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(4, auto)",
    gap: 7,
    color: "#73899c",
    fontSize: 9,
    alignItems: "center",
  },

};
