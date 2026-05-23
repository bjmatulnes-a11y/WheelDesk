import type { NewsProviderName, NormalizedNewsEvent, NewsPulse } from "./news-types";

const MATERIAL_KEYWORDS = [
  "earnings",
  "guidance",
  "forecast",
  "outlook",
  "acquisition",
  "merger",
  "buyout",
  "fda",
  "approval",
  "rejection",
  "sec",
  "doj",
  "ftc",
  "lawsuit",
  "investigation",
  "downgrade",
  "upgrade",
  "price target",
  "bankruptcy",
  "offering",
  "dilution",
  "split",
  "dividend",
  "recall",
  "halt",
  "partnership",
  "contract",
  "layoff",
  "short seller",
];

const POSITIVE_KEYWORDS = ["upgrade", "beat", "raises", "raised", "approval", "wins", "record", "growth", "partnership", "buyout"];
const NEGATIVE_KEYWORDS = ["downgrade", "miss", "cuts", "cut", "lawsuit", "investigation", "recall", "bankruptcy", "offering", "dilution", "halt"];

function isoDate(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function safeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function scoreMateriality(headline: string, summary: string | null, publishedAt: string): number {
  const text = `${headline} ${summary ?? ""}`.toLowerCase();
  let score = 20;

  for (const keyword of MATERIAL_KEYWORDS) {
    if (text.includes(keyword)) score += 9;
  }

  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 36e5);
  if (ageHours <= 6) score += 16;
  else if (ageHours <= 24) score += 10;
  else if (ageHours <= 72) score += 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSentiment(headline: string, summary: string | null): number | null {
  const text = `${headline} ${summary ?? ""}`.toLowerCase();
  let score = 0;
  let hits = 0;

  for (const keyword of POSITIVE_KEYWORDS) {
    if (text.includes(keyword)) {
      score += 1;
      hits += 1;
    }
  }
  for (const keyword of NEGATIVE_KEYWORDS) {
    if (text.includes(keyword)) {
      score -= 1;
      hits += 1;
    }
  }

  if (!hits) return null;
  return Number(Math.max(-1, Math.min(1, score / Math.max(1, hits))).toFixed(3));
}

export function configuredNewsProvider(): NewsProviderName {
  const configured = (process.env.NEWS_PROVIDER ?? "").trim().toLowerCase();
  if (configured === "marketaux") return "marketaux";
  if (configured === "mock") return "mock";
  if (configured === "none") return "none";
  return "finnhub";
}

export function hasNewsProviderCredentials(provider = configuredNewsProvider()): boolean {
  if (provider === "finnhub") return Boolean(process.env.FINNHUB_API_KEY);
  if (provider === "marketaux") return Boolean(process.env.MARKETAUX_API_KEY);
  if (provider === "mock") return true;
  return false;
}

export async function fetchTickerNews(symbolInput: string, daysBack = 3): Promise<NormalizedNewsEvent[]> {
  const symbol = normalizeSymbol(symbolInput);
  const provider = configuredNewsProvider();

  if (!symbol) return [];
  if (provider === "none") return [];
  if (provider === "mock") return mockTickerNews(symbol);
  if (provider === "marketaux") return fetchMarketauxNews(symbol, daysBack);
  return fetchFinnhubNews(symbol, daysBack);
}

async function fetchFinnhubNews(symbol: string, daysBack: number): Promise<NormalizedNewsEvent[]> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return [];

  const from = isoDate(-Math.max(1, daysBack));
  const to = isoDate(0);
  const url = new URL("https://finnhub.io/api/v1/company-news");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("token", token);

  const response = await fetch(url, { next: { revalidate: 60 * 15 } });
  if (!response.ok) throw new Error(`Finnhub news error ${response.status}`);

  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => {
      const headline = safeText(row.headline);
      const summary = safeText(row.summary) || null;
      const publishedAt = new Date(Number(row.datetime ?? 0) * 1000).toISOString();
      return {
        provider: "finnhub",
        providerEventId: safeText(row.id) || `${symbol}-${publishedAt}-${headline}`,
        symbols: [symbol],
        headline,
        summary,
        sourceName: safeText(row.source) || null,
        url: safeText(row.url) || null,
        imageUrl: safeText(row.image) || null,
        publishedAt,
        sentimentScore: scoreSentiment(headline, summary),
        materialityScore: scoreMateriality(headline, summary, publishedAt),
        raw: row,
      } satisfies NormalizedNewsEvent;
    })
    .filter((event) => event.headline && event.publishedAt);
}

async function fetchMarketauxNews(symbol: string, daysBack: number): Promise<NormalizedNewsEvent[]> {
  const token = process.env.MARKETAUX_API_KEY;
  if (!token) return [];

  const url = new URL("https://api.marketaux.com/v1/news/all");
  url.searchParams.set("symbols", symbol);
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "25");
  url.searchParams.set("published_after", `${isoDate(-Math.max(1, daysBack))}T00:00:00`);
  url.searchParams.set("api_token", token);

  const response = await fetch(url, { next: { revalidate: 60 * 15 } });
  if (!response.ok) throw new Error(`Marketaux news error ${response.status}`);

  const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
  return (payload.data ?? [])
    .map((row) => {
      const headline = safeText(row.title);
      const summary = safeText(row.description) || safeText(row.snippet) || null;
      const publishedAt = safeText(row.published_at) || new Date().toISOString();
      const source = row.source && typeof row.source === "object" ? (row.source as Record<string, unknown>) : {};
      return {
        provider: "marketaux",
        providerEventId: safeText(row.uuid) || `${symbol}-${publishedAt}-${headline}`,
        symbols: [symbol],
        headline,
        summary,
        sourceName: safeText(source.name) || null,
        url: safeText(row.url) || null,
        imageUrl: safeText(row.image_url) || null,
        publishedAt: new Date(publishedAt).toISOString(),
        sentimentScore: scoreSentiment(headline, summary),
        materialityScore: scoreMateriality(headline, summary, publishedAt),
        raw: row,
      } satisfies NormalizedNewsEvent;
    })
    .filter((event) => event.headline && event.publishedAt);
}

function mockTickerNews(symbol: string): NormalizedNewsEvent[] {
  const now = new Date();
  return [
    {
      provider: "mock",
      providerEventId: `${symbol}-mock-${now.toISOString().slice(0, 13)}`,
      symbols: [symbol],
      headline: `${symbol} News Pulse placeholder: material headline watch`,
      summary: "Mock provider is enabled. Replace with FINNHUB_API_KEY or MARKETAUX_API_KEY for live ticker news.",
      sourceName: "WheelDesk Mock News",
      url: null,
      imageUrl: null,
      publishedAt: now.toISOString(),
      sentimentScore: null,
      materialityScore: 42,
      raw: { mock: true, symbol },
    },
  ];
}

export function buildNewsPulse(symbolInput: string, events: NormalizedNewsEvent[], hours = 24): NewsPulse {
  const symbol = normalizeSymbol(symbolInput);
  const cutoff = Date.now() - Math.max(1, hours) * 36e5;
  const windowEvents = events.filter((event) => new Date(event.publishedAt).getTime() >= cutoff);
  const materiality = Math.round(Math.max(0, ...windowEvents.map((event) => event.materialityScore ?? 0)));
  const sentimentValues = windowEvents
    .map((event) => event.sentimentScore)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sentiment = sentimentValues.length
    ? Number((sentimentValues.reduce((sum, value) => sum + value, 0) / sentimentValues.length).toFixed(3))
    : null;

  let status: NewsPulse["status"] = "quiet";
  if (materiality >= 75 || windowEvents.length >= 6) status = "shock";
  else if (materiality >= 55 || windowEvents.length >= 3) status = "elevated";
  else if (windowEvents.length > 0) status = "active";

  const latest = [...events].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())[0];
  const forecastImpact: NewsPulse["forecastImpact"] =
    status === "shock" ? "shock_risk" : status === "elevated" ? "confidence_down" : status === "active" ? "watch" : "none";

  return {
    symbol,
    status,
    count24h: windowEvents.length,
    countWindow: windowEvents.length,
    materiality,
    sentiment,
    latestHeadline: latest?.headline ?? null,
    latestPublishedAt: latest?.publishedAt ?? null,
    forecastImpact,
  };
}
