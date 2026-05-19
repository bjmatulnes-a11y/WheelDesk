"use client";

import type { OIFieldForecastResult, OIFieldHorizonForecast, OIFieldPosture } from "../../lib/oi-field-engine-v2";
import { colors, cardStyle } from "./styles";

type Props = {
  forecast: OIFieldForecastResult | null;
};

function fmt(value?: number | null, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(decimals);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value)}%`;
}

function toneForBias(bias: string): string {
  if (bias === "bullish") return colors.green;
  if (bias === "bearish") return colors.red;
  if (bias === "neutral") return colors.amber;
  return colors.teal;
}

function toneForPosture(posture: OIFieldPosture): string {
  if (posture === "actionable") return colors.green;
  if (posture === "defensive") return colors.red;
  if (posture === "stand_down") return colors.amber;
  return colors.teal;
}

function postureLabel(posture: OIFieldPosture): string {
  if (posture === "actionable") return "Actionable";
  if (posture === "defensive") return "Defensive";
  if (posture === "stand_down") return "Stand down";
  return "Watch";
}

function bucketLabel(row: OIFieldHorizonForecast): string {
  if (row.bucket === "short") return "Short";
  if (row.bucket === "swing") return "Swing";
  if (row.bucket === "wheel") return "Wheel";
  return "Expiration";
}

function ScorePill({ label, value, tone = colors.teal }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ border: "1px solid rgba(148, 163, 184, 0.16)", background: "rgba(15, 23, 42, 0.62)", borderRadius: 14, padding: "0.72rem" }}>
      <div style={{ color: colors.muted, fontSize: 11, fontWeight: 850 }}>{label}</div>
      <div style={{ color: tone, fontSize: 24, lineHeight: 1.05, fontWeight: 950, marginTop: 5 }}>{Math.round(value)}</div>
    </div>
  );
}

export default function OIFieldHorizonMatrix({ forecast }: Props) {
  if (!forecast) return null;

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: colors.teal, fontSize: 11, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.12em" }}>OI Field Engine v2</div>
          <h3 style={{ margin: "0.25rem 0 0", color: colors.text, fontSize: 20 }}>Multi-horizon forecast map</h3>
          <p style={{ color: colors.muted, margin: "0.35rem 0 0", fontSize: 12, maxWidth: 900 }}>
            {forecast.readout}
          </p>
        </div>
        <div style={{ color: colors.muted, fontSize: 12, textAlign: "right" }}>
          Bias <strong style={{ color: toneForBias(forecast.baseBias) }}>{forecast.baseBias.toUpperCase()}</strong> · Confidence{" "}
          <strong style={{ color: colors.teal }}>{forecast.confidenceScore}</strong> · Regime{" "}
          <strong style={{ color: colors.text }}>{forecast.regime.replace(/_/g, " ")}</strong>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.65rem", marginTop: "0.85rem" }}>
        <ScorePill label="Short-term" value={forecast.shortTermScore} tone={colors.teal} />
        <ScorePill label="Swing" value={forecast.swingScore} tone={colors.amber} />
        <ScorePill label="Wheel / 30D" value={forecast.wheelScore} tone={colors.green} />
        <ScorePill label="Field confidence" value={forecast.confidenceScore} tone={colors.text} />
      </div>

      <div style={{ overflowX: "auto", marginTop: "0.85rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: colors.muted, textAlign: "left", borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: "0.55rem" }}>Horizon</th>
              <th style={{ padding: "0.55rem" }}>Base target</th>
              <th style={{ padding: "0.55rem" }}>Forecast band</th>
              <th style={{ padding: "0.55rem" }}>Bias</th>
              <th style={{ padding: "0.55rem" }}>Pin</th>
              <th style={{ padding: "0.55rem" }}>Upper touch</th>
              <th style={{ padding: "0.55rem" }}>Lower break</th>
              <th style={{ padding: "0.55rem" }}>Trap</th>
              <th style={{ padding: "0.55rem" }}>Wheel hold</th>
              <th style={{ padding: "0.55rem" }}>Posture</th>
            </tr>
          </thead>
          <tbody>
            {forecast.horizons.map((row) => (
              <tr key={row.key} style={{ borderBottom: "1px solid rgba(148, 163, 184, 0.10)" }}>
                <td style={{ padding: "0.6rem", color: colors.text, fontWeight: 950 }}>
                  {row.label}
                  <div style={{ color: colors.muted, fontSize: 10, fontWeight: 750 }}>{bucketLabel(row)}</div>
                </td>
                <td style={{ padding: "0.6rem", color: colors.text, fontWeight: 900 }}>
                  {fmt(row.baseTarget)}
                  <div style={{ color: row.expectedDriftPct != null && row.expectedDriftPct >= 0 ? colors.green : colors.red, fontSize: 10, fontWeight: 850 }}>
                    {row.expectedDriftPct == null ? "N/A" : `${row.expectedDriftPct >= 0 ? "+" : ""}${fmt(row.expectedDriftPct, 2)}%`}
                  </div>
                </td>
                <td style={{ padding: "0.6rem", color: colors.muted }}>{fmt(row.lowerBand)} – {fmt(row.upperBand)}</td>
                <td style={{ padding: "0.6rem", color: toneForBias(row.bias), fontWeight: 950 }}>{row.bias.toUpperCase()}</td>
                <td style={{ padding: "0.6rem", color: colors.amber, fontWeight: 900 }}>{pct(row.pinProbability)}</td>
                <td style={{ padding: "0.6rem", color: colors.green, fontWeight: 900 }}>{pct(row.upperWallTouchProbability)}</td>
                <td style={{ padding: "0.6rem", color: colors.red, fontWeight: 900 }}>{pct(row.lowerWallBreakProbability)}</td>
                <td style={{ padding: "0.6rem", color: row.trapProbability >= 70 ? colors.red : colors.muted, fontWeight: 900 }}>{pct(row.trapProbability)}</td>
                <td style={{ padding: "0.6rem", color: row.wheelSupportHoldProbability != null && row.wheelSupportHoldProbability >= 60 ? colors.green : colors.muted, fontWeight: 900 }}>{pct(row.wheelSupportHoldProbability)}</td>
                <td style={{ padding: "0.6rem", color: toneForPosture(row.premiumSellerPosture), fontWeight: 950 }}>{postureLabel(row.premiumSellerPosture)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {forecast.engineNotes.length ? (
        <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.8rem" }}>
          {forecast.engineNotes.slice(0, 4).map((note, index) => (
            <div key={index} style={{ color: colors.muted, fontSize: 12 }}>• {note}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
