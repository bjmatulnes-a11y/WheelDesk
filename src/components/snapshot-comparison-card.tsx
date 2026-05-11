import { SnapshotComparison, SnapshotComparisonResult } from "../lib/types";
import { safeFixed, safeInt } from "../lib/format";
type Props = {
  comparison: SnapshotComparison | null;
  reason: SnapshotComparisonResult["reason"];
  message: string;
};

export function SnapshotComparisonCard({ comparison, reason, message }: Props) {
  const renderMoves = (title: string, items: Array<{ strike: number; delta: number }>) => (
    <>
      <h4 style={{ marginBottom: 4 }}>{title}</h4>
      {items.length ? (
        <ul style={{ marginTop: 4 }}>
          {items.map((move) => (
            <li key={`${title}-${move.strike}`}>
  Strike {safeFixed(move?.strike, 2)}:{" "}
  {Number(move?.delta) > 0 ? "+" : ""}
  {move?.delta ?? "N/A"}
</li>
          ))}
        </ul>
      ) : (
        <p style={{ marginTop: 4 }}>No material changes.</p>
      )}
    </>
  );

  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>Snapshot Comparison</h3>
      {!comparison ? (
        <div>
          <p style={{ marginBottom: 4 }}><strong>No comparison:</strong> {message}</p>
          <p style={{ marginTop: 0, color: "#6b7280" }}>Reason code: <code>{reason}</code></p>
        </div>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{comparison.ticker}</strong> current {comparison.currentSnapshotDate} vs prior {comparison.priorSnapshotDate}
          </p>
          <p style={{ marginTop: 0 }}>
            Expiration requested: {comparison.selectedExpiration} • used current {comparison.currentExpirationUsed} vs prior {comparison.priorExpirationUsed}
            {" "}• {comparison.comparisonMatchType === "exact" ? "Exact match" : "Fallback match"}
          </p>
          <p style={{ marginTop: 0, color: "#4b5563" }}>{comparison.comparisonNotes}</p>
          <h4 style={{ marginBottom: 4 }}>What changed?</h4>
          <ul>
            <li>Total Call OI Δ: {safeInt(comparison?.totalCallOiDelta)}</li>
            <li>Total Put OI Δ: {safeInt(comparison?.totalPutOiDelta)}</li>
            <li>Call Weighted Strike Δ: {safeFixed(comparison?.callWeightedStrikeDelta, 2)}</li>
            <li>Put Weighted Strike Δ: {safeFixed(comparison?.putWeightedStrikeDelta, 2)}</li>
            <li>OI Center Δ: {safeFixed(comparison?.oiCenterDelta, 2)}</li>
            <li>OI Lower Range Δ: {safeFixed(comparison?.lowerRangeDelta, 2)}</li>
            <li>OI Upper Range Δ: {safeFixed(comparison?.upperRangeDelta, 2)}</li>
            <li>Call Wall Δ: {safeFixed(comparison?.callWallDelta, 2)}</li>
            <li>Put Wall Δ: {safeFixed(comparison?.putWallDelta, 2)}</li>
            <li>OI Range Width Δ: {safeFixed(comparison?.oiRangeWidthDelta, 2)}</li>
          </ul>
          <h4 style={{ marginBottom: 4 }}>What does it mean?</h4>
          <ul>
            <li>Structural Direction: {comparison.interpretation.structuralDirection}</li>
            <li>Support: {comparison.interpretation.supportState}</li>
            <li>Resistance: {comparison.interpretation.resistanceState}</li>
            <li>Structural State: {comparison.interpretation.structuralState}</li>
            <li>Overall Bias: {comparison.interpretation.overallBias}</li>
          </ul>
          <p style={{ marginTop: 0 }}>{comparison.interpretation.narrative}</p>
          <p style={{ marginTop: 0 }}><strong>Implication:</strong> {comparison.interpretation.tacticalImplication}</p>
          <h4 style={{ marginBottom: 4 }}>Tactical Adjustment</h4>
          <p style={{ marginTop: 0 }}>{comparison.tacticalDecision.tacticalSummary}</p>
          <ul>
            {comparison.tacticalDecision.recommendedActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          {comparison.tacticalDecision.cautionFlags.length > 0 && (
            <>
              <h4 style={{ marginBottom: 4 }}>Caution Flags</h4>
              <ul>
                {comparison.tacticalDecision.cautionFlags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </>
          )}
          <h4 style={{ marginBottom: 4 }}>Execution Plan</h4>
         <p style={{ marginTop: 0 }}>
  <strong>CSP candidates:</strong>{" "}
  {safeFixed(comparison?.executionPlan?.cspCandidateRange?.low, 2)} -{" "}
  {safeFixed(comparison?.executionPlan?.cspCandidateRange?.high, 2)}
</p>

<p style={{ marginTop: 0 }}>
  <strong>Covered call candidates:</strong>{" "}
  {safeFixed(comparison?.executionPlan?.coveredCallCandidateRange?.low, 2)} -{" "}
  {safeFixed(comparison?.executionPlan?.coveredCallCandidateRange?.high, 2)}
</p>
          <p style={{ marginTop: 0 }}><strong>Confidence:</strong> {comparison.executionPlan.confidence}</p>
          <p style={{ marginTop: 0 }}>{comparison.executionPlan.executionSummary}</p>
          <h4 style={{ marginBottom: 4 }}>Triggers</h4>
          <ul>
            {comparison.executionPlan.conditionalTriggers.slice(0, 4).map((trigger) => (
              <li key={trigger}>{trigger}</li>
            ))}
          </ul>
          <h4 style={{ marginBottom: 4 }}>Time Guidance</h4>
          <ul>
            {comparison.executionPlan.timeGuidance.slice(0, 3).map((guide) => (
              <li key={guide}>{guide}</li>
            ))}
          </ul>
          <h4 style={{ marginBottom: 4 }}>Execution Notes</h4>
          <ul>
            {comparison.executionPlan.executionNotes.slice(0, 3).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              {renderMoves("Top Call OI Increases", comparison.topCallOiIncreases)}
              {renderMoves("Top Call OI Decreases", comparison.topCallOiDecreases)}
            </div>
            <div>
              {renderMoves("Top Put OI Increases", comparison.topPutOiIncreases)}
              {renderMoves("Top Put OI Decreases", comparison.topPutOiDecreases)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
