import { RankedCandidate } from "../lib/analytics/types";
import { safeFixed, safePct } from "../lib/format";

type Props = { title: string; items: RankedCandidate[] };

export function CandidateTable({ title, items }: Props) {
  return (
    <section style={{ marginTop: "1rem" }}>
      <h3>{title}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Symbol</th>
            <th align="left">Strike</th>
            <th align="left">DTE</th>
            <th align="left">Ann. Yield</th>
            <th align="left">Risk</th>
            <th align="left">Score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={`${item.contract.symbol}-${idx}`} style={{ borderTop: "1px solid #eee" }}>
              <td>{item.contract.symbol}</td>
              <td>{item.contract.strike}</td>
              <td>{item.contract.dte}</td>
              <td>{safePct(Number(item.annualizedYield) * 100, 2)}</td>
              <td>{item.assignmentRiskBand}</td>
              <td>{safeFixed(item.score, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
