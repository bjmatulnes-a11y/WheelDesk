"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getZeroDteSessionClock,
  type ZeroDteCashSessionStatus,
} from "../lib/zeroDteSessionClock";

type PressurePoint = {
  timestamp: string;
  minuteKey: string;
  pressure: number;
};

type DealerDirection = "RISING" | "FALLING" | "FLAT";
type DealerMomentum = "STRONG" | "MODERATE" | "LIGHT" | "NONE";
type GammaRegime =
  | "STABILIZING"
  | "EXPANSIVE"
  | "TRANSITIONAL";

type DealerRead = {
  official: number;
  live: number;
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
  recommendationConfidence: number;
  structuralConfidence: number;
  mapState: "OPENING" | "TRANSITION" | "ACTIVE";
  sessionStatus: ZeroDteCashSessionStatus;
  openingPressure: number | null;
  controllingPressure: number | null;
};

const historyKey = (tradeDate: string) =>
  `wheeldesk:dealer-pressure:v2:${tradeDate}`;

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
  recommendationConfidence,
  structuralConfidence,
  mapState,
  sessionStatus,
  openingPressure,
  controllingPressure,
}: Props) {
  const [history, setHistory] = useState<PressurePoint[]>([]);
  const pendingMinuteRef = useRef<PressurePoint | null>(null);
  const clock = useMemo(
    () => getZeroDteSessionClock(generatedAt),
    [generatedAt],
  );

  useEffect(() => {
    pendingMinuteRef.current = null;
    setHistory(loadHistory(tradeDate));
  }, [tradeDate]);

  useEffect(() => {
    if (!Number.isFinite(pressure) || !Number.isFinite(Date.parse(generatedAt))) {
      return;
    }

    const point: PressurePoint = {
      timestamp: generatedAt,
      minuteKey: clock.minuteKey,
      pressure,
    };
    const pending = pendingMinuteRef.current;

    if (!pending) {
      if (clock.sessionStatus === "OPEN") pendingMinuteRef.current = point;
      return;
    }

    if (pending.minuteKey === point.minuteKey) {
      if (clock.sessionStatus === "OPEN") pendingMinuteRef.current = point;
      return;
    }

    // The prior minute is now complete. Persist only that completed minute;
    // five-second refreshes never become official pressure history points.
    setHistory((current) => {
      const next = appendPoint(current, pending);
      saveHistory(tradeDate, next);
      return next;
    });
    pendingMinuteRef.current =
      clock.sessionStatus === "OPEN" ? point : null;
  }, [clock.minuteKey, clock.sessionStatus, generatedAt, pressure, tradeDate]);

  const officialPoint = history.at(-1) ?? null;
  const officialPressure = officialPoint?.pressure ?? pressure;
  const read = useMemo(
    () =>
      buildDealerRead({
        history,
        officialPressure,
        livePressure: pressure,
        spot,
        support,
        resistance,
        center,
        pin,
        expectedMove,
        recommendationConfidence,
        structuralConfidence,
        sessionStatus,
      }),
    [
      center,
      expectedMove,
      history,
      pin,
      pressure,
      recommendationConfidence,
      resistance,
      sessionStatus,
      spot,
      structuralConfidence,
      support,
      officialPressure,
    ],
  );

  const pressurePct = Math.min(100, Math.abs(read.official));
  const pressureSide = read.official >= 0 ? "UP" : "DOWN";
  const officialThrough = officialPoint
    ? new Date(officialPoint.timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "building";

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Layer 4 · Closed-Minute Read</div>
          <div style={styles.title}>Dealer Analytics Engine</div>
          <div style={styles.subtitle}>
            Live pressure is displayed immediately; direction, velocity,
            acceleration and rollover become official only after a minute closes.
          </div>
        </div>

        <div style={styles.headerMetrics}>
          <Metric label="Live Pressure" value={signed(read.live)} />
          <Metric label="Official Pressure" value={signed(read.official)} />
          <Metric label="Direction" value={read.direction} />
          <Metric label="Regime" value={read.regime} />
          <Metric label="Stability" value={`${read.stability}%`} />
          <Metric
            label="State"
            value={sessionStatus === "CLOSED" ? "EOD FROZEN" : mapState}
          />
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
              ...(read.official >= 0 ? styles.bandUp : styles.bandDown),
              width: `${pressurePct / 2}%`,
              left: read.official >= 0 ? "50%" : `${50 - pressurePct / 2}%`,
            }}
          />
        </div>
      </div>

      <div style={styles.mainGrid}>
        <div style={styles.analysisCard}>
          <div style={styles.sectionTitle}>Pressure Behavior</div>
          <ReadRow
            label="Open"
            value={openingPressure == null ? "—" : signed(openingPressure)}
          />
          <ReadRow label="Live" value={signed(read.live)} />
          <ReadRow label="Official Close" value={signed(read.official)} />
          <ReadRow label="Official Through" value={officialThrough} />
          <ReadRow
            label="Change From Open"
            value={
              openingPressure == null
                ? "—"
                : signed(read.official - openingPressure)
            }
          />
          <ReadRow label="1m Change" value={signed(read.change)} />
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
          <ReadRow label="Controlling Center" value={center.toFixed(0)} />
          <ReadRow
            label="Layer 3 Confidence"
            value={`${Math.round(structuralConfidence)}%`}
          />
          <ReadRow
            label="Recommendation Confidence"
            value={`${Math.round(recommendationConfidence)}%`}
          />
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
            label="Controlling Map Pressure"
            value={
              controllingPressure == null ? "—" : signed(controllingPressure)
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
        <div style={styles.sectionTitle}>
          Completed-Minute Pressure History · official through {officialThrough}
        </div>
        <div style={styles.sparkline}>
          {history.slice(-40).map((point, index, points) => {
            const max = Math.max(
              ...points.map((item) => Math.abs(item.pressure)),
              1,
            );
            const height = Math.max(5, (Math.abs(point.pressure) / max) * 34);
            return (
              <div
                key={`${point.minuteKey}-${index}`}
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
  officialPressure: number;
  livePressure: number;
  spot: number;
  support: number | null;
  resistance: number | null;
  center: number;
  pin: number | null;
  expectedMove: number;
  recommendationConfidence: number;
  structuralConfidence: number;
  sessionStatus: ZeroDteCashSessionStatus;
}): DealerRead {
  const {
    history,
    officialPressure,
    livePressure,
    spot,
    support,
    resistance,
    center,
    pin,
    expectedMove,
    recommendationConfidence,
    structuralConfidence,
    sessionStatus,
  } = args;

  const latest = history.at(-1);
  const previous = history.at(-2);
  const prior = history.at(-3);

  const change = latest && previous ? latest.pressure - previous.pressure : 0;
  const elapsedMinutes = latest && previous
    ? Math.max(
        (Date.parse(latest.timestamp) - Date.parse(previous.timestamp)) / 60_000,
        1,
      )
    : 1;
  const velocityPerMinute = change / elapsedMinutes;
  const previousVelocity =
    previous && prior
      ? (previous.pressure - prior.pressure) /
        Math.max(
          (Date.parse(previous.timestamp) - Date.parse(prior.timestamp)) /
            60_000,
          1,
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
    Math.abs(officialPressure) <= 18
      ? "STABILIZING"
      : Math.abs(officialPressure) >= 45
        ? "EXPANSIVE"
        : "TRANSITIONAL";

  const volatilityPenalty = Math.min(45, absoluteVelocity * 2.4);
  const magnitudePenalty = Math.min(30, Math.abs(officialPressure) * 0.35);
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
  const rolloverText =
    sessionStatus === "CLOSED"
      ? "End-of-day read is frozen; no new pressure rollover can be confirmed after the cash close."
      : rollover
        ? `Pressure velocity reversed from ${signed(previousVelocity)}/min to ${signed(velocityPerMinute)}/min.`
        : history.length < 3
          ? "Building completed-minute history to detect a pressure rollover."
          : `No material closed-minute velocity reversal. Pressure is ${direction.toLowerCase()}.`;

  const supportDistance = support == null ? null : Math.max(0, spot - support);
  const resistanceDistance =
    resistance == null ? null : Math.max(0, resistance - spot);
  const nearCenter =
    Math.abs(spot - center) <= Math.max(expectedMove * 0.35, 5);
  const nearPin =
    pin != null && Math.abs(spot - pin) <= Math.max(expectedMove * 0.3, 5);
  const pressureStable = stability >= 62;
  const pressureExtreme = Math.abs(officialPressure) >= 55;
  const rollingTowardNeutral =
    (officialPressure < 0 && velocityPerMinute > 0.8) ||
    (officialPressure > 0 && velocityPerMinute < -0.8);

  let executionImpact: DealerRead["executionImpact"] = "NEUTRAL";
  if (sessionStatus !== "CLOSED") {
    if (
      pressureStable &&
      (rollingTowardNeutral || Math.abs(officialPressure) <= 25) &&
      (nearCenter || nearPin)
    ) {
      executionImpact = "SUPPORTS HARVEST";
    } else if (pressureExtreme && !rollingTowardNeutral) {
      executionImpact = "BLOCKS HARVEST";
    }
  }

  const executionReasons = sessionStatus === "CLOSED"
    ? [
        "The SPX cash session is closed; this is an end-of-day diagnostic, not an entry signal.",
        `Official pressure is ${signed(officialPressure)} through the last completed minute.`,
        `Layer 3 structural confidence closed at ${Math.round(structuralConfidence)}%.`,
        `General recommendation confidence closed at ${Math.round(recommendationConfidence)}%.`,
      ]
    : [
        pressureStable
          ? `Dealer stability is ${stability}%, supporting controlled premium behavior.`
          : `Dealer stability is only ${stability}%, increasing directional risk.`,
        rollingTowardNeutral
          ? "Closed-minute pressure is rolling toward neutral."
          : `Closed-minute pressure is ${direction.toLowerCase()} with ${momentum.toLowerCase()} momentum.`,
        nearCenter
          ? "SPX remains near the controlling center."
          : `${Math.abs(spot - center).toFixed(1)} points from the controlling center.`,
        nearPin
          ? "Price remains within the active pin zone."
          : "Pin attraction is not currently dominant.",
        `Layer 3 structural confidence is ${Math.round(structuralConfidence)}%; general recommendation confidence is ${Math.round(recommendationConfidence)}%.`,
      ];

  return {
    official: officialPressure,
    live: livePressure,
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

function appendPoint(history: PressurePoint[], point: PressurePoint): PressurePoint[] {
  if (!Number.isFinite(point.pressure) || !Date.parse(point.timestamp)) {
    return history;
  }
  const existingIndex = history.findIndex(
    (item) => item.minuteKey === point.minuteKey,
  );
  const next = [...history];
  if (existingIndex >= 0) next[existingIndex] = point;
  else next.push(point);
  return next
    .sort((left, right) => Number(left.minuteKey) - Number(right.minuteKey))
    .slice(-390);
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
      JSON.stringify(history.slice(-390)),
    );
  } catch {
    // Analytics still operate in memory.
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
    maxWidth: 640,
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
  pressureBand: { marginTop: 14 },
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
  bandUp: { background: "linear-gradient(90deg,#17674c,#16c784)" },
  bandDown: { background: "linear-gradient(90deg,#ea3943,#7d1d25)" },
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
  sectionTitle: { fontSize: 11, fontWeight: 850, marginBottom: 7 },
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
  executionNeutral: { background: "#0a1721", borderColor: "#172d3f" },
  executionImpact: { fontSize: 18, fontWeight: 950, marginTop: 4 },
  reasonList: { display: "grid", gap: 6, marginTop: 10 },
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
  sparkBar: { width: 5, minWidth: 3, borderRadius: 2 },
};
