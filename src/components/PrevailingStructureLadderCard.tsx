import { PrevailingLevels, PrevailingLevel } from "../lib/oi-prevailing-levels";

type Props = {
  levels: PrevailingLevels | null;
  currentPrice: number;
};

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function distancePct(strike: number, currentPrice: number): number {
  if (!currentPrice) return 0;
  return (strike - currentPrice) / currentPrice;
}

function LevelRow({
  level,
  currentPrice,
  rank
}: {
  level: PrevailingLevel;
  currentPrice: number;
  rank: number;
}) {
  const dist = distancePct(level.strike, currentPrice);

  return (
    <tr>
      <td style={{ padding: "4px 6px", fontWeight: 700 }}>{rank}</td>
      <td style={{ padding: "4px 6px", fontWeight: 700 }}>{fmt(level.strike)}</td>
      <td style={{ padding: "4px 6px" }}>{level.openInterest.toLocaleString()}</td>
      <td style={{ padding: "4px 6px" }}>{level.score.toFixed(2)}</td>
      <td style={{ padding: "4px 6px" }}>{pct(dist)}</td>
    </tr>
  );
}

function LadderTable({
  title,
  color,
  levels,
  currentPrice
}: {
  title: string;
  color: string;
  levels: PrevailingLevel[];
  currentPrice: number;
}) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem" }}>
      <h4 style={{ marginTop: 0, color }}>{title}</h4>

      {levels.length === 0 ? (
        <p style={{ color: "#6b7280", marginBottom: 0 }}>No valid levels found.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "4px 6px" }}>#</th>
              <th style={{ padding: "4px 6px" }}>Strike</th>
              <th style={{ padding: "4px 6px" }}>OI</th>
              <th style={{ padding: "4px 6px" }}>Score</th>
              <th style={{ padding: "4px 6px" }}>Distance</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level, index) => (
              <LevelRow
                key={`${level.type}-${level.strike}`}
                level={level}
                currentPrice={currentPrice}
                rank={index + 1}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PrevailingStructureLadderCard({ levels, currentPrice }: Props) {
  if (!levels) return null;

  const magnetDistance =
    levels.magnet?.strike != null && currentPrice
      ? (levels.magnet.strike - currentPrice) / currentPrice
      : null;

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 8,
        background: "#fff",
        padding: "1rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Prevailing Structure Ladder</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem"
        }}
      >
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem" }}>
          <strong>Primary Support</strong>
          <div style={{ color: "#2563eb", fontSize: 20, fontWeight: 800 }}>
            {fmt(levels.support?.strike)}
          </div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem" }}>
          <strong>OI Magnet</strong>
          <div style={{ color: "#7c3aed", fontSize: 20, fontWeight: 800 }}>
            {fmt(levels.magnet?.strike)}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Distance from spot: {pct(magnetDistance)}
          </div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem" }}>
          <strong>Primary Resistance</strong>
          <div style={{ color: "#dc2626", fontSize: 20, fontWeight: 800 }}>
            {fmt(levels.resistance?.strike)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.75rem"
        }}
      >
        <LadderTable
          title="Support Ladder"
          color="#2563eb"
          levels={levels.supports ?? []}
          currentPrice={currentPrice}
        />

        <LadderTable
          title="Resistance Ladder"
          color="#dc2626"
          levels={levels.resistances ?? []}
          currentPrice={currentPrice}
        />
      </div>

      {levels.quality?.notes?.length > 0 && (
        <div style={{ marginTop: "0.75rem", color: "#92400e", fontSize: 13 }}>
          <strong>Quality Notes</strong>
          <ul style={{ marginBottom: 0 }}>
            {levels.quality.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}