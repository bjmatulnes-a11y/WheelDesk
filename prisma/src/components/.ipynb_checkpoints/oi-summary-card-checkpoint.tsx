import { ExpirationSummary } from "../lib/types";

type Props = {
  summary: ExpirationSummary;
  currentPrice: number;
};

export function OISummaryCard({ summary, currentPrice }: Props) {
  const relation = currentPrice < summary.combinedCenter
    ? "below OI center"
    : currentPrice > summary.upperRange
      ? "above OI range"
      : "inside OI range";

  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>OI Summary ({summary.expiration})</h3>
      <ul>
        <li>Total Call OI: {summary.totalCallOi.toLocaleString()}</li>
        <li>Total Put OI: {summary.totalPutOi.toLocaleString()}</li>
        <li>Call Weighted Strike: {summary.callWeightedStrike.toFixed(2)}</li>
        <li>Put Weighted Strike: {summary.putWeightedStrike.toFixed(2)}</li>
        <li>Combined OI Center: {summary.combinedCenter.toFixed(2)}</li>
        <li>OI Range: {summary.lowerRange.toFixed(2)} - {summary.upperRange.toFixed(2)}</li>
        <li>Call Wall: {summary.callWall.toFixed(2)} | Put Wall: {summary.putWall.toFixed(2)}</li>
        <li>Price relation: <strong>{relation}</strong></li>
      </ul>
    </section>
  );
}
