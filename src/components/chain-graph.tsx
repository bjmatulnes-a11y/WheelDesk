"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { ChainRow, ExpirationSummary } from "../lib/types";
import { safeFixed, safeInt } from "../lib/format";
type Props = {
  rows: ChainRow[];
  summary: ExpirationSummary;
  currentPrice: number;
};

type HoverPoint = {
  strike: number;
  oi: number;
  side: "call" | "put";
  x: number;
  y: number;
};

type LabelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function boxesClash(a: LabelBox, b: LabelBox) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function placeLabel(args: {
  x: number;
  y: number;
  text: string;
  placed: LabelBox[];
  chartTop: number;
}) {
  const width = Math.max(42, args.text.length * 6.2);
  const height = 13;
  const gap = 4;

  let y = args.y;

  for (let i = 0; i < 10; i += 1) {
    const candidate: LabelBox = {
      x: args.x,
      y: y - height,
      width,
      height
    };

    const clash = args.placed.some((box) => boxesClash(candidate, box));

    if (!clash && candidate.y >= args.chartTop) {
      args.placed.push(candidate);
      return y;
    }

    y -= height + gap;
  }

  return y;
}
function canDrawSvgLine(...values: unknown[]): boolean {
  return values.every((value) => typeof value === "number" && Number.isFinite(value));
}
export function ChainGraph({ rows, summary, currentPrice }: Props) {
  const width = 940;
  const height = 300;
  const padding = 36;
  const [hover, setHover] = useState<HoverPoint | null>(null);

  const minStrike = Math.min(...rows.map((r) => r.strike));
  const maxStrike = Math.max(...rows.map((r) => r.strike));
  const maxOi = Math.max(...rows.map((r) => Math.max(r.callOi, r.putOi)), 1);

  const toX = (strike: number) =>
    padding + ((strike - minStrike) / (maxStrike - minStrike || 1)) * (width - padding * 2);

  const toY = (oi: number) => height - padding - (oi / maxOi) * (height - padding * 2);

  const markers = useMemo(
    () => [
      { label: "Put wall", value: summary.putWall, color: "#2563eb" },
      { label: "Low", value: summary.lowerRange, color: "#0f766e" },
      { label: "Center", value: summary.combinedCenter, color: "#7c3aed" },
      { label: "Price", value: currentPrice, color: "#111" },
      { label: "High", value: summary.upperRange, color: "#0f766e" },
      { label: "Call wall", value: summary.callWall, color: "#dc2626" }
    ],
    [summary, currentPrice]
  );

  const placedMarkerLabels = useMemo(() => {
    const placed: LabelBox[] = [];

    return markers.map((m) => {
      const x = toX(m.value) + 3;
      const baseY = padding + 9;
      const y = placeLabel({
        x,
        y: baseY,
        text: m.label,
        placed,
        chartTop: 10
      });

      return { ...m, labelX: x, labelY: y };
    });
  }, [markers, minStrike, maxStrike]);

  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round((i / 5) * maxOi));
  const xTicks = rows.filter((_, i) => i % 2 === 0);

  const onPointHover = (evt: MouseEvent<SVGCircleElement>, point: HoverPoint) => {
    const bounds = evt.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) return;
    setHover({ ...point, x: evt.clientX - bounds.left, y: evt.clientY - bounds.top });
  };

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem",
        position: "relative"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Option Chain OI Scatter</h3>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            {(() => {
              const y = toY(v);
              const x1 = padding;
              const x2 = width - padding;

              return Number.isFinite(x1) &&
                Number.isFinite(y) &&
                Number.isFinite(x2) ? (
                <line x1={x1} y1={y} x2={x2} y2={y} stroke="#ececec" />
  ) : null;
})()}
            <text x={padding - 5} y={toY(v) + 3} fontSize="10" textAnchor="end" fill="#6b7280">
              {safeInt(v)}
            </text>
          </g>
        ))}

        {rows.slice(1).map((r, i) => {
          const prev = rows[i];

          return (
            <g key={`line-${r.strike}`}>
              {(() => {
  const callX1 = toX(prev.strike);
  const callY1 = toY(prev.callOi);
  const callX2 = toX(r.strike);
  const callY2 = toY(r.callOi);

  const canDrawCall =
    Number.isFinite(callX1) &&
    Number.isFinite(callY1) &&
    Number.isFinite(callX2) &&
    Number.isFinite(callY2);

  return canDrawCall ? (
    <line
      x1={callX1}
      y1={callY1}
      x2={callX2}
      y2={callY2}
      stroke="#dc2626"
      strokeWidth="1.2"
    />
  ) : null;
})()}

{(() => {
  const putX1 = toX(prev.strike);
  const putY1 = toY(prev.putOi);
  const putX2 = toX(r.strike);
  const putY2 = toY(r.putOi);

  const canDrawPut =
    Number.isFinite(putX1) &&
    Number.isFinite(putY1) &&
    Number.isFinite(putX2) &&
    Number.isFinite(putY2);

  return canDrawPut ? (
    <line
      x1={putX1}
      y1={putY1}
      x2={putX2}
      y2={putY2}
      stroke="#2563eb"
      strokeWidth="1.2"
    />
  ) : null;
})()}
            </g>
          );
        })}

        {rows.map((r) => (
          <g key={`pt-${r.strike}`}>
            <circle
              cx={toX(r.strike)}
              cy={toY(r.callOi)}
              r="3"
              fill="#dc2626"
              onMouseMove={(e) =>
                onPointHover(e, { strike: r.strike, oi: r.callOi, side: "call", x: 0, y: 0 })
              }
              onMouseLeave={() => setHover(null)}
            />
            <circle
              cx={toX(r.strike)}
              cy={toY(r.putOi)}
              r="3"
              fill="#2563eb"
              onMouseMove={(e) =>
                onPointHover(e, { strike: r.strike, oi: r.putOi, side: "put", x: 0, y: 0 })
              }
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}

        {placedMarkerLabels.map((m) => (
          <g key={m.label}>
          {(() => {
  const x = toX(m.value);
  const y1 = padding;
  const y2 = height - padding;

  return canDrawSvgLine(x, y1, x, y2) ? (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2}
      stroke={m.color}
      strokeDasharray="6 4"
    />
  ) : null;
})()}
            <text x={m.labelX} y={m.labelY} fontSize="10" fill={m.color}>
              {m.label}
            </text>
          </g>
        ))}

        {xTicks.map((r) => (
          <text
            key={`x-${r.strike}`}
            x={toX(r.strike)}
            y={height - 8}
            fontSize="10"
            textAnchor="middle"
            fill="#6b7280"
          >
            {safeFixed(r?.strike, 0)}
          </text>
        ))}

        <text x={width / 2} y={height - 2} fontSize="11" textAnchor="middle" fill="#374151">
          X-axis: Strike
        </text>
        <text x={12} y={16} fontSize="11" fill="#374151">
          Y-axis: Open Interest
        </text>
      </svg>

      {hover && (
        <div
          style={{
            position: "absolute",
            left: Math.min(hover.x + 12, width - 180),
            top: Math.max(40, hover.y - 30),
            background: "#111",
            color: "#fff",
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 6,
            pointerEvents: "none"
          }}
        >
          {String(hover?.side ?? "").toUpperCase()} • Strike {safeFixed(hover?.strike, 2)} • OI {safeInt(hover?.oi)}
        </div>
      )}

      <div style={{ fontSize: 12, marginTop: 6, color: "#4b5563" }}>
        Red = Call OI, Blue = Put OI (strike on x-axis, OI on y-axis)
      </div>
    </section>
  );
}