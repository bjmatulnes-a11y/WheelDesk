import { PriceSlice, SliceResult } from "../lib/portfolio-types";

type Props = {
  slices: PriceSlice[];
  results: SliceResult[];
  onChangeSlices: (next: PriceSlice[]) => void;
  onQuickAdd: () => void;
};

function displayNumber(value?: number, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "";
}

export function PriceSlicesTable({
  slices,
  results,
  onChangeSlices,
  onQuickAdd
}: Props) {
  const update = (id: string, price?: number) =>
    onChangeSlices(
      slices.map((s) =>
        s.id === id ? { ...s, underlyingPrice: price } : s
      )
    );

  const addBlankSlice = () =>
    onChangeSlices([...slices, { id: `slice-${Date.now()}`, underlyingPrice: undefined }]);

  const resultsById = Object.fromEntries(results.map((r) => [r.id, r]));

  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Price Slices</h3>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={addBlankSlice}>Add Slice</button>
        <button onClick={onQuickAdd}>Quick-add from structure</button>
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12
        }}
      >
        <thead>
          <tr>
            {["Price", "Δ", "Γ", "Θ", "V", "P/L", "Theo Net Liq", "BP", ""].map((h) => (
              <th
                key={h}
                align="left"
                style={{ borderBottom: "1px solid #e5e7eb", padding: 4 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {slices.map((slice) => {
            const result = resultsById[slice.id] as SliceResult | undefined;

            return (
              <tr key={slice.id}>
                <td>
                  <input
                    type="number"
                    value={slice.underlyingPrice ?? ""}
                    placeholder=""
                    onChange={(e) =>
                      update(
                        slice.id,
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                  />
                </td>

                <td>{displayNumber(result?.delta, 2)}</td>
                <td>{displayNumber(result?.gamma, 4)}</td>
                <td>{displayNumber(result?.theta, 2)}</td>
                <td>{displayNumber(result?.vega, 2)}</td>
                <td>{displayNumber(result?.plAtSlice, 2)}</td>
                <td>{displayNumber(result?.theoreticalNetLiq, 2)}</td>
                <td>{displayNumber(result?.bpEffect, 2)}</td>

                <td>
                  <button onClick={() => onChangeSlices(slices.filter((s) => s.id !== slice.id))}>
                    x
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}