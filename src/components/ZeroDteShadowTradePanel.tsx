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
          <strong>Automatic forward validation</strong>
        </div>
        <span style={styles.status}>LIVE PAPER</span>
      </div>

      <div style={styles.metrics}>
        <Metric label="Open" value={String(open.length)} />
        <Metric label="Closed" value={String(closed.length)} />
        <Metric label="Closed P/L" value={money(closedPnl)} />
        <Metric
          label="Win rate"
          value={closed.length ? `${Math.round((closedWins / closed.length) * 100)}%` : "—"}
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
        Every confirmed SELL_READY signal is paper-entered at conservative
        sellable credit. Shadow exits are deterministic: 50% premium take-profit,
        3× short-leg premium stop, or large-profit giveback protection. Map/LRP
        warnings remain advisory and do not create small-loss emergency exits.
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}

      {trades.length ? (
        <div style={styles.list}>
          {[...trades]
            .sort((a, b) => Date.parse(b.signalTime) - Date.parse(a.signalTime))
            .slice(0, 8)
            .map((trade) => (
              <div key={trade.id} style={styles.row}>
                <div>
                  <strong>{label(trade.strategy)}</strong>
                  <span style={styles.muted}>
                    {formatLegs(trade.legs)} · score {Math.round(trade.entryScore)}
                  </span>
                  <span style={styles.muted}>
                    crest {trade.premiumCrestStatus ?? "—"} · path {trade.pathDirection ?? "—"}{trade.pathConfidence == null ? "" : ` ${Math.round(trade.pathConfidence)}%`}
                  </span>
                </div>
                <div style={styles.right}>
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
                      ? `OPEN · ${money(trade.currentBuybackDebit)}`
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

function credit(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(0)}`;
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
  list: {
    display: "grid",
    gap: 6,
    marginTop: 10,
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
  right: {
    textAlign: "right",
    display: "grid",
    gap: 2,
  },
  muted: {
    display: "block",
    color: "#75899b",
    marginTop: 2,
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
