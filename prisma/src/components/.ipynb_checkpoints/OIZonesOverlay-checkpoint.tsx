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

      {/* Price label just left of chart axis */}

      

     // LEFT AXIS STYLE LABEL (outside chart)
    <text
      x={args.plotLeft - 10}
      y={y + 4}
      fontSize="11"
      textAnchor="end"
      fill={args.text}
      fontWeight={700}
    >
      {args.value.toFixed(2)}
    </text>

    // SECOND LINE (descriptor)
    <text
      x={args.plotLeft - 10}
      y={y + 16}
      fontSize="9"
      textAnchor="end"
      fill={args.text}
      opacity={0.85}
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
          id: "resistance",
          label: `Resistance · Call OI ${resistance.openInterest.toLocaleString()}`,
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
          id: "support",
          label: `Support · Put OI ${support.openInterest.toLocaleString()}`,
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
        label: "OI Magnet",
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