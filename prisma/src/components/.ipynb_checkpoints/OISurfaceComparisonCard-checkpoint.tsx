"use client";

import { useEffect, useState } from "react";
import { OISurfaceComparison } from "../lib/oi-surface-compare";

export function OISurfaceComparisonCard({
  data
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
          Save at least two daily structure snapshots to compare OI surface drift.
        </p>
      </section>
    );
  }

  return (
    <section style={{ border: "1px solid #334155", padding: 12, borderRadius: 8, background: "#fff" }}>
      <h3 style={{ marginTop: 0 }}>OI Surface Structure Comparison</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Current:</strong> {data.current.snapshotDate}
        </div>
        <div>
          <strong>Prior:</strong> {data.prior?.snapshotDate ?? "N/A"}
        </div>
        <div>
          <strong>Direction:</strong> {data.direction.toUpperCase()}
        </div>
        <div>
          <strong>Bias:</strong> {data.biasChange}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Support Δ:</strong>{" "}
          {data.supportDelta == null ? "N/A" : data.supportDelta.toFixed(2)}
        </div>
        <div>
          <strong>Resistance Δ:</strong>{" "}
          {data.resistanceDelta == null ? "N/A" : data.resistanceDelta.toFixed(2)}
        </div>
        <div>
          <strong>Magnet Δ:</strong> {data.magnetDelta.toFixed(2)}
        </div>
        <div>
          <strong>Slope Δ:</strong> {data.slopeDelta.toFixed(4)}
        </div>
      </div>

      <h4>What changed?</h4>
      <ul>
        {data.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}