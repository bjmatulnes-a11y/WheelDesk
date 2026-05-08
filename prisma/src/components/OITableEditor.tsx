import type { OIRow } from "../lib/types";

type Props = {
  rows: OIRow[];
  onChange: (rows: OIRow[]) => void;
};

export function OITableEditor({ rows, onChange }: Props) {
  const update = (id: string, key: keyof OIRow, value: number) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const addRow = () => {
    onChange([
      ...rows,
      { id: `row-${Date.now()}`, callOi: 0, strike: rows.at(-1)?.strike ? rows.at(-1)!.strike + 5 : 100, putOi: 0 }
    ]);
  };

  const remove = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
  };

  return (
    <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
      <h2>Open Interest Table (manual)</h2>
      <p>Excel-style columns: A=Call OI, B=Strike, C=Put OI</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Call OI</th>
            <th align="left">Strike</th>
            <th align="left">Put OI</th>
            <th align="left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ borderTop: "1px solid #f0f0f0" }}>
              <td><input type="number" value={row.callOi} onChange={(e) => update(row.id, "callOi", Number(e.target.value))} /></td>
              <td><input type="number" value={row.strike} onChange={(e) => update(row.id, "strike", Number(e.target.value))} /></td>
              <td><input type="number" value={row.putOi} onChange={(e) => update(row.id, "putOi", Number(e.target.value))} /></td>
              <td><button onClick={() => remove(row.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} style={{ marginTop: "0.75rem" }}>Add Row</button>
    </section>
  );
}
