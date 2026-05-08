import { DecisionOutput } from "../lib/types";

type Props = { decision: DecisionOutput };

export function DecisionCard({ decision }: Props) {
  return (
    <section style={{ border: "1px solid #111827", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>Market Structure Decision</h3>
      <p><strong>Mode:</strong> {decision.detectedMode}</p>
      <p><strong>Primary Action:</strong> {decision.primaryAction}</p>
      <p><strong>Covered Call Zone:</strong> {decision.coveredCallZone}</p>
      <p><strong>CSP Zone:</strong> {decision.cspZone}</p>
      <p><strong>Structure Readout:</strong> {decision.marketStructureReadout}</p>

      <h4>Reasoning</h4>
      <ul>{decision.reasoningBullets.map((r) => <li key={r}>{r}</li>)}</ul>

      <h4>Risk Notes</h4>
      <ul>{decision.riskNotes.map((r) => <li key={r}>{r}</li>)}</ul>
    </section>
  );
}