"use client";

import { useEffect, useMemo, useState } from "react";

type PressurePoint = {
  timestamp: string;
  pressure: number;
};

type DealerDirection = "RISING" | "FALLING" | "FLAT";
type DealerMomentum = "STRONG" | "MODERATE" | "LIGHT" | "NONE";
type GammaRegime =
  | "LONG GAMMA / STABILIZING"
  | "SHORT GAMMA / EXPANSIVE"
  | "TRANSITIONAL";

type DealerRead = {
  current: number;
  change: number;
  velocityPerMinute: number;
  accelerationPerMinute: number;
  direction: DealerDirection;
  momentum: DealerMomentum;
  regime: GammaRegime;
  stability: number;
  rollover: boolean;
  rolloverText: string;
  supportDistance: number | null;
  resistanceDistance: number | null;
  executionImpact: "SUPPORTS HARVEST" | "NEUTRAL" | "BLOCKS HARVEST";
  executionReasons: string[];
};

type Props = {
  tradeDate: string;
  generatedAt: string;
  spot: number;
  pressure: number;
  spxPressure: number;
  spyPressure: number;
  pressureBias: "up" | "down" | "neutral";
  source: "dealer-pressure-engine" | "local-proxy";
  support: number | null;
  resistance: number | null;
  pin: number | null;
  center: number;
  expectedMove: number;
  confidence: number;
};

const historyKey = (tradeDate: string) =>
  `wheeldesk:dealer-pressure:${tradeDate}`;

export function DealerAnalyticsPanel({
  tradeDate,
  generatedAt,
  spot,
  pressure,
  spxPressure,
  spyPressure,
  pressureBias,
  source,
  support,
  resistance,
  pin,
  center,
  expectedMove,
  confidence,
}: Props) {
  const [history, setHistory] = useState<PressurePoint[]>([]);

  useEffect(() => {
    setHistory(loadHistory(tradeDate));
  }, [tradeDate]);

  useEffect(() => {
    setHistory((current) => {
      const next = appendPoint(current, {
        timestamp: generatedAt,
        pressure,
      });
      saveHistory(tradeDate, next);
      return next;
    });
  }, [generatedAt, pressure, tradeDate]);

  const read = useMemo(
    () =>
      buildDealerRead({
        history,
        pressure,
        spot,
        support,
        resistance,
        center,
        pin,
        expectedMove,
        confidence,
      }),
    [
      center,
      confidence,
      expectedMove,
      history,
      pin,
      pressure,
      resistance,
      spot,
      support,
    ],
  );

  const pressurePct = Math.min(100, Math.abs(read.current));
  const pressureSide = read.current >= 0 ? "UP" : "DOWN";

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Layer 4</div>
          <div style={styles.title}>Dealer Analytics Engine</div>
          <div style={styles.subtitle}>
            Pressure direction, momentum, acceleration, regime and rollover.
          </div>
        </div>

        <div style={styles.headerMetrics}>
          <Metric label="Pressure" value={signed(read.current)} />
          <Metric label="Direction" value={read.direction} />
          <Metric label="Regime" value={read.regime} />
          <Metric label="Stability" value={`${read.stability}%`} />
        </div>
      </div>

      <div style={styles.pressureBand}>
        <div style={styles.bandLabels}>
          <span>Down pressure</span>
          <strong>{pressureSide}</strong>
          <span>Up pressure</span>
        </div>
        <div style={styles.bandTrack}>
          <div style={styles.bandCenter} />
          <div
            style={{
              ...styles.bandFill,
              ...(read.current >= 0 ? styles.bandUp : styles.bandDown),
              width: `${pressurePct / 2}%`,
              left: read.current >= 0 ? "50%" : `${50 - pressurePct / 2}%`,
            }}
          />
        </div>
      </div>

      <div style={styles.mainGrid}>
        <div style={styles.analysisCard}>
          <div style={styles.sectionTitle}>Pressure Behavior</div>
          <ReadRow label="Current" value={signed(read.current)} />
          <ReadRow label="Change" value={signed(read.change)} />
          <ReadRow
            label="Velocity"
            value={`${signed(read.velocityPerMinute)}/min`}
          />
          <ReadRow
            label="Acceleration"
            value={`${signed(read.accelerationPerMinute)}/min²`}
          />
          <ReadRow label="Momentum" value={read.momentum} />
          <ReadRow
            label="Rollover"
            value={read.rollover ? "DETECTED" : "NONE"}
            valueTone={read.rollover ? "positive" : "muted"}
          />
          <div style={styles.note}>{read.rolloverText}</div>
        </div>

        <div style={styles.analysisCard}>
          <div style={styles.sectionTitle}>Dealer Map</div>
          <ReadRow
            label="Support"
            value={support == null ? "—" : support.toFixed(0)}
          />
          <ReadRow
            label="Distance to Support"
            value={
              read.supportDistance == null
                ? "—"
                : `${read.supportDistance.toFixed(1)} pts`
            }
          />
          <ReadRow
            label="Resistance"
            value={resistance == null ? "—" : resistance.toFixed(0)}
          />
          <ReadRow
            label="Distance to Resistance"
            value={
              read.resistanceDistance == null
                ? "—"
                : `${read.resistanceDistance.toFixed(1)} pts`
            }
          />
          <ReadRow label="Pin" value={pin == null ? "—" : pin.toFixed(0)} />
          <ReadRow label="IF Center" value={center.toFixed(0)} />
        </div>

        <div style={styles.analysisCard}>
          <div style={styles.sectionTitle}>Source Alignment</div>
          <ReadRow label="SPX Pressure" value={signed(spxPressure)} />
          <ReadRow label="SPY Confirm" value={signed(spyPressure)} />
          <ReadRow label="Composite Bias" value={pressureBias.toUpperCase()} />
          <ReadRow
            label="Source"
            value={
              source === "dealer-pressure-engine"
                ? "DEALER ENGINE"
                : "LOCAL PROXY"
            }
          />
          <ReadRow
            label="SPX / SPY Spread"
            value={signed(spxPressure - spyPressure)}
          />
          <ReadRow
            label="Alignment"
            value={
              Math.sign(spxPressure) === Math.sign(spyPressure) ||
              Math.abs(spyPressure) < 8
                ? "ALIGNED"
                : "DIVERGENT"
            }
          />
        </div>

        <div
          style={{
            ...styles.executionCard,
            ...(read.executionImpact === "SUPPORTS HARVEST"
              ? styles.executionPositive
              : read.executionImpact === "BLOCKS HARVEST"
                ? styles.executionNegative
                : styles.executionNeutral),
          }}
        >
          <div style={styles.sectionTitle}>Execution Impact</div>
          <div style={styles.executionImpact}>{read.executionImpact}</div>
          <div style={styles.reasonList}>
            {read.executionReasons.map((reason) => (
              <div key={reason} style={styles.reason}>
                <span style={styles.reasonDot} />
                {reason}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.historyStrip}>
        <div style={styles.sectionTitle}>Pressure History</div>
        <div style={styles.sparkline}>
          {history.slice(-40).map((point, index, points) => {
            const max = Math.max(
              ...points.map((item) => Math.abs(item.pressure)),
              1,
            );
            const height = Math.max(5, (Math.abs(point.pressure) / max) * 34);
            return (
              <div
                key={`${point.timestamp}-${index}`}
                title={`${new Date(point.timestamp).toLocaleTimeString()} ${signed(
                  point.pressure,
                )}`}
                style={{
                  ...styles.sparkBar,
                  height,
                  background:
                    point.pressure >= 0
                      ? "rgba(22,199,132,.8)"
                      : "rgba(234,57,67,.8)",
                }}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function buildDealerRead(args: {
  history: PressurePoint[];
  pressure: number;
  spot: number;
  support: number | null;
  resistance: number | null;
  center: number;
  pin: number | null;
  expectedMove: number;
  confidence: number;
}): DealerRead {
  const {
    history,
    pressure,
    spot,
    support,
    resistance,
    center,
    pin,
    expectedMove,
    confidence,
  } = args;

  const latest = history.at(-1);
  const previous = history.at(-2);
  const prior = history.at(-3);

  const change = previous ? pressure - previous.pressure : 0;
  const elapsedMinutes = previous
    ? Math.max(
        (Date.parse(latest?.timestamp ?? new Date().toISOString()) -
          Date.parse(previous.timestamp)) /
          60_000,
        1 / 60,
      )
    : 1;

  const velocityPerMinute = change / elapsedMinutes;

  const previousVelocity =
    previous && prior
      ? (previous.pressure - prior.pressure) /
        Math.max(
          (Date.parse(previous.timestamp) - Date.parse(prior.timestamp)) /
            60_000,
          1 / 60,
        )
      : 0;

  const accelerationPerMinute =
    (velocityPerMinute - previousVelocity) / elapsedMinutes;

  const direction: DealerDirection =
    velocityPerMinute > 0.6
      ? "RISING"
      : velocityPerMinute < -0.6
        ? "FALLING"
        : "FLAT";

  const absoluteVelocity = Math.abs(velocityPerMinute);
  const momentum: DealerMomentum =
    absoluteVelocity >= 8
      ? "STRONG"
      : absoluteVelocity >= 3
        ? "MODERATE"
        : absoluteVelocity >= 0.8
          ? "LIGHT"
          : "NONE";

  const regime: GammaRegime =
    Math.abs(pressure) <= 18
      ? "LONG GAMMA / STABILIZING"
      : Math.abs(pressure) >= 45
        ? "SHORT GAMMA / EXPANSIVE"
        : "TRANSITIONAL";

  const volatilityPenalty = Math.min(45, absoluteVelocity * 2.4);
  const magnitudePenalty = Math.min(30, Math.abs(pressure) * 0.35);
  const accelerationPenalty = Math.min(
    20,
    Math.abs(accelerationPerMinute) * 1.5,
  );
  const stability = clamp(
    Math.round(100 - volatilityPenalty - magnitudePenalty - accelerationPenalty),
    0,
    100,
  );

  const rollover =
    previousVelocity !== 0 &&
    velocityPerMinute !== 0 &&
    Math.sign(previousVelocity) !== Math.sign(velocityPerMinute) &&
    Math.abs(velocityPerMinute - previousVelocity) >= 1.5;

  const rolloverText = rollover
    ? `Pressure velocity reversed from ${signed(
        previousVelocity,
      )}/min to ${signed(velocityPerMinute)}/min.`
    : history.length < 3
      ? "Building enough history to detect a pressure rollover."
      : `No material velocity reversal. Pressure is ${direction.toLowerCase()}.`;

  const supportDistance =
    support == null ? null : Math.max(0, spot - support);
  const resistanceDistance =
    resistance == null ? null : Math.max(0, resistance - spot);

  const nearCenter =
    Math.abs(spot - center) <= Math.max(expectedMove * 0.35, 5);
  const nearPin =
    pin != null && Math.abs(spot - pin) <= Math.max(expectedMove * 0.3, 5);
  const pressureStable = stability >= 62;
  const pressureExtreme = Math.abs(pressure) >= 55;
  const rollingTowardNeutral =
    (pressure < 0 && velocityPerMinute > 0.8) ||
    (pressure > 0 && velocityPerMinute < -0.8);

  let executionImpact: DealerRead["executionImpact"] = "NEUTRAL";

  if (
    pressureStable &&
    (rollingTowardNeutral || Math.abs(pressure) <= 25) &&
    (nearCenter || nearPin)
  ) {
    executionImpact = "SUPPORTS HARVEST";
  } else if (pressureExtreme && !rollingTowardNeutral) {
    executionImpact = "BLOCKS HARVEST";
  }

  const executionReasons = [
    pressureStable
      ? `Dealer stability is ${stability}%, supporting controlled premium behavior.`
      : `Dealer stability is only ${stability}%, increasing directional risk.`,
    rollingTowardNeutral
      ? "Pressure is rolling toward neutral."
      : `Pressure is ${direction.toLowerCase()} with ${momentum.toLowerCase()} momentum.`,
    nearCenter
      ? "SPX remains near the suggested IF center."
      : `${Math.abs(spot - center).toFixed(1)} points from the IF center.`,
    nearPin
      ? "Price remains within the active pin zone."
      : "Pin attraction is not currently dominant.",
    confidence >= 65
      ? `Structure confidence is ${confidence}%.`
      : `Structure confidence remains limited at ${confidence}%.`,
  ].slice(0, 5);

  return {
    current: pressure,
    change,
    velocityPerMinute,
    accelerationPerMinute,
    direction,
    momentum,
    regime,
    stability,
    rollover,
    rolloverText,
    supportDistance,
    resistanceDistance,
    executionImpact,
    executionReasons,
  };
}

function appendPoint(
  history: PressurePoint[],
  point: PressurePoint,
): PressurePoint[] {
  if (!Number.isFinite(point.pressure) || !Date.parse(point.timestamp)) {
    return history;
  }

  const previous = history.at(-1);
  const next =
    previous?.timestamp === point.timestamp
      ? [...history.slice(0, -1), point]
      : [...history, point];

  return next.slice(-720);
}

function loadHistory(tradeDate: string): PressurePoint[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(historyKey(tradeDate)) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(tradeDate: string, history: PressurePoint[]) {
  try {
    window.localStorage.setItem(
      historyKey(tradeDate),
      JSON.stringify(history.slice(-720)),
    );
  } catch {
    // Analytics still operate in-memory.
  }
}

function signed(value: number) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${value > 0 ? "+" : ""}${rounded}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReadRow({
  label,
  value,
  valueTone,
}: {
  label: string;
  value: string;
  valueTone?: "positive" | "muted";
}) {
  return (
    <div style={styles.readRow}>
      <span>{label}</span>
      <strong
        style={
          valueTone === "positive"
            ? { color: "#71e0b4" }
            : valueTone === "muted"
              ? { color: "#71869a" }
              : undefined
        }
      >
        {value}
      </strong>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    marginTop: 12,
    background: "#071018",
    border: "1px solid #173047",
    borderRadius: 13,
    padding: 14,
    color: "#ecf4fa",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "#55d6ff",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 15,
    fontWeight: 900,
    marginTop: 2,
  },
  subtitle: {
    color: "#6e8397",
    fontSize: 10,
    marginTop: 3,
  },
  headerMetrics: {
    display: "flex",
    gap: 7,
    flexWrap: "wrap",
  },
  metric: {
    display: "grid",
    gap: 2,
    minWidth: 90,
    background: "#0c1b27",
    border: "1px solid #1b3448",
    borderRadius: 8,
    padding: "6px 8px",
    color: "#70869a",
    fontSize: 8,
  },
  pressureBand: {
    marginTop: 14,
  },
  bandLabels: {
    display: "flex",
    justifyContent: "space-between",
    color: "#6a8095",
    fontSize: 9,
    marginBottom: 5,
  },
  bandTrack: {
    height: 12,
    borderRadius: 999,
    background: "#112535",
    position: "relative",
    overflow: "hidden",
  },
  bandCenter: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 2,
    background: "#dce8f1",
    opacity: 0.5,
  },
  bandFill: {
    position: "absolute",
    top: 1,
    bottom: 1,
    borderRadius: 999,
  },
  bandUp: {
    background: "linear-gradient(90deg,#17674c,#16c784)",
  },
  bandDown: {
    background: "linear-gradient(90deg,#ea3943,#7d1d25)",
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: 10,
    marginTop: 12,
  },
  analysisCard: {
    background: "#0a1721",
    border: "1px solid #172d3f",
    borderRadius: 10,
    padding: 11,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 850,
    marginBottom: 7,
  },
  readRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    borderTop: "1px solid #142a3b",
    padding: "7px 0",
    color: "#70869a",
    fontSize: 9,
  },
  note: {
    color: "#8195a8",
    fontSize: 9,
    lineHeight: 1.4,
    marginTop: 7,
  },
  executionCard: {
    borderRadius: 10,
    padding: 11,
    border: "1px solid #26394b",
  },
  executionPositive: {
    background: "rgba(22,199,132,.08)",
    borderColor: "rgba(22,199,132,.35)",
  },
  executionNegative: {
    background: "rgba(234,57,67,.08)",
    borderColor: "rgba(234,57,67,.35)",
  },
  executionNeutral: {
    background: "#0a1721",
    borderColor: "#172d3f",
  },
  executionImpact: {
    fontSize: 18,
    fontWeight: 950,
    marginTop: 4,
  },
  reasonList: {
    display: "grid",
    gap: 6,
    marginTop: 10,
  },
  reason: {
    display: "flex",
    gap: 7,
    color: "#b9c7d2",
    fontSize: 9,
    lineHeight: 1.35,
  },
  reasonDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#55d6ff",
    marginTop: 3,
    flex: "0 0 auto",
  },
  historyStrip: {
    marginTop: 12,
    borderTop: "1px solid #173047",
    paddingTop: 10,
  },
  sparkline: {
    height: 40,
    display: "flex",
    alignItems: "center",
    gap: 2,
    overflow: "hidden",
  },
  sparkBar: {
    width: 5,
    minWidth: 3,
    borderRadius: 2,
  },
};
