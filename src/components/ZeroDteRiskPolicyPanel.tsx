"use client";

import type React from "react";
import type {
  ZeroDteRiskPolicy,
  ZeroDteVolContext,
} from "../lib/zeroDteRiskPolicy";
import { deltaMaxForMode } from "../lib/zeroDteRiskPolicy";

export function ZeroDteRiskPolicyPanel({
  policy,
  onChange,
  realizedPnlDollars,
  dailyLossBlocked,
  volContext,
}: {
  policy: ZeroDteRiskPolicy;
  onChange: (policy: ZeroDteRiskPolicy) => void;
  realizedPnlDollars: number;
  dailyLossBlocked: boolean;
  volContext: ZeroDteVolContext | null;
}) {
  const patch = (next: Partial<ZeroDteRiskPolicy>) =>
    onChange({ ...policy, ...next, strictZeroDte: true });

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Risk Policy</div>
          <strong>0DTE execution guardrails</strong>
        </div>
        <span
          style={{
            ...styles.status,
            color: dailyLossBlocked ? "#ff8a9a" : "#7ff2bd",
            borderColor: dailyLossBlocked
              ? "rgba(255,90,110,.45)"
              : "rgba(113,224,180,.4)",
          }}
        >
          {dailyLossBlocked ? "DAILY STOP" : "ACTIVE"}
        </span>
      </div>

      <div style={styles.grid}>
        <label style={styles.field}>
          Policy
          <select
            value={policy.riskMode}
            onChange={(event) => {
              const riskMode = event.target.value as ZeroDteRiskPolicy["riskMode"];
              patch({ riskMode, shortDeltaMax: deltaMaxForMode(riskMode) });
            }}
            style={styles.input}
          >
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>
        <NumberField
          label="Max risk / 1×"
          value={policy.maxRiskPerTradeDollars}
          step={50}
          onChange={(value) => patch({ maxRiskPerTradeDollars: value })}
        />
        <NumberField
          label="Gross risk budget"
          value={policy.grossRiskBudgetDollars}
          step={250}
          onChange={(value) =>
            patch({ grossRiskBudgetDollars: value ?? policy.grossRiskBudgetDollars })
          }
        />
        <NumberField
          label="Account equity"
          value={policy.accountEquityDollars}
          step={1000}
          placeholder="off"
          onChange={(value) => patch({ accountEquityDollars: value })}
        />
        <NumberField
          label="Risk % / trade"
          value={policy.riskPerTradePct}
          step={0.05}
          onChange={(value) => patch({ riskPerTradePct: value ?? 0.75 })}
        />
        <NumberField
          label="Daily loss stop"
          value={policy.dailyLossLimitDollars}
          step={100}
          placeholder="off"
          onChange={(value) => patch({ dailyLossLimitDollars: value })}
        />
        <NumberField
          label="Min sellable credit"
          value={policy.minSellableCredit}
          step={0.05}
          onChange={(value) => patch({ minSellableCredit: value ?? 0 })}
        />
        <NumberField
          label="Max width"
          value={policy.maxWidth}
          step={5}
          onChange={(value) => patch({ maxWidth: value ?? 50 })}
        />
        <NumberField
          label="Short delta max"
          value={policy.shortDeltaMax}
          step={0.01}
          onChange={(value) => patch({ shortDeltaMax: value ?? 0.2 })}
        />
        <label style={styles.field}>
          Event risk
          <select
            value={policy.eventRisk}
            onChange={(event) =>
              patch({ eventRisk: event.target.value === "HIGH" ? "HIGH" : "NORMAL" })
            }
            style={styles.input}
          >
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High — CPI/FOMC/NFP</option>
          </select>
        </label>
      </div>

      <div style={styles.readoutRow}>
        <span>Strict 0DTE <strong>LOCKED ON</strong></span>
        <span>Realized today <strong>{money(realizedPnlDollars)}</strong></span>
        <span>
          Account risk cap{" "}
          <strong>
            {policy.accountEquityDollars == null
              ? "OFF"
              : money((policy.accountEquityDollars * policy.riskPerTradePct) / 100)}
          </strong>
        </span>
        <span>
          Range / opening EM <strong>{percent(volContext?.rangeConsumptionPct)}</strong>
        </span>
        <span>
          Vol context <strong>{volContext?.regime ?? "UNAVAILABLE"}</strong>
        </span>
      </div>
      {dailyLossBlocked ? (
        <div style={styles.blocker}>
          Daily realized loss limit has been reached. New positions are blocked;
          existing positions remain fully managed.
        </div>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  step: number;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <label style={styles.field}>
      {label}
      <input
        type="number"
        value={value ?? ""}
        step={step}
        min="0"
        placeholder={placeholder}
        onChange={(event) => {
          if (!event.target.value.trim()) {
            onChange(null);
            return;
          }
          const numeric = Number(event.target.value);
          onChange(Number.isFinite(numeric) ? numeric : null);
        }}
        style={styles.input}
      />
    </label>
  );
}

function money(value: number) {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(0)}`;
}

function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(0)}%`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    marginTop: 14,
    background: "#08131d",
    border: "1px solid #173047",
    borderRadius: 13,
    padding: 13,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  eyebrow: {
    color: "#55d6ff",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: 850,
    marginBottom: 3,
  },
  status: {
    border: "1px solid",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 10,
    fontWeight: 850,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
    gap: 8,
    marginTop: 10,
  },
  field: {
    color: "#8296aa",
    fontSize: 10,
    fontWeight: 800,
    display: "grid",
    gap: 4,
  },
  input: {
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    background: "#0c1a25",
    color: "#edf7ff",
    border: "1px solid #244058",
    borderRadius: 8,
    padding: "7px 8px",
    fontSize: 12,
  },
  readoutRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px 14px",
    marginTop: 10,
    color: "#8296aa",
    fontSize: 11,
  },
  blocker: {
    marginTop: 9,
    color: "#ff9aa8",
    background: "rgba(255,80,100,.08)",
    border: "1px solid rgba(255,80,100,.28)",
    borderRadius: 8,
    padding: "8px 9px",
    fontSize: 11,
  },
};
