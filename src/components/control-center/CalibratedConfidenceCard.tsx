"use client";

import { type ForecastCalibration } from "../../lib/forecast-calibration-engine";
import { colors, cardStyle } from "./styles";

type Props = { calibration: ForecastCalibration | null };

function verdictColor(verdict: ForecastCalibration["verdict"]): string {
  switch (verdict) {
    case "history_confirms":
      return colors.green;
    case "history_discounts":
      return colors.red;
    case "history_neutral":
      return colors.teal;
    default:
      return colors.muted;
  }
}

function scoreColor(score: number): string {
  return score >= 70 ? colors.green : score >= 50 ? colors.amber : colors.red;
}

function reliabilityColor(reliability: ForecastCalibration["reliability"]): string {
  switch (reliability) {
    case "strong":
    case "usable":
      return colors.green;
    case "developing":
      return colors.amber;
    default:
      return colors.muted;
  }
}

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export default function CalibratedConfidenceCard({ calibration }: Props) {
  if (!calibration) return null;

  const {
    scenarioLabel,
    horizon,
    requestedHorizon,
    horizonMismatch,
    structuralScore,
    modelScore,
    empiricalRate,
    empiricalSamples,
    empiricalLower,
    empiricalUpper,
    verdict,
    headline,
    detail,
    actionRead,
    calibratedScore,
    bucketLabel,
    reliability,
  } = calibration;

  const empiricalPct = empiricalRate === null ? null : Math.round(empiricalRate * 100);
  const vColor = verdictColor(verdict);

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0, color: colors.teal, fontSize: 16, fontWeight: 500 }}>
          Calibrated confidence
        </h3>
        <span style={{ fontSize: 12, color: colors.muted }}>
          {scenarioLabel} · {horizonMismatch ? `${horizon}D proxy for ${requestedHorizon}D` : `${horizon}D`}
        </span>
      </div>

      <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
        Accountability layer · compares live scenario probability to resolved historical proxy outcomes.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 10,
          marginTop: 12,
        }}
      >
        <div style={{ background: colors.panel2, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Live scenario</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(structuralScore) }}>
            {structuralScore}%
          </div>
          <div style={{ fontSize: 11, color: colors.muted }}>
            matrix scenario probability
          </div>
        </div>
        <div style={{ background: colors.panel2, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Historical proxy</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: empiricalPct === null ? colors.muted : scoreColor(empiricalPct) }}>
            {empiricalPct === null ? "—" : `${empiricalPct}%`}
          </div>
          <div style={{ fontSize: 11, color: colors.muted }}>
            {empiricalSamples > 0
              ? `${bucketLabel}, n=${empiricalSamples}`
              : "no resolved samples yet"}
          </div>
        </div>
        <div style={{ background: colors.panel2, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>Reliability</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: reliabilityColor(reliability), textTransform: "capitalize" }}>
            {reliability}
          </div>
          <div style={{ fontSize: 11, color: colors.muted }}>
            Wilson band {pct(empiricalLower)}–{pct(empiricalUpper)} · model quality {modelScore}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderLeft: `3px solid ${vColor}`,
          background: colors.panel2,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: vColor }}>{headline}</div>
        <div style={{ fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 1.55 }}>
          {detail}
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: "9px 10px",
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          background: "rgba(8, 20, 32, 0.55)",
          fontSize: 12,
          color: colors.text,
          lineHeight: 1.55,
        }}
      >
        <span style={{ color: colors.amber, fontWeight: 700 }}>Use: </span>
        {actionRead}
      </div>

      {empiricalPct !== null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>
            Calibrated scenario read{" "}
            <span style={{ color: scoreColor(calibratedScore), fontWeight: 700 }}>
              {calibratedScore}%
            </span>{" "}
            <span style={{ color: colors.muted }}>
              (display-only blend; does not alter official forecast)
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: colors.border,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, calibratedScore))}%`,
                background: scoreColor(calibratedScore),
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      )}

      {calibration.notes.length > 0 && (
        <ul
          style={{
            margin: "12px 0 0",
            fontSize: 11,
            color: colors.muted,
            borderTop: `1px solid ${colors.border}`,
            paddingTop: 8,
            paddingLeft: 16,
            lineHeight: 1.55,
          }}
        >
          {calibration.notes.slice(-3).map((note, index) => (
            <li key={`${note}-${index}`}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
