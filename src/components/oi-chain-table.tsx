import { ChainRow } from "../lib/types";

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
                <td>{r.strike.toFixed(2)}</td>
                <td align="right">{r.callOi.toLocaleString()}</td>
                <td align="right">{r.putOi.toLocaleString()}</td>
                <td align="right">{(r.callVolume ?? 0).toLocaleString()}</td>
                <td align="right">{(r.putVolume ?? 0).toLocaleString()}</td>
                <td align="right">{(r.iv ?? 0).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
