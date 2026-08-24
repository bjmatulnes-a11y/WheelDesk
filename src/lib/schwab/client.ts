import { loadSchwabTokens, saveSchwabTokens } from "./token-store";
import type { SchwabOptionChainResponse, SchwabQuotesResponse } from "./types";

const AUTH_BASE = "https://api.schwabapi.com/v1/oauth";
const MARKET_BASE = "https://api.schwabapi.com/marketdata/v1";

const globalSchwabClient = globalThis as typeof globalThis & {
  __wheelDeskSchwabRefreshes?: Map<string, Promise<string>>;
  __wheelDeskSchwabMarketCache?: Map<string, { value: unknown; expiresAt: number }>;
  __wheelDeskSchwabMarketLoads?: Map<string, Promise<unknown>>;
};

function refreshes() {
  return (globalSchwabClient.__wheelDeskSchwabRefreshes ??= new Map());
}

function marketCache() {
  return (globalSchwabClient.__wheelDeskSchwabMarketCache ??= new Map());
}

function marketLoads() {
  return (globalSchwabClient.__wheelDeskSchwabMarketLoads ??= new Map());
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function basicAuthorization() {
  const clientId = required("SCHWAB_CLIENT_ID");
  const clientSecret = required("SCHWAB_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Schwab token request failed ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in: number;
    refresh_token_expires_in?: number;
  };
}

export function buildSchwabAuthorizeUrl(state: string) {
  const redirectUri = required("SCHWAB_REDIRECT_URI");
  const clientId = required("SCHWAB_CLIENT_ID");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

export async function exchangeSchwabCode(code: string, userId: string) {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: required("SCHWAB_REDIRECT_URI"),
    }),
  );

  if (!token.refresh_token) {
    throw new Error("Schwab did not return a refresh token.");
  }

  await saveSchwabTokens(userId, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    scope: token.scope,
    expiresIn: token.expires_in,
    refreshExpiresIn: token.refresh_token_expires_in,
  });
}

async function refreshSchwabAccessToken(userId: string, refreshToken: string) {
  const active = refreshes();
  const pending = active.get(userId);
  if (pending) return pending;

  const refresh = (async () => {
    const token = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    );

    await saveSchwabTokens(userId, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      tokenType: token.token_type,
      scope: token.scope,
      expiresIn: token.expires_in,
      refreshExpiresIn: token.refresh_token_expires_in,
    });

    return token.access_token;
  })();

  active.set(userId, refresh);
  try {
    return await refresh;
  } finally {
    if (active.get(userId) === refresh) active.delete(userId);
  }
}

export async function getSchwabAccessToken(userId: string) {
  const tokens = await loadSchwabTokens(userId);
  if (!tokens) {
    throw new Error("Schwab is not connected for this WheelDesk user.");
  }

  if (Date.parse(tokens.expires_at) > Date.now() + 60_000) {
    return tokens.access_token;
  }

  return refreshSchwabAccessToken(userId, tokens.refresh_token);
}

export async function schwabFetch<T>(
  userId: string,
  path: string,
  retry = true,
): Promise<T> {
  const accessToken = await getSchwabAccessToken(userId);
  const response = await fetch(`${MARKET_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 401 && retry) {
    const tokens = await loadSchwabTokens(userId, { force: true });
    if (!tokens) throw new Error("Schwab connection is missing for this WheelDesk user.");
    await refreshSchwabAccessToken(userId, tokens.refresh_token);
    return schwabFetch<T>(userId, path, false);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Schwab market-data request failed ${response.status}: ${text.slice(0, 700)}`);
  }

  return JSON.parse(text) as T;
}

async function cachedSchwabFetch<T>(userId: string, path: string, cacheMs: number): Promise<T> {
  const key = `${userId}:${path}`;
  const now = Date.now();
  const cached = marketCache().get(key);
  if (cached && cached.expiresAt > now) return cached.value as T;

  const pending = marketLoads().get(key);
  if (pending) return pending as Promise<T>;

  const load = schwabFetch<T>(userId, path).then((value) => {
    if (cacheMs > 0) {
      marketCache().set(key, { value, expiresAt: Date.now() + cacheMs });
    }
    return value;
  });
  marketLoads().set(key, load);
  try {
    return await load;
  } finally {
    if (marketLoads().get(key) === load) marketLoads().delete(key);
  }
}

export async function fetchSchwabOptionChain(args: {
  userId: string;
  symbol: string;
  fromDate: string;
  toDate: string;
  strikeCount?: number;
}): Promise<SchwabOptionChainResponse> {
  const params = new URLSearchParams({
    symbol: args.symbol,
    contractType: "ALL",
    includeUnderlyingQuote: "true",
    strategy: "SINGLE",
    range: "ALL",
    fromDate: args.fromDate,
    toDate: args.toDate,
    strikeCount: String(args.strikeCount ?? 120),
  });

  return cachedSchwabFetch<SchwabOptionChainResponse>(args.userId, `/chains?${params.toString()}`, 4_000);
}

export type SchwabPriceCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime: number;
};

export type SchwabPriceHistoryResponse = {
  symbol?: string;
  empty?: boolean;
  previousClose?: number;
  previousCloseDate?: number;
  candles?: SchwabPriceCandle[];
};

export async function fetchSchwabPriceHistory(args: {
  userId: string;
  symbol: string;
  frequency?: 1 | 5 | 10 | 15 | 30;
  startDate?: number;
  endDate?: number;
}): Promise<SchwabPriceHistoryResponse> {
  const rawNow = Date.now();
  // Align default history windows to the same four-second bucket used by the
  // live collector cache. Separate browser tabs asking for the same chart in
  // the same refresh window therefore share one Schwab request.
  const now = Math.floor(rawNow / 4_000) * 4_000;
  const params = new URLSearchParams({
    symbol: args.symbol,
    periodType: "day",
    period: "1",
    frequencyType: "minute",
    frequency: String(args.frequency ?? 1),
    startDate: String(args.startDate ?? now - 24 * 60 * 60 * 1000),
    endDate: String(args.endDate ?? now),
    needExtendedHoursData: "false",
    needPreviousClose: "true",
  });

  return cachedSchwabFetch<SchwabPriceHistoryResponse>(args.userId, `/pricehistory?${params.toString()}`, 4_000);
}

export async function fetchSchwabQuotes(
  userId: string,
  symbols: string[],
): Promise<SchwabQuotesResponse> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
  const result: SchwabQuotesResponse = {};

  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50);
    const params = new URLSearchParams({
      symbols: chunk.join(","),
      fields: "quote,reference",
      indicative: "false",
    });
    Object.assign(
      result,
      await cachedSchwabFetch<SchwabQuotesResponse>(userId, `/quotes?${params.toString()}`, 750),
    );
  }

  return result;
}
