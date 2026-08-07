"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExecutionPremiumSample,
  ExecutionPremiumTapePoint,
  ZeroDteExecutionRead,
} from "../../lib/zeroDteExecutionIntelligence";

export function PremiumHistoryPanel({
  history,
  liveTape = [],
  read,
  availableReads = [],
  preferredSetupKey = null,
}: {
  history: ExecutionPremiumSample[];
  liveTape?: ExecutionPremiumTapePoint[];
  read: ZeroDteExecutionRead | null;
  availableReads?: ZeroDteExecutionRead[];
  preferredSetupKey?: string | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [selectedSetupKey, setSelectedSetupKey] = useState<string | null>(null);

  const setupOptions = useMemo(() => {
    const options = new Map<
      string,
      { setupKey: string; label: string; lastTimestamp: number }
    >();

    for (const item of availableReads) {
      if (!item.setupKey) continue;
      options.set(item.setupKey, {
        setupKey: item.setupKey,
        label: setupLabel(item.strategyLabel, item.setupKey),
        lastTimestamp: Date.parse(item.generatedAt) || 0,
      });
    }

    for (const sample of history) {
      const timestamp = Date.parse(sample.timestamp) || 0;
      const existing = options.get(sample.setupKey);
      if (!existing || timestamp > existing.lastTimestamp) {
        options.set(sample.setupKey, {
          setupKey: sample.setupKey,
          label: setupLabel(null, sample.setupKey),
          lastTimestamp: timestamp,
        });
      }
    }

    for (const point of liveTape) {
      const timestamp = Date.parse(point.timestamp) || 0;
      const existing = options.get(point.setupKey);
      if (!existing || timestamp > existing.lastTimestamp) {
        options.set(point.setupKey, {
          setupKey: point.setupKey,
          label: setupLabel(null, point.setupKey),
          lastTimestamp: timestamp,
        });
      }
    }

    const preferred = preferredSetupKey ?? read?.setupKey ?? null;
    return [...options.values()].sort((left, right) => {
      if (left.setupKey === preferred) return -1;
      if (right.setupKey === preferred) return 1;
      return right.lastTimestamp - left.lastTimestamp;
    });
  }, [availableReads, history, liveTape, preferredSetupKey, read?.setupKey]);

  useEffect(() => {
    const preferred = preferredSetupKey ?? read?.setupKey ?? null;
    if (preferred && setupOptions.some((item) => item.setupKey === preferred)) {
      setSelectedSetupKey(preferred);
      return;
    }
    setSelectedSetupKey((current) => {
      if (current && setupOptions.some((item) => item.setupKey === current)) {
        return current;
      }
      return setupOptions[0]?.setupKey ?? null;
    });
  }, [preferredSetupKey, read?.setupKey, setupOptions]);

  const selectedRead = useMemo(
    () =>
      availableReads.find((item) => item.setupKey === selectedSetupKey) ??
      (read?.setupKey === selectedSetupKey ? read : null),
    [availableReads, read, selectedSetupKey],
  );

  const selectedSamples = useMemo(() => {
    if (!selectedSetupKey) return [];
    const windowStart =
      selectedRead?.setupKey === selectedSetupKey
        ? selectedRead.premiumTapeStartedAt
        : null;
    const windowStartMs = windowStart ? Date.parse(windowStart) : null;
    const inWindow = (timestamp: string) =>
      windowStartMs === null || !Number.isFinite(windowStartMs)
        ? true
        : Date.parse(timestamp) >= windowStartMs;

    const byTimestamp = new Map<string, { timestamp: string; credit: number }>();
    for (const sample of history) {
      if (
        sample.setupKey !== selectedSetupKey ||
        !Number.isFinite(sample.credit) ||
        !inWindow(sample.timestamp)
      ) {
        continue;
      }
      byTimestamp.set(sample.timestamp, { timestamp: sample.timestamp, credit: sample.credit });
    }
    for (const point of liveTape) {
      if (
        point.setupKey !== selectedSetupKey ||
        !Number.isFinite(point.credit) ||
        !inWindow(point.timestamp)
      ) {
        continue;
      }
      byTimestamp.set(point.timestamp, { timestamp: point.timestamp, credit: point.credit });
    }
    return [...byTimestamp.values()].sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
    );
  }, [history, liveTape, selectedRead, selectedSetupKey]);

  const chartData = useMemo(() => {
    const bySecond = new Map<number, number>();
    for (const point of selectedSamples) {
      const timestampMs = Date.parse(point.timestamp);
      if (!Number.isFinite(timestampMs) || !Number.isFinite(point.credit)) continue;
      bySecond.set(Math.floor(timestampMs / 1000), point.credit);
    }

    if (
      selectedRead?.currentCredit !== null &&
      selectedRead?.currentCredit !== undefined &&
      Number.isFinite(selectedRead.currentCredit)
    ) {
      const timestampMs = Date.parse(selectedRead.generatedAt);
      if (Number.isFinite(timestampMs)) {
        bySecond.set(
          Math.floor(timestampMs / 1000),
          selectedRead.currentCredit,
        );
      }
    }

    return [...bySecond.entries()]
      .sort(([left], [right]) => left - right)
      .map(([time, value]) => ({
        time: time as UTCTimestamp,
        value,
      }));
  }, [selectedRead, selectedSamples]);

  const metrics = useMemo(() => {
    const values = chartData.map((point) => point.value);
    const current =
      selectedRead?.currentCredit ?? values.at(-1) ?? null;
    const peak = values.length ? Math.max(...values) : null;
    const previous = chartData.at(-2) ?? null;
    const latest = chartData.at(-1) ?? null;
    const elapsedMinutes =
      previous && latest
        ? Math.max((Number(latest.time) - Number(previous.time)) / 60, 1 / 60)
        : null;
    const calculatedVelocity =
      previous && latest && elapsedMinutes
        ? (latest.value - previous.value) / elapsedMinutes
        : null;
    const velocity =
      selectedRead?.premiumVelocityPerMinute ?? calculatedVelocity;
    const fromPeak =
      current !== null && peak !== null && peak > 0
        ? ((current - peak) / peak) * 100
        : null;
    return { current, peak, velocity, fromPeak };
  }, [chartData, selectedRead]);

  useEffect(() => {
    if (!hostRef.current) return;

    const chart = createChart(hostRef.current, {
      autoSize: true,
      height: 210,
      layout: {
        background: { type: ColorType.Solid, color: "#08131d" },
        textColor: "#8296a9",
      },
      grid: {
        vertLines: { color: "rgba(90,120,145,.09)" },
        horzLines: { color: "rgba(90,120,145,.09)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#203448",
      },
      rightPriceScale: {
        borderColor: "#203448",
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#18b6ed",
      topColor: "rgba(24,182,237,.32)",
      bottomColor: "rgba(24,182,237,.02)",
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    series.setData(chartData);
    if (chartData.length) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [chartData, selectedSetupKey]);

  const selectedOption = setupOptions.find(
    (item) => item.setupKey === selectedSetupKey,
  );

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>
            {selectedOption?.label ?? "Exact-Setup Premium"}
          </div>
          <div style={styles.subTitle}>
            Exact-leg live tape first; Supabase fills historical gaps. Strategy samples are never mixed.
          </div>
        </div>
        <div style={styles.controls}>
          <label style={styles.setupLabel}>
            Tracked setup
            <select
              value={selectedSetupKey ?? ""}
              onChange={(event) =>
                setSelectedSetupKey(event.target.value || null)
              }
              style={styles.select}
            >
              {!setupOptions.length ? (
                <option value="">No tracked setup</option>
              ) : null}
              {setupOptions.map((option) => (
                <option key={option.setupKey} value={option.setupKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div style={styles.metrics}>
            <Metric label="Current" value={fmt(metrics.current)} />
            <Metric label="Peak" value={fmt(metrics.peak)} />
            <Metric
              label="Velocity"
              value={
                metrics.velocity == null
                  ? "—"
                  : `${metrics.velocity >= 0 ? "+" : ""}${metrics.velocity.toFixed(3)}/m`
              }
            />
            <Metric
              label="From Peak"
              value={
                metrics.fromPeak == null
                  ? "—"
                  : `${metrics.fromPeak.toFixed(1)}%`
              }
            />
          </div>
        </div>
      </div>
      <div style={styles.chartWrap}>
        <div ref={hostRef} style={{ width: "100%", height: 210 }} />
        {!selectedSetupKey ? (
          <div style={styles.emptyState}>
            No tracked strategy is selected. The chart will remain blank rather
            than combining Iron Fly, put-spread, and call-spread premiums.
          </div>
        ) : !chartData.length ? (
          <div style={styles.emptyState}>
            This exact strike set does not have a live or persisted premium sample yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function setupLabel(label: string | null, setupKey: string) {
  const legs = setupKey
    .split(":")[1]
    ?.split("-")
    .map((leg) => leg.match(/^([sb])([pc])(\d+(?:\.\d+)?)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const action = match[1] === "s" ? "S" : "B";
      const type = match[2] === "p" ? "P" : "C";
      return `${action}${Number(match[3]).toFixed(0)}${type}`;
    })
    .join(" · ");
  const strategy = setupKey.startsWith("put-credit-spread")
    ? "PUT"
    : setupKey.startsWith("call-credit-spread")
      ? "CALL"
      : "IF";
  return `${label ?? strategy}${legs ? ` · ${legs}` : ""}`;
}

function fmt(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#08131d",
    border: "1px solid #1d3447",
    borderRadius: 14,
    padding: 14,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 13,
    fontWeight: 850,
  },
  subTitle: {
    color: "#6f8295",
    fontSize: 10,
    marginTop: 3,
  },
  controls: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
  },
  setupLabel: {
    display: "grid",
    gap: 3,
    color: "#6f8397",
    fontSize: 9,
  },
  select: {
    minWidth: 230,
    background: "#0c1a25",
    color: "#d9e7f2",
    border: "1px solid #29465d",
    borderRadius: 8,
    padding: "7px 9px",
  },
  metrics: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  metric: {
    display: "grid",
    gap: 2,
    minWidth: 70,
    padding: "6px 8px",
    background: "#0c1a25",
    border: "1px solid #1b3144",
    borderRadius: 8,
    fontSize: 9,
    color: "#6f8397",
  },
  chartWrap: {
    position: "relative",
  },
  emptyState: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 24,
    textAlign: "center",
    color: "#7890a4",
    fontSize: 12,
    pointerEvents: "none",
  },
};
