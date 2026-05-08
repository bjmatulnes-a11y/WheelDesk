"use client";

import { useEffect, useState } from "react";
import { OISurfaceComparison } from "../lib/oi-surface-compare";

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function fmtDelta(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function directionColor(direction: string): string {
  if (direction === "bullish") return "#15803d";
  if (direction === "bearish") return "#b91c1c";
  if (direction === "compression") return "#7c2d12";
  if (direction === "expansion") return "#1d4ed8";
  if (direction === "stable") return "#374151";
  return "#111827";
}

function DeltaBox({
  label,
  value,
  current,
  prior,
}: {
  label: string;
  value: number | null;
  current?: number | null;
  prior?: number | null;
}) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.65rem" }}>
      <strong>{label}</strong>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtDelta(value)}</div>
      <div style={{ fontSize: 12, color: "#4b5563" }}>
        {fmt(prior)} → {fmt(current)}
      </div>
    </div>
  );
}

export function OISurfaceComparisonCard({
  data,
}: {
  data: OISurfaceComparison | null;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  if (!data) {
    return (
      <section style={{ border: "1px solid #d1d5db", padding: 12, borderRadius: 8, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>OI Surface Structure Comparison</h3>
        <p style={{ marginBottom: 0, color: "#6b7280" }}>
          Save at least two full OI surface snapshots in <code>wheeldesk_storage_v2</code> to compare validated wall drift.
        </p>
      </section>
    );
  }

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        padding: "1rem",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>OI Surface Structure Comparison</h3>
          <div style={{ color: "#4b5563", fontSize: 12 }}>
            Source: <code>{data.source}</code>. Uses the shared trader-edge engine, not legacy daily-structure storage.
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: directionColor(data.direction), fontSize: 18, fontWeight: 900 }}>
            {data.direction.toUpperCase()}
          </div>
          <div style={{ fontSize: 12 }}>{data.strength.toUpperCase()} strength</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: "0.75rem",
          marginTop: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <strong>Current</strong>
          <div>{data.current.snapshotDate}</div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>{data.current.actionBucket}</div>
        </div>

        <div>
          <strong>Prior</strong>
          <div>{data.prior?.snapshotDate ?? "N/A"}</div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>{data.prior?.actionBucket ?? "N/A"}</div>
        </div>

        <div>
          <strong>Edge Score</strong>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{data.current.edgeScore.toFixed(0)} / 100</div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>Δ {fmtDelta(data.edgeScoreDelta)}</div>
        </div>

        <div>
          <strong>Data Quality</strong>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{data.current.dataQualityScore.toFixed(0)} / 100</div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>validated levels</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <DeltaBox label="Support Δ" value={data.supportDelta} current={data.current.support} prior={data.prior?.support} />
        <DeltaBox label="Resistance Δ" value={data.resistanceDelta} current={data.current.resistance} prior={data.prior?.resistance} />
        <DeltaBox label="Magnet Δ" value={data.magnetDelta} current={data.current.magnet} prior={data.prior?.magnet} />
        <DeltaBox label="Range Width Δ" value={data.rangeWidthDelta} current={data.current.rangeWidth} prior={data.prior?.rangeWidth} />
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <strong>Readout</strong>
        <p style={{ marginBottom: 0 }}>{data.summary}</p>
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <strong>Trading Implication</strong>
        <p style={{ marginBottom: 0 }}>{data.implication}</p>
      </div>

      <details>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>What changed?</summary>

        <ul>
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>

        <div style={{ fontSize: 13, color: "#4b5563" }}>Action bucket: {data.biasChange}</div>
      </details>
    </section>
  );
}
