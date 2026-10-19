"use client";

import type React from "react";
import type { DefensibleCreditSpreadPlan } from "../../lib/zeroDteCreditSpreadPlan";
import type { ZeroDteRiskPolicy } from "../../lib/zeroDteRiskPolicy";

export function ZeroDteCreditSpreadPlanCard({
  plan,
  policy,
  shadowOpen,
  shadowClosed,
  shadowError,
}: {
  plan: DefensibleCreditSpreadPlan;
  policy: ZeroDteRiskPolicy;
  shadowOpen: number;
  shadowClosed: number;
  shadowError?: string | null;
}) {
  const ready = plan.status === "READY";
  const accent = plan.side === "PCS" ? "#14d990" : plan.side === "CCS" ? "#f24968" : "#94a3b8";
  return (
    <div style={{ ...styles.card, borderColor: ready ? `${accent}66` : "#24364a" }}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Defensible Credit Spread</div>
          <strong style={{ fontSize: 16, color: ready ? accent : "#d9e7f5" }}>
            {ready ? `${plan.side} READY` : `${plan.side ?? "NO SIDE"} · WAIT`}
          </strong>
        </div>
        <span style={{ ...styles.pill, color: ready ? accent : "#a8b6c5", borderColor: ready ? `${accent}66` : "#334155" }}>
          {ready ? "DEFENDED" : "NO TRADE"}
        </span>
      </div>

      {plan.shortStrike !== null && plan.longStrike !== null ? (
        <div style={styles.tradeLine}>
          <strong>{plan.shortStrike.toFixed(0)} / {plan.longStrike.toFixed(0)}</strong>
          <span>{plan.widthPoints?.toFixed(0) ?? "—"} wide</span>
          <span>credit {money2(plan.sellableCredit)}</span>
          <span>risk {money0(plan.maxRiskDollars)}</span>
          <span>Δ {plan.shortDeltaAbs == null ? "—" : plan.shortDeltaAbs.toFixed(2)}</span>
        </div>
      ) : null}

      {plan.guard ? (
        <div style={styles.guard}>
          Guard: <strong>{plan.guard.label} {plan.guard.price.toFixed(1)}</strong> · {plan.invalidationText}
          {plan.defenses.length > 1 ? (
            <div style={styles.defenses}>
              Defenses: {plan.defenses.slice(0, 3).map((item) => `${item.label} ${item.price.toFixed(1)}`).join(" · ")}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={styles.rules}>
        <span>Side comes from the latched BULL/BEAR engine.</span>
        <span>Short must remain OTM and behind real support/resistance.</span>
        <span>Default target is ~10–20 wide, ≤{policy.shortDeltaMax.toFixed(2)} short delta, inside your dollar-risk cap.</span>
      </div>

      <div style={styles.reason}>
        {ready
          ? plan.reasons.slice(0, 2).join(" · ")
          : plan.blockers.slice(0, 2).join(" · ") || "Wait for a defended candidate."}
      </div>

      <div style={styles.paper}>
        Paper: {shadowError ? <strong style={{ color: "#ff8a9a" }}>ERROR · {shadowError}</strong> : <strong style={{ color: "#71e0b4" }}>OK</strong>}
        <span> · {shadowOpen} open / {shadowClosed} closed · 1-lot validation</span>
      </div>
    </div>
  );
}

function money0(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `$${Math.round(value).toLocaleString()}`;
}

function money2(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `$${value.toFixed(2)}`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#08131d",
    border: "1px solid #24364a",
    borderRadius: 12,
    padding: 12,
    display: "grid",
    gap: 9,
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  eyebrow: { color: "#55d6ff", fontSize: 9, fontWeight: 900, letterSpacing: 1.1, textTransform: "uppercase" },
  pill: { border: "1px solid", borderRadius: 999, padding: "4px 7px", fontSize: 9, fontWeight: 900 },
  tradeLine: { display: "flex", gap: "5px 9px", flexWrap: "wrap", color: "#d8e8f7", fontSize: 11 },
  guard: { color: "#b9cadb", fontSize: 10, lineHeight: 1.45 },
  defenses: { marginTop: 3, color: "#8296aa", fontSize: 9 },
  rules: { display: "grid", gap: 3, color: "#8296aa", fontSize: 9, lineHeight: 1.35 },
  reason: { color: "#b6c8d8", fontSize: 10, lineHeight: 1.4, borderTop: "1px solid #17283a", paddingTop: 7 },
  paper: { color: "#8296aa", fontSize: 9, lineHeight: 1.35 },
};
