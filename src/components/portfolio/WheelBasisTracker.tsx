"use client";

import { useEffect, useMemo, useState } from "react";
import type { PortfolioPosition } from "../../lib/portfolio-types";
import {
  buildWheelBasisSummary,
  normalizeWheelBasisAdjustment,
  wheelAdjustmentLabel,
  type WheelBasisAdjustment,
  type WheelBasisAdjustmentKind,
} from "../../lib/wheel-basis-engine";

const KINDS: WheelBasisAdjustmentKind[] = [
  "PUT_EXPIRED",
  "CALL_EXPIRED",
  "NET_ROLL_CREDIT",
  "NET_ROLL_DEBIT",
  "PUT_ASSIGNED_CREDIT",
  "CALL_BUYBACK_DEBIT",
  "DIVIDEND",
  "MANUAL_CREDIT",
  "MANUAL_DEBIT",
];

function storageKey(profileId: string): string {
  return `wheelDesk.wheelBasisLedger.v1.${profileId || "default"}`;
}

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cashTone(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "#111827";
  if (value < 0) return "#dc2626";
  if (value > 0) return "#16a34a";
  return "#111827";
}

function basisTone(broker?: number | null, adjusted?: number | null): string {
  if (adjusted == null || broker == null) return "#111827";
  if (adjusted < broker) return "#16a34a";
  if (adjusted > broker) return "#dc2626";
  return "#111827";
}

function tickerFromPosition(position: any): string {
  return String(position?.symbol ?? position?.ticker ?? position?.underlying ?? "").trim().toUpperCase();
}

function Metric({ label, value, help }: { label: string; value: React.ReactNode; help?: React.ReactNode }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      {help ? <div style={styles.metricHelp}>{help}</div> : null}
    </div>
  );
}

export default function WheelBasisTracker({
  profileId,
  positions,
}: {
  profileId: string;
  positions: PortfolioPosition[];
}) {
  const [adjustments, setAdjustments] = useState<WheelBasisAdjustment[]>([]);
  const [ticker, setTicker] = useState("");
  const [kind, setKind] = useState<WheelBasisAdjustmentKind>("PUT_EXPIRED");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!profileId || typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey(profileId));
      const parsed = raw ? JSON.parse(raw) : [];
      setAdjustments(Array.isArray(parsed) ? parsed : []);
    } catch {
      setAdjustments([]);
    }
  }, [profileId]);

  function persist(next: WheelBasisAdjustment[]) {
    setAdjustments(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(profileId), JSON.stringify(next));
    }
  }

  const summaries = useMemo(
    () => buildWheelBasisSummary({ positions, adjustments }),
    [positions, adjustments]
  );

  const tickers = useMemo(() => {
    const values = new Set<string>();

    for (const position of positions ?? []) {
      const symbol = tickerFromPosition(position);
      if (symbol) values.add(symbol);
    }

    for (const adjustment of adjustments) {
      if (adjustment.ticker) values.add(adjustment.ticker);
    }

    return Array.from(values).sort();
  }, [positions, adjustments]);

  useEffect(() => {
    if (!ticker && tickers.length) setTicker(tickers[0]);
  }, [ticker, tickers]);

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, row) => {
        acc.credits += row.totalPremiumCredits;
        acc.debits += row.totalPremiumDebits;
        acc.stockCost += row.brokerStockCost;
        acc.adjustedCost += row.wheelAdjustedCost;
        return acc;
      },
      { credits: 0, debits: 0, stockCost: 0, adjustedCost: 0 }
    );
  }, [summaries]);

  function addAdjustment() {
    const normalized = normalizeWheelBasisAdjustment({
      ticker,
      kind,
      amount: Number(amount),
      date,
      notes,
    });

    if (!normalized) return;

    persist([normalized, ...adjustments]);
    setAmount("");
    setNotes("");
  }

  function removeAdjustment(id: string) {
    persist(adjustments.filter((adjustment) => adjustment.id !== id));
  }

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <h3 style={{ margin: 0 }}>Wheel Basis Tracker</h3>
          <p style={styles.subtle}>
            Economic basis tracking for the wheel. Expired puts, expired calls, and net roll credits reduce the WheelDesk adjusted basis.
          </p>
        </div>

        <div style={styles.badge}>
          {adjustments.length} ledger item{adjustments.length === 1 ? "" : "s"}
        </div>
      </div>

      <div style={styles.metricsGrid}>
        <Metric label="Total Credits" value={<span style={{ color: "#16a34a" }}>{money(totals.credits)}</span>} />
        <Metric label="Total Debits" value={<span style={{ color: "#dc2626" }}>{money(totals.debits)}</span>} />
        <Metric label="Broker Stock Cost" value={money(totals.stockCost)} />
        <Metric
          label="Wheel Adjusted Cost"
          value={<span style={{ color: cashTone(totals.stockCost - totals.adjustedCost) }}>{money(totals.adjustedCost)}</span>}
          help="Broker stock cost minus net wheel credits."
        />
      </div>

      <div style={styles.formGrid}>
        <label style={styles.label}>
          Ticker
          <input
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            list="wheel-basis-tickers"
            style={styles.input}
            placeholder="SOFI"
          />
          <datalist id="wheel-basis-tickers">
            {tickers.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>

        <label style={styles.label}>
          Event
          <select value={kind} onChange={(event) => setKind(event.target.value as WheelBasisAdjustmentKind)} style={styles.input}>
            {KINDS.map((item) => (
              <option key={item} value={item}>
                {wheelAdjustmentLabel(item)}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Amount
          <input
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            style={styles.input}
            placeholder="Credit/debit total $"
          />
        </label>

        <label style={styles.label}>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={styles.input} />
        </label>

        <label style={{ ...styles.label, gridColumn: "span 2" }}>
          Notes
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            style={styles.input}
            placeholder="Example: 5 contracts expired worthless at $0.42"
          />
        </label>

        <button type="button" onClick={addAdjustment} style={styles.button}>
          Add Wheel Credit / Debit
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {[
                "Ticker",
                "Shares",
                "Broker Basis",
                "Wheel Basis",
                "Credit / Share",
                "CSP Credits",
                "CC Credits",
                "Net Rolls",
                "Unallocated",
                "Short C/P",
              ].map((header) => (
                <th key={header} style={styles.th}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summaries.length ? (
              summaries.map((row) => (
                <tr key={row.ticker}>
                  <td style={styles.tdStrong}>{row.ticker}</td>
                  <td style={styles.tdRight}>{row.stockShares.toLocaleString()}</td>
                  <td style={styles.tdRight}>{money(row.brokerBasisPerShare)}</td>
                  <td style={{ ...styles.tdRight, color: basisTone(row.brokerBasisPerShare, row.wheelAdjustedBasisPerShare), fontWeight: 900 }}>
                    {money(row.wheelAdjustedBasisPerShare)}
                  </td>
                  <td style={{ ...styles.tdRight, color: cashTone(row.wheelCreditPerShare), fontWeight: 900 }}>
                    {money(row.wheelCreditPerShare)}
                  </td>
                  <td style={styles.tdRight}>{money(row.cspCredits)}</td>
                  <td style={styles.tdRight}>{money(row.coveredCallCredits)}</td>
                  <td style={{ ...styles.tdRight, color: cashTone(row.netRollCredits), fontWeight: 900 }}>{money(row.netRollCredits)}</td>
                  <td style={styles.tdRight}>{money(row.unallocatedWheelCredit)}</td>
                  <td style={styles.tdRight}>{row.shortCalls.toLocaleString()} / {row.shortPuts.toLocaleString()}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td style={styles.td} colSpan={10}>No positions or wheel ledger entries yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adjustments.length ? (
        <details style={styles.details}>
          <summary style={{ cursor: "pointer", fontWeight: 900 }}>Wheel premium ledger</summary>

          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {adjustments.slice(0, 30).map((adjustment) => (
              <div key={adjustment.id} style={styles.ledgerRow}>
                <div>
                  <strong>{adjustment.ticker}</strong> · {adjustment.date} · {wheelAdjustmentLabel(adjustment.kind)}
                  {adjustment.notes ? <div style={styles.subtle}>{adjustment.notes}</div> : null}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong style={{ color: adjustment.kind.includes("DEBIT") ? "#dc2626" : "#16a34a" }}>
                    {money(adjustment.amount)}
                  </strong>
                  <button type="button" onClick={() => removeAdjustment(adjustment.id)} style={styles.deleteButton}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <p style={styles.disclaimer}>
        WheelDesk basis is an economic management basis, not tax basis. Broker/tax basis may differ.
      </p>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid #d1d5db",
    borderRadius: 8,
    background: "#fff",
    padding: "0.8rem",
    display: "grid",
    gap: "0.8rem",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "flex-start",
  },
  subtle: {
    margin: "0.25rem 0 0",
    fontSize: 12,
    color: "#4b5563",
    lineHeight: 1.4,
  },
  badge: {
    border: "1px solid #d1d5db",
    borderRadius: 999,
    padding: "0.35rem 0.65rem",
    color: "#0891b2",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 8,
  },
  metric: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: "0.65rem",
    background: "#fff",
  },
  metricLabel: {
    fontSize: 11,
    color: "#4b5563",
    fontWeight: 700,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 800,
    marginTop: 4,
  },
  metricHelp: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 4,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    alignItems: "end",
  },
  label: {
    display: "grid",
    gap: 4,
    fontSize: 12,
    fontWeight: 700,
  },
  input: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "0.45rem",
  },
  button: {
    border: "1px solid #0891b2",
    borderRadius: 8,
    background: "#0891b2",
    color: "#fff",
    padding: "0.55rem 0.75rem",
    fontWeight: 900,
    cursor: "pointer",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  th: {
    textAlign: "left",
    borderBottom: "1px solid #e5e7eb",
    padding: 6,
    color: "#4b5563",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #f3f4f6",
    padding: 6,
  },
  tdStrong: {
    borderBottom: "1px solid #f3f4f6",
    padding: 6,
    fontWeight: 900,
  },
  tdRight: {
    borderBottom: "1px solid #f3f4f6",
    padding: 6,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  details: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "0.65rem",
  },
  ledgerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    border: "1px solid #f3f4f6",
    borderRadius: 6,
    padding: "0.55rem",
    fontSize: 12,
  },
  deleteButton: {
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#b91c1c",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },
  disclaimer: {
    margin: 0,
    fontSize: 11,
    color: "#6b7280",
  },
};
