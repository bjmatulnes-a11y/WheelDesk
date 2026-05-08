import { PrevailingLevels } from "../lib/oi-prevailing-levels";

type OIZoneOverlayProps = {
  currentPrice: number;
  prevailingLevels?: PrevailingLevels | null;
  toY: (price: number) => number;
  plotLeft: number;
  plotRight: number;
  chartTop: number;
  chartBottom: number;
  enabled?: boolean;
};

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function drawLineWithLeftLabel(args: {
  id: string;
  label: string;
  value: number;
  stroke: string;
  text: string;
  toY: (price: number) => number;
  plotLeft: number;
  plotRight: number;
  chartTop: number;
  chartBottom: number;
  dashed?: boolean;
}) {
  const y = clamp(args.toY(args.value), args.chartTop, args.chartBottom);

  return (
    <g key={args.id}>
      <line
        x1={args.plotLeft}
        x2={args.plotRight}
        y1={y}
        y2={y}
        stroke={args.stroke}
        strokeWidth={1.6}
        strokeOpacity={0.85}
        strokeDasharray={args.dashed ? "5 5" : undefined}
      />

      <rect
        x={args.plotLeft + 4}
        y={y - 9}
        width={220}
        height={16}
        fill="#ffffff"
        opacity={0.88}
        rx={3}
      />

      <text
        x={args.plotLeft + 8}
        y={y + 3}
        fontSize="10"
        fill={args.text}
        fontWeight={700}
      >
        {args.label}
      </text>
    </g>
  );
}

export function OIZonesOverlay({
  currentPrice,
  prevailingLevels,
  toY,
  plotLeft,
  plotRight,
  chartTop,
  chartBottom,
  enabled = true
}: OIZoneOverlayProps) {
  if (!enabled || !currentPrice || !prevailingLevels) return null;

  const support = prevailingLevels.support;
  const resistance = prevailingLevels.resistance;
  const magnet = prevailingLevels.magnet;

  return (
    <g data-layer="oi-aggregate-lines">
      {resistance &&
        drawLineWithLeftLabel({
          id: "aggregate-resistance",
          label: `Aggregate Resistance ${resistance.strike.toFixed(2)} · Call OI ${resistance.openInterest.toLocaleString()}`,
          value: resistance.strike,
          stroke: "#dc2626",
          text: "#dc2626",
          toY,
          plotLeft,
          plotRight,
          chartTop,
          chartBottom
        })}

      {support &&
        drawLineWithLeftLabel({
          id: "aggregate-support",
          label: `Aggregate Support ${support.strike.toFixed(2)} · Put OI ${support.openInterest.toLocaleString()}`,
          value: support.strike,
          stroke: "#2563eb",
          text: "#2563eb",
          toY,
          plotLeft,
          plotRight,
          chartTop,
          chartBottom
        })}

      {drawLineWithLeftLabel({
        id: "oi-magnet",
        label: `OI Magnet ${magnet.strike.toFixed(2)}`,
        value: magnet.strike,
        stroke: "#7c3aed",
        text: "#7c3aed",
        toY,
        plotLeft,
        plotRight,
        chartTop,
        chartBottom,
        dashed: true
      })}
    </g>
  );
}