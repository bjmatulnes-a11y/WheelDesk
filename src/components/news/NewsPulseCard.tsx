import type { NewsPulse } from "../../lib/news/news-types";

function statusLabel(status: NewsPulse["status"]): string {
  if (status === "shock") return "Shock risk";
  if (status === "elevated") return "Elevated";
  if (status === "active") return "Active";
  return "Quiet";
}

function impactLabel(impact: NewsPulse["forecastImpact"]): string {
  if (impact === "shock_risk") return "Potential field shock";
  if (impact === "confidence_down") return "Forecast confidence should be reduced";
  if (impact === "watch") return "Watch for divergence";
  return "No material news pressure";
}

export function NewsPulseCard({ pulse }: { pulse: NewsPulse }) {
  const accent =
    pulse.status === "shock"
      ? "#fb7185"
      : pulse.status === "elevated"
        ? "#f59e0b"
        : pulse.status === "active"
          ? "#22d3ee"
          : "#94a3b8";

  return (
    <section
      style={{
        border: "1px solid rgba(34,211,238,0.22)",
        borderRadius: 18,
        background: "rgba(2,10,20,0.78)",
        padding: 18,
        minHeight: 170,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#67e8f9", fontSize: 12, fontWeight: 900, letterSpacing: 1.5 }}>NEWS PULSE</div>
          <h3 style={{ color: "#f8fafc", margin: "6px 0 0", fontSize: 24 }}>{pulse.symbol}</h3>
        </div>
        <div style={{ color: accent, fontWeight: 900, textAlign: "right" }}>{statusLabel(pulse.status)}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", fontWeight: 800 }}>24h items</div>
          <div style={{ color: "#e0f2fe", fontSize: 22, fontWeight: 900 }}>{pulse.count24h}</div>
        </div>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", fontWeight: 800 }}>Materiality</div>
          <div style={{ color: accent, fontSize: 22, fontWeight: 900 }}>{pulse.materiality}</div>
        </div>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", fontWeight: 800 }}>Sentiment</div>
          <div style={{ color: "#e0f2fe", fontSize: 22, fontWeight: 900 }}>
            {pulse.sentiment === null ? "—" : pulse.sentiment > 0 ? `+${pulse.sentiment}` : pulse.sentiment}
          </div>
        </div>
      </div>

      <p style={{ color: "#bae6fd", margin: "14px 0 0", fontSize: 13, lineHeight: 1.45 }}>{impactLabel(pulse.forecastImpact)}</p>
      {pulse.latestHeadline && (
        <p style={{ color: "#cbd5e1", margin: "10px 0 0", fontSize: 13, lineHeight: 1.45 }}>{pulse.latestHeadline}</p>
      )}
    </section>
  );
}
