import { DailyStructureSnapshot } from "./daily-structure-store";

export type StructureDriftDirection =
  | "bullish"
  | "bearish"
  | "compression"
  | "expansion"
  | "mixed"
  | "neutral";

export type DailyStructureDrift = {
  current: DailyStructureSnapshot;
  prior: DailyStructureSnapshot | null;

  supportDelta: number | null;
  resistanceDelta: number | null;
  magnetDelta: number;

  direction: StructureDriftDirection;
  notes: string[];
};

function delta(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null) return null;
  return current - prior;
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

export function buildDailyStructureDrift(args: {
  history: DailyStructureSnapshot[];
  selectedDate?: string;
}): DailyStructureDrift | null {
  const ordered = [...args.history].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  if (!ordered.length) return null;

  const current =
    args.selectedDate
      ? ordered.find((s) => s.snapshotDate === args.selectedDate) ?? ordered[0]
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
      direction: "neutral",
      notes: ["No prior daily structure snapshot exists yet."]
    };
  }

  const supportDelta = delta(current.support, prior.support);
  const resistanceDelta = delta(current.resistance, prior.resistance);
  const magnetDelta = current.magnet - prior.magnet;

  const notes: string[] = [];

  if (supportDelta != null) {
    notes.push(`Support moved ${fmt(prior.support)} → ${fmt(current.support)} (${supportDelta >= 0 ? "+" : ""}${supportDelta.toFixed(2)}).`);
  }

  if (resistanceDelta != null) {
    notes.push(`Resistance moved ${fmt(prior.resistance)} → ${fmt(current.resistance)} (${resistanceDelta >= 0 ? "+" : ""}${resistanceDelta.toFixed(2)}).`);
  }

  notes.push(`OI Magnet moved ${fmt(prior.magnet)} → ${fmt(current.magnet)} (${magnetDelta >= 0 ? "+" : ""}${magnetDelta.toFixed(2)}).`);

  let direction: StructureDriftDirection = "neutral";

  const supportUp = supportDelta != null && supportDelta > 0;
  const supportDown = supportDelta != null && supportDelta < 0;
  const resistanceUp = resistanceDelta != null && resistanceDelta > 0;
  const resistanceDown = resistanceDelta != null && resistanceDelta < 0;
  const magnetUp = magnetDelta > 0;
  const magnetDown = magnetDelta < 0;

  if (supportUp && resistanceUp && magnetUp) {
    direction = "bullish";
    notes.push("Structure drift is bullish: support, resistance, and magnet are shifting higher.");
  } else if (supportDown && resistanceDown && magnetDown) {
    direction = "bearish";
    notes.push("Structure drift is bearish: support, resistance, and magnet are shifting lower.");
  } else if (supportUp && resistanceDown) {
    direction = "compression";
    notes.push("Structure is compressing: support is rising while resistance is falling.");
  } else if (supportDown && resistanceUp) {
    direction = "expansion";
    notes.push("Structure is expanding: support is falling while resistance is rising.");
  } else if (magnetUp) {
    direction = "bullish";
    notes.push("Magnet drift is upward even though support/resistance are mixed.");
  } else if (magnetDown) {
    direction = "bearish";
    notes.push("Magnet drift is downward even though support/resistance are mixed.");
  } else {
    direction = "mixed";
    notes.push("Structure drift is mixed/neutral.");
  }

  return {
    current,
    prior,
    supportDelta,
    resistanceDelta,
    magnetDelta,
    direction,
    notes
  };
}