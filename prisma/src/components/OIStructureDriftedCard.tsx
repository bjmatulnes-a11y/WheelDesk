import { DailyStructureDrift } from "../lib/daily-structure-compare";

type Props = {
  drift: DailyStructureDrift | null;
};

function colorFor(direction: string): string {
  if (direction === "bullish") return "#15803d";
  if (direction === "bearish") return "#b91c1c";
  if (direction === "compression") return "#7c3aed";
  if (direction === "expansion") return "#c2410c";
  return "#4b5563";
}

export function OIStructureDriftCard({ drift }: Props) {
  if (!drift) {
    return (
      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
        <h3 style={{ marginTop: 0 }}>OI Structure Drift</h3>
        <p style={{ marginBottom: 0, color: "#6b7280" }}>
          Save daily structure snapshots to compare support, resistance, and OI magnet drift.
        </p>
      </section>
    );
  }

  return (
    <section style={{ border: "1px solid #334155", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>OI Structure Drift</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Current:</strong> {drift.current.snapshotDate}
        </div>
        <div>
          <strong>Prior:</strong> {drift.prior?.snapshotDate ?? "N/A"}
        </div>
        <div>
          <strong>Direction:</strong>{" "}
          <span style={{ color: colorFor(drift.direction), fontWeight: 700 }}>
            {drift.direction.toUpperCase()}
          </span>
        </div>
        <div>
          <strong>Spot:</strong> {drift.current.spot.toFixed(2)}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Support:</strong> {drift.current.support?.toFixed(2) ?? "N/A"}
        </div>
        <div>
          <strong>Resistance:</strong> {drift.current.resistance?.toFixed(2) ?? "N/A"}
        </div>
        <div>
          <strong>OI Magnet:</strong> {drift.current.magnet.toFixed(2)}
        </div>
      </div>

      <ul style={{ marginBottom: 0 }}>
        {drift.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}