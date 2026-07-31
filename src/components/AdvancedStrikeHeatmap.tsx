"use client";

import { useEffect, useMemo, useState } from "react";
import type { ZeroDteChainRow } from "../lib/zeroDteOiIntelligence";

type StrikeSnapshot = {
  strike: number;
  callOi: number;
  putOi: number;
  callGamma: number;
  putGamma: number;
  callVolume: number;
  putVolume: number;
  totalScore: number;
};

type SnapshotMap = Record<string, StrikeSnapshot>;

type HeatRow = StrikeSnapshot & {
  callShare: number;
  putShare: number;
  gammaBias: "CALL" | "PUT" | "BALANCED";
  sideBias: "CALL" | "PUT" | "BALANCED";
  sessionScoreChange: number;
  recentScoreChange: number;
  trend: "STRENGTHENING" | "WEAKENING" | "STABLE";
  labels: string[];
};

type Props = {
  tradeDate: string;
  generatedAt: string;
  spot: number;
  center: number;
  callWall: number | null;
  putWall: number | null;
  pin: number | null;
  expectedMove: number;
  rows: ZeroDteChainRow[];
  openingBaseline: SnapshotMap | null;
  mapState: "OPENING" | "TRANSITION" | "ACTIVE";
};

const roundStrike = (value: number) => Math.round(value / 5) * 5;
const safe = (value: number | null | undefined) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

export function AdvancedStrikeHeatmap({
  tradeDate,
  generatedAt,
  spot,
  center,
  callWall,
  putWall,
  pin,
  expectedMove,
  rows,
  openingBaseline,
  mapState,
}: Props) {
  const [baseline, setBaseline] = useState<SnapshotMap>({});
  const [previous, setPrevious] = useState<SnapshotMap>({});
  const [metric, setMetric] = useState<
    "structure" | "oi" | "gamma" | "volume" | "change"
  >("structure");

  const current = useMemo(() => buildSnapshot(rows), [rows]);

  useEffect(() => {
    const baselineKey = `wheeldesk:heatmap:baseline:${tradeDate}`;
    const previousKey = `wheeldesk:heatmap:previous:${tradeDate}`;

    const loadedBaseline = loadSnapshot(baselineKey);
    const loadedPrevious = loadSnapshot(previousKey);
    const nextBaseline =
      openingBaseline && Object.keys(openingBaseline).length > 0
        ? openingBaseline
        : Object.keys(loadedBaseline).length > 0
          ? loadedBaseline
          : current;

    setBaseline(nextBaseline);
    setPrevious(
      Object.keys(loadedPrevious).length > 0 ? loadedPrevious : current,
    );

    if (Object.keys(loadedBaseline).length === 0) {
      saveSnapshot(baselineKey, current);
    }

    saveSnapshot(previousKey, current);
  }, [openingBaseline, tradeDate]);

  useEffect(() => {
    if (!Object.keys(current).length) return;
    const key = `wheeldesk:heatmap:previous:${tradeDate}`;
    const stored = loadSnapshot(key);
    setPrevious(stored);
    saveSnapshot(key, current);
  }, [current, generatedAt, tradeDate]);

  const displayRows = useMemo(() => {
    const radius = Math.max(expectedMove * 1.6, 85);

    return Object.values(current)
      .filter((row) => Math.abs(row.strike - spot) <= radius)
      .map((row): HeatRow => {
        const base = baseline[String(row.strike)];
        const prior = previous[String(row.strike)];
        const callStructure = row.callOi + row.callGamma;
        const putStructure = row.putOi + row.putGamma;
        const totalStructure = Math.max(callStructure + putStructure, 1);
        const recentScoreChange = prior
          ? row.totalScore - prior.totalScore
          : 0;
        const sessionScoreChange = base
          ? row.totalScore - base.totalScore
          : 0;

        const labels: string[] = [];
        if (near(row.strike, spot)) labels.push("SPOT");
        if (near(row.strike, center)) labels.push("CENTER");
        if (callWall != null && near(row.strike, callWall))
          labels.push("CALL WALL");
        if (putWall != null && near(row.strike, putWall))
          labels.push("PUT WALL");
        if (pin != null && near(row.strike, pin)) labels.push("PIN");

        return {
          ...row,
          callShare: callStructure / totalStructure,
          putShare: putStructure / totalStructure,
          gammaBias:
            row.callGamma > row.putGamma * 1.12
              ? "CALL"
              : row.putGamma > row.callGamma * 1.12
                ? "PUT"
                : "BALANCED",
          sideBias:
            callStructure > putStructure * 1.12
              ? "CALL"
              : putStructure > callStructure * 1.12
                ? "PUT"
                : "BALANCED",
          sessionScoreChange,
          recentScoreChange,
          trend:
            recentScoreChange > Math.max(row.totalScore * 0.005, 25)
              ? "STRENGTHENING"
              : recentScoreChange < -Math.max(row.totalScore * 0.005, 25)
                ? "WEAKENING"
                : "STABLE",
          labels,
        };
      })
      .sort((a, b) => b.strike - a.strike);
  }, [
    baseline,
    callWall,
    center,
    current,
    expectedMove,
    pin,
    previous,
    putWall,
    spot,
  ]);

  const maxMetric = useMemo(
    () =>
      Math.max(
        ...displayRows.map((row) => Math.abs(metricValue(row, metric))),
        1,
      ),
    [displayRows, metric],
  );

  const strongest = useMemo(
    () => [...displayRows].sort((a, b) => b.totalScore - a.totalScore)[0],
    [displayRows],
  );

  const callTotal = displayRows.reduce(
    (sum, row) => sum + row.callOi + row.callGamma,
    0,
  );
  const putTotal = displayRows.reduce(
    (sum, row) => sum + row.putOi + row.putGamma,
    0,
  );
  const aggregateBias =
    callTotal > putTotal * 1.08
      ? "CALL HEAVY"
      : putTotal > callTotal * 1.08
        ? "PUT HEAVY"
        : "BALANCED";

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>SPX Multi-Factor Strike Heatmap</div>
          <div style={styles.subtitle}>
            OI, gamma, volume and session structure change by strike.
          </div>
        </div>

        <div style={styles.summary}>
          <Summary
            label="Dominant Strike"
            value={strongest?.strike.toFixed(0) ?? "—"}
          />
          <Summary label="Aggregate Bias" value={aggregateBias} />
          <Summary
            label="Opening Baseline"
            value={
              openingBaseline && Object.keys(openingBaseline).length
                ? "OPEN MAP"
                : Object.keys(baseline).length
                  ? "FALLBACK"
                  : "BUILDING"
            }
          />
          <Summary label="Map State" value={mapState} />
        </div>
      </div>

      <div style={styles.tabs}>
        {[
          ["structure", "Structure"],
          ["oi", "Open Interest"],
          ["gamma", "Gamma"],
          ["volume", "Volume"],
          ["change", "Session Change"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMetric(key as typeof metric)}
            style={{
              ...styles.tab,
              ...(metric === key ? styles.tabActive : {}),
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={styles.legend}>
        <span>Orange = call side</span>
        <span>Blue = put side</span>
        <span>Trend compares prior refresh</span>
        <span>Session change compares first stored snapshot</span>
      </div>

      <div style={styles.grid}>
        <div style={styles.headerRow}>
          <div>Strike</div>
          <div>Call</div>
          <div>Put</div>
          <div>Bias / Trend</div>
          <div>Values</div>
        </div>

        {displayRows.map((row) => {
          const callValue = callMetric(row, metric);
          const putValue = putMetric(row, metric);

          return (
            <div
              key={row.strike}
              style={{
                ...styles.row,
                ...(near(row.strike, spot) ? styles.spotRow : {}),
              }}
            >
              <div style={styles.strikeCell}>
                <strong>{row.strike.toFixed(0)}</strong>
                <div style={styles.badges}>
                  {row.labels.map((label) => (
                    <span key={label} style={badgeStyle(label)}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div style={styles.barCell}>
                <div style={styles.track}>
                  <div
                    style={{
                      ...styles.callFill,
                      width: `${Math.max(
                        2,
                        (Math.abs(callValue) / maxMetric) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <span>{formatValue(callValue, metric)}</span>
              </div>

              <div style={styles.barCell}>
                <div style={styles.track}>
                  <div
                    style={{
                      ...styles.putFill,
                      width: `${Math.max(
                        2,
                        (Math.abs(putValue) / maxMetric) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <span>{formatValue(putValue, metric)}</span>
              </div>

              <div style={styles.biasCell}>
                <strong>{row.sideBias}</strong>
                <span style={trendStyle(row.trend)}>{row.trend}</span>
                <span>{row.gammaBias} GAMMA</span>
              </div>

              <div style={styles.valuesCell}>
                <ValueCell
                  label="OI"
                  value={`${formatCompact(row.callOi)} / ${formatCompact(
                    row.putOi,
                  )}`}
                />
                <ValueCell
                  label="Gamma"
                  value={`${formatCompact(row.callGamma)} / ${formatCompact(
                    row.putGamma,
                  )}`}
                />
                <ValueCell
                  label="Vol"
                  value={`${formatCompact(row.callVolume)} / ${formatCompact(
                    row.putVolume,
                  )}`}
                />
                <ValueCell
                  label="Session Δ"
                  value={signedCompact(row.sessionScoreChange)}
                  valueColor={
                    row.sessionScoreChange > 0
                      ? "#71e0b4"
                      : row.sessionScoreChange < 0
                        ? "#ff8a93"
                        : "#8aa0b5"
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.footer}>
        Session Δ compares the live strike structure to the shared Opening Map
        baseline when available. It is not official exchange-reported intraday
        open-interest change.
      </div>
    </section>
  );
}

function ValueCell({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={styles.valueCell}>
      <span>{label}</span>
      <strong style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </strong>
    </div>
  );
}

function buildSnapshot(rows: ZeroDteChainRow[]): SnapshotMap {
  const map = new Map<number, StrikeSnapshot>();

  for (const row of rows) {
    const strike = roundStrike(row.strike);
    const current =
      map.get(strike) ??
      ({
        strike,
        callOi: 0,
        putOi: 0,
        callGamma: 0,
        putGamma: 0,
        callVolume: 0,
        putVolume: 0,
        totalScore: 0,
      } satisfies StrikeSnapshot);

    const oi = safe(row.openInterest);
    const gamma = Math.abs(safe(row.gamma)) * Math.max(oi, 1) * 1000;
    const volume = safe(row.volume);

    if (row.optionType === "call") {
      current.callOi += oi;
      current.callGamma += gamma;
      current.callVolume += volume;
    } else {
      current.putOi += oi;
      current.putGamma += gamma;
      current.putVolume += volume;
    }

    current.totalScore =
      current.callOi +
      current.putOi +
      current.callGamma +
      current.putGamma +
      (current.callVolume + current.putVolume) * 0.18;

    map.set(strike, current);
  }

  return Object.fromEntries(
    [...map.entries()].map(([strike, value]) => [String(strike), value]),
  );
}

function metricValue(row: HeatRow, metric: string) {
  switch (metric) {
    case "oi":
      return row.callOi + row.putOi;
    case "gamma":
      return row.callGamma + row.putGamma;
    case "volume":
      return row.callVolume + row.putVolume;
    case "change":
      return row.sessionScoreChange;
    default:
      return row.totalScore;
  }
}

function callMetric(row: HeatRow, metric: string) {
  switch (metric) {
    case "oi":
      return row.callOi;
    case "gamma":
      return row.callGamma;
    case "volume":
      return row.callVolume;
    case "change":
      return Math.max(row.sessionScoreChange, 0) * row.callShare;
    default:
      return row.callOi + row.callGamma + row.callVolume * 0.18;
  }
}

function putMetric(row: HeatRow, metric: string) {
  switch (metric) {
    case "oi":
      return row.putOi;
    case "gamma":
      return row.putGamma;
    case "volume":
      return row.putVolume;
    case "change":
      return Math.abs(Math.min(row.sessionScoreChange, 0)) * row.putShare;
    default:
      return row.putOi + row.putGamma + row.putVolume * 0.18;
  }
}

function loadSnapshot(key: string): SnapshotMap {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSnapshot(key: string, value: SnapshotMap) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Heatmap remains usable without persistence.
  }
}

function near(a: number, b: number) {
  return Math.abs(a - b) <= 2.5;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function signedCompact(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatCompact(value)}`;
}

function formatValue(value: number, metric: string) {
  return metric === "change" ? signedCompact(value) : formatCompact(value);
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.summaryItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function badgeStyle(label: string): React.CSSProperties {
  const palette: Record<string, { background: string; color: string }> = {
    SPOT: { background: "#16c784", color: "#04120c" },
    CENTER: { background: "#ffd400", color: "#211b00" },
    "CALL WALL": { background: "#ff8a34", color: "#241000" },
    "PUT WALL": { background: "#2f80ed", color: "#eef6ff" },
    PIN: { background: "#e8eef5", color: "#101820" },
  };

  return {
    ...styles.badge,
    ...(palette[label] ?? {
      background: "#24384a",
      color: "#d9e4ed",
    }),
  };
}

function trendStyle(trend: HeatRow["trend"]): React.CSSProperties {
  return {
    color:
      trend === "STRENGTHENING"
        ? "#71e0b4"
        : trend === "WEAKENING"
          ? "#ff8a93"
          : "#8296aa",
  };
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    marginTop: 12,
    background: "#08121a",
    border: "1px solid #16283a",
    borderRadius: 13,
    padding: 14,
    color: "#eaf2f8",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  title: {
    fontSize: 14,
    fontWeight: 850,
  },
  subtitle: {
    color: "#708399",
    fontSize: 11,
    marginTop: 3,
  },
  summary: {
    display: "flex",
    gap: 7,
    flexWrap: "wrap",
  },
  summaryItem: {
    display: "grid",
    gap: 2,
    minWidth: 95,
    background: "#0d1b26",
    border: "1px solid #1b3143",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 9,
    color: "#70869a",
  },
  tabs: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 13,
  },
  tab: {
    background: "#0b1822",
    border: "1px solid #24394b",
    color: "#7f94a8",
    borderRadius: 999,
    padding: "6px 9px",
    fontSize: 10,
    cursor: "pointer",
  },
  tabActive: {
    background: "#153b54",
    borderColor: "#2b789f",
    color: "#eefaff",
  },
  legend: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    color: "#60758a",
    fontSize: 9,
    marginTop: 10,
  },
  grid: {
    marginTop: 12,
    display: "grid",
    overflowX: "auto",
  },
  headerRow: {
    display: "grid",
    gridTemplateColumns:
      "120px minmax(120px,1fr) minmax(120px,1fr) 130px minmax(230px,1.2fr)",
    gap: 10,
    minWidth: 850,
    color: "#5f758a",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    padding: "0 8px 7px",
  },
  row: {
    display: "grid",
    gridTemplateColumns:
      "120px minmax(120px,1fr) minmax(120px,1fr) 130px minmax(230px,1.2fr)",
    gap: 10,
    minWidth: 850,
    alignItems: "center",
    borderTop: "1px solid #142635",
    padding: "8px",
  },
  spotRow: {
    background: "rgba(22,199,132,.045)",
    boxShadow: "inset 3px 0 0 rgba(22,199,132,.8)",
  },
  strikeCell: {
    display: "grid",
    gap: 5,
    fontSize: 12,
  },
  badges: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
  },
  badge: {
    borderRadius: 4,
    padding: "2px 4px",
    fontSize: 7,
    fontWeight: 900,
  },
  barCell: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 55px",
    gap: 7,
    alignItems: "center",
    color: "#71869a",
    fontSize: 9,
  },
  track: {
    height: 9,
    background: "#102231",
    borderRadius: 999,
    overflow: "hidden",
  },
  callFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg,#7d3d14,#ff8a34)",
  },
  putFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg,#173f78,#2f80ed)",
  },
  biasCell: {
    display: "grid",
    gap: 3,
    fontSize: 9,
    color: "#7f94a8",
  },
  valuesCell: {
    display: "grid",
    gridTemplateColumns: "repeat(4,minmax(0,1fr))",
    gap: 7,
  },
  valueCell: {
    display: "grid",
    gap: 2,
    color: "#60758a",
    fontSize: 8,
  },
  footer: {
    color: "#607489",
    fontSize: 9,
    marginTop: 10,
    borderTop: "1px solid #152839",
    paddingTop: 9,
  },
};
