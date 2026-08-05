"use client";

import type React from "react";
import type {
  MarketMapSnapshot,
  SessionMapManagerState,
} from "../lib/session/mapEngine";
import type { ZeroDteStrikeFlowRead } from "../lib/zeroDteStrikeFlow";

export function MapEnginePanel({
  state,
  strikeFlow,
  onReset,
}: {
  state: SessionMapManagerState;
  strikeFlow?: ZeroDteStrikeFlowRead | null;
  onReset: () => void;
}) {
  const controlling =
    state.phase === "ACTIVE"
      ? state.active
      : state.phase === "TRANSITION" && state.candidate
        ? state.candidate
        : state.opening;
  const accepted =
    state.phase === "ACTIVE"
      ? state.active
      : state.phase === "TRANSITION"
        ? state.candidate
        : null;

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Map Engine Manager</div>
          <div style={styles.titleRow}>
            <div style={styles.title}>{state.phase}</div>
            <span style={phaseBadge(state.phase)}>{state.phase}</span>
            <span style={sessionBadge(state.sessionStatus)}>
              {state.sessionStatus === "CLOSED"
                ? "EOD FROZEN"
                : state.sessionStatus}
            </span>
          </div>
          <div style={styles.subtitle}>
            The opening thesis is immutable. A replacement map becomes controlling
            only after price, structure, completed-minute flow, and two closed
            candles agree.
          </div>
        </div>

        <button onClick={onReset} style={styles.resetButton}>
          Re-read Opening Map
        </button>
      </div>

      <div style={styles.summaryGrid}>
        <MapMetric
          label="Opening Center"
          value={formatNumber(state.opening.center)}
        />
        <MapMetric
          label="Live Center"
          value={formatNumber(state.latest.center)}
        />
        <MapMetric
          label="Controlling Center"
          value={formatNumber(controlling.center)}
        />
        <MapMetric label="Rail Breached" value={state.railBreached} />
        <MapMetric
          label="Outside"
          value={`${state.outsideMinutes.toFixed(1)} min`}
        />
        <MapMetric
          label="Migration Evidence"
          value={`${state.migrationScore}/100`}
        />
        <MapMetric
          label="Closed Candles"
          value={`${state.confirmationCount}/${state.confirmationRequired}`}
        />
        <MapMetric
          label="Flow"
          value={state.flowConfirmation}
        />
      </div>

      <div style={styles.mapGrid}>
        <MapColumn
          title="Opening Thesis"
          subtitle={`${formatTime(state.opening.capturedAt)} · ${state.opening.source}`}
          map={state.opening}
        />

        <MapColumn
          title="Live Structure"
          subtitle="Latest Schwab chain; diagnostic until accepted"
          map={state.latest}
        />

        <MapColumn
          title={
            state.phase === "ACTIVE"
              ? "Active Map"
              : state.phase === "TRANSITION"
                ? "Candidate Map"
                : "Accepted Replacement"
          }
          subtitle={
            accepted
              ? state.phase === "ACTIVE"
                ? "Confirmed replacement structure"
                : "Building through closed candles"
              : "No replacement map has cleared the gate"
          }
          map={accepted}
          candidate={state.phase === "TRANSITION"}
        />

        <MigrationEvidence state={state} flow={strikeFlow ?? null} />
      </div>

      <StructureEvolution
        opening={state.opening}
        current={state.latest}
        accepted={accepted}
      />

      <div style={styles.reasonGrid}>
        <div style={styles.reasonCard}>
          <div style={styles.sectionTitle}>Current State</div>
          {(state.reasons.length
            ? state.reasons
            : ["Map evidence is still building."]
          ).map((reason, index) => (
            <div key={`${reason}-${index}`} style={styles.reasonLine}>
              <span style={styles.reasonDot} />
              {reason}
            </div>
          ))}
        </div>

        <div style={styles.reasonCard}>
          <div style={styles.sectionTitle}>What the Manager Is Doing</div>
          <div style={styles.ruleText}>
            <strong>OPENING:</strong> the saved opening thesis controls.
          </div>
          <div style={styles.ruleText}>
            <strong>TRANSITION:</strong> price is outside a rail and a live
            replacement is being tested with completed one-minute delta volume.
          </div>
          <div style={styles.ruleText}>
            <strong>ACTIVE:</strong> two closed candles confirmed the replacement;
            directional credit spreads may use it. The opening Iron Fly remains
            tied to the opening thesis.
          </div>
          <div style={styles.proxyNote}>
            Structure movement is descriptive, not an entry signal. OI/gamma say
            where the structure is; completed-minute delta volume and price response
            say whether the market accepted it.
          </div>
        </div>
      </div>
    </section>
  );
}

function MigrationEvidence({
  state,
  flow,
}: {
  state: SessionMapManagerState;
  flow: ZeroDteStrikeFlowRead | null;
}) {
  const structureConfidence =
    state.latest.structure?.structuralConfidence ?? 0;
  return (
    <div style={styles.mapColumn}>
      <div style={styles.sectionTitle}>Migration Evidence</div>
      <MapRow label="Evidence score" value={state.migrationScore} suffix="/100" />
      <MapRow
        label="Structure confidence"
        value={structureConfidence}
        suffix="%"
      />
      <MapRow
        label="General confidence"
        value={state.latest.confidence}
        suffix="%"
      />
      <TextRow label="Flow verdict" value={state.flowConfirmation} />
      <TextRow
        label="Flow direction"
        value={flow?.mapDirection ?? "UNAVAILABLE"}
      />
      <MapRow
        label="Flow score"
        value={flow?.mapConfirmationScore}
        suffix="/100"
      />
      <TextRow
        label="Official through"
        value={flow?.officialThrough ? formatTime(flow.officialThrough) : "—"}
      />
      <TextRow
        label="Flow windows"
        value={
          flow
            ? `1m trigger · ${flow.confirmationWindowMinutes}m confirm · ${flow.contextWindowMinutes}m context`
            : "Building"
        }
      />
      <div style={styles.proxyNote}>
        {flow?.mapMessage ??
          "Five-second harvests collect data only. The first official flow read appears after a one-minute candle closes."}
      </div>
    </div>
  );
}

function StructureEvolution({
  opening,
  current,
  accepted,
}: {
  opening: MarketMapSnapshot;
  current: MarketMapSnapshot;
  accepted: MarketMapSnapshot | null;
}) {
  const openingStructure = opening.structure;
  const currentStructure = current.structure;

  if (!openingStructure || !currentStructure) {
    return (
      <div style={styles.evolutionCard}>
        <div style={styles.sectionTitle}>Observed Structure Movement</div>
        <div style={styles.proxyNote}>
          Structure is rebuilding from the current Schwab chain.
        </div>
      </div>
    );
  }

  const rows = currentStructure.levels.map((level) => {
    const openLevel = openingStructure.levels.find(
      (item) => item.key === level.key,
    );
    const acceptedLevel = accepted?.structure?.levels.find(
      (item) => item.key === level.key,
    );
    const move =
      level.value == null || openLevel?.value == null
        ? null
        : level.value - openLevel.value;
    const acceptedValue = acceptedLevel?.value ?? null;
    const acceptedNow =
      acceptedValue != null &&
      level.value != null &&
      Math.abs(acceptedValue - level.value) <= 5;

    return {
      ...level,
      openValue: openLevel?.value ?? null,
      move,
      acceptedNow,
    };
  });

  return (
    <div style={styles.evolutionCard}>
      <div style={styles.evolutionHeader}>
        <div>
          <div style={styles.sectionTitle}>
            Observed Structure Movement
          </div>
          <div style={styles.proxyNote}>
            Diagnostic comparison of the saved opening chain with the latest
            chain. A moved level does not become controlling until the Map
            Manager confirms it.
          </div>
        </div>
        <div style={styles.evolutionSummary}>
          <span>Latest dominant level</span>
          <strong>
            {currentStructure.dominantLevel
              ? `${labelKey(currentStructure.dominantLevel)} · ${
                  currentStructure.dominantLevelValue?.toFixed(0) ?? "—"
                }`
              : "BUILDING"}
          </strong>
        </div>
      </div>

      <div style={styles.evolutionTable}>
        <div style={styles.evolutionTableHeader}>
          <span>Level</span>
          <span>Opening</span>
          <span>Latest</span>
          <span>Move</span>
          <span>Strength</span>
          <span>Confidence</span>
          <span>Accepted?</span>
        </div>

        {rows.map((row) => (
          <div key={row.key} style={styles.evolutionRow}>
            <strong>{row.label}</strong>
            <span>{formatNumber(row.openValue)}</span>
            <span>{formatNumber(row.value)}</span>
            <span style={movementTone(row.move)}>
              {formatSigned(row.move)}
            </span>
            <span>{row.strength}%</span>
            <span>{row.confidence}%</span>
            <span
              style={{
                color: row.acceptedNow ? "#71e0b4" : "#71879b",
                fontWeight: 850,
              }}
            >
              {row.acceptedNow ? "YES" : "NO"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MapColumn({
  title,
  subtitle,
  map,
  candidate,
}: {
  title: string;
  subtitle: string;
  map: MarketMapSnapshot | null;
  candidate?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.mapColumn,
        borderStyle: candidate ? "dotted" : "solid",
        opacity: map ? 1 : 0.72,
      }}
    >
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.columnSubtitle}>{subtitle}</div>
      <MapRow label="Spot" value={map?.spot} />
      <MapRow label="Center" value={map?.center} />
      <MapRow label="Lower rail" value={map?.lowerWing} />
      <MapRow label="Upper rail" value={map?.upperWing} />
      <MapRow label="Put wall" value={map?.putWall} />
      <MapRow label="Call wall" value={map?.callWall} />
      <MapRow label="Pin" value={map?.pin} />
      <MapRow
        label="Structure confidence"
        value={map?.structure?.structuralConfidence}
        suffix="%"
      />
      <MapRow
        label="Dealer pressure"
        value={map?.dealerPressure}
        signed
      />
    </div>
  );
}

function MapRow({
  label,
  value,
  signed,
  suffix = "",
}: {
  label: string;
  value: number | null | undefined;
  signed?: boolean;
  suffix?: string;
}) {
  const text =
    value == null
      ? "—"
      : signed
        ? `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`
        : `${value.toFixed(suffix === "%" || suffix === "/100" ? 0 : 1)}${suffix}`;

  return (
    <div style={styles.row}>
      <span>{label}</span>
      <strong>{text}</strong>
    </div>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(0);
}

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatSigned(value: number | null) {
  if (value == null) return "—";
  if (Math.abs(value) < 0.01) return "0";
  return `${value > 0 ? "↑ +" : "↓ "}${Math.abs(value).toFixed(0)}`;
}

function movementTone(value: number | null): React.CSSProperties {
  return {
    color:
      value == null || Math.abs(value) < 0.01
        ? "#71879b"
        : value > 0
          ? "#71e0b4"
          : "#ff8a93",
  };
}

function labelKey(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function phaseBadge(
  phase: SessionMapManagerState["phase"],
): React.CSSProperties {
  return {
    ...styles.badge,
    background:
      phase === "OPENING"
        ? "rgba(85,214,255,.14)"
        : phase === "TRANSITION"
          ? "rgba(245,197,66,.16)"
          : "rgba(22,199,132,.16)",
    color:
      phase === "OPENING"
        ? "#78dcff"
        : phase === "TRANSITION"
          ? "#f5c542"
          : "#71e0b4",
  };
}

function sessionBadge(
  status: SessionMapManagerState["sessionStatus"],
): React.CSSProperties {
  return {
    ...styles.badge,
    background:
      status === "OPEN"
        ? "rgba(22,199,132,.14)"
        : status === "CLOSED"
          ? "rgba(113,135,155,.16)"
          : "rgba(245,197,66,.14)",
    color:
      status === "OPEN"
        ? "#71e0b4"
        : status === "CLOSED"
          ? "#9aabba"
          : "#f5c542",
  };
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    marginTop: 12,
    background: "#08131d",
    border: "1px solid #1b3449",
    borderRadius: 13,
    padding: 14,
    color: "#edf5fb",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "#55d6ff",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 18,
    fontWeight: 950,
  },
  badge: {
    borderRadius: 999,
    padding: "4px 7px",
    fontSize: 8,
    fontWeight: 900,
  },
  subtitle: {
    color: "#7c91a4",
    fontSize: 10,
    marginTop: 4,
    maxWidth: 760,
    lineHeight: 1.45,
  },
  resetButton: {
    background: "#0e2030",
    color: "#dce9f2",
    border: "1px solid #29445b",
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 10,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
    gap: 8,
    marginTop: 12,
  },
  metric: {
    display: "grid",
    gap: 3,
    background: "#0d1c28",
    border: "1px solid #193248",
    borderRadius: 8,
    padding: "7px 8px",
    color: "#6f8599",
    fontSize: 8,
  },
  mapGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
    gap: 10,
    marginTop: 12,
  },
  mapColumn: {
    background: "#0a1823",
    border: "1px solid #21405a",
    borderRadius: 10,
    padding: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 850,
    marginBottom: 5,
  },
  columnSubtitle: {
    color: "#6f8599",
    fontSize: 8,
    lineHeight: 1.35,
    minHeight: 22,
    marginBottom: 4,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    borderTop: "1px solid #173047",
    padding: "6px 0",
    color: "#71879b",
    fontSize: 9,
  },
  evolutionCard: {
    marginTop: 12,
    background: "#0a1823",
    border: "1px solid #183247",
    borderRadius: 10,
    padding: 10,
  },
  evolutionHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  evolutionSummary: {
    display: "grid",
    gap: 2,
    minWidth: 170,
    color: "#6f8599",
    fontSize: 8,
  },
  evolutionTable: {
    marginTop: 10,
    overflowX: "auto",
  },
  evolutionTableHeader: {
    display: "grid",
    gridTemplateColumns:
      "minmax(130px,1.4fr) repeat(6,minmax(80px,1fr))",
    gap: 8,
    minWidth: 730,
    color: "#60778c",
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    padding: "0 6px 6px",
  },
  evolutionRow: {
    display: "grid",
    gridTemplateColumns:
      "minmax(130px,1.4fr) repeat(6,minmax(80px,1fr))",
    gap: 8,
    minWidth: 730,
    borderTop: "1px solid #173047",
    padding: "7px 6px",
    color: "#91a4b5",
    fontSize: 9,
    alignItems: "center",
  },
  reasonGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
    gap: 10,
    marginTop: 12,
  },
  reasonCard: {
    background: "#0a1823",
    border: "1px solid #183247",
    borderRadius: 10,
    padding: 10,
  },
  reasonLine: {
    display: "flex",
    gap: 7,
    alignItems: "flex-start",
    color: "#9cb0c0",
    fontSize: 9,
    lineHeight: 1.45,
    marginTop: 6,
  },
  reasonDot: {
    width: 5,
    height: 5,
    borderRadius: 99,
    background: "#55d6ff",
    flex: "0 0 auto",
    marginTop: 4,
  },
  ruleText: {
    color: "#9cb0c0",
    fontSize: 9,
    lineHeight: 1.5,
    marginTop: 6,
  },
  proxyNote: {
    color: "#60788e",
    fontSize: 8,
    lineHeight: 1.45,
    marginTop: 7,
  },
};
