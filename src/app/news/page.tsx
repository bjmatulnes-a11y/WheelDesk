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

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "NVDA", "AMD", "SOFI"];

function normalizeSymbols(value: string): string[] {
  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12))
    .filter(Boolean)
    .slice(0, 10);
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
  const [symbolInput, setSymbolInput] = useState(DEFAULT_SYMBOLS.join(", "));
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOLS[0]);
  const [events, setEvents] = useState<NormalizedNewsEvent[]>([]);
  const [pulse, setPulse] = useState<NewsPulse | null>(null);
  const [pulses, setPulses] = useState<NewsPulse[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerNote, setProviderNote] = useState<string | null>(null);

  const symbols = useMemo(() => normalizeSymbols(symbolInput), [symbolInput]);

  async function loadPulseList() {
    if (!symbols.length) return;
    try {
      const response = await fetch(`/api/news/pulse?symbols=${encodeURIComponent(symbols.join(","))}&hours=24`);
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
      } else {
        setProviderNote(payload.source ? `Source: ${payload.source}${payload.inserted ? ` · inserted ${payload.inserted}` : ""}` : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ticker news.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function runHarvest() {
    setError(null);
    setRefreshing(true);
    try {
      const response = await fetch("/api/news/harvest", {
        method: "POST",
        headers: await getNewsAuthHeaders(true),
        body: JSON.stringify({ symbols, hours: 72 }),
      });
      const payload = (await response.json()) as { ok: boolean; totalInserted?: number; totalFailed?: number; error?: string };
      if (!payload.ok) throw new Error(payload.error ?? "News harvest failed.");
      setProviderNote(`News harvest complete · inserted ${payload.totalInserted ?? 0} · failed ${payload.totalFailed ?? 0}`);
      await loadPulseList();
      await loadTicker(selectedSymbol, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "News harvest failed.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadPulseList();
    loadTicker(selectedSymbol, false);
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
          <p style={{ color: "#94a3b8", maxWidth: 820, lineHeight: 1.6 }}>
            News Pulse is not a headline firehose. It is a ticker-scoped event layer that helps identify when news may amplify,
            invalidate, or explain divergence from the OI Field forecast.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 1fr) auto auto",
            gap: 12,
            alignItems: "end",
            border: "1px solid rgba(34,211,238,0.18)",
            borderRadius: 20,
            padding: 16,
            background: "rgba(8,18,32,0.72)",
            marginBottom: 22,
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 900, textTransform: "uppercase" }}>Tracked symbols</span>
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              style={{
                background: "#030b16",
                border: "1px solid rgba(148,163,184,0.28)",
                borderRadius: 12,
                color: "#e0f2fe",
                padding: "12px 14px",
                fontWeight: 800,
              }}
            />
          </label>
          <button
            onClick={loadPulseList}
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
            disabled={refreshing}
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ color: "#22d3ee", fontSize: 12, fontWeight: 900, letterSpacing: 1.8 }}>SELECTED NEWS CONTEXT</div>
              <h2 style={{ color: "#f8fafc", margin: "4px 0 0", fontSize: 28 }}>{selectedSymbol}</h2>
            </div>
            <button
              onClick={() => loadTicker(selectedSymbol, true)}
              disabled={refreshing || loading}
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
