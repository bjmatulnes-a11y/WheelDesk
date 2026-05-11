"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  Candle,
  ExpirationSummary,
  OverlayFlags,
  SupportedTicker,
  Timeframe,
} from "../lib/types";
import { SnapshotStructurePoint } from "../lib/chart-overlay";
import { PrevailingLevels } from "../lib/oi-prevailing-levels";
import { OIZonesOverlay } from "./OIZonesOverlay";
import { OIStructureDriftOverlay } from "./OIStructureDriftOverlay";
import { safeFixed } from "../lib/format";

type Props = {
  candles: Candle[];
  summary: ExpirationSummary;
  overlays: OverlayFlags;
  ticker: SupportedTicker;
  timeframe: Timeframe;
  selectedSnapshotDate: string;
  snapshotSeries: SnapshotStructurePoint[];
  showSavedOiHistory: boolean;
  fallbackOverlayDates: string[];
  overlayStatus: string;
  hasExactSnapshot: boolean;
  structureDrift?: any;
  prevailingLevels?: PrevailingLevels | null;
};

type HistoricalSegment = {
  id: string;
  x1: number;
  x2: number;
  y: number;
  color: string;
  strokeWidth: number;
  opacity: number;
};

type StructureLine = {
  id: string;
  value: number;
  color: string;
  label: string;
};

const METRIC_STYLES = {
  center: { color: "#7c3aed", label: "OI Center" },
  lower: { color: "#0f766e", label: "OI Lower" },
  upper: { color: "#0f766e", label: "OI Upper" },
  callWall: { color: "#dc2626", label: "Call Wall" },
  putWall: { color: "#2563eb", label: "Put Wall" },
} as const;

function isIntraday(timeframe: Timeframe): boolean {
  return !["daily", "weekly"].includes(timeframe);
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canDrawSvg(...values: unknown[]): boolean {
  return values.every(isFiniteNumber);
}

function dateKey(iso: string): string {
  return String(iso ?? "").slice(0, 10);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "N/A";

  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "N/A";

  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "p" : "a";
  h = h % 12 || 12;

  return `${h}:${String(m).padStart(2, "0")}${suffix}`;
}

function formatXAxisLabel(iso: string, timeframe: Timeframe, isFirstOfDay: boolean): string {
  if (timeframe === "weekly" || timeframe === "daily") return formatDateLabel(iso);
  if (isFirstOfDay) return formatDateLabel(iso);

  return formatTimeLabel(iso);
}

function safeSummaryValue(
  summary: ExpirationSummary | null | undefined,
  key: keyof ExpirationSummary
): number | null {
  return finiteNumber(summary?.[key]);
}

function SafeLine({
  x1,
  y1,
  x2,
  y2,
  ...props
}: {
  x1: unknown;
  y1: unknown;
  x2: unknown;
  y2: unknown;
} & Omit<SVGProps<SVGLineElement>, "x1" | "y1" | "x2" | "y2">) {
  const nx1 = finiteNumber(x1);
  const ny1 = finiteNumber(y1);
  const nx2 = finiteNumber(x2);
  const ny2 = finiteNumber(y2);

  if (nx1 === null || ny1 === null || nx2 === null || ny2 === null) {
    return null;
  }

  return <line {...props} x1={nx1} y1={ny1} x2={nx2} y2={ny2} />;
}

function SafeRect({
  x,
  y,
  width,
  height,
  ...props
}: {
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
} & Omit<SVGProps<SVGRectElement>, "x" | "y" | "width" | "height">) {
  const nx = finiteNumber(x);
  const ny = finiteNumber(y);
  const nw = finiteNumber(width);
  const nh = finiteNumber(height);

  if (nx === null || ny === null || nw === null || nh === null) {
    return null;
  }

  if (nw < 0 || nh < 0) {
    return null;
  }

  return <rect {...props} x={nx} y={ny} width={nw} height={nh} />;
}


function SafeText({
  x,
  y,
  children,
  ...props
}: {
  x: unknown;
  y: unknown;
  children?: ReactNode;
} & Omit<SVGProps<SVGTextElement>, "x" | "y">) {
  const nx = finiteNumber(x);
  const ny = finiteNumber(y);

  if (nx === null || ny === null) {
    return null;
  }

  return (
    <text {...props} x={nx} y={ny}>
      {children}
    </text>
  );
}

export function ChartPanel({
  candles,
  summary,
  overlays,
  ticker,
  timeframe,
  selectedSnapshotDate,
  snapshotSeries,
  showSavedOiHistory,
  fallbackOverlayDates,
  overlayStatus,
  hasExactSnapshot,
  prevailingLevels,
  structureDrift,
}: Props) {
  const width = 940;
  const height = 360;
  const padding = 48;
  const rightAxisGutter = 68;
  const paddingLeft = 130;
  const paddingRight = 60;
  const plotLeft = paddingLeft;
  const plotRight = width - paddingRight - rightAxisGutter;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [yZoom, setYZoom] = useState(1);
  const [yOffset, setYOffset] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const intraday = isIntraday(timeframe);

  const safeCandles = useMemo(() => {
    return (candles ?? []).filter((c) => {
      return (
        c &&
        finiteNumber(c.open) !== null &&
        finiteNumber(c.high) !== null &&
        finiteNumber(c.low) !== null &&
        finiteNumber(c.close) !== null &&
        typeof c.time === "string"
      );
    });
  }, [candles]);

  const windowed = useMemo(() => {
    const count = safeCandles.length;
    const keep = Math.max(20, Math.round(count / Math.max(zoomLevel, 1)));
    const target = focusIndex ?? count - 1;
    const start = Math.max(0, Math.min(count - keep, target - Math.floor(keep / 2)));

    return safeCandles.slice(start, start + keep);
  }, [safeCandles, zoomLevel, focusIndex]);

  const closes = useMemo(() => {
    return windowed
      .map((c) => finiteNumber(c.close))
      .filter((value): value is number => value !== null);
  }, [windowed]);

  const summaryCenter = safeSummaryValue(summary, "combinedCenter") ?? 0;
  const currentPrice = closes.at(-1) ?? summaryCenter;

  const overlayScaleValues = useMemo(() => {
    const values: number[] = [];

    const pushValue = (value: unknown) => {
      const n = finiteNumber(value);
      if (n !== null) values.push(n);
    };

    snapshotSeries?.forEach((point) => {
      const pointSummary = point?.summary;

      if (overlays.showOiCenter) pushValue(pointSummary?.combinedCenter);
      if (overlays.showOiRange) {
        pushValue(pointSummary?.lowerRange);
        pushValue(pointSummary?.upperRange);
      }
      if (overlays.showWalls) {
        pushValue(pointSummary?.callWall);
        pushValue(pointSummary?.putWall);
      }
    });

    if (overlays.showOiCenter) pushValue(summary?.combinedCenter);
    if (overlays.showOiRange) {
      pushValue(summary?.lowerRange);
      pushValue(summary?.upperRange);
    }
    if (overlays.showWalls) {
      pushValue(summary?.callWall);
      pushValue(summary?.putWall);
    }

    return values;
  }, [snapshotSeries, overlays, summary]);

  const candleLow = useMemo(() => {
    if (!windowed.length) return Number.POSITIVE_INFINITY;

    return windowed.reduce((min, candle) => {
      const low = finiteNumber(candle.low);
      return low === null ? min : Math.min(min, low);
    }, Number.POSITIVE_INFINITY);
  }, [windowed]);

  const candleHigh = useMemo(() => {
    if (!windowed.length) return Number.NEGATIVE_INFINITY;

    return windowed.reduce((max, candle) => {
      const high = finiteNumber(candle.high);
      return high === null ? max : Math.max(max, high);
    }, Number.NEGATIVE_INFINITY);
  }, [windowed]);

  const rawMin = Math.min(candleLow, ...overlayScaleValues);
  const rawMax = Math.max(candleHigh, ...overlayScaleValues);

  const fallbackMin = currentPrice > 0 ? currentPrice * 0.98 : -1;
  const fallbackMax = currentPrice > 0 ? currentPrice * 1.02 : 1;

  const safeMin = Number.isFinite(rawMin) ? rawMin : fallbackMin;
  const safeMax = Number.isFinite(rawMax) ? rawMax : fallbackMax;

  const paddedSpan = Math.max(0.5, safeMax - safeMin);
  const defaultMin = safeMin - paddedSpan * 0.08;
  const defaultMax = safeMax + paddedSpan * 0.08;

  const defaultRange = Math.max(0.01, defaultMax - defaultMin);
  const safeYZoom = Math.max(0.5, finiteNumber(yZoom) ?? 1);
  const scaledRange = defaultRange / safeYZoom;
  const mid = (defaultMax + defaultMin) / 2 + yOffset * scaledRange;

  const minPrice = mid - scaledRange / 2;
  const maxPrice = mid + scaledRange / 2;

  const toY = useCallback(
    (price: number) => {
      const n = finiteNumber(price);
      if (n === null) return Number.NaN;

      const range = maxPrice - minPrice;
      if (!Number.isFinite(range) || range === 0) return Number.NaN;

      return padding + ((maxPrice - n) / range) * (height - padding * 2);
    },
    [maxPrice, minPrice, height, padding]
  );

  const candleWidth = (plotRight - plotLeft) / Math.max(1, windowed.length);
  const candleBodyWidth = Math.max(2, Math.min(12, candleWidth * 0.62));

  const selectedStructureLines = useMemo(() => {
    const lines: StructureLine[] = [];

    const pushLine = (id: string, value: unknown, color: string, label: string) => {
      const n = finiteNumber(value);
      if (n === null) return;

      lines.push({ id, value: n, color, label });
    };

    if (overlays.showOiCenter) {
      pushLine(
        "selected-center",
        summary?.combinedCenter,
        METRIC_STYLES.center.color,
        METRIC_STYLES.center.label
      );
    }

    if (overlays.showOiRange) {
      pushLine(
        "selected-lower",
        summary?.lowerRange,
        METRIC_STYLES.lower.color,
        METRIC_STYLES.lower.label
      );
      pushLine(
        "selected-upper",
        summary?.upperRange,
        METRIC_STYLES.upper.color,
        METRIC_STYLES.upper.label
      );
    }

    if (overlays.showWalls) {
      pushLine(
        "selected-call-wall",
        summary?.callWall,
        METRIC_STYLES.callWall.color,
        METRIC_STYLES.callWall.label
      );
      pushLine(
        "selected-put-wall",
        summary?.putWall,
        METRIC_STYLES.putWall.color,
        METRIC_STYLES.putWall.label
      );
    }

    return lines;
  }, [summary, overlays]);

  const dayRanges = useMemo(() => {
    const ranges = new Map<string, { first: number; last: number }>();

    windowed.forEach((c, idx) => {
      const key = dateKey(c.time);
      if (!key) return;

      const existing = ranges.get(key);

      if (!existing) {
        ranges.set(key, { first: idx, last: idx });
      } else {
        existing.last = idx;
      }
    });

    return ranges;
  }, [windowed]);

  const firstIndexesOfDay = useMemo(() => {
    return new Set([...dayRanges.values()].map((range) => range.first));
  }, [dayRanges]);

  const historicalSegments = useMemo(() => {
    if (!showSavedOiHistory) return [];

    const segments: HistoricalSegment[] = [];

    const pushSegment = (
      point: SnapshotStructurePoint,
      role: string,
      idSuffix: string,
      value: unknown,
      x1: number,
      x2: number,
      color: string,
      strokeWidth: number,
      opacity: number
    ) => {
      const n = finiteNumber(value);
      if (n === null) return;

      const y = toY(n);
      if (!canDrawSvg(x1, y, x2, y)) return;

      segments.push({
        id: `${point.snapshotDate}-${role}-${idSuffix}`,
        x1,
        x2,
        y,
        color,
        strokeWidth,
        opacity,
      });
    };

    snapshotSeries?.forEach((point) => {
      const dayRange = dayRanges.get(point.snapshotDate);
      if (!dayRange) return;

      let x1: number;
      let x2: number;

      if (intraday) {
        x1 = plotLeft + dayRange.first * candleWidth + candleWidth * 0.1;
        x2 = plotLeft + dayRange.last * candleWidth + candleWidth * 0.9;
      } else {
        const anchorIdx = dayRange.first;
        x1 = plotLeft + anchorIdx * candleWidth + candleWidth * 0.15;
        x2 = plotLeft + anchorIdx * candleWidth + candleWidth * 0.85;
      }

      if (!Number.isFinite(x1) || !Number.isFinite(x2)) return;

      const isSelected = point.snapshotDate === selectedSnapshotDate;
      const strokeWidth = isSelected ? 3 : 2;
      const opacity = isSelected ? 0.95 : 0.6;
      const pointSummary = point.summary;

      if (overlays.showOiCenter) {
        pushSegment(
          point,
          point.role,
          "center",
          pointSummary?.combinedCenter,
          x1,
          x2,
          METRIC_STYLES.center.color,
          strokeWidth,
          opacity
        );
      }

      if (overlays.showOiRange) {
        pushSegment(
          point,
          point.role,
          "lower",
          pointSummary?.lowerRange,
          x1,
          x2,
          METRIC_STYLES.lower.color,
          strokeWidth,
          opacity
        );

        pushSegment(
          point,
          point.role,
          "upper",
          pointSummary?.upperRange,
          x1,
          x2,
          METRIC_STYLES.upper.color,
          strokeWidth,
          opacity
        );
      }

      if (overlays.showWalls) {
        pushSegment(
          point,
          point.role,
          "call-wall",
          pointSummary?.callWall,
          x1,
          x2,
          METRIC_STYLES.callWall.color,
          strokeWidth,
          opacity
        );

        pushSegment(
          point,
          point.role,
          "put-wall",
          pointSummary?.putWall,
          x1,
          x2,
          METRIC_STYLES.putWall.color,
          strokeWidth,
          opacity
        );
      }
    });

    return segments;
  }, [
    showSavedOiHistory,
    snapshotSeries,
    dayRanges,
    intraday,
    selectedSnapshotDate,
    overlays,
    plotLeft,
    candleWidth,
    toY,
  ]);

  const rightAxisLabels = useMemo(() => {
    const labels = selectedStructureLines
      .map((series) => ({
        ...series,
        y: toY(series.value),
      }))
      .filter((label) => Number.isFinite(label.y))
      .sort((a, b) => a.y - b.y);

    const minSpacing = 12;

    for (let i = 1; i < labels.length; i += 1) {
      if (labels[i].y - labels[i - 1].y < minSpacing) {
        labels[i].y = labels[i - 1].y + minSpacing;
      }
    }

    return labels;
  }, [selectedStructureLines, toY]);

  const yTicks = useMemo(() => {
    const steps = 6;

    return Array.from({ length: steps + 1 }).map((_, i) => {
      const ratio = i / steps;
      const value = maxPrice - (maxPrice - minPrice) * ratio;

      return {
        id: `y-${i}`,
        value,
        y: toY(value),
      };
    });
  }, [maxPrice, minPrice, toY]);

  const xTickIndexes = useMemo(() => {
    if (!windowed.length) return [];

    if (intraday) {
      const indexes = new Set<number>();

      for (const range of dayRanges.values()) {
        indexes.add(range.first);
      }

      const desired = 7;

      for (let i = 0; i < desired; i += 1) {
        indexes.add(Math.round((i / Math.max(1, desired - 1)) * (windowed.length - 1)));
      }

      return [...indexes].sort((a, b) => a - b);
    }

    const count = 6;

    return Array.from({ length: count + 1 }).map((_, i) =>
      Math.round((i / count) * (windowed.length - 1))
    );
  }, [windowed.length, intraday, dayRanges]);

  const hovered = hoverIndex !== null ? windowed[hoverIndex] : windowed[windowed.length - 1];

  const indexFromClientX = useCallback(
    (clientX: number, bounds: DOMRect): number => {
      const x = clientX - bounds.left;
      const chartLeftPx = (plotLeft / width) * bounds.width;
      const chartRightPx = (plotRight / width) * bounds.width;
      const chartWidthPx = chartRightPx - chartLeftPx;
      const relativeX = x - chartLeftPx;
      const ratio = Math.min(1, Math.max(0, relativeX / Math.max(chartWidthPx, 1)));

      return Math.min(windowed.length - 1, Math.max(0, Math.round(ratio * (windowed.length - 1))));
    },
    [plotLeft, plotRight, width, windowed.length]
  );

  const handleMove = (evt: MouseEvent<SVGSVGElement>) => {
    if (!windowed.length) return;

    setHoverIndex(indexFromClientX(evt.clientX, evt.currentTarget.getBoundingClientRect()));
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();

      if (!windowed.length) return;

      const bounds = svg.getBoundingClientRect();
      const idx = indexFromClientX(evt.clientX, bounds);

      if (evt.shiftKey) {
        setYZoom((z) => (evt.deltaY < 0 ? Math.min(10, z + 0.25) : Math.max(0.5, z - 0.25)));
        return;
      }

      if (evt.altKey) {
        setYOffset((o) => o + (evt.deltaY > 0 ? -0.05 : 0.05));
        return;
      }

      const anchorTime = windowed[idx]?.time;
      const absoluteIdx = safeCandles.findIndex((c) => c.time === anchorTime);

      if (absoluteIdx >= 0) setFocusIndex(absoluteIdx);

      setZoomLevel((z) => (evt.deltaY < 0 ? Math.min(8, z + 1) : Math.max(1, z - 1)));
    };

    svg.addEventListener("wheel", onWheel, { passive: false });

    return () => svg.removeEventListener("wheel", onWheel);
  }, [windowed, safeCandles, indexFromClientX]);

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem",
        overscrollBehavior: "contain",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>
          Main Stock Chart — {ticker} ({timeframe})
        </h3>

        <div style={{ fontSize: 12, color: "#4b5563" }}>
          Wheel time zoom • ShiftWheel price zoom • AltWheel price pan • X{zoomLevel} Y
          {safeFixed(yZoom, 2)}
        </div>
      </div>

      {hovered ? (
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          O: {safeFixed(hovered.open, 2)} H: {safeFixed(hovered.high, 2)} L:{" "}
          {safeFixed(hovered.low, 2)} C: {safeFixed(hovered.close, 2)}
        </div>
      ) : null}

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick.id}>
            <SafeLine x1={plotLeft} y1={tick.y} x2={plotRight} y2={tick.y} stroke="#e5e7eb" />

            <SafeText
              x={plotRight + 8}
              y={tick.y + 3}
              fontSize="10"
              textAnchor="start"
              fill="#6b7280"
            >
              {safeFixed(tick.value, 2)}
            </SafeText>
          </g>
        ))}

        <SafeLine
          x1={plotRight}
          y1={padding}
          x2={plotRight}
          y2={height - padding}
          stroke="#d1d5db"
        />

        {intraday
          ? [...dayRanges.entries()].map(([day, range]) => {
              if (range.first === 0) return null;

              const x = plotLeft + range.first * candleWidth;
              const labelTime = windowed[range.first]?.time;

              return (
                <g key={`day-break-${day}`}>
                  <SafeLine
                    x1={x}
                    y1={padding}
                    x2={x}
                    y2={height - padding}
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                  />

                  <SafeText x={x + 4} y={padding + 12} fontSize="10" fill="#64748b">
                   {formatDateLabel(labelTime ?? day)}
                  </SafeText>
                </g>
              );
            })
          : null}

        <OIZonesOverlay
          currentPrice={currentPrice}
          prevailingLevels={prevailingLevels}
          toY={toY}
          plotLeft={plotLeft}
          plotRight={plotRight}
          chartTop={padding}
          chartBottom={height - padding}
          enabled={Boolean(overlays.showOiZones && prevailingLevels && currentPrice)}
        />

        <OIStructureDriftOverlay
          drift={structureDrift}
          toY={toY}
          plotLeft={plotLeft}
          plotRight={plotRight}
          chartTop={padding}
          chartBottom={height - padding}
          enabled={Boolean(overlays.showOiZones && structureDrift)}
        />

        {windowed.map((c, i) => {
          const x = plotLeft + i * candleWidth + candleWidth / 2;
          const openY = toY(c.open);
          const closeY = toY(c.close);
          const highY = toY(c.high);
          const lowY = toY(c.low);
          const isUp = c.close >= c.open;
          const candleColor = isUp ? "#16a34a" : "#dc2626";

          return (
            <g key={`${c.time}-${i}`} opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.65}>
              <SafeLine
                x1={x}
                y1={highY}
                x2={x}
                y2={lowY}
                stroke={candleColor}
                strokeWidth={1.2}
              />

              <SafeRect
                x={x - candleBodyWidth / 2}
                y={Math.min(openY, closeY)}
                width={candleBodyWidth}
                height={Math.max(1, Math.abs(closeY - openY))}
                fill={candleColor}
                stroke={candleColor}
              />
            </g>
          );
        })}

        {historicalSegments.map((segment) => (
          <SafeLine
            key={segment.id}
            x1={segment.x1}
            y1={segment.y}
            x2={segment.x2}
            y2={segment.y}
            stroke={segment.color}
            strokeWidth={segment.strokeWidth}
            opacity={segment.opacity}
          />
        ))}

        {rightAxisLabels.map((label) => (
          <g key={`${label.id}-tag`}>
            <SafeRect
              x={plotRight + 8}
              y={label.y - 7}
              width={rightAxisGutter - 14}
              height={14}
              fill="#ffffff"
              opacity={0.85}
            />

            <SafeText
              x={plotRight + 10}
              y={label.y + 3}
              fontSize="10"
              textAnchor="start"
              fill={label.color}
            >
              {label.label} {safeFixed(label.value, 2)}
            </SafeText>
          </g>
        ))}

        {xTickIndexes.map((idx) => {
          const candle = windowed[idx];
          if (!candle) return null;

          const x = plotLeft + idx * candleWidth + candleWidth / 2;
          const firstOfDay = firstIndexesOfDay.has(idx);

          return (
            <SafeText
              key={`${candle.time}-${idx}`}
              x={x}
              y={height - 6}
              fontSize="10"
              textAnchor="middle"
              fill={firstOfDay ? "#111827" : "#6b7280"}
              fontWeight={firstOfDay ? 700 : 400}
            >
              {formatXAxisLabel(candle.time, timeframe, firstOfDay)}
            </SafeText>
          );
        })}

        {hovered && hoverIndex !== null ? (
          <SafeLine
            x1={plotLeft + hoverIndex * candleWidth + candleWidth / 2}
            y1={padding}
            x2={plotLeft + hoverIndex * candleWidth + candleWidth / 2}
            y2={height - padding}
            stroke="#9ca3af"
            strokeDasharray="4 4"
          />
        ) : null}
      </svg>

      {!hasExactSnapshot ? (
        <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
          No saved snapshot exists for this expiration on this date.
        </div>
      ) : null}

      {!snapshotSeries.length && showSavedOiHistory ? (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
          No saved OI snapshots for this ticker/chain yet.
        </div>
      ) : null}

      {fallbackOverlayDates.length > 0 ? (
        <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
          Expiration fallback used for saved snapshots: {fallbackOverlayDates.join(", ")}
        </div>
      ) : null}

      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>
        Overlay status: {overlayStatus}
      </div>
    </section>
  );
}