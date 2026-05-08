import { RiskProfilePoint } from "../lib/portfolio-types";

type Props = {
  expirationPoints: RiskProfilePoint[];
  theoreticalPoints: RiskProfilePoint[];
  currentPrice: number;
  slices: number[];
};

function formatDollar(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(0)}`;
}

function buildPath(
  points: RiskProfilePoint[],
  toX: (value: number) => number,
  toY: (value: number) => number
): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.price)} ${toY(p.pl)}`)
    .join(" ");
}

export function RiskProfileComparisonChart({
  expirationPoints,
  theoreticalPoints,
  currentPrice,
  slices
}: Props) {
  const points = expirationPoints.length ? expirationPoints : theoreticalPoints;
  const allPoints = [...expirationPoints, ...theoreticalPoints];

  const width = 980;
  const height = 380;
  const padLeft = 68;
  const padRight = 24;
  const padTop = 34;
  const padBottom = 44;

  const minX = points[0]?.price ?? 0;
  const maxX = points.at(-1)?.price ?? 1;
  const minY = Math.min(...allPoints.map((p) => p.pl), 0);
  const maxY = Math.max(...allPoints.map((p) => p.pl), 0);

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const toX = (x: number) =>
    padLeft + ((x - minX) / Math.max(0.0001, maxX - minX)) * innerW;

  const toY = (y: number) =>
    padTop + ((maxY - y) / Math.max(0.0001, maxY - minY)) * innerH;

  const expirationPath = buildPath(expirationPoints, toX, toY);
  const theoreticalPath = buildPath(theoreticalPoints, toX, toY);

  const yTicks = 5;
  const xTicks = 6;

  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>Risk Profile — Expiration vs Theoretical</h3>
          <p style={{ marginTop: 0, fontSize: 12, color: "#4b5563" }}>
            Expiration shows intrinsic value at expiry. Theoretical keeps time value using the current IV assumptions.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 18, height: 3, background: "#2563eb", display: "inline-block" }} />
            Expiration
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 18, height: 3, background: "#f97316", display: "inline-block" }} />
            Theoretical
          </span>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const t = i / yTicks;
          const yVal = maxY - (maxY - minY) * t;
          const y = toY(yVal);
          return (
            <g key={`y-${i}`}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#e5e7eb" />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                {formatDollar(yVal)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const t = i / xTicks;
          const xVal = minX + (maxX - minX) * t;
          const x = toX(xVal);
          return (
            <g key={`x-${i}`}>
              <line x1={x} y1={padTop} x2={x} y2={height - padBottom} stroke="#f3f4f6" />
              <text x={x} y={height - 14} textAnchor="middle" fontSize="11" fill="#6b7280">
                {xVal.toFixed(2)}
              </text>
            </g>
          );
        })}

        <line x1={padLeft} y1={toY(0)} x2={width - padRight} y2={toY(0)} stroke="#9ca3af" strokeWidth={1.5} />

        {expirationPath ? <path d={expirationPath} fill="none" stroke="#2563eb" strokeWidth={2.5} /> : null}
        {theoreticalPath ? (
          <path d={theoreticalPath} fill="none" stroke="#f97316" strokeWidth={2.5} strokeDasharray="7 5" />
        ) : null}

        <line
          x1={toX(currentPrice)}
          y1={padTop}
          x2={toX(currentPrice)}
          y2={height - padBottom}
          stroke="#dc2626"
          strokeDasharray="5 5"
          strokeWidth={1.5}
        />
        <text x={toX(currentPrice)} y={padTop - 8} textAnchor="middle" fontSize="11" fill="#dc2626">
          Spot {currentPrice.toFixed(2)}
        </text>

        {slices.map((s) => (
          <line
            key={s}
            x1={toX(s)}
            y1={padTop}
            x2={toX(s)}
            y2={height - padBottom}
            stroke="#0f766e"
            strokeDasharray="2 4"
            strokeWidth={1}
          />
        ))}

        <text x={padLeft + innerW / 2} y={height - 3} textAnchor="middle" fontSize="12" fill="#374151">
          Underlying Price
        </text>
        <text transform={`translate(14 ${padTop + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#374151">
          Profit / Loss ($)
        </text>
      </svg>
    </section>
  );
}
