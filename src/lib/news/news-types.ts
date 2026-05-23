export type NewsProviderName = "finnhub" | "marketaux" | "mock" | "none";

export type NormalizedNewsEvent = {
  provider: NewsProviderName | string;
  providerEventId: string;
  symbols: string[];
  headline: string;
  summary: string | null;
  sourceName: string | null;
  url: string | null;
  imageUrl: string | null;
  publishedAt: string;
  sentimentScore: number | null;
  materialityScore: number;
  raw: Record<string, unknown>;
};

export type NewsPulse = {
  symbol: string;
  status: "quiet" | "active" | "elevated" | "shock";
  count24h: number;
  countWindow: number;
  materiality: number;
  sentiment: number | null;
  latestHeadline: string | null;
  latestPublishedAt: string | null;
  forecastImpact: "none" | "watch" | "confidence_down" | "shock_risk";
};

export type NewsTickerResponse = {
  ok: boolean;
  symbol: string;
  provider?: string;
  source?: "cache" | "cache+refresh" | "cache_only";
  events?: NormalizedNewsEvent[];
  pulse?: NewsPulse;
  error?: string;
};
