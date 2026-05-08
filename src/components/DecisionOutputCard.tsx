import { DecisionOutput } from "../lib/types";

type Props = {
  decision: DecisionOutput;
};

export function DecisionOutputCard({ decision }: Props) {
  return (
    <section style={{ border: "1px solid #111", borderRadius: 8, padding: "1rem", background: "#fff" }}>
      <h2>Decision Engine Output</h2>
      <p><strong>Detected Mode:</strong> {decision.detectedMode}</p>
      <p><strong>Primary Action:</strong> {decision.primaryAction}</p>
      <p><strong>Covered Call Zone:</strong> {decision.coveredCallZone}</p>
      <p><strong>CSP Zone:</strong> {decision.cspZone}</p>
      <p><strong>Market Structure:</strong> {decision.marketStructureReadout}</p>
      <h3>Reasoning</h3>
      <ul>{decision.reasoningBullets.map((r) => <li key={r}>{r}</li>)}</ul>
      <h3>Risk Notes</h3>
      <ul>{decision.riskNotes.map((r) => <li key={r}>{r}</li>)}</ul>
    </section>
  );
}
