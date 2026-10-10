import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { buildBasisSummary } from "../../../../lib/zeroDteBasis";
import {
  fetchFirstAvailableEsSeries,
  fetchHistoricalSeries,
  frontEsContractSymbol,
  uniqueSymbols,
} from "../../../../lib/zeroDteHistoryData";
import {
  buildCarriedPriorStructure,
  computeDailyStructure,
  computeOvernightLevels,
  computePriorCashSession,
  dateInTimeZone,
  previousTradingSessionDate,
  type PriorStructure,
  type PriorStructureLevel,
  zonedDateTimeToEpochMs,
} from "../../../../lib/zeroDtePriorStructure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CacheEntry = {
  value: PriorStructure;
  expiresAt: number;
};

const globalPriorStructure = globalThis as typeof globalThis & {
  __wheelDeskPriorStructureCache?: Map<string, CacheEntry>;
  __wheelDeskPriorStructureLoads?: Map<string, Promise<PriorStructure>>;
};

function cache() {
  return (globalPriorStructure.__wheelDeskPriorStructureCache ??= new Map());
}

function loads() {
  return (globalPriorStructure.__wheelDeskPriorStructureLoads ??= new Map());
}

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;

  const tradeDate = request.nextUrl.searchParams.get("tradeDate")?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return NextResponse.json(
      { ok: false, error: "tradeDate must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const key = `${access.access.user.id}:${tradeDate}`;
  const now = Date.now();
  const current = cache().get(key);
  if (current && current.expiresAt > now) {
    return response(current.value, "HIT");
  }

  const pending = loads().get(key);
  if (pending) {
    try {
      return response(await pending, "COALESCED");
    } catch (error) {
      return errorResponse(error);
    }
  }

  const load = buildPriorStructure(access.access.user.id, tradeDate);
  loads().set(key, load);
  try {
    const value = await load;
    cache().set(key, {
      value,
      expiresAt: priorStructureExpiry(tradeDate, now),
    });
    return response(value, "MISS");
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (loads().get(key) === load) loads().delete(key);
  }
}

async function buildPriorStructure(userId: string, tradeDate: string): Promise<PriorStructure> {
  const priorSessionDate = previousTradingSessionDate(tradeDate);
  const warnings: string[] = [];
  const spxSymbol = process.env.SCHWAB_SPX_SYMBOL?.trim() || "$SPX";
  const priorStart = zonedDateTimeToEpochMs(priorSessionDate, 8, 30);
  const priorEnd = zonedDateTimeToEpochMs(priorSessionDate, 15, 0) + 59_999;
  const tradeStart = zonedDateTimeToEpochMs(tradeDate, 8, 30);
  const tradeEnd = zonedDateTimeToEpochMs(tradeDate, 15, 0) + 59_999;

  const priorPromise = fetchHistoricalSeries({
    userId,
    symbol: spxSymbol,
    startDate: priorStart,
    endDate: priorEnd,
    extendedHours: false,
    frequencyType: "minute",
    frequency: 1,
    periodType: "day",
    period: 1,
  });
  const dailyPromise = fetchHistoricalSeries({
    userId,
    symbol: spxSymbol,
    extendedHours: false,
    frequencyType: "daily",
    frequency: 1,
    periodType: "month",
    period: 3,
  });
  // Query the selected trade date separately so Schwab's previousClose refers
  // to the session immediately preceding this trade date, including Mondays
  // and post-holiday sessions. Failure is non-fatal; the 1m close remains.
  const previousClosePromise = fetchHistoricalSeries({
    userId,
    symbol: spxSymbol,
    startDate: tradeStart,
    endDate: tradeEnd,
    extendedHours: false,
    frequencyType: "minute",
    frequency: 1,
    periodType: "day",
    period: 1,
  }).catch(() => null);

  const [priorSeries, dailySeries, selectedTradeSeries] = await Promise.all([
    priorPromise,
    dailyPromise,
    previousClosePromise,
  ]);

  const cash = computePriorCashSession({
    candles: priorSeries.candles,
    priorSessionDate,
    // Only the selected trade-date query can supply the immediately prior
    // session close. `priorSeries.previousClose` would be the session before
    // that (e.g. Thursday when the target prior session is Friday), so do not
    // use it as a fallback.
    previousClose: selectedTradeSeries?.previousClose ?? null,
  });
  warnings.push(...cash.warnings);

  const levels: PriorStructureLevel[] = [];
  addLevel(levels, "PDH", "PDH", cash.high, "PRIOR_DAY");
  addLevel(levels, "PDL", "PDL", cash.low, "PRIOR_DAY");
  addLevel(levels, "PDC", "PDC", cash.close, "PRIOR_DAY");
  addLevel(levels, "PDO", "PDO", cash.open, "PRIOR_DAY");
  addLevel(levels, "PD_MID", "PD MID", cash.mid, "PRIOR_DAY");
  levels.push(...buildCarriedPriorStructure(cash.candles, priorSessionDate));

  const daily = computeDailyStructure({
    dailyCandles: dailySeries.candles,
    tradeDate,
  });
  addLevel(levels, "PWH", "PW H", daily.priorWeekHigh, "WEEKLY");
  addLevel(levels, "PWL", "PW L", daily.priorWeekLow, "WEEKLY");
  if (daily.flipLevel !== null) {
    addLevel(
      levels,
      "DAILY_FLIP",
      daily.trend === "BULL" ? "Daily flip (HL)" : daily.trend === "BEAR" ? "Daily flip (LH)" : "Daily flip",
      daily.flipLevel,
      "DAILY",
    );
  }

  const esStart = zonedDateTimeToEpochMs(priorSessionDate, 14, 25);
  const esEnd = zonedDateTimeToEpochMs(tradeDate, 8, 30) + 59_999;
  const contract = frontEsContractSymbol(new Date(`${tradeDate}T17:00:00Z`));
  const esCandidates = uniqueSymbols([
    process.env.SCHWAB_ES_SYMBOL?.trim() || null,
    contract,
    "/ES",
  ]);
  const es = await fetchFirstAvailableEsSeries({
    userId,
    candidates: esCandidates,
    startDate: esStart,
    endDate: esEnd,
  });
  if (!es.series) warnings.push(...es.failures.map((failure) => `ES history: ${failure}`));

  const basisStart = Math.floor(zonedDateTimeToEpochMs(priorSessionDate, 14, 30) / 1000);
  const basisEnd = Math.floor(zonedDateTimeToEpochMs(priorSessionDate, 15, 0) / 1000) + 59;
  const basisSpx = cash.candles.filter((candle) => candle.time >= basisStart && candle.time <= basisEnd);
  const basisEs = (es.series?.candles ?? []).filter(
    (candle) => candle.time >= basisStart && candle.time <= basisEnd,
  );
  const basis = buildBasisSummary(basisEs, basisSpx, 90);
  if (basis.median === null) {
    warnings.push("ES→SPX basis unavailable; overnight levels could not be projected.");
  } else if ((basis.coveragePct ?? 0) < 50) {
    warnings.push(
      `ES→SPX basis coverage is ${Math.round(basis.coveragePct ?? 0)}%; ONH/ONL are approximate.`,
    );
  }

  levels.push(...computeOvernightLevels({
    esCandles: es.series?.candles ?? [],
    priorSessionDate,
    tradeDate,
    basisMedian: basis.median,
    basisCoveragePct: basis.coveragePct,
  }));

  return {
    tradeDate,
    priorSessionDate,
    levels: dedupeLevels(levels),
    daily: { trend: daily.trend, flipLevel: daily.flipLevel },
    basis: { median: basis.median, coveragePct: basis.coveragePct },
    warnings,
  };
}

function addLevel(
  levels: PriorStructureLevel[],
  id: string,
  label: string,
  price: number | null,
  kind: PriorStructureLevel["kind"],
) {
  if (typeof price !== "number" || !Number.isFinite(price)) return;
  levels.push({ id, label, price, kind });
}

function dedupeLevels(levels: PriorStructureLevel[]) {
  const byId = new Map<string, PriorStructureLevel>();
  for (const level of levels) byId.set(level.id, level);
  return [...byId.values()];
}

function priorStructureExpiry(tradeDate: string, now: number) {
  const todayCentral = dateInTimeZone(Math.floor(now / 1000));
  if (tradeDate !== todayCentral) return now + 12 * 60 * 60 * 1000;
  const open = zonedDateTimeToEpochMs(tradeDate, 8, 30);
  if (now < open) return Math.min(open, now + 60_000);
  // Once the cash session opens, prior-day/daily context and the completed
  // overnight range are frozen for the day.
  return now + 18 * 60 * 60 * 1000;
}

function response(value: PriorStructure, cacheStatus: string) {
  return NextResponse.json(
    { ok: true, ...value },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-WheelDesk-Prior-Structure-Cache": cacheStatus,
      },
    },
  );
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}
