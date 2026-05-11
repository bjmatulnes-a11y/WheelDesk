import { DailyStructureDrift } from "../lib/daily-structure-compare";
import { safeFixed } from "../lib/format";

type Props = {
  drift: DailyStructureDrift | null;
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

function drawDriftLine(args: {
  id: string;
  label: string;
  value: number | null;
  color: string;
  dashed?: boolean;
  toY: (price: number) => number;
  plotLeft: number;
  plotRight: number;
  chartTop: number;
  chartBottom: number;
}) {
  if (args.value == null || !Number.isFinite(args.value)) return null;

  const y = clamp(args.toY(args.value), args.chartTop, args.chartBottom);

  return (
    <g key={args.id}>
      <line
        x1={args.plotLeft}
        x2={args.plotRight}
        y1={y}
        y2={y}
        stroke={args.color}
        strokeWidth={args.dashed ? 1.1 : 1.8}
        strokeOpacity={args.dashed ? 0.45 : 0.85}
        strokeDasharray={args.dashed ? "6 5" : undefined}
      />

      <text
        x={args.plotLeft - 50}
        y={y + 4}
        fontSize={args.dashed ? "9" : "10"}
        textAnchor="end"
        fill={args.color}
        opacity={args.dashed ? 0.75 : 1}
        fontWeight={args.dashed ? 500 : 700}
      >
        {args.label}
      </text>
    </g>
  );
}

export function OIStructureDriftOverlay({
  drift,
  toY,
  plotLeft,
  plotRight,
  chartTop,
  chartBottom,
  enabled = true
}: Props) {
  if (!enabled || !drift) return null;

  return (
    <g data-layer="oi-structure-drift">
      {drift.prior &&
        drawDriftLine({
          id: "prior-resistance",
          label: `R ${safeFixed(drift?.prior?.resistance, 2)}`,
          value: drift.prior.resistance,
          color: "#dc2626",
          dashed: true,
          toY,
          plotLeft,
          plotRight,
          chartTop,
          chartBottom
        })}

      {drift.prior &&
        drawDriftLine({
          id: "prior-support",
          label: `S ${safeFixed(drift?.prior?.support, 2)}`,
          value: drift.prior.support,
          color: "#2563eb",
          dashed: true,
          toY,
          plotLeft,
          plotRight,
          chartTop,
          chartBottom
        })}

      {drift.prior &&
        drawDriftLine({
          id: "prior-magnet",
          label: `M ${safeFixed(drift?.prior?.magnet, 2)}`,
          value: drift.prior.magnet,
          color: "#7c3aed",
          dashed: true,
          toY,
          plotLeft,
          plotRight,
          chartTop,
          chartBottom
        })}
    </g>
  );
}