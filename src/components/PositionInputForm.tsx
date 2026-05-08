import type { PositionInputs } from "../lib/types";

type Props = {
  value: PositionInputs;
  onChange: (next: PositionInputs) => void;
};

export function PositionInputForm({ value, onChange }: Props) {
  const set = <K extends keyof PositionInputs>(key: K, nextValue: PositionInputs[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
      <h2>Position Inputs</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem" }}>
        <label>Ticker<input value={value.ticker ?? ""} onChange={(e) => set("ticker", e.target.value.toUpperCase())} /></label>
        <label>Shares<input type="number" value={value.shares} onChange={(e) => set("shares", Number(e.target.value))} /></label>
        <label>Cost Basis<input type="number" value={value.costBasis} onChange={(e) => set("costBasis", Number(e.target.value))} /></label>
        <label>Current Price<input type="number" value={value.currentPrice ?? ""} onChange={(e) => set("currentPrice", Number(e.target.value))} /></label>
        <label>Short Call Strike<input type="number" value={value.shortCallStrike} onChange={(e) => set("shortCallStrike", Number(e.target.value))} /></label>
        <label>Short Call DTE<input type="number" value={value.shortCallDte} onChange={(e) => set("shortCallDte", Number(e.target.value))} /></label>
        <label>Cash Available<input type="number" value={value.cashAvailable} onChange={(e) => set("cashAvailable", Number(e.target.value))} /></label>

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

        <label>SMA20<input type="number" value={value.sma20 ?? ""} onChange={(e) => set("sma20", Number(e.target.value))} /></label>
        <label>Upper Bollinger<input type="number" value={value.upperBollinger ?? ""} onChange={(e) => set("upperBollinger", Number(e.target.value))} /></label>
        <label>Lower Bollinger<input type="number" value={value.lowerBollinger ?? ""} onChange={(e) => set("lowerBollinger", Number(e.target.value))} /></label>
      </div>
    </section>
  );
}
