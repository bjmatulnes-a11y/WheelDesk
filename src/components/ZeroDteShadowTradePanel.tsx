"use client";

import type React from "react";
import type { ZeroDteShadowTrade } from "../lib/zeroDteShadowTrade";

export function ZeroDteShadowTradePanel({
  trades,
  error,
}: {
  trades: ZeroDteShadowTrade[];
  error?: string | null;
}) {
  const open = trades.filter((trade) => trade.state === "open");
  const closed = trades.filter((trade) => trade.state === "closed");
  const closedPnl = closed.reduce(
    (sum, trade) => sum + (trade.pnlConservativeDollars ?? 0),
    0,
  );
  const closedWins = closed.filter((trade) => (trade.pnlConservativeDollars ?? 0) > 0).length;
  const adaptiveTracked = trades.filter((trade) => trade.adaptiveState !== null);
  const adaptiveOpen = adaptiveTracked.filter((trade) => trade.adaptiveState === "open");
  const adaptiveClosed = adaptiveTracked.filter((trade) => trade.adaptiveState === "closed");
  const adaptiveClosedPnl = adaptiveClosed.reduce(
    (sum, trade) => sum + (trade.adaptivePnlDollars ?? 0),
    0,
  );
  const adaptiveMarkedPnl = adaptiveTracked.reduce(
    (sum, trade) => sum + adaptiveCurrentPnl(trade),
    0,
  );
  const pairedClosed = trades.filter(
    (trade) => trade.state === "closed" && trade.adaptiveState === "closed",
  );
  const pairedDelta = pairedClosed.reduce(
    (sum, trade) =>
      sum +
      ((trade.adaptivePnlDollars ?? 0) - (trade.pnlConservativeDollars ?? 0)),
    0,
  );
  const peakCaptures = trades
    .map((trade) => peakCapturePct(trade))
    .filter((value): value is number => value !== null);
  const averagePeakCapture = peakCaptures.length
    ? peakCaptures.reduce((sum, value) => sum + value, 0) / peakCaptures.length
    : null;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Shadow Lab</div>
          <strong>Static vs adaptive forward validation</strong>
        </div>
        <span style={styles.status}>LIVE PAPER</span>
      </div>

      <div style={styles.metrics}>
        <Metric label="Static open" value={String(open.length)} />
        <Metric label="Static closed" value={String(closed.length)} />
        <Metric label="Static P/L" value={money(closedPnl)} />
        <Metric
          label="Static win rate"
          value={closed.length ? `${Math.round((closedWins / closed.length) * 100)}%` : "—"}
        />
        <Metric label="Adaptive open" value={String(adaptiveOpen.length)} />
        <Metric label="Adaptive closed" value={String(adaptiveClosed.length)} />
        <Metric label="Adaptive marked P/L" value={money(adaptiveMarkedPnl)} />
        <Metric
          label="Adaptive vs static"
          value={pairedClosed.length ? signedMoney(pairedDelta) : "—"}
        />
        <Metric
          label="Avg peak capture"
          value={averagePeakCapture === null ? "—" : `${averagePeakCapture.toFixed(0)}%`}
        />
        <Metric
          label="Short touches"
          value={String(trades.filter((trade) => trade.hitShortStrike).length)}
        />
        <Metric
          label="Hit 1.5× debit"
          value={String(trades.filter((trade) => trade.hitOnePointFiveX).length)}
        />
        <Metric
          label="Hit 2× debit"
          value={String(trades.filter((trade) => trade.hitTwoX).length)}
        />
      </div>

      <div style={styles.note}>
        Static keeps the existing 50% premium TP / 3× short stop / profit-protection
        policy. Adaptive runs beside it without changing live execution. Verticals
        can extend harvest to 65–80% only when the thesis strengthens. Iron Flies
        are managed by center validity and a defined-risk R target rather than by a
        fixed 50% credit target.
      </div>

      {adaptiveClosed.length ? (
        <div style={styles.studyNote}>
          Adaptive closed P/L {money(adaptiveClosedPnl)} across {adaptiveClosed.length} completed adaptive paths.
        </div>
      ) : null}

      {error ? <div style={styles.error}>{error}</div> : null}

      {trades.length ? (
        <div style={styles.list}>
          {[...trades]
            .sort((a, b) => Date.parse(b.signalTime) - Date.parse(a.signalTime))
            .map((trade) => (
              <div key={trade.id} style={styles.row}>
                <div style={styles.left}>
                  <strong>{label(trade.strategy)}</strong>
                  <span style={styles.muted}>
                    {formatLegs(trade.legs)} · score {Math.round(trade.entryScore)}
                  </span>
                  <span style={styles.muted}>
                    crest {trade.premiumCrestStatus ?? "—"} · path {trade.pathDirection ?? "—"}
                    {trade.pathConfidence == null ? "" : ` ${Math.round(trade.pathConfidence)}%`}
                  </span>
                  <AdaptiveRead trade={trade} />
                </div>
                <div style={styles.right}>
                  <span style={styles.managerLabel}>STATIC</span>
                  <strong
                    style={{
                      color:
                        trade.state === "open"
                          ? "#f5c542"
                          : (trade.pnlConservativeDollars ?? 0) >= 0
                            ? "#71e0b4"
                            : "#ff8a9a",
                    }}
                  >
                    {trade.state === "open"
                      ? `OPEN · ${credit(trade.currentBuybackDebit)}`
                      : money(trade.pnlConservativeDollars)}
                  </strong>
                  <span style={styles.muted}>
                    MAE {money(trade.maxAdverseExcursionDollars)} · MFE{" "}
                    {money(trade.maxFavorableExcursionDollars)}
                  </span>
                  <span style={styles.muted}>
                    Open {credit(trade.entrySellableCredit)} · TP debit ≤ {credit(trade.entrySellableCredit * 0.5)} · short {trade.currentShortLegMultiple == null ? "—" : `${trade.currentShortLegMultiple.toFixed(2)}× / 3.00×`}
                  </span>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div style={styles.empty}>
          Waiting for the first confirmed SELL_READY signal.
        </div>
      )}
    </div>
  );
}

function AdaptiveRead({ trade }: { trade: ZeroDteShadowTrade }) {
  if (trade.adaptiveState === null) {
    return <span style={styles.adaptiveMuted}>ADAPTIVE · legacy row / not tracked</span>;
  }
  const tone = adaptiveTone(trade.adaptiveManagementState, trade.adaptiveState);
  const target =
    trade.strategy === "iron-fly" && trade.adaptiveTargetR !== null
      ? `${trade.adaptiveTargetR.toFixed(1)}R · debit ≤ ${credit(trade.adaptiveTargetDebit)}`
      : trade.adaptiveTargetCapturePct !== null
        ? `${Math.round(trade.adaptiveTargetCapturePct)}% · debit ≤ ${credit(trade.adaptiveTargetDebit)}`
        : "—";
  const pnl =
    trade.adaptiveState === "closed"
      ? trade.adaptivePnlDollars
      : adaptiveCurrentPnl(trade);

  return (
    <div style={styles.adaptiveBox}>
      <div style={styles.adaptiveHead}>
        <strong style={{ color: tone }}>{`ADAPTIVE · ${trade.adaptiveManagementState ?? "WARMING"}`}</strong>
        <span style={{ color: tone }}>{trade.adaptiveAction ?? "HOLD"}</span>
      </div>
      <span style={styles.adaptiveText}>
        P/L {money(pnl)} · target {target}
      </span>
      <span style={styles.adaptiveText}>
        Thesis {score(trade.adaptiveThesisScore)} · Favor {score(trade.adaptiveFavorableScore)} · Threat {score(trade.adaptiveThreatScore)} · Invalid {score(trade.adaptiveInvalidationScore)}
      </span>
      <span style={styles.adaptiveText}>
        MAE {money(trade.adaptiveMaxAdverseExcursionDollars)} · MFE {money(trade.adaptiveMaxFavorableExcursionDollars)}
        {trade.adaptiveProfitGivebackPct == null ? "" : ` · giveback ${Math.round(trade.adaptiveProfitGivebackPct)}%`}
      </span>
      {trade.adaptiveAuctionState ? (
        <span style={styles.adaptiveText}>
          ES {trade.adaptiveAuctionState}
          {trade.adaptiveAuctionPressurePct == null ? "" : ` · pressure ${signedPct(trade.adaptiveAuctionPressurePct)}`}
          {trade.adaptiveAuctionEfficiencyPct == null ? "" : ` · eff ${Math.round(trade.adaptiveAuctionEfficiencyPct)}%`}
          {trade.adaptiveProjectedPocSpx == null ? "" : ` · SPX POC ${trade.adaptiveProjectedPocSpx.toFixed(1)}`}
        </span>
      ) : null}
      {trade.adaptiveState === "closed" && trade.adaptiveExitReason ? (
        <span style={styles.adaptiveText}>Exit: {trade.adaptiveExitReason}</span>
      ) : trade.adaptiveReason ? (
        <span style={styles.adaptiveReason}>{trade.adaptiveReason}</span>
      ) : null}
    </div>
  );
}

function adaptiveCurrentPnl(trade: ZeroDteShadowTrade) {
  if (trade.adaptiveState === "closed") return trade.adaptivePnlDollars ?? 0;
  if (trade.currentBuybackDebit == null) return 0;
  return (trade.entrySellableCredit - trade.currentBuybackDebit) * 100;
}

function peakCapturePct(trade: ZeroDteShadowTrade) {
  const entry = trade.entryMarkCredit;
  const peak = Math.max(trade.signalPeakCredit ?? 0, trade.maxMarkCredit ?? 0);
  if (entry == null || !Number.isFinite(entry) || peak <= 0) return null;
  return Math.max(0, Math.min(100, (entry / peak) * 100));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function label(strategy: ZeroDteShadowTrade["strategy"]) {
  if (strategy === "put-credit-spread") return "PUT CREDIT";
  if (strategy === "call-credit-spread") return "CALL CREDIT";
  return "IRON FLY";
}

function formatLegs(legs: ZeroDteShadowTrade["legs"]) {
  return legs
    .map(
      (leg) =>
        `${leg.action === "sell" ? "S" : "B"}${leg.strike.toFixed(0)}${leg.optionType === "call" ? "C" : "P"}`,
    )
    .join(" · ");
}

function adaptiveTone(
  state: ZeroDteShadowTrade["adaptiveManagementState"],
  adaptiveState: ZeroDteShadowTrade["adaptiveState"],
) {
  if (adaptiveState === "closed") return "#71e0b4";
  if (state === "INVALIDATED") return "#ff7a8a";
  if (state === "THREATENED") return "#ffb55c";
  if (state === "RECOVERY") return "#8fd3ff";
  if (state === "FAVORABLE_RELEASE") return "#71e0b4";
  if (state === "HARVEST") return "#b38cff";
  return "#b8c6d4";
}

function score(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : String(Math.round(value));
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
}

function credit(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(0)}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    marginTop: 14,
    background: "#08131d",
    border: "1px solid #173047",
    borderRadius: 13,
    padding: 13,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  eyebrow: {
    color: "#b38cff",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: 850,
    marginBottom: 3,
  },
  status: {
    color: "#b38cff",
    border: "1px solid rgba(179,140,255,.4)",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 10,
    fontWeight: 850,
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
    gap: 7,
    marginTop: 10,
  },
  metric: {
    display: "grid",
    gap: 2,
    padding: 8,
    borderRadius: 8,
    border: "1px solid #1f3548",
    background: "#0a1823",
    color: "#8296aa",
    fontSize: 9,
  },
  note: {
    color: "#8296aa",
    fontSize: 10,
    lineHeight: 1.5,
    marginTop: 10,
  },
  studyNote: {
    marginTop: 8,
    color: "#aab9c7",
    fontSize: 10,
    borderLeft: "2px solid #b38cff",
    paddingLeft: 8,
  },
  list: {
    display: "grid",
    gap: 6,
    marginTop: 10,
    maxHeight: 520,
    overflowY: "auto",
    paddingRight: 4,
    overscrollBehavior: "contain",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: 8,
    borderRadius: 8,
    border: "1px solid #1f3548",
    background: "#091722",
    fontSize: 10,
  },
  left: {
    flex: 1,
    minWidth: 0,
  },
  right: {
    textAlign: "right",
    display: "grid",
    alignContent: "start",
    gap: 2,
    minWidth: 230,
  },
  managerLabel: {
    color: "#60778b",
    fontSize: 8,
    fontWeight: 850,
    letterSpacing: 0.8,
  },
  muted: {
    display: "block",
    color: "#75899b",
    marginTop: 2,
  },
  adaptiveBox: {
    marginTop: 7,
    padding: 7,
    borderRadius: 7,
    border: "1px solid rgba(179,140,255,.24)",
    background: "rgba(179,140,255,.045)",
    display: "grid",
    gap: 2,
  },
  adaptiveHead: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 9,
  },
  adaptiveText: {
    color: "#8ea1b3",
    fontSize: 9,
    lineHeight: 1.35,
  },
  adaptiveReason: {
    color: "#a9b8c6",
    fontSize: 9,
    lineHeight: 1.35,
    marginTop: 2,
  },
  adaptiveMuted: {
    display: "block",
    marginTop: 6,
    color: "#5d7182",
    fontSize: 9,
  },
  empty: {
    color: "#617789",
    fontSize: 10,
    marginTop: 10,
  },
  error: {
    color: "#ff9aa8",
    fontSize: 10,
    marginTop: 8,
  },
};
