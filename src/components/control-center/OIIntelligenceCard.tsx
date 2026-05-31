"use client";

import { useState } from "react";
import { analyzeOIIntelligence, type OIAnomaly } from "../../lib/oi-intelligence-engine";
import { safeFixed } from "../../lib/format";
import type { ChainRow, ExpirationSummary } from "../../lib/types";
import type { OptionSurfaceSnapshot } from "../../lib/wheeldesk-storage";
import { colors, cardStyle } from "./styles";

type OIIntelligenceCardProps = {
  surface: OptionSurfaceSnapshot | null;
  currentPrice: number;
  title?: string;
};

type Side = "call" | "put";

type NormalizedOptionRow = {
  strike: number;
  side: Side;
  oi: number;
  volume: number;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? safeFixed(n, 2) : "N/A";
}

function formatInt(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : "N/A";
}

function getSide(row: any): Side | null {
  const value = String(
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

  if (value.includes("call")) return "call";
  if (value.includes("put")) return "put";
  return null;
}

function getStrike(row: any): number | null {
  return (
    toNumber(row?.strike) ??
    toNumber(row?.raw?.strike) ??
    null
  );
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toNumber(value);
    if (n != null) return n;
  }
  return null;
}

function getGenericOpenInterest(row: any): number | null {
  return readNumber(
    row?.openInterest,
    row?.open_interest,
    row?.oi,
    row?.raw?.openInterest,
    row?.raw?.open_interest,
    row?.raw?.oi
  );
}

function getSideOpenInterest(row: any, side: Side): number | null {
  if (side === "call") {
    return readNumber(
      row?.callOi,
      row?.callOI,
      row?.call_oi,
      row?.callOpenInterest,
      row?.call_open_interest,
      row?.call?.openInterest,
      row?.call?.open_interest,
      row?.raw?.callOi,
      row?.raw?.callOI,
      row?.raw?.call_oi,
      row?.raw?.callOpenInterest,
      row?.raw?.call_open_interest,
      row?.raw?.call?.openInterest,
      row?.raw?.call?.open_interest
    );
  }

  return readNumber(
    row?.putOi,
    row?.putOI,
    row?.put_oi,
    row?.putOpenInterest,
    row?.put_open_interest,
    row?.put?.openInterest,
    row?.put?.open_interest,
    row?.raw?.putOi,
    row?.raw?.putOI,
    row?.raw?.put_oi,
    row?.raw?.putOpenInterest,
    row?.raw?.put_open_interest,
    row?.raw?.put?.openInterest,
    row?.raw?.put?.open_interest
  );
}

function getOpenInterest(row: any, side: Side): number | null {
  return getSideOpenInterest(row, side) ?? getGenericOpenInterest(row);
}

function getGenericVolume(row: any): number | null {
  return readNumber(row?.volume, row?.raw?.volume);
}

function getSideVolume(row: any, side: Side): number | null {
  if (side === "call") {
    return readNumber(
      row?.callVolume,
      row?.call_volume,
      row?.call?.volume,
      row?.raw?.callVolume,
      row?.raw?.call_volume,
      row?.raw?.call?.volume
    );
  }

  return readNumber(
    row?.putVolume,
    row?.put_volume,
    row?.put?.volume,
    row?.raw?.putVolume,
    row?.raw?.put_volume,
    row?.raw?.put?.volume
  );
}

function getVolume(row: any, side: Side): number {
  return getSideVolume(row, side) ?? getGenericVolume(row) ?? 0;
}

function normalizeRows(surface: OptionSurfaceSnapshot | null): NormalizedOptionRow[] {
  const rows: NormalizedOptionRow[] = [];

  for (const chain of surface?.chains ?? []) {
    for (const row of (chain as any)?.rows ?? []) {
      const strike = getStrike(row);
      if (strike == null) continue;

      const explicitSide = getSide(row);

      if (explicitSide) {
        const oi = getOpenInterest(row, explicitSide);
        if (oi == null || !Number.isFinite(oi)) continue;

        rows.push({
          strike,
          side: explicitSide,
          oi,
          volume: getVolume(row, explicitSide),
        });
        continue;
      }

      // Supabase surfaces may be reconstructed into one wide row per strike
      // ({ strike, callOi, putOi }) instead of one row per side. Treat those
      // as two logical OI rows so the restored OI Intelligence card still sees
      // the selected chain correctly.
      const callOi = getSideOpenInterest(row, "call");
      const putOi = getSideOpenInterest(row, "put");

      if (callOi != null && Number.isFinite(callOi)) {
        rows.push({
          strike,
          side: "call",
          oi: callOi,
          volume: getVolume(row, "call"),
        });
      }

      if (putOi != null && Number.isFinite(putOi)) {
        rows.push({
          strike,
          side: "put",
          oi: putOi,
          volume: getVolume(row, "put"),
        });
      }
    }
  }

  return rows;
}

function toChainRows(rows: NormalizedOptionRow[]): ChainRow[] {
  const byStrike = new Map<number, any>();

  for (const row of rows) {
    const existing = byStrike.get(row.strike) ?? {
      strike: row.strike,
      callOi: 0,
      putOi: 0,
      callVolume: 0,
      putVolume: 0,
    };

    if (row.side === "call") {
      existing.callOi += row.oi;
      existing.callVolume += row.volume;
    } else {
      existing.putOi += row.oi;
      existing.putVolume += row.volume;
    }

    byStrike.set(row.strike, existing);
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike) as ChainRow[];
}

function largestWall(rows: ChainRow[], side: Side): { strike: number; oi: number } {
  let bestStrike = 0;
  let bestOi = -Infinity;

  for (const row of rows as any[]) {
    const oi = side === "call" ? Number(row.callOi ?? 0) : Number(row.putOi ?? 0);
    const strike = Number(row.strike ?? 0);

    if (oi > bestOi || (oi === bestOi && strike < bestStrike)) {
      bestOi = oi;
      bestStrike = strike;
    }
  }

  return {
    strike: bestStrike,
    oi: Number.isFinite(bestOi) ? bestOi : 0,
  };
}

function weightedCenter(rows: ChainRow[]): number {
  const total = (rows as any[]).reduce(
    (sum, row) => sum + Number(row.callOi ?? 0) + Number(row.putOi ?? 0),
    0
  );

  if (!total) return 0;

  return (
    (rows as any[]).reduce(
      (sum, row) =>
        sum + Number(row.strike ?? 0) * (Number(row.callOi ?? 0) + Number(row.putOi ?? 0)),
      0
    ) / total
  );
}

function buildSummary(rows: ChainRow[]): ExpirationSummary {
  const callWall = largestWall(rows, "call");
  const putWall = largestWall(rows, "put");
  const combinedCenter = weightedCenter(rows);

  const totalCallOi = (rows as any[]).reduce((sum, row) => sum + Number(row.callOi ?? 0), 0);
  const totalPutOi = (rows as any[]).reduce((sum, row) => sum + Number(row.putOi ?? 0), 0);
  const totalCallVolume = (rows as any[]).reduce((sum, row) => sum + Number(row.callVolume ?? 0), 0);
  const totalPutVolume = (rows as any[]).reduce((sum, row) => sum + Number(row.putVolume ?? 0), 0);

  const strikes = (rows as any[]).map((row) => Number(row.strike)).filter(Number.isFinite);

const callWeightedStrike =
  totalCallOi > 0
    ? (rows as any[]).reduce(
        (sum, row) => sum + Number(row.strike ?? 0) * Number(row.callOi ?? 0),
        0
      ) / totalCallOi
    : 0;

const putWeightedStrike =
  totalPutOi > 0
    ? (rows as any[]).reduce(
        (sum, row) => sum + Number(row.strike ?? 0) * Number(row.putOi ?? 0),
        0
      ) / totalPutOi
    : 0;

return {
  expiration: "",
  dte: 0,
  totalCallOi,
  totalPutOi,
  totalCallVolume,
  totalPutVolume,
  callWall: callWall.strike,
  putWall: putWall.strike,
  combinedCenter,
  callWeightedStrike,
  putWeightedStrike,
  lowerRange: strikes.length ? Math.min(...strikes) : 0,
  upperRange: strikes.length ? Math.max(...strikes) : 0,
  prevailingScore: 0,
} as ExpirationSummary;
}

function anomalyTone(severity: OIAnomaly["severity"]): string {
  if (severity === "high") return colors.red;
  if (severity === "medium") return colors.amber;
  return colors.teal;
}

function Metric({ label, value, tone = colors.text }: { label: string; value: string; tone?: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: tone }}>{value}</div>
    </div>
  );
}

export default function OIIntelligenceCard({
  surface,
  currentPrice,
  title = "Selected Expiration OI Intelligence",
}: OIIntelligenceCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedRows = normalizeRows(surface);
  const chainRows = toChainRows(normalizedRows);
  const summary = buildSummary(chainRows);

  const report =
    chainRows.length && Number.isFinite(currentPrice) && currentPrice > 0
      ? analyzeOIIntelligence({
          rows: chainRows,
          summary,
          currentPrice,
        })
      : null;

  const activeRows = report
    ? (chainRows as any[]).filter(
        (row) =>
          Number(row.strike) >= currentPrice * 0.5 &&
          Number(row.strike) <= currentPrice * 1.75
      )
    : [];

  return (
    <section style={{ ...cardStyle, padding: isOpen ? "1rem" : "0.75rem 1rem" }}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        style={styles.collapseHeader}
        aria-expanded={isOpen}
      >
        <div style={styles.headerText}>
          <span style={styles.collapseIcon}>{isOpen ? "−" : "+"}</span>
          <div>
            <h3 style={styles.title}>{title}</h3>
            <p style={styles.subtitle}>
              Restored old OI Intelligence logic. Raw structure is separated from active tradable structure,
              and anomalies are listed below.
            </p>
          </div>
        </div>

        <div style={styles.badge}>
          {normalizedRows.length.toLocaleString()} rows · {report?.anomalies.length ?? 0} anomalies
        </div>
      </button>

      {!isOpen ? null : !report ? (
        <div style={styles.warning}>
          No OI intelligence available. The selected chain has no rows or the current price is unavailable.
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            <Metric label="Total Call OI" value={formatInt(summary.totalCallOi)} tone={colors.green} />
            <Metric label="Total Put OI" value={formatInt(summary.totalPutOi)} tone={colors.red} />
            <Metric
              label="Put/Call OI"
              value={
                Number(summary.totalCallOi) > 0
                  ? safeFixed(Number(summary.totalPutOi) / Number(summary.totalCallOi), 2)
                  : "N/A"
              }
              tone={colors.amber}
            />
            <Metric label="Total OI" value={formatInt(Number(summary.totalCallOi) + Number(summary.totalPutOi))} tone={colors.teal} />

            <Metric label="Raw Center" value={formatPrice(summary.combinedCenter)} tone={colors.text} />
            <Metric label="Adjusted Center" value={formatPrice(report.adjustedCenter)} tone={colors.amber} />
            <Metric label="Raw Call Wall" value={formatPrice(summary.callWall)} tone={colors.green} />
            <Metric label="Adjusted Call Wall" value={formatPrice(report.adjustedCallWall)} tone={colors.green} />

            <Metric label="Raw Put Wall" value={formatPrice(summary.putWall)} tone={colors.red} />
            <Metric label="Adjusted Put Wall" value={formatPrice(report.adjustedPutWall)} tone={colors.red} />
            <Metric label="Active Rows" value={formatInt(activeRows.length)} tone={colors.teal} />
            <Metric label="Anomalies" value={String(report.anomalies.length)} tone={report.anomalies.length ? colors.amber : colors.green} />
          </div>

          <div style={styles.readout}>
            <div style={styles.readoutTitle}>Intelligence Readout</div>
            <ul style={styles.readoutList}>
              <li>{report.activeStructureSummary}</li>
              <li>{report.anomalySummary}</li>
              {report.intelligenceReadout.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>

          {report.anomalies.length ? (
            <div style={styles.anomalies}>
              <div style={styles.readoutTitle}>Detected OI Anomalies</div>

              <div style={styles.anomalyGrid}>
                {report.anomalies.map((anomaly, index) => (
                  <div key={`${anomaly.type}-${anomaly.strike}-${index}`} style={styles.anomalyCard}>
                    <div style={{ ...styles.anomalySeverity, color: anomalyTone(anomaly.severity) }}>
                      {anomaly.severity.toUpperCase()} · {anomaly.side.toUpperCase()} · {formatPrice(anomaly.strike)}
                    </div>
                    <div style={styles.anomalyDescription}>{anomaly.description}</div>
                    <div style={styles.anomalyDetail}>
                      OI {formatInt(anomaly.openInterest)} · Share equiv {formatInt(anomaly.shareEquivalent)}
                    </div>
                    <div style={styles.anomalyInterpretation}>{anomaly.interpretation}</div>
                    <div style={styles.anomalyAction}>{anomaly.action}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  collapseHeader: {
    width: "100%",
    border: 0,
    background: "transparent",
    padding: 0,
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "flex-start",
    textAlign: "left",
    cursor: "pointer",
  },
  headerText: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "flex-start",
  },
  collapseIcon: {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: "1px solid #24465d",
    background: "#071523",
    color: colors.teal,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 18,
    lineHeight: 1,
    flex: "0 0 auto",
    marginTop: 1,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "flex-start",
    marginBottom: "0.85rem",
  },
  title: {
    margin: 0,
    color: colors.text,
    fontSize: 18,
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.45,
  },
  badge: {
    color: colors.teal,
    border: "1px solid #24465d",
    background: "#071523",
    borderRadius: 999,
    padding: "0.35rem 0.65rem",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: "0.75rem",
  },
  metric: {
    border: "1px solid #20384d",
    background: "rgba(7, 21, 35, 0.72)",
    borderRadius: 10,
    padding: "0.75rem",
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    marginBottom: 6,
  },
  metricValue: {
    fontWeight: 900,
    fontSize: 17,
  },
  readout: {
    marginTop: "0.85rem",
    border: "1px solid #20384d",
    background: "rgba(7, 21, 35, 0.72)",
    borderRadius: 10,
    padding: "0.85rem",
  },
  readoutTitle: {
    color: colors.text,
    fontWeight: 900,
    marginBottom: "0.45rem",
  },
  readoutList: {
    margin: 0,
    paddingLeft: "1.15rem",
    color: colors.muted,
    lineHeight: 1.55,
    fontSize: 12,
  },
  warning: {
    marginTop: "0.85rem",
    color: colors.amber,
    border: "1px solid rgba(245, 158, 11, 0.35)",
    background: "rgba(245, 158, 11, 0.08)",
    borderRadius: 10,
    padding: "0.75rem",
    fontSize: 12,
    lineHeight: 1.45,
  },
  anomalies: {
    marginTop: "0.85rem",
  },
  anomalyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.75rem",
  },
  anomalyCard: {
    border: "1px solid rgba(245, 158, 11, 0.35)",
    background: "rgba(245, 158, 11, 0.06)",
    borderRadius: 10,
    padding: "0.75rem",
  },
  anomalySeverity: {
    fontWeight: 900,
    fontSize: 12,
    marginBottom: 5,
  },
  anomalyDescription: {
    color: colors.text,
    fontWeight: 800,
    fontSize: 12,
    marginBottom: 5,
  },
  anomalyDetail: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 5,
  },
  anomalyInterpretation: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 5,
    lineHeight: 1.45,
  },
  anomalyAction: {
    color: colors.amber,
    fontSize: 12,
    lineHeight: 1.45,
    fontWeight: 800,
  },
};
