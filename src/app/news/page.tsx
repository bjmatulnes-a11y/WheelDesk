"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "../../components/auth/AuthGate";
import { NewsEventList } from "../../components/news/NewsEventList";
import { NewsPulseCard } from "../../components/news/NewsPulseCard";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";
import type { NewsPulse, NormalizedNewsEvent } from "../../lib/news/news-types";

type TickerNewsResponse = {
  ok: boolean;
  symbol: string;
  provider?: string;
  providerReady?: boolean;
  source?: string;
  inserted?: number;
  pulse?: NewsPulse;
  events?: NormalizedNewsEvent[];
  error?: string;
};

type ProviderStatusResponse = {
  ok: boolean;
  provider: string;
  providerReady: boolean;
  credentialEnvName: string | null;
  autofetchOnRead: boolean;
  mode: "live-finnhub" | "live-marketaux" | "mock" | "disabled" | "missing-credentials" | string;
};

type UserWatchlistTicker = {
  id?: string;
  symbol: string;
  slot_index?: number | null;
  source?: string | null;
  created_at?: string | null;
};

type UserWatchlistResponse = {
  ok: boolean;
  plan?: string;
  entitlement?: {
    plan?: string;
    maxTickers?: number;
    maxReplacementsPerDay?: number;
    maxValidationHistoryDays?: number;
  };
  replacementsUsedToday?: number;
  tickers?: UserWatchlistTicker[];
  error?: string;
};

function normalizeSymbols(value: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw
    .map((symbol) => symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12))
    .filter(Boolean)
    .slice(0, 50);
}

function providerLabel(status: ProviderStatusResponse | null): string {
  if (!status) return "Checking provider...";
  if (status.mode === "live-finnhub") return "Live Finnhub";
  if (status.mode === "live-marketaux") return "Live Marketaux";
  if (status.mode === "mock") return "Mock provider";
  if (status.mode === "disabled") return "News disabled";
  return "Provider needs setup";
}

function providerColor(status: ProviderStatusResponse | null): { border: string; color: string; background: string } {
  if (!status) return { border: "rgba(148,163,184,0.35)", color: "#cbd5e1", background: "rgba(15,23,42,0.76)" };
  if (status.providerReady && status.provider !== "mock") {
    return { border: "rgba(16,185,129,0.5)", color: "#6ee7b7", background: "rgba(16,185,129,0.12)" };
  }
  if (status.provider === "mock") {
    return { border: "rgba(250,204,21,0.45)", color: "#fde68a", background: "rgba(250,204,21,0.10)" };
  }
  return { border: "rgba(251,113,133,0.45)", color: "#fecdd3", background: "rgba(251,113,133,0.10)" };
}

async function getNewsAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = includeJson ? { "Content-Type": "application/json" } : {};

  const { data } = await getSupabaseAuthClient().auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Login session is not ready yet. Refresh News Pulse or sign in again.");
  }

  headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function NewsPulsePage() {
  const [lockedSymbols, setLockedSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [events, setEvents] = useState<NormalizedNewsEvent[]>([]);
  const [pulse, setPulse] = useState<NewsPulse | null>(null);
  const [pulses, setPulses] = useState<NewsPulse[]>([]);
  const [planLabel, setPlanLabel] = useState<string | null>(null);
  const [slotLimit, setSlotLimit] = useState<number | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);

  const symbols = useMemo(() => normalizeSymbols(lockedSymbols), [lockedSymbols]);
  const statusColors = providerColor(providerStatus);

  async function loadProviderStatus() {
    try {
      const response = await fetch("/api/news/provider-status", { cache: "no-store" });
      const payload = (await response.json()) as ProviderStatusResponse;
      if (payload.ok) {
        setProviderStatus(payload);
        if (payload.mode === "live-finnhub") {
          setProviderNote("Finnhub is active. News harvest will pull live ticker headlines into Supabase for your locked tickers.");
        } else if (payload.mode === "missing-credentials") {
          setProviderNote(
            `News provider is set to ${payload.provider}, but ${payload.credentialEnvName ?? "the provider key"} is missing.`,
          );
        } else if (payload.mode === "mock") {
          setProviderNote("Mock news provider is active. Set NEWS_PROVIDER=finnhub and FINNHUB_API_KEY to use live ticker news.");
        }
      }
    } catch {
      // Non-blocking. News can still attempt cached reads.
    }
  }

  async function loadLockedSymbols() {
    setWatchlistLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/user-watchlist", {
        headers: await getNewsAuthHeaders(false),
      });
      const payload = (await response.json()) as UserWatchlistResponse;
      if (!payload.ok) throw new Error(payload.error ?? "Could not load locked ticker slots.");

      const nextSymbols = normalizeSymbols((payload.tickers ?? []).map((row) => row.symbol));
      setLockedSymbols(nextSymbols);
      setPlanLabel(payload.entitlement?.plan ?? payload.plan ?? null);
      setSlotLimit(typeof payload.entitlement?.maxTickers === "number" ? payload.entitlement.maxTickers : null);

      if (nextSymbols.length) {
        setSelectedSymbol((current) => (current && nextSymbols.includes(current) ? current : nextSymbols[0]));
      } else {
        setSelectedSymbol("");
        setEvents([]);
        setPulse(null);
        setPulses([]);
        setProviderNote("No locked ticker slots found. Add tracked tickers from the Dashboard first.");
      }

      return nextSymbols;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load locked ticker slots.");
      return [];
    } finally {
      setWatchlistLoading(false);
    }
  }

  async function loadPulseList(symbolOverride?: string[]) {
    const scopedSymbols = normalizeSymbols(symbolOverride ?? symbols);
    if (!scopedSymbols.length) return;

    try {
      const response = await fetch(
        `/api/news/pulse?symbols=${encodeURIComponent(scopedSymbols.join(","))}&hours=24`,
      );
      const payload = (await response.json()) as { ok: boolean; pulses?: NewsPulse[]; error?: string };
      if (!payload.ok) throw new Error(payload.error ?? "Could not load news pulses.");
      setPulses(payload.pulses ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load news pulses.");
    }
  }

  async function loadTicker(symbol: string, refresh = false) {
    const clean = normalizeSymbols(symbol)[0];
    if (!clean) return;

    setSelectedSymbol(clean);
    setError(null);
    setLoading(!refresh);
    setRefreshing(refresh);

    try {
      const response = await fetch(
        `/api/news/ticker?symbol=${encodeURIComponent(clean)}&hours=72&limit=30${refresh ? "&refresh=1" : ""}`,
      );
      const payload = (await response.json()) as TickerNewsResponse;
      if (!payload.ok) throw new Error(payload.error ?? "Could not load ticker news.");

      setEvents(payload.events ?? []);
      setPulse(payload.pulse ?? null);
      if (payload.providerReady === false) {
        setProviderNote(
          `News provider ${payload.provider ?? "unknown"} is not configured. Showing cached news only.`,
        );
      } else if (payload.source) {
        setProviderNote(`Source: ${payload.source}${payload.inserted ? ` · inserted ${payload.inserted}` : ""}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ticker news.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function runHarvest() {
    const scopedSymbols = symbols;
    if (!scopedSymbols.length) {
      setError("No locked ticker slots found. Add tracked tickers from the Dashboard first.");
      return;
    }

    setError(null);
    setRefreshing(true);
    try {
      const response = await fetch("/api/news/harvest", {
        method: "POST",
        headers: await getNewsAuthHeaders(true),
        body: JSON.stringify({ symbols: scopedSymbols, hours: 72 }),
      });
      const payload = (await response.json()) as { ok: boolean; provider?: string; totalInserted?: number; totalFailed?: number; error?: string };
      if (!payload.ok) throw new Error(payload.error ?? "News harvest failed.");
      setProviderNote(
        `${payload.provider ?? "News"} harvest complete for ${scopedSymbols.length} locked ticker(s) · inserted ${payload.totalInserted ?? 0} · failed ${payload.totalFailed ?? 0}`,
      );
      await loadPulseList(scopedSymbols);
      await loadTicker(selectedSymbol || scopedSymbols[0], false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "News harvest failed.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      await loadProviderStatus();
      const nextSymbols = await loadLockedSymbols();
      if (cancelled || !nextSymbols.length) return;
      await loadPulseList(nextSymbols);
      await loadTicker(nextSymbols[0], false);
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthGate>
      <main
        style={{
          minHeight: "100vh",
          background: "#020a12",
          color: "#e0f2fe",
          padding: "32px min(5vw, 56px)",
        }}
      >
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <header style={{ marginBottom: 24 }}>
            <div style={{ color: "#22d3ee", letterSpacing: 3, fontSize: 12, fontWeight: 900 }}>WHEELDESK NEWS PULSE</div>
            <h1 style={{ color: "#f8fafc", fontSize: 42, margin: "8px 0" }}>Ticker news as forecast context.</h1>
            <p style={{ color: "#94a3b8", maxWidth: 840, lineHeight: 1.6 }}>
              News Pulse now scopes to your locked WheelDesk ticker slots. Finnhub can be used as the first live provider,
              while Supabase caching keeps the feed focused on forecast context instead of becoming a headline firehose.
            </p>
          </header>

          <section
            style={{
              border: `1px solid ${statusColors.border}`,
              borderRadius: 20,
              padding: 16,
              background: statusColors.background,
              marginBottom: 18,
              color: statusColors.color,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1.4 }}>News provider</div>
                <div style={{ fontSize: 22, fontWeight: 950, marginTop: 4 }}>{providerLabel(providerStatus)}</div>
                <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 4 }}>
                  {providerStatus?.providerReady
                    ? providerStatus.autofetchOnRead
                      ? "Live provider configured · auto-fetch on read enabled"
                      : "Live provider configured · use Run News Harvest for cached ticker news"
                    : providerStatus?.credentialEnvName
                      ? `Set ${providerStatus.credentialEnvName} in Vercel, then redeploy.`
                      : "Provider status is loading."}
                </div>
              </div>
              <button
                onClick={loadProviderStatus}
                style={{
                  background: "rgba(15,23,42,0.72)",
                  border: "1px solid rgba(148,163,184,0.32)",
                  borderRadius: 12,
                  color: "#dbeafe",
                  padding: "10px 14px",
                  fontWeight: 900,
                }}
              >
                Check Provider
              </button>
            </div>
          </section>

          <section
            style={{
              border: "1px solid rgba(34,211,238,0.18)",
              borderRadius: 20,
              padding: 16,
              background: "rgba(8,18,32,0.72)",
              marginBottom: 22,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 900, textTransform: "uppercase" }}>
                  Locked ticker slots
                </div>
                <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 900, marginTop: 4 }}>
                  {watchlistLoading
                    ? "Loading locked tickers..."
                    : `${symbols.length}${slotLimit ? ` / ${slotLimit}` : ""} tracked ticker${symbols.length === 1 ? "" : "s"}`}
                </div>
                {planLabel && (
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Plan: {planLabel.toUpperCase()}</div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={async () => {
                    const nextSymbols = await loadLockedSymbols();
                    await loadPulseList(nextSymbols);
                    if (nextSymbols.length) await loadTicker(selectedSymbol && nextSymbols.includes(selectedSymbol) ? selectedSymbol : nextSymbols[0], false);
                  }}
                  disabled={watchlistLoading || refreshing}
                  style={{
                    background: "rgba(34,211,238,0.12)",
                    border: "1px solid rgba(34,211,238,0.5)",
                    borderRadius: 12,
                    color: "#67e8f9",
                    padding: "12px 16px",
                    fontWeight: 900,
                  }}
                >
                  Refresh Locked Tickers
                </button>
                <button
                  onClick={() => loadPulseList()}
                  disabled={!symbols.length || refreshing}
                  style={{
                    background: "rgba(34,211,238,0.12)",
                    border: "1px solid rgba(34,211,238,0.5)",
                    borderRadius: 12,
                    color: "#67e8f9",
                    padding: "12px 16px",
                    fontWeight: 900,
                  }}
                >
                  Refresh Pulse
                </button>
                <button
                  onClick={runHarvest}
                  disabled={!symbols.length || refreshing}
                  style={{
                    background: refreshing ? "rgba(148,163,184,0.18)" : "rgba(16,185,129,0.16)",
                    border: "1px solid rgba(16,185,129,0.5)",
                    borderRadius: 12,
                    color: "#6ee7b7",
                    padding: "12px 16px",
                    fontWeight: 900,
                  }}
                >
                  {refreshing ? "Harvesting..." : "Run News Harvest"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {symbols.map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => loadTicker(symbol, false)}
                  style={{
                    background: selectedSymbol === symbol ? "rgba(34,211,238,0.22)" : "rgba(15,23,42,0.9)",
                    border: selectedSymbol === symbol ? "1px solid rgba(34,211,238,0.65)" : "1px solid rgba(148,163,184,0.25)",
                    borderRadius: 999,
                    color: selectedSymbol === symbol ? "#67e8f9" : "#dbeafe",
                    padding: "8px 12px",
                    fontWeight: 900,
                  }}
                >
                  {symbol}
                </button>
              ))}
              {!watchlistLoading && !symbols.length && (
                <a
                  href="/dashboard"
                  style={{
                    color: "#67e8f9",
                    border: "1px solid rgba(34,211,238,0.4)",
                    borderRadius: 999,
                    padding: "8px 12px",
                    textDecoration: "none",
                    fontWeight: 900,
                  }}
                >
                  Add tickers from Dashboard
                </a>
              )}
            </div>
          </section>

          {error && (
            <div style={{ border: "1px solid rgba(251,113,133,0.45)", color: "#fecdd3", borderRadius: 16, padding: 14, marginBottom: 18 }}>
              {error}
            </div>
          )}
          {providerNote && (
            <div style={{ border: "1px solid rgba(34,211,238,0.25)", color: "#bae6fd", borderRadius: 16, padding: 14, marginBottom: 18 }}>
              {providerNote}
            </div>
          )}

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 24 }}>
            {pulses.map((item) => (
              <button key={item.symbol} onClick={() => loadTicker(item.symbol, false)} style={{ all: "unset", cursor: "pointer" }}>
                <NewsPulseCard pulse={item} />
              </button>
            ))}
          </section>

          <section
            style={{
              border: "1px solid rgba(34,211,238,0.18)",
              borderRadius: 20,
              background: "rgba(8,18,32,0.72)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "#22d3ee", fontSize: 12, fontWeight: 900, letterSpacing: 1.8 }}>SELECTED NEWS CONTEXT</div>
                <h2 style={{ color: "#f8fafc", margin: "4px 0 0", fontSize: 28 }}>{selectedSymbol || "No ticker selected"}</h2>
              </div>
              <button
                onClick={() => selectedSymbol && loadTicker(selectedSymbol, true)}
                disabled={!selectedSymbol || refreshing || loading}
                style={{
                  background: "rgba(34,211,238,0.12)",
                  border: "1px solid rgba(34,211,238,0.5)",
                  borderRadius: 12,
                  color: "#67e8f9",
                  padding: "12px 16px",
                  fontWeight: 900,
                }}
              >
                {refreshing ? "Refreshing..." : "Refresh Ticker News"}
              </button>
            </div>

            {pulse && <div style={{ marginBottom: 16 }}><NewsPulseCard pulse={pulse} /></div>}
            {loading ? <div style={{ color: "#94a3b8" }}>Loading ticker news...</div> : <NewsEventList events={events} />}
          </section>
        </div>
      </main>
    </AuthGate>
  );
}
