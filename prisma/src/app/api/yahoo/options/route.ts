import { NextRequest, NextResponse } from "next/server";

function cookieHeaderFromSetCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function timestampToDateString(ts?: number): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function getYahooCrumbAndCookie() {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "*/*"
    },
    cache: "no-store"
  });

  const cookie = cookieHeaderFromSetCookie(cookieRes.headers.get("set-cookie"));

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Cookie: cookie
    },
    cache: "no-store"
  });

  if (!crumbRes.ok) {
    throw new Error(`Yahoo crumb failed: ${crumbRes.status}`);
  }

  const crumb = await crumbRes.text();

  return { crumb, cookie };
}

function mapContract(c: any) {
  return {
    contractSymbol: c.contractSymbol,
    strike: c.strike,
    expiration: timestampToDateString(c.expiration),
    impliedVolatility:
      typeof c.impliedVolatility === "number" ? c.impliedVolatility : undefined,
    openInterest:
      typeof c.openInterest === "number" ? c.openInterest : undefined,
    volume: typeof c.volume === "number" ? c.volume : undefined,
    bid: typeof c.bid === "number" ? c.bid : undefined,
    ask: typeof c.ask === "number" ? c.ask : undefined,
    lastPrice: typeof c.lastPrice === "number" ? c.lastPrice : undefined,
    change: typeof c.change === "number" ? c.change : undefined,
    percentChange:
      typeof c.percentChange === "number" ? c.percentChange : undefined,
    inTheMoney: c.inTheMoney
  };
}

async function fetchYahooOptions(symbol: string, date?: string) {
  const { crumb, cookie } = await getYahooCrumbAndCookie();

  const base = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(
    symbol.toUpperCase()
  )}`;

  const params = new URLSearchParams();
  params.set("crumb", crumb);

  if (date) params.set("date", date);

  const url = `${base}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*",
      Cookie: cookie
    },
    cache: "no-store"
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Yahoo options failed ${res.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text);
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const date = req.nextUrl.searchParams.get("date");

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  try {
    const json = await fetchYahooOptions(symbol, date ?? undefined);
    const result = json?.optionChain?.result?.[0];

    if (!result) {
      return NextResponse.json(
        {
          error: "No Yahoo optionChain result",
          raw: json?.optionChain?.error ?? null
        },
        { status: 502 }
      );
    }

    const expirationDates: number[] = Array.isArray(result.expirationDates)
      ? result.expirationDates
      : [];

    if (!date) {
      return NextResponse.json({
        symbol: symbol.toUpperCase(),
        expirations: expirationDates,
        expirationDates: expirationDates.map((ts) => ({
          timestamp: ts,
          date: timestampToDateString(ts)
        }))
      });
    }

    const optionBlock = result.options?.[0];

    return NextResponse.json({
      symbol: symbol.toUpperCase(),
      expirationTimestamp: Number(date),
      expirationDate: timestampToDateString(Number(date)),
      calls: Array.isArray(optionBlock?.calls)
        ? optionBlock.calls.map(mapContract)
        : [],
      puts: Array.isArray(optionBlock?.puts)
        ? optionBlock.puts.map(mapContract)
        : []
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown Yahoo options error"
      },
      { status: 502 }
    );
  }
}