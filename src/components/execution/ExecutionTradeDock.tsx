"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  makeExecutionSetupKey,
  type ExecutionCandidate,
  type ExecutionLeg,
  type ExecutionStrategy,
  type ZeroDteExecutionRead,
} from "../../lib/zeroDteExecutionIntelligence";

type Props = {
  read: ZeroDteExecutionRead | null;
  candidates: Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>;
  selectedStrategy: ExecutionStrategy;
  onStrategyChange: (strategy: ExecutionStrategy) => void;
  onOpen: (args: {
    candidate: ExecutionCandidate;
    entryCredit: number;
    quantity: number;
  }) => void | Promise<void>;
  onClose: (exitDebit: number) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
};

type SetupMode = "recommended" | "manual";

type DraftLeg = Omit<ExecutionLeg, "strike"> & { strike: string };

const STRATEGIES: Array<{ strategy: ExecutionStrategy; label: string }> = [
  { strategy: "put-credit-spread", label: "Put Credit" },
  { strategy: "call-credit-spread", label: "Call Credit" },
  { strategy: "iron-fly", label: "Iron Fly" },
];

export function ExecutionTradeDock({
  read,
  candidates,
  selectedStrategy,
  onStrategyChange,
  onOpen,
  onClose,
  busy = false,
  error = null,
}: Props) {
  const [setupMode, setSetupMode] = useState<SetupMode>("recommended");
  const [draftLegs, setDraftLegs] = useState<DraftLeg[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [entryCredit, setEntryCredit] = useState("");
  const [exitDebit, setExitDebit] = useState("");

  const candidate = candidates[selectedStrategy] ?? null;
  const candidateKey = candidate?.setupKey ?? `${selectedStrategy}:none`;

  useEffect(() => {
    if (setupMode === "manual") return;
    if (!candidate) {
      setDraftLegs([]);
      setEntryCredit("");
      return;
    }
    setDraftLegs(
      candidate.legs.map((leg) => ({ ...leg, strike: leg.strike.toFixed(0) })),
    );
    setEntryCredit(
      candidate.estimatedCredit == null
        ? ""
        : candidate.estimatedCredit.toFixed(2),
    );
  }, [candidateKey, setupMode]);

  useEffect(() => {
    if (!read?.position) {
      setExitDebit("");
      return;
    }
    setExitDebit(
      read.currentCredit == null ? "" : read.currentCredit.toFixed(2),
    );
  }, [read?.position?.id]);

  const parsedEntryCredit = parseNonNegative(entryCredit);
  const parsedExitDebit = parseNonNegative(exitDebit);
  const parsedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));

  const ticket = useMemo(() => {
    if (!candidate) return { candidate: null, error: "No setup is available." };
    if (setupMode === "recommended") {
      const credit = parsedEntryCredit ?? candidate.estimatedCredit;
      return {
        candidate: {
          ...candidate,
          estimatedCredit: credit,
          maxRiskDollars: calculateMaxRisk(
            selectedStrategy,
            candidate.legs,
            credit,
          ),
        },
        error: null,
      };
    }

    const legs = draftLegs.map((leg) => ({
      optionType: leg.optionType,
      action: leg.action,
      strike: Number(leg.strike),
    }));
    const validation = validateLegs(selectedStrategy, legs);
    if (validation) return { candidate: null, error: validation };

    const credit = parsedEntryCredit ?? candidate.estimatedCredit;
    return {
      candidate: {
        ...candidate,
        label: `Manual ${strategyName(selectedStrategy)}`,
        legs,
        setupKey: makeExecutionSetupKey(selectedStrategy, legs),
        estimatedCredit: credit,
        maxRiskDollars: calculateMaxRisk(selectedStrategy, legs, credit),
        reasons: [
          "Manual execution legs entered in the WheelDesk Trade Dock.",
          ...candidate.reasons,
        ],
      },
      error: null,
    };
  }, [candidate, draftLegs, parsedEntryCredit, selectedStrategy, setupMode]);

  if (!read) {
    return (
      <div style={styles.card}>
        <div style={styles.eyebrow}>Trade Dock</div>
        <div style={styles.empty}>Waiting for live execution intelligence.</div>
      </div>
    );
  }

  if (read.position) {
    const closeLegs = read.position.legs.map(invertLeg);
    return (
      <div
        style={{
          ...styles.card,
          borderColor: read.emergencyExit
            ? "rgba(251,113,133,.72)"
            : read.lifecycle === "BUYBACK_READY"
              ? "rgba(251,113,133,.58)"
              : "rgba(66,165,245,.5)",
        }}
      >
        <div style={styles.headerRow}>
          <div>
            <div style={styles.eyebrow}>Position Manager</div>
            <div style={styles.title}>{read.position.label}</div>
          </div>
          <div style={styles.quantityPill}>{read.position.quantity}×</div>
        </div>

        <LegList legs={read.position.legs} title="Open legs" />

        <div style={styles.metricGrid}>
          <DockMetric label="Entry Credit" value={money(read.position.entryCredit)} />
          <DockMetric label="Current Debit" value={money(read.currentCredit)} />
          <DockMetric label="Captured" value={percent(read.capturedPremiumPct)} />
          <DockMetric label="Open P/L" value={dollars(read.livePnlDollars)} />
          <DockMetric label="Exit Score" value={String(Math.round(read.exitScore))} />
          <DockMetric label="State" value={read.lifecycle.replaceAll("_", " ")} />
        </div>

        <div style={styles.closePreview}>
          <div style={styles.smallCaps}>Closing Order</div>
          {closeLegs.map((leg, index) => (
            <div key={`${leg.action}-${leg.optionType}-${leg.strike}-${index}`} style={styles.closeLeg}>
              <strong>{leg.action.toUpperCase()}</strong>
              <span>
                {read.position?.quantity} × {leg.strike.toFixed(0)} {leg.optionType.toUpperCase()}
              </span>
            </div>
          ))}
        </div>

        <label style={styles.fieldLabel}>
          Actual closing debit
          <input
            value={exitDebit}
            onChange={(event) => setExitDebit(event.target.value)}
            type="number"
            min="0"
            step="0.05"
            placeholder={read.currentCredit?.toFixed(2) ?? "0.00"}
            style={styles.input}
          />
        </label>

        <button
          type="button"
          disabled={busy || parsedExitDebit == null}
          onClick={() => {
            if (parsedExitDebit == null) return;
            void onClose(parsedExitDebit);
          }}
          style={{
            ...styles.closeButton,
            opacity: busy || parsedExitDebit == null ? 0.45 : 1,
          }}
        >
          {busy ? "Saving…" : "Buy Back / Close Position"}
        </button>

        {error ? <div style={styles.error}>{error}</div> : null}
      </div>
    );
  }

  const engineCleared =
    read.lifecycle === "ARMED" || read.lifecycle === "SELL_READY";
  const canOpen =
    !busy &&
    ticket.candidate !== null &&
    parsedEntryCredit !== null &&
    parsedEntryCredit > 0;

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.eyebrow}>Trade Dock</div>
          <div style={styles.title}>Enter Actual Position</div>
        </div>
        <div
          style={{
            ...styles.enginePill,
            color: engineCleared ? "#71e0b4" : "#f5c542",
            borderColor: engineCleared
              ? "rgba(113,224,180,.45)"
              : "rgba(245,197,66,.42)",
          }}
        >
          {read.lifecycle.replaceAll("_", " ")}
        </div>
      </div>

      <div style={styles.strategyGrid}>
        {STRATEGIES.map(({ strategy, label }) => {
          const option = candidates[strategy];
          const active = selectedStrategy === strategy;
          return (
            <button
              type="button"
              key={strategy}
              onClick={() => {
                setSetupMode("recommended");
                onStrategyChange(strategy);
              }}
              style={{
                ...styles.strategyButton,
                ...(active ? styles.strategyButtonActive : {}),
                opacity: option ? 1 : 0.5,
              }}
            >
              <span>{label}</span>
              <strong>{option ? Math.round(option.score) : "—"}</strong>
            </button>
          );
        })}
      </div>

      <div style={styles.modeRow}>
        <button
          type="button"
          onClick={() => setSetupMode("recommended")}
          style={{
            ...styles.modeButton,
            ...(setupMode === "recommended" ? styles.modeButtonActive : {}),
          }}
        >
          Recommended
        </button>
        <button
          type="button"
          onClick={() => setSetupMode("manual")}
          style={{
            ...styles.modeButton,
            ...(setupMode === "manual" ? styles.modeButtonActive : {}),
          }}
        >
          Manual Legs
        </button>
      </div>

      {draftLegs.length ? (
        <div style={styles.legEditor}>
          {draftLegs.map((leg, index) => (
            <label
              key={`${leg.action}-${leg.optionType}-${index}`}
              style={styles.legField}
            >
              <span>
                {leg.action.toUpperCase()} {leg.optionType.toUpperCase()}
              </span>
              <input
                value={leg.strike}
                disabled={setupMode === "recommended"}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraftLegs((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, strike: value } : item,
                    ),
                  );
                }}
                type="number"
                step="5"
                style={{
                  ...styles.legInput,
                  opacity: setupMode === "recommended" ? 0.72 : 1,
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <div style={styles.empty}>No executable legs for this strategy.</div>
      )}

      <div style={styles.twoColumn}>
        <label style={styles.fieldLabel}>
          Quantity
          <input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            type="number"
            min="1"
            step="1"
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          Actual fill credit
          <input
            value={entryCredit}
            onChange={(event) => setEntryCredit(event.target.value)}
            type="number"
            min="0"
            step="0.05"
            placeholder={read.currentCredit?.toFixed(2) ?? "0.00"}
            style={styles.input}
          />
        </label>
      </div>

      <div style={styles.metricGrid}>
        <DockMetric label="Live Credit" value={money(read.currentCredit)} />
        <DockMetric
          label="Max Risk / 1×"
          value={dollars(
            ticket.candidate?.maxRiskDollars ?? candidate?.maxRiskDollars,
          )}
        />
        <DockMetric label="Entry Score" value={String(Math.round(read.entryScore))} />
        <DockMetric
          label="Eligibility"
          value={candidate?.eligible ? "ELIGIBLE" : "OVERRIDE"}
        />
      </div>

      {!engineCleared ? (
        <div style={styles.warning}>
          The execution engine has not confirmed a sell entry. WheelDesk will still
          store and manage the position if you mark an actual fill.
        </div>
      ) : null}

      {ticket.error ? <div style={styles.error}>{ticket.error}</div> : null}
      {error ? <div style={styles.error}>{error}</div> : null}

      <button
        type="button"
        disabled={!canOpen}
        onClick={() => {
          if (!ticket.candidate || parsedEntryCredit == null) return;
          void onOpen({
            candidate: ticket.candidate,
            entryCredit: parsedEntryCredit,
            quantity: parsedQuantity,
          });
        }}
        style={{ ...styles.openButton, opacity: canOpen ? 1 : 0.45 }}
      >
        {busy
          ? "Saving…"
          : `Open / Track ${strategyName(selectedStrategy)}`}
      </button>
    </div>
  );
}

function LegList({ legs, title }: { legs: ExecutionLeg[]; title: string }) {
  return (
    <div style={styles.legList}>
      <div style={styles.smallCaps}>{title}</div>
      {legs.map((leg, index) => (
        <div key={`${leg.action}-${leg.optionType}-${leg.strike}-${index}`} style={styles.legRow}>
          <strong>{leg.action.toUpperCase()}</strong>
          <span>{leg.strike.toFixed(0)} {leg.optionType.toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}

function DockMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateLegs(strategy: ExecutionStrategy, legs: ExecutionLeg[]) {
  if (legs.some((leg) => !Number.isFinite(leg.strike) || leg.strike <= 0)) {
    return "Every leg requires a valid strike.";
  }

  if (strategy === "put-credit-spread") {
    const short = legs.find((leg) => leg.action === "sell" && leg.optionType === "put");
    const long = legs.find((leg) => leg.action === "buy" && leg.optionType === "put");
    if (!short || !long) return "Put spread requires one short put and one long put.";
    if (short.strike <= long.strike) {
      return "Put credit spread short strike must be above the long strike.";
    }
  }

  if (strategy === "call-credit-spread") {
    const short = legs.find((leg) => leg.action === "sell" && leg.optionType === "call");
    const long = legs.find((leg) => leg.action === "buy" && leg.optionType === "call");
    if (!short || !long) return "Call spread requires one short call and one long call.";
    if (short.strike >= long.strike) {
      return "Call credit spread short strike must be below the long strike.";
    }
  }

  if (strategy === "iron-fly") {
    const longPut = legs.find((leg) => leg.action === "buy" && leg.optionType === "put");
    const shortPut = legs.find((leg) => leg.action === "sell" && leg.optionType === "put");
    const shortCall = legs.find((leg) => leg.action === "sell" && leg.optionType === "call");
    const longCall = legs.find((leg) => leg.action === "buy" && leg.optionType === "call");
    if (!longPut || !shortPut || !shortCall || !longCall) {
      return "Iron Fly requires four complete put/call legs.";
    }
    if (shortPut.strike !== shortCall.strike) {
      return "Iron Fly short put and short call must share the center strike.";
    }
    if (!(longPut.strike < shortPut.strike && shortCall.strike < longCall.strike)) {
      return "Iron Fly wings must remain outside the short center.";
    }
  }

  return null;
}

function calculateMaxRisk(
  strategy: ExecutionStrategy,
  legs: ExecutionLeg[],
  credit: number | null,
) {
  if (credit == null) return null;
  if (strategy === "iron-fly") {
    const short = legs.find((leg) => leg.action === "sell")?.strike;
    const longPut = legs.find((leg) => leg.action === "buy" && leg.optionType === "put")?.strike;
    const longCall = legs.find((leg) => leg.action === "buy" && leg.optionType === "call")?.strike;
    if (short == null || longPut == null || longCall == null) return null;
    const width = Math.max(short - longPut, longCall - short);
    return Math.max(0, width - credit) * 100;
  }

  const short = legs.find((leg) => leg.action === "sell")?.strike;
  const long = legs.find((leg) => leg.action === "buy")?.strike;
  if (short == null || long == null) return null;
  return Math.max(0, Math.abs(short - long) - credit) * 100;
}

function invertLeg(leg: ExecutionLeg): ExecutionLeg {
  return { ...leg, action: leg.action === "sell" ? "buy" : "sell" };
}

function strategyName(strategy: ExecutionStrategy) {
  if (strategy === "put-credit-spread") return "Put Credit Spread";
  if (strategy === "call-credit-spread") return "Call Credit Spread";
  return "Iron Fly";
}

function parseNonNegative(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function dollars(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : ""}$${absolute}`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#0a141d",
    border: "1px solid #1d3b53",
    borderRadius: 13,
    padding: 13,
    display: "grid",
    gap: 11,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "flex-start",
  },
  eyebrow: {
    color: "#55d6ff",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: { marginTop: 3, fontSize: 14, fontWeight: 900 },
  smallCaps: {
    color: "#708399",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  enginePill: {
    border: "1px solid",
    borderRadius: 999,
    padding: "4px 7px",
    fontSize: 8,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  quantityPill: {
    border: "1px solid #28506b",
    background: "#102434",
    borderRadius: 999,
    padding: "5px 9px",
    fontWeight: 900,
  },
  strategyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 5,
  },
  strategyButton: {
    display: "grid",
    gap: 3,
    border: "1px solid #223b4e",
    borderRadius: 8,
    background: "#08111a",
    color: "#8295aa",
    padding: "7px 5px",
    fontSize: 8,
    cursor: "pointer",
  },
  strategyButtonActive: {
    background: "#12324a",
    color: "#eaf7ff",
    borderColor: "#2d709e",
  },
  modeRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 },
  modeButton: {
    border: "1px solid #26394b",
    borderRadius: 8,
    background: "#08111a",
    color: "#8295aa",
    padding: "7px",
    fontSize: 9,
    cursor: "pointer",
  },
  modeButtonActive: {
    color: "#eaf7ff",
    borderColor: "#2d709e",
    background: "#10283a",
  },
  legEditor: { display: "grid", gap: 6 },
  legField: {
    display: "grid",
    gridTemplateColumns: "1fr 86px",
    alignItems: "center",
    gap: 8,
    color: "#9aabbb",
    fontSize: 9,
    fontWeight: 850,
  },
  legInput: {
    width: "100%",
    boxSizing: "border-box",
    background: "#071018",
    color: "#eef5fb",
    border: "1px solid #26394b",
    borderRadius: 7,
    padding: "7px 8px",
    textAlign: "right",
  },
  twoColumn: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 },
  fieldLabel: {
    display: "grid",
    gap: 5,
    color: "#8194a7",
    fontSize: 9,
    fontWeight: 800,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#071018",
    color: "#eef5fb",
    border: "1px solid #26394b",
    borderRadius: 8,
    padding: "8px",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 6,
  },
  metric: {
    display: "grid",
    gap: 3,
    background: "#071018",
    border: "1px solid #172a3b",
    borderRadius: 8,
    padding: 7,
    color: "#708399",
    fontSize: 8,
  },
  openButton: {
    border: 0,
    borderRadius: 9,
    background: "linear-gradient(135deg,#167b55,#16c784)",
    color: "#04120c",
    padding: "10px 9px",
    fontWeight: 950,
    cursor: "pointer",
  },
  closeButton: {
    border: 0,
    borderRadius: 9,
    background: "linear-gradient(135deg,#a92836,#ea3943)",
    color: "white",
    padding: "10px 9px",
    fontWeight: 950,
    cursor: "pointer",
  },
  warning: {
    color: "#f5d77d",
    background: "rgba(245,197,66,.08)",
    border: "1px solid rgba(245,197,66,.26)",
    borderRadius: 8,
    padding: 8,
    fontSize: 9,
    lineHeight: 1.4,
  },
  error: {
    color: "#ff9aa1",
    background: "rgba(234,57,67,.08)",
    border: "1px solid rgba(234,57,67,.28)",
    borderRadius: 8,
    padding: 8,
    fontSize: 9,
  },
  empty: { color: "#708399", fontSize: 10, lineHeight: 1.4 },
  legList: {
    display: "grid",
    gap: 5,
    background: "#071018",
    border: "1px solid #172a3b",
    borderRadius: 8,
    padding: 8,
  },
  legRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#b8c6d3",
    fontSize: 10,
  },
  closePreview: {
    display: "grid",
    gap: 5,
    background: "rgba(234,57,67,.06)",
    border: "1px solid rgba(234,57,67,.2)",
    borderRadius: 8,
    padding: 8,
  },
  closeLeg: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#d8e1e9",
    fontSize: 9,
  },
};
