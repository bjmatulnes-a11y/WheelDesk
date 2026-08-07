"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExecutionPremiumSample,
  ExecutionPremiumTapePoint,
  ZeroDteExecutionRead,
} from "../../lib/zeroDteExecutionIntelligence";
import { buildCompletedPremiumMinuteBars } from "../../lib/zeroDtePremiumCrestEngine";

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
  const officialSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [selectedSetupKey, setSelectedSetupKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"AUTO" | "MANUAL">("AUTO");

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

    setSelectedSetupKey((current) => {
      // A user-selected setup is sticky. Market refreshes, scanner reranking,
      // and preferredSetupKey changes must never steal the Premium History view.
      if (selectionMode === "MANUAL" && current) {
        return current;
      }

      if (preferred && setupOptions.some((item) => item.setupKey === preferred)) {
        return preferred;
      }

      if (current && setupOptions.some((item) => item.setupKey === current)) {
        return current;
      }

      return setupOptions[0]?.setupKey ?? null;
    });
  }, [preferredSetupKey, read?.setupKey, selectionMode, setupOptions]);

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

  const officialBars = useMemo(() => {
    if (!selectedSamples.length) return [];
    const lastTimestamp = selectedSamples.at(-1)?.timestamp ?? null;
    const generatedAt =
      selectedRead?.generatedAt ??
      (lastTimestamp
        ? new Date(Date.parse(lastTimestamp) + 60_000).toISOString()
        : new Date().toISOString());
    return buildCompletedPremiumMinuteBars(selectedSamples, generatedAt);
  }, [selectedRead?.generatedAt, selectedSamples]);

  const officialData = useMemo(
    () =>
      officialBars.map((bar) => ({
        time: Math.floor(bar.minuteKey / 1000) as UTCTimestamp,
        value: bar.median,
      })),
    [officialBars],
  );

  const metrics = useMemo(() => {
    const rawCurrent = selectedRead?.currentCredit ?? chartData.at(-1)?.value ?? null;
    const officialCurrent =
      selectedRead?.premiumCrest.officialCredit ?? officialData.at(-1)?.value ?? null;
    const localPeak =
      selectedRead?.premiumCrest.localPeakCredit ??
      (officialData.length ? Math.max(...officialData.map((point) => point.value)) : null);
    const noise = selectedRead?.premiumCrest.quoteNoisePoints ?? null;
    const slope3m = selectedRead?.premiumCrest.threeMinuteSlope ?? null;
    const state = selectedRead?.premiumCrest.status.replaceAll("_", " ") ?? "BUILDING";
    return { rawCurrent, officialCurrent, localPeak, noise, slope3m, state };
  }, [chartData, officialData, selectedRead]);

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
      localization: {
        locale: "en-US",
        timeFormatter: formatCentralPremiumTime,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#203448",
        tickMarkFormatter: (time: Time) => formatCentralPremiumTime(time),
      },
      rightPriceScale: {
        borderColor: "#203448",
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#18b6ed",
      topColor: "rgba(24,182,237,.22)",
      bottomColor: "rgba(24,182,237,.01)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const officialSeries = chart.addSeries(LineSeries, {
      color: "#fbbf24",
      lineWidth: 3,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    officialSeriesRef.current = officialSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      officialSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const officialSeries = officialSeriesRef.current;
    if (!series || !officialSeries) return;

    series.setData(chartData);
    officialSeries.setData(officialData);
    if (chartData.length || officialData.length) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [chartData, officialData, selectedSetupKey]);

  const preferred = preferredSetupKey ?? read?.setupKey ?? null;
  const preferredOption = setupOptions.find((item) => item.setupKey === preferred);
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
            Cyan is the raw exact-leg tape. Amber is the completed one-minute median used by the signal engine. Selecting a setup creates a MANUAL LOCK; scanner reranking will not change this chart until you choose another setup or click Follow Preferred.
          </div>
        </div>
        <div style={styles.controls}>
          <label style={styles.setupLabel}>
            Tracked setup
            <select
              value={selectedSetupKey ?? ""}
              onChange={(event) => {
                const next = event.target.value || null;
                setSelectedSetupKey(next);
                if (next) {
                  setSelectionMode("MANUAL");
                }
              }}
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
          <div style={styles.modeControl}>
            <span
              style={{
                ...styles.modeBadge,
                ...(selectionMode === "MANUAL"
                  ? styles.modeBadgeManual
                  : styles.modeBadgeAuto),
              }}
            >
              {selectionMode === "MANUAL" ? "MANUAL LOCK" : "AUTO"}
            </span>
            <button
              type="button"
              style={styles.autoButton}
              disabled={selectionMode === "AUTO"}
              onClick={() => {
                setSelectionMode("AUTO");
                if (
                  preferred &&
                  setupOptions.some((item) => item.setupKey === preferred)
                ) {
                  setSelectedSetupKey(preferred);
                } else {
                  setSelectedSetupKey(setupOptions[0]?.setupKey ?? null);
                }
              }}
              title={
                preferredOption
                  ? `Follow WheelDesk preferred setup: ${preferredOption.label}`
                  : "Follow WheelDesk preferred tracked setup"
              }
            >
              Follow Preferred
            </button>
          </div>
          <div style={styles.metrics}>
            <Metric label="Raw" value={fmt(metrics.rawCurrent)} />
            <Metric label="Official 1m" value={fmt(metrics.officialCurrent)} />
            <Metric label="Local Crest" value={fmt(metrics.localPeak)} />
            <Metric label="Noise" value={fmt(metrics.noise)} />
            <Metric
              label="3m Slope"
              value={
                metrics.slope3m == null
                  ? "—"
                  : `${metrics.slope3m >= 0 ? "+" : ""}${metrics.slope3m.toFixed(3)}/m`
              }
            />
            <Metric label="Crest State" value={metrics.state} />
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

const CENTRAL_PREMIUM_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

function formatCentralPremiumTime(time: Time) {
  const date = premiumTimeToDate(time);
  return date ? CENTRAL_PREMIUM_TIME_FORMATTER.format(date) : "";
}

function premiumTimeToDate(time: Time) {
  if (typeof time === "number") {
    return new Date(Number(time) * 1000);
  }

  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  if (
    time &&
    typeof time === "object" &&
    "year" in time &&
    "month" in time &&
    "day" in time
  ) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day, 12, 0, 0));
  }

  return null;
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
  modeControl: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  modeBadge: {
    borderRadius: 999,
    padding: "5px 8px",
    fontSize: 9,
    fontWeight: 850,
    letterSpacing: ".04em",
    border: "1px solid",
  },
  modeBadgeAuto: {
    color: "#67e8f9",
    background: "rgba(6,182,212,.08)",
    borderColor: "rgba(34,211,238,.32)",
  },
  modeBadgeManual: {
    color: "#fbbf24",
    background: "rgba(251,191,36,.08)",
    borderColor: "rgba(251,191,36,.34)",
  },
  autoButton: {
    background: "#0c1a25",
    color: "#c7d8e6",
    border: "1px solid #29465d",
    borderRadius: 8,
    padding: "7px 9px",
    fontSize: 9,
    fontWeight: 750,
    cursor: "pointer",
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
