type Point = { price: number; pl: number };

type Props = {
  points: Point[];
  currentPrice: number;
  slices: number[];
};

function formatDollar(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function RiskProfileChart({ points, currentPrice, slices }: Props) {
  const width = 980;
  const height = 340;
  const padLeft = 68;
  const padRight = 22;
  const padTop = 24;
  const padBottom = 38;

  const minX = points[0]?.price ?? 0;
  const maxX = points.at(-1)?.price ?? 1;
  const minY = Math.min(...points.map((p) => p.pl), 0);
  const maxY = Math.max(...points.map((p) => p.pl), 0);

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const toX = (x: number) =>
    padLeft + ((x - minX) / Math.max(0.0001, maxX - minX)) * innerW;

  const toY = (y: number) =>
    padTop + ((maxY - y) / Math.max(0.0001, maxY - minY)) * innerH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.price)} ${toY(p.pl)}`)
    .join(" ");

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
      <h3 style={{ marginTop: 0 }}>Risk Profile</h3>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        {/* grid */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const t = i / yTicks;
          const yVal = maxY - (maxY - minY) * t;
          const y = toY(yVal);
          return (
            <g key={`y-${i}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#e5e7eb"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#6b7280"
              >
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
              <line
                x1={x}
                y1={padTop}
                x2={x}
                y2={height - padBottom}
                stroke="#f3f4f6"
              />
              <text
                x={x}
                y={height - 12}
                textAnchor="middle"
                fontSize="11"
                fill="#6b7280"
              >
                {xVal.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* zero line */}
        <line
          x1={padLeft}
          y1={toY(0)}
          x2={width - padRight}
          y2={toY(0)}
          stroke="#9ca3af"
          strokeWidth={1.5}
        />

        {/* profile */}
        <path d={path} fill="none" stroke="#2563eb" strokeWidth={2.5} />

        {/* current price */}
        <line
          x1={toX(currentPrice)}
          y1={padTop}
          x2={toX(currentPrice)}
          y2={height - padBottom}
          stroke="#dc2626"
          strokeDasharray="5 5"
          strokeWidth={1.5}
        />
        <text
          x={toX(currentPrice)}
          y={padTop - 4}
          textAnchor="middle"
          fontSize="11"
          fill="#dc2626"
        >
          Spot {currentPrice.toFixed(2)}
        </text>

        {/* slice markers */}
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

        {/* axis titles */}
        <text
          x={padLeft + innerW / 2}
          y={height - 2}
          textAnchor="middle"
          fontSize="12"
          fill="#374151"
        >
          Underlying Price
        </text>
        <text
          transform={`translate(14 ${padTop + innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="12"
          fill="#374151"
        >
          Profit / Loss ($)
        </text>
      </svg>
    </section>
  );
}