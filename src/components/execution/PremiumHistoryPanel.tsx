"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import type { ExecutionRead, PremiumPoint } from "../../lib/execution/types";

export function PremiumHistoryPanel({
  history,
  read,
}: {
  history: PremiumPoint[];
  read: ExecutionRead | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const hasInitialFitRef = useRef(false);

  const chartData = useMemo(() => {
    const bySecond = new Map<number, number>();

    for (const point of history) {
      const timestampMs = Date.parse(point.timestamp);
      if (!Number.isFinite(timestampMs) || !Number.isFinite(point.credit)) {
        continue;
      }

      // Lightweight Charts requires strictly increasing, unique timestamps.
      // Keep the newest premium value when multiple refreshes land in the same second.
      bySecond.set(Math.floor(timestampMs / 1000), point.credit);
    }

    return [...bySecond.entries()]
      .sort(([left], [right]) => left - right)
      .map(([time, value]) => ({
        time: time as UTCTimestamp,
        value,
      }));
  }, [history]);

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

    try {
      series.setData(chartData);

      if (!hasInitialFitRef.current && chartData.length) {
        chartRef.current?.timeScale().fitContent();
        hasInitialFitRef.current = true;
      }
    } catch (error) {
      console.error("Premium history chart update failed", error, chartData);
    }
  }, [chartData]);

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Iron Fly Premium</div>
          <div style={styles.subTitle}>Simulated live center-and-wing credit</div>
        </div>
        <div style={styles.metrics}>
          <Metric label="Current" value={fmt(read?.currentCredit)} />
          <Metric label="Peak" value={fmt(read?.peakCredit)} />
          <Metric
            label="Velocity"
            value={
              read
                ? `${read.premiumVelocityPerMinute >= 0 ? "+" : ""}${read.premiumVelocityPerMinute.toFixed(3)}/m`
                : "—"
            }
          />
          <Metric
            label="Off Peak"
            value={
              read?.creditOffPeakPct === null ||
              read?.creditOffPeakPct === undefined
                ? "—"
                : `${read.creditOffPeakPct.toFixed(1)}%`
            }
          />
        </div>
      </div>
      <div ref={hostRef} style={{ width: "100%", height: 210 }} />
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
};
