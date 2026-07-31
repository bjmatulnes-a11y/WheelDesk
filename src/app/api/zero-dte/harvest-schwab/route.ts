import { NextRequest, NextResponse } from "next/server";
import {
  buildZeroDteRecommendation,
  type ZeroDteChainRow,
} from "../../../../lib/zeroDteOiIntelligence";
import {
  buildZeroDteMoodRead,
  type ZeroDteMoodInput,
} from "../../../../lib/zeroDteMoodEngine";
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
  const generatedAt = new Date().toISOString();
  const tradeDate =
    request.nextUrl.searchParams.get("date") ?? nyDateString(new Date());
  const rangePct = numberParam(request, "rangePct", 0.045);
  const manualExpectedMove = numberParam(request, "expectedMove", 0);
  const manualMood = optionalNumberParam(request, "mood");
  const maxWidth = optionalNumberParam(request, "maxWidth") ?? 50;
  const maxRiskDollars = optionalNumberParam(request, "maxRisk");
  const minCredit = optionalNumberParam(request, "minCredit");
  const strictZeroDte = request.nextUrl.searchParams.get("strict") === "1";
  const riskMode = riskModeParam(request);
  const errors: string[] = [];

  let spx: SchwabHarvestSymbol | undefined;
  let spy: SchwabHarvestSymbol | undefined;

  try {
    spx = await harvestSchwabSymbol({
      symbol: "SPX",
      providerSymbol: process.env.SCHWAB_SPX_SYMBOL?.trim() || "$SPX",
      tradeDate,
      rangePct,
      strictZeroDte,
    });
  } catch (error) {
    errors.push(`SPX harvest failed: ${message(error)}`);
  }

  try {
    spy = await harvestSchwabSymbol({
      symbol: "SPY",
      providerSymbol: process.env.SCHWAB_SPY_SYMBOL?.trim() || "SPY",
      tradeDate,
      rangePct,
      strictZeroDte,
    });
  } catch (error) {
    errors.push(`SPY harvest failed: ${message(error)}`);
  }

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

  const moodInput: ZeroDteMoodInput = {
    index: "SPX",
    manualMoodPercent: manualMood,
    generatedAt,
    source: manualMood === null ? "unavailable" : "manual-tos-mood",
  };
  const mood = recommendation ? buildZeroDteMoodRead(moodInput) : undefined;

  const tradeSelection =
    recommendation && spx
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

  const qualityChecks = buildQualityChecks(tradeDate, spx, spy);
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
      status,
      spx,
      spy,
      recommendation,
      mood,
      tradeSelection,
      errors,
      qualityChecks,
      provider: "schwab",
    },
    status === "error" ? 502 : 200,
  );
}

async function harvestSchwabSymbol(args: {
  symbol: "SPX" | "SPY";
  providerSymbol: string;
  tradeDate: string;
  rangePct: number;
  strictZeroDte: boolean;
}): Promise<SchwabHarvestSymbol> {
  const toDate = addDays(args.tradeDate, args.strictZeroDte ? 0 : 7);
  const chain = await fetchSchwabOptionChain({
    symbol: args.providerSymbol,
    fromDate: args.tradeDate,
    toDate,
    strikeCount: 160,
  });

  const expiration = chooseExpiration(chain, args.tradeDate, args.strictZeroDte);
  const price = finite(chain.underlyingPrice);
  if (!price || price <= 0) {
    throw new Error(`Schwab returned no usable underlying price for ${args.providerSymbol}.`);
  }

  const minStrike = price * (1 - args.rangePct);
  const maxStrike = price * (1 + args.rangePct);
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
      ).toFixed(1)}% of ${price.toFixed(2)}.`,
    );
  }

  return {
    symbol: args.symbol,
    providerSymbol: args.providerSymbol,
    price,
    expirationTimestamp: Math.floor(
      Date.parse(`${expiration.date}T16:00:00-04:00`) / 1000,
    ),
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
  const bid = finite(contract.bid) ?? 0;
  const ask = finite(contract.ask) ?? 0;
  const mark = finite(contract.mark);
  const last = finite(contract.last) ?? 0;
  const mid = mark ?? (bid > 0 && ask > 0 ? (bid + ask) / 2 : last);

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
  };
}

function buildQualityChecks(
  tradeDate: string,
  spx?: SchwabHarvestSymbol,
  spy?: SchwabHarvestSymbol,
): QualityCheck[] {
  const checks: QualityCheck[] = [];

  checks.push({
    label: "Provider",
    status: "ok",
    message: "Schwab Trader API market data is active.",
  });

  checks.push(
    spx?.isZeroDte && spy?.isZeroDte
      ? {
          label: "Expiration",
          status: "ok",
          message: `Both chains match ${tradeDate}.`,
        }
      : spx || spy
        ? {
            label: "Expiration",
            status: "warn",
            message: `SPX=${spx?.expirationDate ?? "none"}, SPY=${
              spy?.expirationDate ?? "none"
            }, trade date=${tradeDate}.`,
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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
