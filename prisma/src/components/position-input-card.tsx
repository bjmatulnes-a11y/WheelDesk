import { PositionInputs } from "../lib/types";

type Props = {
  value: PositionInputs;
  onChange: (next: PositionInputs) => void;
};

export function PositionInputCard({ value, onChange }: Props) {
  const set = <K extends keyof PositionInputs>(key: K, next: PositionInputs[K]) => onChange({ ...value, [key]: next });

  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>Position Inputs</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0.6rem" }}>
        <label>Shares <input type="number" value={value.shares} onChange={(e) => set("shares", Number(e.target.value))} /></label>
        <label>Cost Basis <input type="number" value={value.costBasis} onChange={(e) => set("costBasis", Number(e.target.value))} /></label>
        <label>Short Call Strike <input type="number" value={value.shortCallStrike} onChange={(e) => set("shortCallStrike", Number(e.target.value))} /></label>
        <label>Short Call DTE <input type="number" value={value.shortCallDte} onChange={(e) => set("shortCallDte", Number(e.target.value))} /></label>
        <label>Cash Available <input type="number" value={value.cashAvailable} onChange={(e) => set("cashAvailable", Number(e.target.value))} /></label>
        <label>
          Market Bias
          <select value={value.marketBias} onChange={(e) => set("marketBias", e.target.value as PositionInputs["marketBias"])}>
            <option value="bullish">bullish</option>
            <option value="neutral">neutral</option>
            <option value="bearish">bearish</option>
          </select>
        </label>
        <label>
          Stock Bias
          <select value={value.stockBias} onChange={(e) => set("stockBias", e.target.value as PositionInputs["stockBias"])}>
            <option value="bullish">bullish</option>
            <option value="neutral">neutral</option>
            <option value="bearish">bearish</option>
          </select>
        </label>
      </div>
    </section>
  );
}
