import { EnrichedPortfolioPosition, PortfolioPosition } from "../lib/portfolio-types";

type Props = {
  positions: EnrichedPortfolioPosition[];
  onChange: (positions: PortfolioPosition[]) => void;
};

const blankPosition = (): PortfolioPosition => ({
  id: `pos-${Date.now()}`,
  symbol: "",
  instrumentType: "stock",
  qty: undefined,
  side: "long",
  expiration: "",
  strike: undefined,
  entryPrice: undefined,
  manualIv: undefined,
  includeInRiskProfile: true,
  riskFreeRate: 0.045,
  bpEffect: undefined,
  yieldPct: undefined
});

function numDisplay(value?: number, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "";
}

export function PortfolioPositionsTable({ positions, onChange }: Props) {
  const set = <K extends keyof PortfolioPosition>(
    id: string,
    key: K,
    value: PortfolioPosition[K]
  ) => {
    onChange(positions.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
  };

  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Positions</h3>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {[
              "Use",
              "Symbol",
              "Type",
              "Qty",
              "Side",
              "Underlying Px",
              "Expiration",
              "Strike",
              "Entry",
              "Mark",
              "Delta",
              "Gamma",
              "Theta",
              "Vega",
              "IV",
              "P/L day",
              "P/L open",
              "BP effect",
              "Yield",
              ""
            ].map((h) => (
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
          {positions.map((p) => {
            const isStock = p.instrumentType === "stock";

            return (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={p.includeInRiskProfile !== false}
                    onChange={(e) =>
                      set(p.id, "includeInRiskProfile", e.target.checked)
                    }
                  />
                </td>

                <td>
                  <input
                    value={p.symbol}
                    placeholder="SOFI"
                    onChange={(e) => set(p.id, "symbol", e.target.value.toUpperCase())}
                    style={{ width: 70 }}
                  />
                </td>

                <td>
                  <select
                    value={p.instrumentType}
                    onChange={(e) =>
                      set(
                        p.id,
                        "instrumentType",
                        e.target.value as PortfolioPosition["instrumentType"]
                      )
                    }
                  >
                    <option>stock</option>
                    <option>call</option>
                    <option>put</option>
                  </select>
                </td>

                <td>
                  <input
                    type="number"
                    value={p.qty ?? ""}
                    onChange={(e) =>
                      set(p.id, "qty", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    style={{ width: 60 }}
                  />
                </td>

                <td>
                  <select
                    value={p.side}
                    onChange={(e) => set(p.id, "side", e.target.value as PortfolioPosition["side"])}
                  >
                    <option>long</option>
                    <option>short</option>
                  </select>
                </td>

                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.currentUnderlyingPrice, 2)}
                </td>

                <td>
                  <input
                    type="date"
                    value={p.expiration ?? ""}
                    onChange={(e) => set(p.id, "expiration", e.target.value || undefined)}
                    style={{ width: 138 }}
                    disabled={isStock}
                  />
                </td>

                <td>
                  <input
                    type="number"
                    value={p.strike ?? ""}
                    onChange={(e) =>
                      set(
                        p.id,
                        "strike",
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                    style={{ width: 70 }}
                    disabled={isStock}
                  />
                </td>

                <td>
                  <input
                    type="number"
                    value={p.entryPrice ?? ""}
                    onChange={(e) =>
                      set(
                        p.id,
                        "entryPrice",
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                    style={{ width: 75 }}
                  />
                </td>

                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.mark, 2)}
                </td>

                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.delta, 2)}
                </td>
                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.gamma, 4)}
                </td>
                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.theta, 2)}
                </td>
                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.vega, 2)}
                </td>

                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={p.manualIv ?? ""}
                    onChange={(e) =>
                      set(
                        p.id,
                        "manualIv",
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                    placeholder={numDisplay(p.iv, 2)}
                    style={{ width: 58 }}
                    disabled={isStock}
                  />
                </td>

                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.plDay, 2)}
                </td>

                <td style={{ textAlign: "right", paddingRight: 6 }}>
                  {numDisplay(p.plOpen, 2)}
                </td>

                <td>
                  <input
                    type="number"
                    value={p.bpEffect ?? ""}
                    onChange={(e) =>
                      set(
                        p.id,
                        "bpEffect",
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                    style={{ width: 70 }}
                  />
                </td>

                <td>
                  <input
                    type="number"
                    value={p.yieldPct ?? ""}
                    onChange={(e) =>
                      set(
                        p.id,
                        "yieldPct",
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                    style={{ width: 60 }}
                  />
                </td>

                <td>
                  <button onClick={() => onChange(positions.filter((x) => x.id !== p.id))}>
                    x
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button style={{ marginTop: 8 }} onClick={() => onChange([...positions, blankPosition()])}>
        Add Position
      </button>
    </section>
  );
}