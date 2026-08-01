"use client";

import type { MarketMapSnapshot, SessionMapManagerState } from "../lib/session/mapEngine";

export function MapEnginePanel({
  state,
  onReset,
}: {
  state: SessionMapManagerState;
  onReset: () => void;
}) {
  const controlling =
    state.phase === "ACTIVE" ? state.active : state.opening;
  const candidate = state.candidate;

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Map Engine Manager</div>
          <div style={styles.titleRow}>
            <div style={styles.title}>{state.phase}</div>
            <span style={phaseBadge(state.phase)}>{state.phase}</span>
          </div>
          <div style={styles.subtitle}>
            Opening map remains immutable while candidate and active maps evolve.
          </div>
        </div>

        <button onClick={onReset} style={styles.resetButton}>
          Re-read Opening Map
        </button>
      </div>

      <div style={styles.summaryGrid}>
        <MapMetric
          label="Opening Center"
          value={state.opening.center.toFixed(0)}
        />
        <MapMetric
          label="Controlling Center"
          value={controlling.center.toFixed(0)}
        />
        <MapMetric
          label="Candidate Center"
          value={candidate?.center.toFixed(0) ?? "—"}
        />
        <MapMetric
          label="Confirmation"
          value={
            state.phase === "TRANSITION"
              ? `${state.confirmationCount}/${state.confirmationRequired}`
              : "—"
          }
        />
        <MapMetric label="Rail Breached" value={state.railBreached} />
        <MapMetric
          label="Outside"
          value={`${state.outsideMinutes.toFixed(1)} min`}
        />
      </div>

      <div style={styles.mapGrid}>
        <MapColumn title="Opening Map" map={state.opening} faded />
        <MapColumn
          title={state.phase === "ACTIVE" ? "Active Map" : "Controlling Map"}
          map={controlling}
        />
        <MapColumn title="Candidate Map" map={candidate} candidate />
      </div>

      <div style={styles.structureGrid}>
        <StructureColumn
          title="Opening Structure"
          map={state.opening}
          compareTo={state.opening}
          faded
        />
        <StructureColumn
          title={state.phase === "ACTIVE" ? "Active Structure" : "Controlling Structure"}
          map={controlling}
          compareTo={state.opening}
        />
        <StructureRankings map={controlling} />
      </div>

      <div style={styles.reasonGrid}>
        <div style={styles.reasonCard}>
          <div style={styles.sectionTitle}>Current Read</div>
          {state.reasons.map((reason) => (
            <div key={reason} style={styles.reason}>
              <span style={styles.dot} />
              {reason}
            </div>
          ))}
        </div>

        <div style={styles.reasonCard}>
          <div style={styles.sectionTitle}>Execution Rule</div>
          <div style={styles.rule}>
            {state.phase === "TRANSITION"
              ? "Iron Fly entry is penalized or blocked until the candidate map confirms."
              : state.phase === "ACTIVE"
                ? "Execution engines use the confirmed active map while retaining the opening map for comparison."
                : "Execution engines use the immutable opening map as the controlling structure."}
          </div>
          <div style={styles.rule}>
            Credit-spread candidates may remain eligible during transition when
            their directional wall and dealer conditions agree.
          </div>
        </div>
      </div>

      {state.events.length ? (
        <div style={styles.events}>
          <div style={styles.sectionTitle}>Map Events</div>
          {[...state.events]
            .reverse()
            .slice(0, 6)
            .map((event, index) => (
              <div key={`${event.timestamp}-${index}`} style={styles.event}>
                <span>
                  {new Date(event.timestamp).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <strong>
                  {event.from} → {event.to}
                </strong>
                <span>Center {event.center.toFixed(0)}</span>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}

function StructureColumn({
  title,
  map,
  compareTo,
  faded,
}: {
  title: string;
  map: MarketMapSnapshot;
  compareTo: MarketMapSnapshot;
  faded?: boolean;
}) {
  const structure = map.structure;
  if (!structure) {
    return (
      <div style={{ ...styles.mapColumn, opacity: faded ? 0.68 : 1 }}>
        <div style={styles.sectionTitle}>{title}</div>
        <div style={styles.proxyNote}>
          Structure is rebuilding from the current Schwab chain.
        </div>
      </div>
    );
  }

  const openingStructure = compareTo.structure ?? structure;

  return (
    <div style={{ ...styles.mapColumn, opacity: faded ? 0.68 : 1 }}>
      <div style={styles.sectionTitle}>{title}</div>
      <StructureRow label="Gamma Flip" value={structure.gammaFlip} opening={openingStructure.gammaFlip} />
      <StructureRow label="Zero Gamma" value={structure.zeroGamma} opening={openingStructure.zeroGamma} />
      <StructureRow label="Dealer Neutral" value={structure.dealerNeutral} opening={openingStructure.dealerNeutral} />
      <StructureRow label="Max Pain" value={structure.maxPain} opening={openingStructure.maxPain} />
      <ScoreRow label="Call Wall Strength" value={structure.callWallStrength} />
      <ScoreRow label="Put Wall Strength" value={structure.putWallStrength} />
      <ScoreRow label="Pin Probability" value={structure.pinProbability} />
      <ScoreRow label="Structure Confidence" value={structure.structuralConfidence} />
    </div>
  );
}

function StructureRankings({ map }: { map: MarketMapSnapshot }) {
  const structure = map.structure;
  if (!structure) {
    return (
      <div style={styles.mapColumn}>
        <div style={styles.sectionTitle}>Dominant Structure</div>
        <div style={styles.proxyNote}>
          Structure is rebuilding from the current Schwab chain.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.mapColumn}>
      <div style={styles.sectionTitle}>Dominant Structure</div>
      <div style={styles.dominantValue}>
        {structure.dominantLevel
          ? `${labelKey(structure.dominantLevel)} · ${structure.dominantLevelValue?.toFixed(0) ?? "—"}`
          : "BUILDING"}
      </div>
      <div style={styles.rankingTitle}>Support ranking</div>
      {structure.supportRanking.slice(0, 3).map((level, index) => (
        <RankRow key={level.key} index={index + 1} level={level.label} value={level.value} confidence={level.confidence} />
      ))}
      <div style={styles.rankingTitle}>Resistance ranking</div>
      {structure.resistanceRanking.slice(0, 3).map((level, index) => (
        <RankRow key={level.key} index={index + 1} level={level.label} value={level.value} confidence={level.confidence} />
      ))}
      <div style={styles.proxyNote}>Gamma/neutral levels are WheelDesk model proxies, not exchange-published dealer positions.</div>
    </div>
  );
}

function StructureRow({ label, value, opening }: { label: string; value: number | null; opening: number | null }) {
  const shift = value == null || opening == null ? null : value - opening;
  return (
    <div style={styles.row}>
      <span>{label}</span>
      <strong>
        {value == null ? "—" : value.toFixed(0)}
        {shift != null && shift !== 0 ? <em style={styles.shift}> {shift > 0 ? "↑" : "↓"}{Math.abs(shift).toFixed(0)}</em> : null}
      </strong>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.scoreBlock}>
      <div style={styles.scoreHeader}><span>{label}</span><strong>{value}%</strong></div>
      <div style={styles.scoreTrack}><div style={{ ...styles.scoreFill, width: `${value}%` }} /></div>
    </div>
  );
}

function RankRow({ index, level, value, confidence }: { index: number; level: string; value: number | null; confidence: number }) {
  return <div style={styles.rankRow}><span>{index}. {level}</span><strong>{value?.toFixed(0) ?? "—"} · {confidence}%</strong></div>;
}

function labelKey(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function MapColumn({
  title,
  map,
  faded,
  candidate,
}: {
  title: string;
  map: SessionMapManagerState["opening"] | null;
  faded?: boolean;
  candidate?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.mapColumn,
        opacity: faded ? 0.68 : 1,
        borderStyle: candidate ? "dotted" : "solid",
      }}
    >
      <div style={styles.sectionTitle}>{title}</div>
      <MapRow label="Center" value={map?.center} />
      <MapRow label="Lower Wing" value={map?.lowerWing} />
      <MapRow label="Upper Wing" value={map?.upperWing} />
      <MapRow label="Put Wall" value={map?.putWall} />
      <MapRow label="Call Wall" value={map?.callWall} />
      <MapRow label="Pin" value={map?.pin} />
      <MapRow label="Pressure" value={map?.dealerPressure} signed />
    </div>
  );
}

function MapRow({
  label,
  value,
  signed,
}: {
  label: string;
  value: number | null | undefined;
  signed?: boolean;
}) {
  const text =
    value == null
      ? "—"
      : signed
        ? `${value > 0 ? "+" : ""}${value.toFixed(1)}`
        : value.toFixed(0);

  return (
    <div style={styles.row}>
      <span>{label}</span>
      <strong>{text}</strong>
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
    color: "#70869a",
    fontSize: 10,
    marginTop: 3,
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
    gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))",
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
    gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
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
    marginBottom: 6,
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
  reasonGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
    gap: 10,
    marginTop: 12,
  },
  reasonCard: {
    background: "#0a1823",
    border: "1px solid #183247",
    borderRadius: 10,
    padding: 10,
  },
  reason: {
    display: "flex",
    gap: 7,
    color: "#b8c7d2",
    fontSize: 9,
    lineHeight: 1.4,
    marginTop: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#55d6ff",
    marginTop: 3,
    flex: "0 0 auto",
  },
  rule: {
    color: "#a9bac8",
    fontSize: 9,
    lineHeight: 1.45,
    marginTop: 6,
  },
  events: {
    marginTop: 12,
    borderTop: "1px solid #183247",
    paddingTop: 10,
  },
  event: {
    display: "grid",
    gridTemplateColumns: "70px 1fr 90px",
    gap: 10,
    padding: "6px 0",
    borderTop: "1px solid #142a3b",
    color: "#748a9e",
    fontSize: 9,
  },  structureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
    gap: 10,
    marginTop: 12,
  },
  scoreBlock: { display: "grid", gap: 4, padding: "7px 0", borderTop: "1px solid #173047" },
  scoreHeader: { display: "flex", justifyContent: "space-between", color: "#71879b", fontSize: 9 },
  scoreTrack: { height: 7, borderRadius: 99, background: "#12283a", overflow: "hidden" },
  scoreFill: { height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#1c739c,#20c997)" },
  shift: { color: "#55d6ff", fontStyle: "normal", fontSize: 8 },
  dominantValue: { fontSize: 16, fontWeight: 900, color: "#edf5fb", margin: "8px 0 12px" },
  rankingTitle: { color: "#6f8599", fontSize: 8, textTransform: "uppercase", letterSpacing: .7, marginTop: 10 },
  rankRow: { display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #173047", padding: "6px 0", color: "#8da0b1", fontSize: 9 },
  proxyNote: { color: "#60778c", fontSize: 8, lineHeight: 1.4, marginTop: 10 },

};
