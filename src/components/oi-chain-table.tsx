import { ChainRow } from "../lib/types";
import { safeFixed, safeInt } from "../lib/format";
type Props = { rows: ChainRow[] };

export function OIChainTable({ rows }: Props) {
  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.8rem" }}>
      <h3 style={{ marginTop: 0 }}>Option Chain Open Interest Table</h3>
      <div style={{ maxHeight: 220, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Strike</th>
              <th align="right">Call OI</th>
              <th align="right">Put OI</th>
              <th align="right">Call Vol</th>
              <th align="right">Put Vol</th>
              <th align="right">IV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.strike} style={{ borderTop: "1px solid #eee" }}>
                <td>{safeFixed(r.strike, 2)}</td>
                <td align="right">{safeInt(r?.callOi)}</td>
                <td align="right">{safeInt(r?.putOi)}</td>
                <td align="right">{safeInt(r?.callVolume)}</td>
                <td align="right">{safeInt(r?.putVolume)}</td>
                <td align="right">{safeFixed(r?.iv, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
