import type { OIMetrics } from "../lib/types";
import { safeFixed, safeInt } from "../lib/format";

type Props = {
  oi: OIMetrics;
};

export function OIInterpretationCard({ oi }: Props) {
  return (
    <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
      <h2>OI Interpretation</h2>
      <ul>
        <li>Total Call OI: {safeInt(oi?.totalCallOi)}</li>
        <li>Total Put OI: {safeInt(oi?.totalPutOi)}</li>
        <li>Call Weighted Strike: {safeFixed(oi?.callWeightedStrike, 2)}</li>
        <li>Put Weighted Strike: {safeFixed(oi?.putWeightedStrike, 2)}</li>
        <li>Combined OI Center: {safeFixed(oi?.combinedCenter, 2)}</li>
        <li>OI Lower Range: {safeFixed(oi?.lowerRange, 2)}</li>
        <li>OI Upper Range: {safeFixed(oi?.upperRange, 2)}</li>
      </ul>
      <p>
        <strong>Price relation:</strong> {oi.priceRelation.replaceAll("_", " ")}
      </p>
      <p>
        {oi.priceRelation === "below_oi_center" && "Market structure lean: defensive, watch downside pressure around center reclaim."}
        {oi.priceRelation === "inside_oi_range" && "Market structure lean: balanced positioning zone; premium harvesting conditions."}
        {oi.priceRelation === "above_oi_range" && "Market structure lean: upside extension; assignment and roll management is priority."}
      </p>
    </section>
  );
}
