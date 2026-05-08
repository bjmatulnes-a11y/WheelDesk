import { DailyStructureSnapshot } from "./daily-structure-store";

export type OISurfaceComparison = {
  current: DailyStructureSnapshot;
  prior: DailyStructureSnapshot | null;

  supportDelta: number | null;
  resistanceDelta: number | null;
  magnetDelta: number;

  slopeDelta: number;
  biasChange: string;

  direction: "bullish" | "bearish" | "compression" | "expansion" | "neutral";

  notes: string[];
};

export function buildOISurfaceComparison(
  history: DailyStructureSnapshot[],
  selectedDate?: string
): OISurfaceComparison | null {
  if (!history.length) return null;

  const ordered = [...history].sort((a, b) =>
    b.snapshotDate.localeCompare(a.snapshotDate)
  );

  const current =
    selectedDate
      ? ordered.find((s) => s.snapshotDate === selectedDate) ?? ordered[0]
      : ordered[0];

  const prior =
    ordered.find((s) => s.snapshotDate < current.snapshotDate) ?? null;

  if (!prior) {
    return {
      current,
      prior: null,
      supportDelta: null,
      resistanceDelta: null,
      magnetDelta: 0,
      slopeDelta: 0,
      biasChange: "N/A",
      direction: "neutral",
      notes: ["No prior structure snapshot."]
    };
  }

  const supportDelta =
    current.support != null && prior.support != null
      ? current.support - prior.support
      : null;

  const resistanceDelta =
    current.resistance != null && prior.resistance != null
      ? current.resistance - prior.resistance
      : null;

  const magnetDelta = current.magnet - prior.magnet;
  const slopeDelta = (current.slope ?? 0) - (prior.slope ?? 0);

  const notes: string[] = [];

  if (supportDelta != null)
    notes.push(`Support: ${prior.support} → ${current.support}`);

  if (resistanceDelta != null)
    notes.push(`Resistance: ${prior.resistance} → ${current.resistance}`);

  notes.push(`Magnet: ${prior.magnet.toFixed(2)} → ${current.magnet.toFixed(2)}`);
  notes.push(`Slope: ${prior.slope?.toFixed(4)} → ${current.slope?.toFixed(4)}`);

  let direction: OISurfaceComparison["direction"] = "neutral";

  if (supportDelta! > 0 && resistanceDelta! > 0) direction = "bullish";
  else if (supportDelta! < 0 && resistanceDelta! < 0) direction = "bearish";
  else if (supportDelta! > 0 && resistanceDelta! < 0) direction = "compression";
  else if (supportDelta! < 0 && resistanceDelta! > 0) direction = "expansion";

  return {
    current,
    prior,
    supportDelta,
    resistanceDelta,
    magnetDelta,
    slopeDelta,
    biasChange: `${prior.projectedBias ?? "neutral"} → ${current.projectedBias ?? "neutral"}`,
    direction,
    notes
  };
}