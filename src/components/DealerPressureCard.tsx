"use client";

import { type DealerPressureSummary } from "../lib/dealer-pressure-engine";
import { safeFixed } from "../lib/format";

type DealerPressureCardProps = {
  summary: DealerPressureSummary | null;
  compact?: boolean;
};

function score(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
 return `$${safeFixed(value, 0)} / 100`;
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${safeFixed(value, 1)}%`;
}

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function badgeColor(text: string): { background: string; color: string; borderColor: string } {
  const lower = text.toLowerCase();
  if (lower.includes("pin-to-snap") || lower.includes("danger")) return { background: "#fff7ed", color: "#9a3412", borderColor: "#fed7aa" };
  if (lower.includes("expansion") || lower.includes("amplification") || lower.includes("avoid")) return { background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" };
  if (lower.includes("suppression") || lower.includes("pinning") || lower.includes("safe")) return { background: "#ecfdf5", color: "#166534", borderColor: "#bbf7d0" };
  if (lower.includes("bullish")) return { background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" };
  if (lower.includes("bearish")) return { background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" };
  return { background: "#f8fafc", color: "#334155", borderColor: "#e2e8f0" };
}

function Badge({ children }: { children: string }) {
  const style = badgeColor(children);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${style.borderColor}`,
        borderRadius: 999,
        background: style.background,
        color: style.color,
        padding: "0.2rem 0.55rem",
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.65rem", background: "#fff" }}>
      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{value}</div>
      {sub ? <div style={{ marginTop: 3, fontSize: 12, color: "#64748b" }}>{sub}</div> : null}
    </div>
  );
}

export default function DealerPressureCard({ summary, compact = false }: DealerPressureCardProps) {
  if (!summary) {
    return (
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem", background: "#fff" }}>
        <h3 style={{ margin: 0 }}>Dealer Pressure / Gamma Regime</h3>
        <p style={{ color: "#64748b", marginBottom: 0 }}>No dealer-pressure read is available for this ticker.</p>
      </section>
    );
  }

  return (
    <section style={{ border: "1px solid #dbeafe", borderRadius: 12, padding: "1rem", background: "#f8fbff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Dealer Pressure / Gamma Regime</h3>
          <p style={{ margin: "0.35rem 0 0", color: "#475569", maxWidth: 860 }}>
            This is a dealer-pressure proxy, not a confirmed dealer book. It estimates whether OI structure is more likely to pin price, snap through rails, or amplify movement.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge>{summary.regime}</Badge>
          <Badge>{`Bias: ${summary.hedgeFlowBias}`}</Badge>
          <Badge>{summary.premiumSellerSafety}</Badge>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.65rem", marginTop: "0.9rem" }}>
        <MetricCard label="Pin Risk" value={score(summary.pinRiskScore)} sub="Mean-reversion / chop pressure" />
        <MetricCard label="Snap Risk" value={score(summary.snapRiskScore)} sub="Rail-break acceleration risk" />
        <MetricCard label="Gamma Concentration" value={score(summary.gammaConcentrationScore)} sub="OI pressure near spot" />
        <MetricCard label="Confidence" value={score(summary.confidenceScore)} sub="Data quality + depth" />
      </div>

      {!compact ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.65rem", marginTop: "0.65rem" }}>
            <MetricCard label="Pressure Split" value={`${pct(summary.callPressureSharePct)} call / ${pct(summary.putPressureSharePct)} put`} />
            <MetricCard label="Dominant Strike" value={money(summary.dominantPressureStrike)} sub="Highest combined pressure" />
            <MetricCard label="Nearest Call Pressure" value={money(summary.nearestCallPressureStrike)} />
            <MetricCard label="Nearest Put Pressure" value={money(summary.nearestPutPressureStrike)} />
          </div>

          <div style={{ marginTop: "0.9rem", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "0.8rem" }}>
            <strong>Interpretation</strong>
            <p style={{ margin: "0.35rem 0 0", color: "#334155" }}>{summary.interpretation}</p>
            <div style={{ marginTop: "0.5rem", color: "#64748b", fontSize: 13 }}>
              Active range: <strong>{money(summary.support)}</strong> support · <strong>{money(summary.magnet)}</strong> magnet · <strong>{money(summary.resistance)}</strong> resistance · Width {pct(summary.activeRangeWidthPct)}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "0.8rem" }}>
              <strong>Trade Translation</strong>
              <ul style={{ margin: "0.45rem 0 0", paddingLeft: "1.15rem", color: "#334155" }}>
                {summary.tradeTranslation.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "0.8rem" }}>
              <strong>Gamma Scalp Lite</strong>
              <ul style={{ margin: "0.45rem 0 0", paddingLeft: "1.15rem", color: "#334155" }}>
                {summary.scalpLiteNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          </div>

          {(summary.riskNotes.length > 0 || summary.dataQualityNotes.length > 0) && (
            <div style={{ marginTop: "0.75rem", border: "1px solid #fed7aa", borderRadius: 8, background: "#fff7ed", padding: "0.8rem" }}>
              <strong>Pressure Warnings</strong>
              <ul style={{ margin: "0.45rem 0 0", paddingLeft: "1.15rem", color: "#7c2d12" }}>
                {[...summary.riskNotes, ...summary.dataQualityNotes].map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
