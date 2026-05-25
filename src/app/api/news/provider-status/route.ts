import { NextResponse } from "next/server";
import { configuredNewsProvider, hasNewsProviderCredentials } from "../../../../lib/news/news-provider";

export const runtime = "nodejs";

export async function GET() {
  const provider = configuredNewsProvider();
  const providerReady = hasNewsProviderCredentials(provider);

  const credentialEnvName =
    provider === "finnhub"
      ? "FINNHUB_API_KEY"
      : provider === "marketaux"
        ? "MARKETAUX_API_KEY"
        : provider === "mock"
          ? "NEWS_PROVIDER=mock"
          : null;

  return NextResponse.json({
    ok: true,
    provider,
    providerReady,
    credentialEnvName,
    autofetchOnRead: process.env.NEWS_AUTOFETCH_ON_READ === "true",
    mode:
      provider === "finnhub" && providerReady
        ? "live-finnhub"
        : provider === "marketaux" && providerReady
          ? "live-marketaux"
          : provider === "mock"
            ? "mock"
            : provider === "none"
              ? "disabled"
              : "missing-credentials",
  });
}
