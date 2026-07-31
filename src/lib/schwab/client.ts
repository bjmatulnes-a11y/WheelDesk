import { loadSchwabTokens, saveSchwabTokens } from "./token-store";
import type { SchwabOptionChainResponse } from "./types";

const AUTH_BASE = "https://api.schwabapi.com/v1/oauth";
const MARKET_BASE = "https://api.schwabapi.com/marketdata/v1";

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

export async function exchangeSchwabCode(code: string) {
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

  await saveSchwabTokens({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    scope: token.scope,
    expiresIn: token.expires_in,
    refreshExpiresIn: token.refresh_token_expires_in,
  });
}

async function refreshSchwabAccessToken(refreshToken: string) {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );

  await saveSchwabTokens({
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    tokenType: token.token_type,
    scope: token.scope,
    expiresIn: token.expires_in,
    refreshExpiresIn: token.refresh_token_expires_in,
  });

  return token.access_token;
}

export async function getSchwabAccessToken() {
  const tokens = await loadSchwabTokens();
  if (!tokens) {
    throw new Error("Schwab is not connected. Open /api/brokers/schwab/connect first.");
  }

  if (Date.parse(tokens.expires_at) > Date.now() + 60_000) {
    return tokens.access_token;
  }

  return refreshSchwabAccessToken(tokens.refresh_token);
}

export async function schwabFetch<T>(path: string, retry = true): Promise<T> {
  const accessToken = await getSchwabAccessToken();
  const response = await fetch(`${MARKET_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 401 && retry) {
    const tokens = await loadSchwabTokens();
    if (!tokens) throw new Error("Schwab connection is missing.");
    await refreshSchwabAccessToken(tokens.refresh_token);
    return schwabFetch<T>(path, false);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Schwab market-data request failed ${response.status}: ${text.slice(0, 700)}`);
  }

  return JSON.parse(text) as T;
}

export async function fetchSchwabOptionChain(args: {
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

  return schwabFetch<SchwabOptionChainResponse>(`/chains?${params.toString()}`);
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
  symbol: string;
  frequency?: 1 | 5 | 10 | 15 | 30;
  startDate?: number;
  endDate?: number;
}): Promise<SchwabPriceHistoryResponse> {
  const now = Date.now();
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

  return schwabFetch<SchwabPriceHistoryResponse>(`/pricehistory?${params.toString()}`);
}
