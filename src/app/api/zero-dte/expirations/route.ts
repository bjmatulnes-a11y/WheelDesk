import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { fetchSchwabOptionChain } from "../../../../lib/schwab/client";
import type { SchwabOptionChainResponse } from "../../../../lib/schwab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  const tradeDate =
    request.nextUrl.searchParams.get("date") ?? chicagoDateString(new Date());
  const days = clampInteger(
    Number(request.nextUrl.searchParams.get("days") ?? 14),
    3,
    45,
  );
  const providerSymbol = process.env.SCHWAB_SPX_SYMBOL?.trim() || "$SPX";

  try {
    const chain = await fetchSchwabOptionChain({
      userId: access.access.user.id,
      symbol: providerSymbol,
      fromDate: tradeDate,
      toDate: addDays(tradeDate, days),
      // We only need expiration keys here, not a deep strike surface.
      strikeCount: 1,
    });

    const expirations = collectExpirations(chain)
      .filter((date) => date >= tradeDate)
      .map((date) => ({
        date,
        daysFromTradeDate: calendarDayDifference(tradeDate, date),
      }));

    return NextResponse.json(
      {
        ok: true,
        tradeDate,
        provider: "schwab",
        providerSymbol,
        expirations,
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        tradeDate,
        provider: "schwab",
        expirations: [],
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function collectExpirations(chain: SchwabOptionChainResponse) {
  const dates = new Set<string>();
  for (const key of Object.keys(chain.callExpDateMap ?? {})) {
    const date = key.split(":")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
  }
  for (const key of Object.keys(chain.putExpDateMap ?? {})) {
    const date = key.split(":")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
  }
  return [...dates].sort((a, b) => a.localeCompare(b));
}

function chicagoDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
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

function calendarDayDifference(fromDate: string, toDate: string) {
  const from = Date.parse(`${fromDate}T12:00:00Z`);
  const to = Date.parse(`${toDate}T12:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
