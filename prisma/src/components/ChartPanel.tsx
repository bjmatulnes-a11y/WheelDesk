"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Candle, ExpirationSummary, OverlayFlags, SupportedTicker, Timeframe } from "../lib/types";
import { SnapshotStructurePoint } from "../lib/chart-overlay";
import { PrevailingLevels } from "../lib/oi-prevailing-levels";
import { OIZonesOverlay } from "./OIZonesOverlay";
import { OIStructureDriftOverlay } from "./OIStructureDriftOverlay";

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
  prevailingLevels?:PrevailingLevels | null;
};

function isIntraday(timeframe: Timeframe): boolean {
  return !["daily", "weekly"].includes(timeframe);
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
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
  structureDrift  
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

  const windowed = useMemo(() => {
    const keep = Math.max(20, Math.round(candles.length / Math.max(zoomLevel, 1)));
    const target = focusIndex ?? candles.length - 1;
    const start = Math.max(0, Math.min(candles.length - keep, target - Math.floor(keep / 2)));
    return candles.slice(start, start + keep);
  }, [candles, zoomLevel, focusIndex]);

  const closes = windowed.map((c) => c.close);
  const currentPrice = closes.at(-1) ?? summary.combinedCenter;

  const metricStyles = {
    center: { color: "#7c3aed", label: "OI Center" },
    lower: { color: "#0f766e", label: "OI Lower" },
    upper: { color: "#0f766e", label: "OI Upper" },
    callWall: { color: "#dc2626", label: "Call Wall" },
    putWall: { color: "#2563eb", label: "Put Wall" }
  } as const;

  const overlayScaleValues = useMemo(() => {
    const values: number[] = [];

    snapshotSeries.forEach((o) => {
      if (overlays.showOiCenter) values.push(o.summary.combinedCenter);
      if (overlays.showOiRange) values.push(o.summary.lowerRange, o.summary.upperRange);
      if (overlays.showWalls) values.push(o.summary.callWall, o.summary.putWall);
    });

    if (overlays.showOiCenter) values.push(summary.combinedCenter);
    if (overlays.showOiRange) values.push(summary.lowerRange, summary.upperRange);
    if (overlays.showWalls) values.push(summary.callWall, summary.putWall);

    return values.filter((v) => Number.isFinite(v));
  }, [snapshotSeries, overlays, summary]);

  const candleLow = windowed.reduce((m, c) => Math.min(m, c.low), Number.POSITIVE_INFINITY);
  const candleHigh = windowed.reduce((m, c) => Math.max(m, c.high), Number.NEGATIVE_INFINITY);

  const rawMin = Math.min(candleLow, ...overlayScaleValues);
  const rawMax = Math.max(candleHigh, ...overlayScaleValues);

  const safeMin = Number.isFinite(rawMin) ? rawMin : currentPrice * 0.98;
  const safeMax = Number.isFinite(rawMax) ? rawMax : currentPrice * 1.02;

  const paddedSpan = Math.max(0.5, safeMax - safeMin);
  const defaultMin = safeMin - paddedSpan * 0.08;
  const defaultMax = safeMax + paddedSpan * 0.08;

  const defaultRange = Math.max(0.01, defaultMax - defaultMin);
  const scaledRange = defaultRange / yZoom;
  const mid = (defaultMax + defaultMin) / 2 + yOffset * scaledRange;

  const minPrice = mid - scaledRange / 2;
  const maxPrice = mid + scaledRange / 2;

  const toY = (price: number) =>
    padding + ((maxPrice - price) / (maxPrice - minPrice || 1)) * (height - padding * 2);

  const candleWidth = (plotRight - plotLeft) / Math.max(1, windowed.length);
  const candleBodyWidth = Math.max(2, Math.min(12, candleWidth * 0.62));

  const selectedStructureLines = useMemo(() => {
    const lines: Array<{ id: string; value: number; color: string; label: string }> = [];

    if (overlays.showOiCenter) {
      lines.push({
        id: "selected-center",
        value: summary.combinedCenter,
        color: metricStyles.center.color,
        label: metricStyles.center.label
      });
    }

    if (overlays.showOiRange) {
      lines.push({
        id: "selected-lower",
        value: summary.lowerRange,
        color: metricStyles.lower.color,
        label: metricStyles.lower.label
      });

      lines.push({
        id: "selected-upper",
        value: summary.upperRange,
        color: metricStyles.upper.color,
        label: metricStyles.upper.label
      });
    }

    if (overlays.showWalls) {
      lines.push({
        id: "selected-call-wall",
        value: summary.callWall,
        color: metricStyles.callWall.color,
        label: metricStyles.callWall.label
      });

      lines.push({
        id: "selected-put-wall",
        value: summary.putWall,
        color: metricStyles.putWall.color,
        label: metricStyles.putWall.label
      });
    }

    return lines.filter((line) => Number.isFinite(line.value));
  }, [summary, overlays, metricStyles]);

  const dayRanges = useMemo(() => {
    const ranges = new Map<string, { first: number; last: number }>();

    windowed.forEach((c, idx) => {
      const key = dateKey(c.time);
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
    return new Set([...dayRanges.values()].map((r) => r.first));
  }, [dayRanges]);

  const historicalSegments = useMemo(() => {
    if (!showSavedOiHistory) return [];

    const segments: Array<{
      id: string;
      x1: number;
      x2: number;
      y: number;
      color: string;
      strokeWidth: number;
      opacity: number;
    }> = [];

    snapshotSeries.forEach((point) => {
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

      const isSelected = point.snapshotDate === selectedSnapshotDate;
      const strokeWidth = isSelected ? 3 : 2;
      const opacity = isSelected ? 0.95 : 0.6;

      if (overlays.showOiCenter) {
        segments.push({
          id: `${point.snapshotDate}-${point.role}-center`,
          x1,
          x2,
          y: toY(point.summary.combinedCenter),
          color: metricStyles.center.color,
          strokeWidth,
          opacity
        });
      }

      if (overlays.showOiRange) {
        segments.push({
          id: `${point.snapshotDate}-${point.role}-lower`,
          x1,
          x2,
          y: toY(point.summary.lowerRange),
          color: metricStyles.lower.color,
          strokeWidth,
          opacity
        });

        segments.push({
          id: `${point.snapshotDate}-${point.role}-upper`,
          x1,
          x2,
          y: toY(point.summary.upperRange),
          color: metricStyles.upper.color,
          strokeWidth,
          opacity
        });
      }

      if (overlays.showWalls) {
        segments.push({
          id: `${point.snapshotDate}-${point.role}-call-wall`,
          x1,
          x2,
          y: toY(point.summary.callWall),
          color: metricStyles.callWall.color,
          strokeWidth,
          opacity
        });

        segments.push({
          id: `${point.snapshotDate}-${point.role}-put-wall`,
          x1,
          x2,
          y: toY(point.summary.putWall),
          color: metricStyles.putWall.color,
          strokeWidth,
          opacity
        });
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
    metricStyles
  ]);

  const rightAxisLabels = useMemo(() => {
    const labels = selectedStructureLines
      .map((series) => ({ ...series, y: toY(series.value) }))
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
      return { value, y: toY(value) };
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

  const indexFromClientX = (clientX: number, bounds: DOMRect): number => {
    const x = clientX - bounds.left;
    const chartLeftPx = (plotLeft / width) * bounds.width;
    const chartRightPx = (plotRight / width) * bounds.width;
    const chartWidthPx = chartRightPx - chartLeftPx;
    const relativeX = x - chartLeftPx;
    const ratio = Math.min(1, Math.max(0, relativeX / Math.max(chartWidthPx, 1)));

    return Math.min(windowed.length - 1, Math.max(0, Math.round(ratio * (windowed.length - 1))));
  };

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
      const absoluteIdx = candles.findIndex((c) => c.time === anchorTime);

      if (absoluteIdx >= 0) setFocusIndex(absoluteIdx);

      setZoomLevel((z) => (evt.deltaY < 0 ? Math.min(8, z + 1) : Math.max(1, z - 1)));
    };

    svg.addEventListener("wheel", onWheel, { passive: false });

    return () => svg.removeEventListener("wheel", onWheel);
  }, [windowed, candles]);

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem",
        overscrollBehavior: "contain"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>
          Main Stock Chart — {ticker} ({timeframe})
        </h3>

        <div style={{ fontSize: 12, color: "#4b5563" }}>
          Wheel: time zoom • Shift+Wheel: price zoom • Alt+Wheel: price pan • X{zoomLevel} Y{yZoom.toFixed(2)}
        </div>
      </div>

      {hovered && (
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          O:{hovered.open.toFixed(2)} H:{hovered.high.toFixed(2)} L:{hovered.low.toFixed(2)} C:{hovered.close.toFixed(2)}
        </div>
      )}

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line x1={plotLeft} y1={tick.y} x2={plotRight} y2={tick.y} stroke="#e5e7eb" />

            

            <text x={plotRight + 8} y={tick.y + 3} fontSize="10" textAnchor="start" fill="#6b7280">
              {tick.value.toFixed(2)}
            </text>
          </g>
        ))}

        <line x1={plotRight} y1={padding} x2={plotRight} y2={height - padding} stroke="#d1d5db" />

        {intraday &&
          [...dayRanges.entries()].map(([day, range]) => {
            if (range.first === 0) return null;

            const x = plotLeft + range.first * candleWidth;

            return (
              <g key={`day-break-${day}`}>
                <line
                  x1={x}
                  y1={padding}
                  x2={x}
                  y2={height - padding}
                  stroke="#cbd5e1"
                  strokeDasharray="4 4"
                />

                <text x={x + 4} y={padding + 12} fontSize="10" fill="#64748b">
                  {formatDateLabel(windowed[range.first].time)}
                </text>
              </g>
            );
          })}

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
          const isUp = c.close >= c.open;
          const candleColor = isUp ? "#16a34a" : "#dc2626";

          return (
            <g key={`${c.time}-${i}`} opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.65}>
              <line x1={x} y1={toY(c.high)} x2={x} y2={toY(c.low)} stroke={candleColor} strokeWidth={1.2} />

              <rect
                x={x - candleBodyWidth / 2}
                y={Math.min(toY(c.open), toY(c.close))}
                width={candleBodyWidth}
                height={Math.max(1, Math.abs(toY(c.close) - toY(c.open)))}
                fill={candleColor}
                stroke={candleColor}
              />
            </g>
          );
        })}

        {historicalSegments.map((segment) => (
          <line
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
            <rect
              x={plotRight + 8}
              y={label.y - 7}
              width={rightAxisGutter - 14}
              height={14}
              fill="#ffffff"
              opacity={0.85}
            />

            <text x={plotRight + 10} y={label.y + 3} fontSize="10" textAnchor="start" fill={label.color}>
              {label.label} {label.value.toFixed(2)}
            </text>
          </g>
        ))}

        {xTickIndexes.map((idx) => {
          const candle = windowed[idx];
          if (!candle) return null;

          const x = plotLeft + idx * candleWidth + candleWidth / 2;
          const firstOfDay = firstIndexesOfDay.has(idx);

          return (
            <text
              key={`${candle.time}-${idx}`}
              x={x}
              y={height - 6}
              fontSize="10"
              textAnchor="middle"
              fill={firstOfDay ? "#111827" : "#6b7280"}
              fontWeight={firstOfDay ? 700 : 400}
            >
              {formatXAxisLabel(candle.time, timeframe, firstOfDay)}
            </text>
          );
        })}

        {hovered && hoverIndex !== null && (
          <line
            x1={plotLeft + hoverIndex * candleWidth + candleWidth / 2}
            y1={padding}
            x2={plotLeft + hoverIndex * candleWidth + candleWidth / 2}
            y2={height - padding}
            stroke="#9ca3af"
            strokeDasharray="4 4"
          />
        )}
      </svg>

      {!hasExactSnapshot && (
        <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
          No saved snapshot exists for this expiration on this date.
        </div>
      )}

      {!snapshotSeries.length && showSavedOiHistory && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
          No saved OI snapshots for this ticker/chain yet.
        </div>
      )}

      {fallbackOverlayDates.length > 0 && (
        <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
          Expiration fallback used for saved snapshots: {fallbackOverlayDates.join(", ")}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>Overlay status: {overlayStatus}</div>
    </section>
  );
}