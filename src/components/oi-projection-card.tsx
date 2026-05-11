import { OIProjectionReport } from "../lib/oi-projection-engine";
import { safeFixed } from "../lib/format";

type Props = {
  report: OIProjectionReport | null;
};

function biasColor(bias: OIProjectionReport["projectedBias"]) {
  if (bias === "bullish") return "#15803d";
  if (bias === "bearish") return "#b91c1c";
  return "#6b7280";
}

export function OIProjectionCard({ report }: Props) {
  if (!report) {
    return (
      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
        <h3 style={{ marginTop: 0 }}>OI Implied Path</h3>
        <p style={{ color: "#6b7280", marginBottom: 0 }}>
          Fetch an option chain to build the forward OI path.
        </p>
      </section>
    );
  }

  return (
    <section style={{ border: "1px solid #4f46e5", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>OI Implied Path</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Ticker:</strong> {report.ticker}
        </div>
        <div>
          <strong>Snapshot:</strong> {report.snapshotDate}
        </div>
        <div>
          <strong>Bias:</strong>{" "}
          <span style={{ color: biasColor(report.projectedBias), fontWeight: 700 }}>
            {report.projectedBias.toUpperCase()}
          </span>
        </div>
        <div>
         <strong>Slope:</strong> {safeFixed(report?.slope, 4)} / day
        </div>
      </div>

      <p style={{ marginTop: 10 }}>{report.summary}</p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {[
                "Expiration",
                "DTE",
                "Raw Center",
                "Adjusted Center",
                "Lower",
                "Upper",
                "Call Wall",
                "Put Wall",
                "Score",
                "Anomalies"
              ].map((h) => (
                <th key={h} align="left" style={{ borderBottom: "1px solid #e5e7eb", padding: 4 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.points.map((p) => (
              <tr key={p.expiration}>
                <td style={{ padding: 4 }}>{p.expiration}</td>
                <td style={{ padding: 4 }}>{p.dte}</td>
                <td style={{ padding: 4 }}>{safeFixed(p?.rawCenter, 2)}</td>
                <td style={{ padding: 4, fontWeight: 700 }}>{safeFixed(p?.adjustedCenter, 2)}</td>
                <td style={{ padding: 4 }}>{safeFixed(p?.lowerRange, 2)}</td>
                <td style={{ padding: 4 }}>{safeFixed(p?.upperRange, 2)}</td>
                <td style={{ padding: 4 }}>{safeFixed(p?.callWall, 2)}</td>
                <td style={{ padding: 4 }}>{safeFixed(p?.putWall, 2)}</td>
                <td style={{ padding: 4 }}>{safeFixed(p?.prevailingScore, 2)}</td>
                <td style={{ padding: 4 }}>{p.anomalyCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}