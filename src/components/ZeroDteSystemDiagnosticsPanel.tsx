"use client";

import { useMemo } from "react";
import type React from "react";
import { runZeroDteSystemDiagnostics } from "../lib/zeroDteSystemDiagnostics";

export function ZeroDteSystemDiagnosticsPanel() {
  const checks = useMemo(() => runZeroDteSystemDiagnostics(), []);
  const passed = checks.filter((check) => check.passed).length;
  const allPassed = passed === checks.length;

  return (
    <details style={styles.card}>
      <summary style={styles.summary}>
        <span>0DTE deterministic system checks</span>
        <span style={{ ...styles.badge, ...(allPassed ? styles.pass : styles.fail) }}>{passed}/{checks.length} PASS</span>
      </summary>
      <div style={styles.grid}>
        {checks.map((check) => (
          <div key={check.id} style={styles.row}>
            <span style={{ ...styles.dot, background: check.passed ? "#22c55e" : "#ef4444" }} />
            <div>
              <div style={styles.label}>{check.label}</div>
              <div style={styles.detail}>{check.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { border: "1px solid #243044", borderRadius: 14, padding: "12px 14px", background: "#0d1421", marginTop: 16 },
  summary: { cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontWeight: 700 },
  badge: { borderRadius: 999, padding: "4px 9px", fontSize: 12 },
  pass: { background: "rgba(34,197,94,.15)", color: "#86efac" },
  fail: { background: "rgba(239,68,68,.15)", color: "#fca5a5" },
  grid: { display: "grid", gap: 10, marginTop: 14 },
  row: { display: "grid", gridTemplateColumns: "10px 1fr", gap: 10, alignItems: "start" },
  dot: { width: 8, height: 8, borderRadius: 999, marginTop: 6 },
  label: { fontWeight: 650, color: "#e5edf8" },
  detail: { marginTop: 2, fontSize: 12, color: "#94a3b8" },
};
