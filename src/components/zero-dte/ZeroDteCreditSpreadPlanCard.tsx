"use client";

import type React from "react";
import type {
  CreditSpreadPlanLeg,
  DefensibleCreditSpreadPlan,
} from "../../lib/zeroDteCreditSpreadPlan";
import type { CreditSpreadTrackRecord } from "../../lib/zeroDteCreditSpreadTrackRecord";
import type { ZeroDteRiskPolicy } from "../../lib/zeroDteRiskPolicy";

export function ZeroDteCreditSpreadPlanCard({
  plan,
  policy,
  shadowOpen,
  shadowClosed,
  shadowError,
  trackRecord,
}: {
  plan: DefensibleCreditSpreadPlan;
  policy: ZeroDteRiskPolicy;
  shadowOpen: number;
  shadowClosed: number;
  shadowError?: string | null;
  trackRecord?: CreditSpreadTrackRecord | null;
}) {
  const active = plan.status === "READY" || plan.status === "PAIRED";
  const accent = plan.status === "PAIRED"
    ? "#c084fc"
    : plan.side === "PCS"
      ? "#14d990"
      : plan.side === "CCS"
        ? "#f24968"
        : "#94a3b8";
  const title = plan.status === "NO_TRADE_DAY"
    ? "NO TRADE DAY"
    : plan.status === "PAIRED"
      ? "PAIRED · POSITIVE GAMMA"
      : plan.status === "READY"
        ? `${plan.side} READY`
        : `${plan.side ?? "CREDIT"} · WAIT`;

  return (
    <div style={{ ...styles.card, borderColor: active ? `${accent}66` : plan.status === "NO_TRADE_DAY" ? "rgba(255,90,110,.5)" : "#24364a" }}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Credit Spread Edge</div>
          <strong style={{ fontSize: 16, color: active ? accent : plan.status === "NO_TRADE_DAY" ? "#ff8a9a" : "#d9e7f5" }}>
            {title}
          </strong>
        </div>
        <span style={{ ...styles.pill, color: active ? accent : "#a8b6c5", borderColor: active ? `${accent}66` : "#334155" }}>
          {plan.status}
        </span>
      </div>

      {plan.status === "PAIRED" && plan.paired ? (
        <div style={styles.pairedGrid}>
          <LegBlock leg={plan.paired.pcs} />
          <LegBlock leg={plan.paired.ccs} />
        </div>
      ) : plan.primary ? (
        <LegBlock leg={plan.primary} />
      ) : null}

      {plan.primary?.edge ? <EdgeBlock leg={plan.primary} /> : null}

      {plan.status === "READY" && plan.primary ? (
        <div style={{ ...styles.trigger, borderColor: plan.primary.entryTrigger === "NONE" ? "#334155" : `${accent}66`, color: plan.primary.entryTrigger === "NONE" ? "#a8b6c5" : accent }}>
          <strong>{plan.primary.entryTrigger === "NONE" ? "READY · no trigger yet" : "ENTER NOW"}</strong>
          <span>{plan.primary.entryTriggerDetail}</span>
        </div>
      ) : null}

      {plan.primary?.guard ? (
        <div style={styles.guard}>
          Guard: <strong>{plan.primary.guard.label} {plan.primary.guard.price.toFixed(1)}</strong> · {plan.primary.invalidationText}
          {plan.primary.defenses.length > 1 ? (
            <div style={styles.defenses}>
              Defenses: {plan.primary.defenses.slice(0, 4).map((item) => `${item.label} ${item.price.toFixed(1)}`).join(" · ")}
            </div>
          ) : null}
        </div>
      ) : null}

      {plan.primary?.exitPlan ? (
        <div style={styles.exitBox}>
          <strong>Exit plan</strong>
          <span>Take profit: buy back ≤ {money2(plan.primary.exitPlan.takeProfitDebit)} ({Math.round(plan.primary.exitPlan.takeProfitPct * 100)}% of entry credit)</span>
          <span>Structure stop: {plan.primary.exitPlan.structureStopText}</span>
          <span>Price stop: buyback ≥ {money2(plan.primary.exitPlan.priceStopDebit)} ({plan.primary.exitPlan.stopCreditMultiple.toFixed(1)}× entry credit)</span>
          <span>Time stop: {plan.primary.exitPlan.timeStopText}</span>
          <em>Edge shown above is hold-to-expiry EV until path-based exit EV is seeded.</em>
        </div>
      ) : null}

      <div style={styles.contextRow}>
        <span>Gamma <strong>{plan.gammaRegime ?? "—"}</strong></span>
        <span>Tilt <strong>{plan.directionalTilt}</strong></span>
        <span>Window <strong>{policy.entryWindowStart}–{policy.entryWindowEnd} CT</strong></span>
      </div>

      <div style={styles.reason}>
        {plan.status === "NO_TRADE_DAY"
          ? plan.dayVetoReason ?? plan.blockers[0] ?? "New entries are vetoed."
          : active
            ? plan.reasons.slice(0, 3).join(" · ")
            : plan.blockers.slice(0, 3).join(" · ") || "No defended, positive-EV spread is ready."}
      </div>

      <TrackRecordBlock record={trackRecord ?? null} />

      <div style={styles.paper}>
        Paper: {shadowError ? <strong style={{ color: "#ff8a9a" }}>ERROR · {shadowError}</strong> : <strong style={{ color: "#71e0b4" }}>OK</strong>}
        <span> · {shadowOpen} open / {shadowClosed} closed · 1-lot validation</span>
      </div>
    </div>
  );
}

function LegBlock({ leg }: { leg: CreditSpreadPlanLeg }) {
  const accent = leg.side === "PCS" ? "#14d990" : "#f24968";
  return (
    <div style={styles.legBox}>
      <div style={{ ...styles.legTitle, color: accent }}>{leg.side}</div>
      <div style={styles.tradeLine}>
        <strong>{leg.shortStrike.toFixed(0)} / {leg.longStrike.toFixed(0)}</strong>
        <span>{leg.widthPoints.toFixed(0)} wide</span>
        <span>credit {money2(leg.sellableCredit)}</span>
        <span>risk {money0(leg.maxRiskDollars * leg.riskSizeMultiplier)}</span>
        <span>Δ {leg.shortDeltaAbs == null ? "—" : leg.shortDeltaAbs.toFixed(2)}</span>
      </div>
      {leg.riskSizeMultiplier < 1 ? <div style={styles.subtle}>50% risk size in paired mode.</div> : null}
    </div>
  );
}

function EdgeBlock({ leg }: { leg: CreditSpreadPlanLeg }) {
  const edge = leg.edge!;
  const marketOtm = edge.marketProbItm == null ? null : (1 - edge.marketProbItm) * 100;
  const histOtm = (1 - edge.histProbItmAtClose) * 100;
  const touch = edge.histProbTouch * 100;
  const edgePts = edge.edgePts;
  const green = edge.evPerLotDollars > 0 && (edgePts ?? -Infinity) >= 5;
  const amber = edge.evPerLotDollars > 0 && !green;
  const color = green ? "#71e0b4" : amber ? "#f5c542" : "#ff8a9a";
  return (
    <div style={{ ...styles.edgeBox, borderColor: `${color}55` }}>
      <div style={styles.edgeTitle}>Empirical edge</div>
      <div>Market: {marketOtm == null ? "—" : `${marketOtm.toFixed(0)}% OTM (Δ ${(edge.marketProbItm ?? 0).toFixed(2)})`} · History: {histOtm.toFixed(0)}% OTM · touched {touch.toFixed(0)}%</div>
      <div style={{ color }}><strong>Edge {edgePts == null ? "—" : signed(edgePts, 1)} pts · EV {moneySigned(edge.evPerLotDollars)} / lot · n={edge.sample.n}</strong></div>
      <div style={styles.subtle}>{edge.sample.keyUsed}</div>
    </div>
  );
}

function TrackRecordBlock({ record }: { record: CreditSpreadTrackRecord | null }) {
  if (!record || record.n < 10) {
    return <div style={styles.track}>Similar setups: <strong>Not enough shadow history yet</strong>{record?.n ? ` · ${record.n} broad matches` : ""}</div>;
  }
  return (
    <div style={styles.track}>
      Similar setups: <strong>{record.n} trades · {record.winRatePct.toFixed(0)}% win · avg {moneySigned(record.averagePnlDollars)} · worst {moneySigned(record.worstLossDollars)} · last 10: {record.last10Wins}W {record.last10Losses}L</strong>
    </div>
  );
}

function money0(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `$${Math.round(value).toLocaleString()}`;
}
function money2(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `$${value.toFixed(2)}`;
}
function moneySigned(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}`;
}
function signed(value: number, digits: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: "#08131d", border: "1px solid #24364a", borderRadius: 12, padding: 12, display: "grid", gap: 9 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  eyebrow: { color: "#55d6ff", fontSize: 9, fontWeight: 900, letterSpacing: 1.1, textTransform: "uppercase" },
  pill: { border: "1px solid", borderRadius: 999, padding: "4px 7px", fontSize: 9, fontWeight: 900 },
  pairedGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 },
  legBox: { background: "#0a1823", border: "1px solid #1b3144", borderRadius: 8, padding: 8 },
  legTitle: { fontSize: 9, fontWeight: 900, marginBottom: 4 },
  tradeLine: { display: "flex", gap: "5px 9px", flexWrap: "wrap", color: "#d8e8f7", fontSize: 11 },
  guard: { color: "#b9cadb", fontSize: 10, lineHeight: 1.45 },
  defenses: { marginTop: 3, color: "#8296aa", fontSize: 9 },
  edgeBox: { display: "grid", gap: 3, background: "#091722", border: "1px solid", borderRadius: 8, padding: 8, color: "#b9cadb", fontSize: 10 },
  edgeTitle: { color: "#55d6ff", fontWeight: 900, fontSize: 9, textTransform: "uppercase", letterSpacing: .8 },
  trigger: { display: "grid", gap: 2, border: "1px solid", borderRadius: 8, padding: 7, fontSize: 10 },
  exitBox: { display: "grid", gap: 3, color: "#9db1c4", fontSize: 9, lineHeight: 1.35, borderTop: "1px solid #17283a", paddingTop: 7 },
  contextRow: { display: "flex", gap: "5px 12px", flexWrap: "wrap", color: "#8296aa", fontSize: 9 },
  reason: { color: "#b6c8d8", fontSize: 10, lineHeight: 1.4, borderTop: "1px solid #17283a", paddingTop: 7 },
  track: { color: "#8296aa", fontSize: 9, lineHeight: 1.35 },
  paper: { color: "#8296aa", fontSize: 9, lineHeight: 1.35 },
  subtle: { color: "#6f8498", fontSize: 8, marginTop: 2 },
};
