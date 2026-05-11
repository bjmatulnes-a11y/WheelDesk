import { ExpirationChain } from "../lib/types";
import { safeFixed } from "../lib/format";
type Props = {
  snapshotDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  compareDate: string;
  onSelectCompareDate: (date: string) => void;
  chains: ExpirationChain[];
  selectedExpiration: string;
  onSelectExpiration: (exp: string) => void;
};

export function SnapshotSelector({
  snapshotDates,
  selectedDate,
  onSelectDate,
  compareDate,
  onSelectCompareDate,
  chains,
  selectedExpiration,
  onSelectExpiration
}: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
      <label>
        Surface Snapshot Day
        <select value={selectedDate} onChange={(e) => onSelectDate(e.target.value)}>
          {snapshotDates.map((date) => (
            <option key={`primary-${date}`} value={date}>{date}</option>
          ))}
        </select>
      </label>

      <label>
        Compare Surface Day
        <select value={compareDate} onChange={(e) => onSelectCompareDate(e.target.value)}>
          <option value="">None</option>
          {snapshotDates
            .filter((date) => date !== selectedDate)
            .map((date) => (
              <option key={`compare-${date}`} value={date}>{date}</option>
            ))}
        </select>
      </label>

      <label>
        Expiration Chain
        <select value={selectedExpiration} onChange={(e) => onSelectExpiration(e.target.value)} disabled={chains.length === 0}>
          {chains.length === 0 ? (
            <option value="">Fetch option chain first</option>
          ) : (
            chains.map((c) => {
              return (
              <option key={c.expiration} value={c.expiration}>
               {c.expiration} | score {safeFixed(c?.summary?.prevailingScore, 2)}
              </option>
              );
            })
          )}
        </select>
      </label>
    </div>
  );
}
