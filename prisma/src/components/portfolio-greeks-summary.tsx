import { AggregateGreeks } from "../lib/portfolio-types";

type Props = { summary: AggregateGreeks };

export function PortfolioGreeksSummary({ summary }: Props) {
  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.8rem" }}>
      <h3 style={{ marginTop: 0 }}>Aggregate Greeks</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div><strong>Δ</strong><div>{summary.delta.toFixed(2)}</div></div>
        <div><strong>Γ</strong><div>{summary.gamma.toFixed(4)}</div></div>
        <div><strong>Θ</strong><div>{summary.theta.toFixed(2)}</div></div>
        <div><strong>V</strong><div>{summary.vega.toFixed(2)}</div></div>
        <div><strong>P/L Day</strong><div>{summary.totalPlDay.toFixed(2)}</div></div>
        <div><strong>P/L Open</strong><div>{summary.totalPlOpen.toFixed(2)}</div></div>
        <div><strong>BP Effect</strong><div>{summary.totalBpEffect.toFixed(2)}</div></div>
      </div>
    </section>
  );
}

