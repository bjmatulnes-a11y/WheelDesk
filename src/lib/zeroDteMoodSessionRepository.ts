import { supabaseServer } from "./supabase-server";
import type { ZeroDteMoodInput, ZeroDteMoodRead } from "./zeroDteMoodEngine";
import type { ZeroDteLeadershipRead } from "./zeroDteLeadershipEngine";
import type { ZeroDteBreadthSnapshot } from "./zeroDteBreadthAdapter";

export type PersistedZeroDteMoodSample = {
  tradeDate: string;
  minuteKey: number;
  sampledAt: string;
  calculationMode: string;
  input: ZeroDteMoodInput;
  read: ZeroDteMoodRead;
  leadership: ZeroDteLeadershipRead;
  breadth: ZeroDteBreadthSnapshot;
};

const memory = new Map<string, PersistedZeroDteMoodSample[]>();
const hydratedTradeDates = new Set<string>();

export async function loadZeroDteMoodHistory(
  tradeDate: string,
  limit = 120,
): Promise<PersistedZeroDteMoodSample[]> {
  if (hydratedTradeDates.has(tradeDate)) {
    return [...(memory.get(tradeDate) ?? [])].slice(-limit);
  }

  try {
    const { data, error } = await supabaseServer
      .from("zero_dte_mood_samples")
      .select("*")
      .eq("trade_date", tradeDate)
      .order("minute_key", { ascending: false })
      .limit(limit);
    if (!error && data) {
      const rows = data.map(rowToSample).reverse();
      memory.set(tradeDate, rows);
      hydratedTradeDates.add(tradeDate);
      return rows;
    }
    hydratedTradeDates.add(tradeDate);
  } catch {
    // Fall through to in-memory history when the migration has not run yet.
    // Mark the warm instance hydrated so a missing table does not trigger a
    // database request on every 0DTE refresh.
    hydratedTradeDates.add(tradeDate);
  }
  return [...(memory.get(tradeDate) ?? [])].slice(-limit);
}

export async function saveZeroDteMoodSample(
  sample: PersistedZeroDteMoodSample,
): Promise<void> {
  const current = memory.get(sample.tradeDate) ?? [];
  const next = [
    ...current.filter((item) => item.minuteKey !== sample.minuteKey),
    sample,
  ]
    .sort((a, b) => a.minuteKey - b.minuteKey)
    .slice(-240);
  memory.set(sample.tradeDate, next);

  try {
    await supabaseServer.from("zero_dte_mood_samples").upsert(
      {
        trade_date: sample.tradeDate,
        minute_key: sample.minuteKey,
        sampled_at: sample.sampledAt,
        calculation_mode: sample.calculationMode,
        raw_mood_percent: sample.read.rawMoodPercent,
        mood_percent: sample.read.moodPercent,
        input_json: sample.input,
        read_json: sample.read,
        leadership_json: sample.leadership,
        breadth_json: sample.breadth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "trade_date,minute_key" },
    );
  } catch {
    // In-memory persistence keeps the route usable during migration rollout.
  }
}

function rowToSample(row: any): PersistedZeroDteMoodSample {
  return {
    tradeDate: row.trade_date,
    minuteKey: Number(row.minute_key),
    sampledAt: row.sampled_at,
    calculationMode: row.calculation_mode,
    input: row.input_json ?? {},
    read: row.read_json ?? {},
    leadership: row.leadership_json ?? {},
    breadth: row.breadth_json ?? {},
  };
}
