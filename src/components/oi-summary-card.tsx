import { ExpirationSummary } from "../lib/types";
import { safeFixed } from "../lib/format";

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
        <li>Call Weighted Strike: {safeFixed(summary?.callWeightedStrike, 2)}</li>
        <li>Put Weighted Strike: {safeFixed(summary?.putWeightedStrike, 2)}</li>
        <li>Combined OI Center: {safeFixed(summary?.combinedCenter, 2)}</li>
        <li>
              OI Range: {safeFixed(summary?.lowerRange, 2)} - {safeFixed(summary?.upperRange, 2)}
        </li>
<li>
  Call Wall: {safeFixed(summary?.callWall, 2)} | Put Wall: {safeFixed(summary?.putWall, 2)}
</li>
        <li>Price relation: <strong>{relation}</strong></li>
      </ul>
    </section>
  );
}
