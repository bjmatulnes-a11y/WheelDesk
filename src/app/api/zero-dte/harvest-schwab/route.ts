import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import {
  buildZeroDteRecommendation,
  type ZeroDteChainRow,
} from "../../../../lib/zeroDteOiIntelligence";
import type { ZeroDteManualMoodMode } from "../../../../lib/zeroDteMoodEngine";
import { buildZeroDteMoodSessionRead } from "../../../../lib/zeroDteMoodSessionEngine";
import { loadZeroDteMoodMarketData } from "../../../../lib/zeroDteMoodMarketData";
import { buildZeroDteTradeSelection } from "../../../../lib/zeroDteTradeSelector";
import { fetchSchwabOptionChain } from "../../../../lib/schwab/client";
import type {
  SchwabHarvestSymbol,
  SchwabOptionChainResponse,
  SchwabOptionContract,
} from "../../../../lib/schwab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type QualityCheck = {
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(request);
  const generatedAt = new Date().toISOString();
  const tradeDate =
    request.nextUrl.searchParams.get("date") ?? nyDateString(new Date());
  const rangePct = numberParam(request, "rangePct", 0.045);
  const manualExpectedMove = numberParam(request, "expectedMove", 0);
  const manualMood = optionalNumberParam(request, "mood");
  const manualMoodMode: ZeroDteManualMoodMode =
    request.nextUrl.searchParams.get("moodMode") === "force"
      ? "force"
      : "fallback";
  const maxWidth = optionalNumberParam(request, "maxWidth") ?? 50;
  const maxRiskDollars = optionalNumberParam(request, "maxRisk");
  const minCredit = optionalNumberParam(request, "minCredit");
  // This route powers the SPX 0DTE engine. Strict same-day expiration is the
  // safe default; callers must never silently fall forward to 1–7 DTE.
  const strictZeroDte = request.nextUrl.searchParams.get("strict") !== "0";
  const manualExpiration = dateParam(request, "expiration");
  const anchorTradeDate = dateParam(request, "anchorTradeDate");
  const spxAnchor = anchorTradeDate === tradeDate
    ? optionalNumberParam(request, "spxAnchor")
    : null;
  const spyAnchor = anchorTradeDate === tradeDate
    ? optionalNumberParam(request, "spyAnchor")
    : null;
  const researchMode = Boolean(
    manualExpiration && manualExpiration !== tradeDate,
  );
  const riskMode = riskModeParam(request);
  const includeTradeSelection = request.nextUrl.searchParams.get("selection") !== "0";
  const errors: string[] = [];

  let spx: SchwabHarvestSymbol | undefined;
  let spy: SchwabHarvestSymbol | undefined;

  // SPX and SPY are independent provider requests. Run them together so the
  // five-second chart cadence is not needlessly exposed to sequential chain
  // latency. Partial failures are still reported independently below.
  const [spxResult, spyResult] = await Promise.allSettled([
    harvestSchwabSymbol({
      userId: user.id,
      symbol: "SPX",
      providerSymbol: process.env.SCHWAB_SPX_SYMBOL?.trim() || "$SPX",
      tradeDate,
      rangePct,
      strictZeroDte,
      expirationDate: manualExpiration,
      anchorSpot: spxAnchor,
    }),
    harvestSchwabSymbol({
      userId: user.id,
      symbol: "SPY",
      providerSymbol: process.env.SCHWAB_SPY_SYMBOL?.trim() || "SPY",
      tradeDate,
      rangePct,
      strictZeroDte,
      expirationDate: manualExpiration,
      anchorSpot: spyAnchor,
    }),
  ]);

  if (spxResult.status === "fulfilled") spx = spxResult.value;
  else errors.push(`SPX harvest failed: ${message(spxResult.reason)}`);

  if (spyResult.status === "fulfilled") spy = spyResult.value;
  else errors.push(`SPY harvest failed: ${message(spyResult.reason)}`);

  if (!spx?.rows.length) errors.push("No SPX option rows available after Schwab filtering.");
  if (!spy?.rows.length) errors.push("No SPY option rows available after Schwab filtering.");

  const recommendation =
    spx?.rows.length && spy?.rows.length
      ? buildZeroDteRecommendation({
          spxPrice: spx.price,
          spyPrice: spy.price,
          spxRows: spx.rows,
          spyRows: spy.rows,
          manualExpectedMove: manualExpectedMove > 0 ? manualExpectedMove : null,
        })
      : undefined;

  let mood;
  let leadership;
  let breadth;
  if (recommendation && spx) {
    try {
      const marketData = await loadZeroDteMoodMarketData({
        userId: user.id,
        tradeDate,
        generatedAt,
        spxProviderSymbol: spx.providerSymbol,
        spxCurrent: spx.price,
        requestValues: {
          tick: optionalNumberParam(request, "tick") ?? undefined,
          uvol: optionalNumberParam(request, "uvol") ?? undefined,
          dvol: optionalNumberParam(request, "dvol") ?? undefined,
          advanceDecline:
            optionalNumberParam(request, "advanceDecline") ?? undefined,
        },
      });
      leadership = marketData.leadership;
      breadth = marketData.breadth;
      mood = await buildZeroDteMoodSessionRead({
        tradeDate,
        generatedAt,
        leadership,
        breadth,
        spxCandles: marketData.spxCandles,
        manualMoodPercent: manualMood,
        manualMoodMode,
        optionChainCoverage: "full",
        averageLength: 5,
        smoothingLength: 3,
      });
    } catch (error) {
      errors.push(`SPX Mood calculation failed: ${message(error)}`);
    }
  }

  const tradeSelection =
    includeTradeSelection && recommendation && spx
      ? buildZeroDteTradeSelection({
          recommendation,
          spxRows: spx.rows,
          mood: mood ?? null,
          spreadWidth: maxWidth,
          maxWidth,
          minWidth: 5,
          maxRiskDollars,
          minCredit,
          minCreditToRiskPct: null,
          riskMode,
        })
      : undefined;

  const qualityChecks = buildQualityChecks(
    tradeDate,
    spx,
    spy,
    manualExpiration,
  );
  if (leadership) {
    qualityChecks.push({
      label: "Leadership",
      status: leadership.quoteCoveragePct >= 90 ? "ok" : leadership.quoteCoveragePct >= 50 ? "warn" : "fail",
      message: `${leadership.availableCount}/${leadership.selectedCount} constituents · ${leadership.quoteCoveragePct.toFixed(0)}% selected-weight coverage.`,
    });
  }
  if (breadth) {
    qualityChecks.push({
      label: "SPX Breadth",
      status: breadth.coverage === "FULL" ? "ok" : "warn",
      message:
        breadth.source === "SCHWAB_SPX_UNIVERSE"
          ? `${breadth.coverage} · Schwab native · ${breadth.quotedCount ?? 0}/${breadth.universeCount ?? 0} quotes · TICK ${breadth.tick == null ? "warming" : breadth.tick}.`
          : `${breadth.coverage} · ${breadth.source.replaceAll("_", " ")}.`,
    });
  }
  if (mood) {
    qualityChecks.push({
      label: "SPX Mood",
      status: mood.coverage.status === "FULL" ? "ok" : mood.coverage.status === "UNAVAILABLE" ? "warn" : "warn",
      message: `${mood.calculationMode.replaceAll("_", " ")} · ${mood.coverage.status} · ${mood.moodPercent == null ? "no value" : `${mood.moodPercent.toFixed(1)}%`}.`,
    });
  }
  const hasFail = qualityChecks.some((item) => item.status === "fail");
  const hasWarn = qualityChecks.some((item) => item.status === "warn");
  const status = recommendation
    ? hasFail
      ? "error"
      : errors.length || hasWarn
        ? "partial"
        : "ok"
    : "error";

  return json(
    {
      tradeDate,
      generatedAt,
      manualExpiration,
      researchMode,
      status,
      spx,
      spy,
      recommendation,
      mood,
      leadership,
      breadth,
      tradeSelection,
      errors,
      qualityChecks,
      provider: "schwab",
    },
    status === "error" ? 502 : 200,
  );
}

async function harvestSchwabSymbol(args: {
  userId: string;
  symbol: "SPX" | "SPY";
  providerSymbol: string;
  tradeDate: string;
  rangePct: number;
  strictZeroDte: boolean;
  expirationDate: string | null;
  anchorSpot?: number | null;
}): Promise<SchwabHarvestSymbol> {
  const requestedDate = args.expirationDate ?? args.tradeDate;
  const toDate = args.expirationDate
    ? requestedDate
    : addDays(args.tradeDate, args.strictZeroDte ? 0 : 7);
  const chain = await fetchSchwabOptionChain({
    userId: args.userId,
    symbol: args.providerSymbol,
    fromDate: requestedDate,
    toDate,
    // Keep enough raw strikes to preserve a fixed session-anchored structural
    // universe even after a meaningful intraday move.
    strikeCount: args.anchorSpot && args.anchorSpot > 0 ? 240 : 160,
  });

  // Manual expiration is an exact research-chain request. Auto mode retains
  // the strict 0DTE behavior used by the live execution engine.
  const expiration = chooseExpiration(
    chain,
    requestedDate,
    args.expirationDate ? true : args.strictZeroDte,
  );
  const price = finite(chain.underlyingPrice);
  if (!price || price <= 0) {
    throw new Error(`Schwab returned no usable underlying price for ${args.providerSymbol}.`);
  }

  const rangeCenter =
    args.anchorSpot && Number.isFinite(args.anchorSpot) && args.anchorSpot > 0
      ? args.anchorSpot
      : price;
  const minStrike = rangeCenter * (1 - args.rangePct);
  const maxStrike = rangeCenter * (1 + args.rangePct);
  const calls = contractsForExpiration(chain.callExpDateMap, expiration.key);
  const puts = contractsForExpiration(chain.putExpDateMap, expiration.key);

  const rows = [
    ...calls.map((contract) => mapContract(args.symbol, "call", contract)),
    ...puts.map((contract) => mapContract(args.symbol, "put", contract)),
  ]
    .filter((row) => row.strike >= minStrike && row.strike <= maxStrike)
    .filter(
      (row) =>
        (row.openInterest ?? 0) > 0 ||
        (row.volume ?? 0) > 0 ||
        (row.bid ?? 0) > 0 ||
        (row.ask ?? 0) > 0,
    )
    .sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType));

  if (!rows.length) {
    throw new Error(
      `No usable ${args.providerSymbol} contracts inside ±${(
        args.rangePct * 100
      ).toFixed(1)}% of structural anchor ${rangeCenter.toFixed(2)}.`,
    );
  }

  return {
    symbol: args.symbol,
    providerSymbol: args.providerSymbol,
    price,
    expirationTimestamp: expirationTimestampEastern(expiration.date),
    expirationDate: expiration.date,
    isZeroDte: expiration.date === args.tradeDate,
    rows,
    source: "schwab",
  };
}

function chooseExpiration(
  chain: SchwabOptionChainResponse,
  tradeDate: string,
  strict: boolean,
) {
  const keys = new Set<string>();
  Object.keys(chain.callExpDateMap ?? {}).forEach((key) => keys.add(key));
  Object.keys(chain.putExpDateMap ?? {}).forEach((key) => keys.add(key));

  const expirations = [...keys]
    .map((key) => ({ key, date: key.split(":")[0] }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const exact = expirations.find((item) => item.date === tradeDate);
  if (exact) return exact;

  if (!strict) {
    const next = expirations.find((item) => item.date > tradeDate);
    if (next) return next;
  }

  throw new Error(
    `No ${strict ? "exact 0DTE" : "same-day or future"} expiration for ${tradeDate}. Available: ${
      expirations.slice(0, 8).map((item) => item.date).join(", ") || "none"
    }`,
  );
}

function contractsForExpiration(
  map: Record<string, Record<string, SchwabOptionContract[]>> | undefined,
  expirationKey: string,
) {
  return Object.values(map?.[expirationKey] ?? {}).flat();
}

function mapContract(
  symbol: "SPX" | "SPY",
  optionType: "call" | "put",
  contract: SchwabOptionContract,
): ZeroDteChainRow {
  const bid = finite(contract.bid);
  const ask = finite(contract.ask);
  const mark = finite(contract.mark);
  const last = finite(contract.last);
  // Missing quotes stay missing. Last trade can be hours stale in 0DTE wings
  // and is informational only; it is never promoted into a live mark.
  const mid =
    mark ??
    (bid !== null && ask !== null && bid >= 0 && ask > 0 && ask >= bid
      ? (bid + ask) / 2
      : null);

  return {
    symbol,
    optionType,
    strike: finite(contract.strikePrice) ?? 0,
    expiration: contract.expirationDate ?? "",
    iv: finite(contract.volatility),
    openInterest: finite(contract.openInterest),
    volume: finite(contract.totalVolume),
    bid,
    ask,
    mid,
    last,
    delta: finite(contract.delta),
    gamma: finite(contract.gamma),
    theta: finite(contract.theta),
    vega: finite(contract.vega),
  };
}

function buildQualityChecks(
  tradeDate: string,
  spx?: SchwabHarvestSymbol,
  spy?: SchwabHarvestSymbol,
  manualExpiration?: string | null,
): QualityCheck[] {
  const checks: QualityCheck[] = [];

  checks.push({
    label: "Provider",
    status: "ok",
    message: "Schwab Trader API market data is active.",
  });

  const expectedExpiration = manualExpiration ?? tradeDate;
  const expirationMatches =
    spx?.expirationDate === expectedExpiration &&
    spy?.expirationDate === expectedExpiration;

  checks.push(
    expirationMatches
      ? manualExpiration && manualExpiration !== tradeDate
        ? {
            label: "Expiration",
            status: "warn",
            message: `Manual research chain ${manualExpiration} selected. Scanner/structure analytics are active; live 0DTE execution remains disabled.`,
          }
        : {
            label: "Expiration",
            status: "ok",
            message: `Both chains match ${tradeDate}.`,
          }
      : spx || spy
        ? {
            label: "Expiration",
            status: "fail",
            message: `SPX=${spx?.expirationDate ?? "none"}, SPY=${
              spy?.expirationDate ?? "none"
            }, requested=${expectedExpiration}.`,
          }
        : {
            label: "Expiration",
            status: "fail",
            message: "No usable Schwab expiration was returned.",
          },
  );

  checks.push({
    label: "SPX Rows",
    status: spx?.rows.length ? (spx.rows.length >= 30 ? "ok" : "warn") : "fail",
    message: `${spx?.rows.length ?? 0} SPX option rows.`,
  });

  checks.push({
    label: "SPY Rows",
    status: spy?.rows.length ? (spy.rows.length >= 30 ? "ok" : "warn") : "fail",
    message: `${spy?.rows.length ?? 0} SPY option rows.`,
  });

  return checks;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateParam(request: NextRequest, key: string) {
  const raw = request.nextUrl.searchParams.get(key)?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function optionalNumberParam(request: NextRequest, key: string) {
  const raw = request.nextUrl.searchParams.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function numberParam(request: NextRequest, key: string, fallback: number) {
  return optionalNumberParam(request, key) ?? fallback;
}

function riskModeParam(
  request: NextRequest,
): "conservative" | "balanced" | "aggressive" {
  const value = request.nextUrl.searchParams.get("riskMode");
  return value === "conservative" || value === "aggressive" ? value : "balanced";
}

function nyDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function expirationTimestampEastern(dateString: string) {
  const noonUtc = new Date(`${dateString}T12:00:00Z`);
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(noonUtc);
  const offsetLabel =
    zone.find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";
  const match = offsetLabel.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offsetHours = match ? Number(match[1]) : -5;
  const offsetMinutes = match?.[2]
    ? Math.sign(offsetHours || 1) * Number(match[2])
    : 0;
  const [year, month, day] = dateString.split("-").map(Number);
  const utcMs = Date.UTC(
    year,
    month - 1,
    day,
    16 - offsetHours,
    -offsetMinutes,
    0,
  );
  return Math.floor(utcMs / 1000);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
