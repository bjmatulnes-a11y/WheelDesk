"use client";

import { useEffect, useMemo, useState } from "react";
import { getOptionChain, getPriceSeries } from "../../lib/data-provider";
import { buildOptionSurfaceSnapshot } from "../../lib/oi-surface-snapshot-builder";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { type PortfolioProfile } from "../../lib/portfolio-types";
import { readPreferences, saveOptionSurfaceSnapshot } from "../../lib/wheeldesk-storage";
import { SUPPORTED_TICKERS, type SupportedTicker } from "../../lib/types";

const today = new Date().toISOString().slice(0, 10);

const HARVEST_TICKERS_KEY = "wheelDesk.dashboardHarvestTickers";
const MAX_NORMAL_TICKERS = 10;

type HarvestStatus = "idle" | "pending" | "fetching" | "saving" | "saved" | "failed" | "skipped";

type HarvestItem = {
  ticker: string;
  status: HarvestStatus;
  message?: string;
  chainCount?: number;
  rowCount?: number;
  surfaceKey?: string;
  snapshotDate?: string;
  startedAt?: string;
  completedAt?: string;
  premium?: boolean;
};

function normalizeTickerInput(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function parseTickerList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map(normalizeTickerInput)
    .filter(Boolean);
}

function uniqueTickers(tickers: string[]): string[] {
  return Array.from(new Set(tickers.map(normalizeTickerInput).filter(Boolean)));
}

function isPremiumTicker(ticker: string): boolean {
  const normalized = normalizeTickerInput(ticker);
  return normalized === "^SPX" || normalized === "SPX" || normalized === "SPXW";
}

function countRows(snapshot: any): number {
  return (snapshot?.chains ?? []).reduce((sum: number, chain: any) => {
    return sum + ((chain?.rows ?? []).length || 0);
  }, 0);
}

function safeInt(value: unknown, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : fallback;
}

function safeMoney(value: unknown, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : fallback;
}

function safeFixed(value: unknown, digits = 2, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function statusColor(status: HarvestStatus): string {
  switch (status) {
    case "saved":
      return "#166534";
    case "failed":
      return "#991b1b";
    case "fetching":
    case "saving":
      return "#92400e";
    case "skipped":
      return "#6b7280";
    case "pending":
      return "#1d4ed8";
    default:
      return "#374151";
  }
}

function summarizePortfolio(profile?: PortfolioProfile) {
  const positions = profile?.positions ?? [];

  let stockShares = 0;
  let shortCalls = 0;
  let shortPuts = 0;
  let longOptions = 0;
  let openPremiumProxy = 0;

  for (const position of positions as any[]) {
    const qty = Number(position?.qty ?? 0);
    const side = String(position?.side ?? "").toLowerCase();
    const instrumentType = String(position?.instrumentType ?? "").toLowerCase();
    const mark = Number(position?.mark ?? position?.entryPrice ?? 0);

    if (instrumentType === "stock") {
      stockShares += side === "short" ? -qty : qty;
    }

    if (instrumentType === "call" && side === "short") shortCalls += qty;
    if (instrumentType === "put" && side === "short") shortPuts += qty;
    if ((instrumentType === "call" || instrumentType === "put") && side === "long") longOptions += qty;

    if ((instrumentType === "call" || instrumentType === "put") && side === "short") {
      openPremiumProxy += Number.isFinite(mark) ? mark * qty * 100 : 0;
    }
  }

  return {
    positionCount: positions.length,
    stockShares,
    shortCalls,
    shortPuts,
    longOptions,
    openPremiumProxy,
  };
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(today);
  const [tickerInput, setTickerInput] = useState("");
  const [tickers, setTickers] = useState<string[]>(["AAPL", "SOFI", "MU"]);
  const [queue, setQueue] = useState<HarvestItem[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Ready.");
  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");

  useEffect(() => {
    setMounted(true);

    try {
      const savedTickers = JSON.parse(localStorage.getItem(HARVEST_TICKERS_KEY) || "[]");
      if (Array.isArray(savedTickers) && savedTickers.length) {
        setTickers(uniqueTickers(savedTickers).slice(0, MAX_NORMAL_TICKERS));
      }
    } catch {
      // ignore local UI state errors
    }

    const loadedProfiles = listPortfolioProfiles();
    setProfiles(loadedProfiles);
    setSelectedProfileId(loadedProfiles[0]?.id ?? "");
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(HARVEST_TICKERS_KEY, JSON.stringify(tickers));
  }, [mounted, tickers]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  const portfolioSummary = useMemo(() => summarizePortfolio(selectedProfile), [selectedProfile]);

  const normalTickers = useMemo(() => tickers.filter((ticker) => !isPremiumTicker(ticker)), [tickers]);
  const premiumTickers = useMemo(() => tickers.filter(isPremiumTicker), [tickers]);

  const canAddMoreNormal = normalTickers.length < MAX_NORMAL_TICKERS;

  function addTickersFromInput() {
    const parsed = parseTickerList(tickerInput);
    if (!parsed.length) return;

    const next = uniqueTickers([...tickers, ...parsed]);
    const normal = next.filter((ticker) => !isPremiumTicker(ticker)).slice(0, MAX_NORMAL_TICKERS);
    const premium = next.filter(isPremiumTicker);

    setTickers(uniqueTickers([...normal, ...premium]));
    setTickerInput("");
  }

  function removeTicker(ticker: string) {
    setTickers((current) => current.filter((item) => item !== ticker));
  }

  function buildQueue(targetTickers: string[]) {
    const nextQueue = targetTickers.map((ticker) => ({
      ticker,
      status: "pending" as HarvestStatus,
      premium: isPremiumTicker(ticker),
      message: "Waiting",
    }));

    setQueue(nextQueue);
    return nextQueue;
  }

  function updateQueueItem(ticker: string, patch: Partial<HarvestItem>) {
    setQueue((current) =>
      current.map((item) =>
        item.ticker === ticker
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  }

  async function getBestPrice(ticker: string): Promise<number> {
    try {
      const series = await getPriceSeries(ticker as SupportedTicker, "daily");
      const close = Number(series.at(-1)?.close);
      return Number.isFinite(close) ? close : 0;
    } catch {
      return 0;
    }
  }

  async function harvestTicker(ticker: string) {
    const normalizedTicker = normalizeTickerInput(ticker);
    const startedAt = new Date().toISOString();

    updateQueueItem(normalizedTicker, {
      status: "fetching",
      startedAt,
      message: "Fetching option chain",
    });

    const snapshot = await getOptionChain(normalizedTicker as SupportedTicker, snapshotDate);
    const rowCount = countRows(snapshot);
    const chainCount = snapshot?.chains?.length ?? 0;

    if (!chainCount || !rowCount) {
      updateQueueItem(normalizedTicker, {
        status: "failed",
        chainCount,
        rowCount,
        message: "No chains or rows returned",
        completedAt: new Date().toISOString(),
      });
      return;
    }

    updateQueueItem(normalizedTicker, {
      status: "saving",
      chainCount,
      rowCount,
      snapshotDate: snapshot.snapshotDate ?? snapshotDate,
      message: `Saving ${safeInt(rowCount)} rows to Supabase`,
    });

    const preferences = readPreferences();
    const price = await getBestPrice(normalizedTicker);
    const finalSnapshotDate = snapshotDate || snapshot.snapshotDate || today;

    const surfaceSnapshot = buildOptionSurfaceSnapshot({
      ticker: normalizedTicker,
      snapshotTimeZone: preferences.snapshotTimeZone,
      chains: snapshot.chains.map((chain: any) => ({
        ticker: normalizedTicker,
        snapshotDate: finalSnapshotDate,
        expiration: chain.expiration,
        rows: chain.rows ?? [],
        summary: chain.summary ?? {},
        chainKind: chain.chainKind,
        dteAtCapture: chain.dteAtCapture,
      })),
      dailyStructure: {
        ticker: normalizedTicker,
        snapshotDate: finalSnapshotDate,
        spot: price,
        source: "dashboard_harvest",
        chainCount,
        rowCount,
      },
      price: {
        date: finalSnapshotDate,
        close: price,
      },
    });

    await Promise.resolve(saveOptionSurfaceSnapshot(surfaceSnapshot));

    updateQueueItem(normalizedTicker, {
      status: "saved",
      chainCount,
      rowCount,
      surfaceKey: surfaceSnapshot.surfaceKey,
      snapshotDate: surfaceSnapshot.snapshotDate,
      message: `Saved ${safeInt(rowCount)} rows / ${safeInt(chainCount)} chains`,
      completedAt: new Date().toISOString(),
    });
  }

  async function runHarvest(targets: string[]) {
    if (running) return;

    const uniqueTargets = uniqueTickers(targets);
    if (!uniqueTargets.length) {
      setStatus("No tickers selected.");
      return;
    }

    setRunning(true);
    setStatus(`Running harvest for ${uniqueTargets.length} ticker(s)...`);
    buildQueue(uniqueTargets);

    for (const ticker of uniqueTargets) {
      try {
        await harvestTicker(ticker);
      } catch (error) {
        console.error("[WheelDesk] Harvest failed:", ticker, error);

        updateQueueItem(ticker, {
          status: "failed",
          message: error instanceof Error ? error.message : "Harvest failed",
          completedAt: new Date().toISOString(),
        });
      }
    }

    setRunning(false);
    setStatus(`Harvest complete: ${uniqueTargets.length} ticker(s) processed.`);
  }

  const savedCount = queue.filter((item) => item.status === "saved").length;
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const totalRows = queue.reduce((sum, item) => sum + (item.rowCount ?? 0), 0);

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "1rem", display: "grid", gap: "1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>WheelDesk Dashboard</h1>
          <p style={{ margin: "0.35rem 0 0", color: "#6b7280" }}>
            Snapshot harvest, portfolio monitor, and market calendar.
          </p>
        </div>

        <a
          href="/control-center"
          style={{
            background: "#111827",
            color: "#fff",
            padding: "0.65rem 0.9rem",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          Open Control Center
        </a>
      </header>

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Ticker Harvest Runner</h2>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto auto auto", gap: "0.75rem", alignItems: "end" }}>
          <label style={labelStyle}>
            Add tickers
            <input
              value={tickerInput}
              onChange={(event) => setTickerInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTickersFromInput();
                }
              }}
              placeholder="AAPL, SOFI, MU"
              style={inputStyle}
              list="dashboard-supported-tickers"
            />
            <datalist id="dashboard-supported-tickers">
              {SUPPORTED_TICKERS.map((ticker) => (
                <option key={ticker} value={ticker} />
              ))}
              <option value="^SPX" />
              <option value="SPY" />
              <option value="QQQ" />
            </datalist>
          </label>

          <label style={labelStyle}>
            Snapshot date
            <input
              type="date"
              value={snapshotDate}
              onChange={(event) => setSnapshotDate(event.target.value)}
              style={inputStyle}
            />
          </label>

          <button type="button" onClick={addTickersFromInput} disabled={!tickerInput.trim()} style={buttonStyle}>
            Add
          </button>

          <button
            type="button"
            onClick={() => runHarvest(normalTickers)}
            disabled={running || !normalTickers.length}
            style={primaryButtonStyle}
          >
            Run 10-Ticker Harvest
          </button>

          <button
            type="button"
            onClick={() => runHarvest(premiumTickers)}
            disabled={running || !premiumTickers.length}
            style={buttonStyle}
            title="Premium/heavy tickers such as ^SPX should run separately."
          >
            Run Premium
          </button>
        </div>

        <div style={{ marginTop: "0.8rem", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#6b7280", fontSize: 12 }}>Normal tickers: {normalTickers.length}/{MAX_NORMAL_TICKERS}</span>

          {tickers.map((ticker) => (
            <span
              key={ticker}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: isPremiumTicker(ticker) ? "#fef3c7" : "#e5e7eb",
                color: isPremiumTicker(ticker) ? "#92400e" : "#111827",
                borderRadius: 999,
                padding: "0.25rem 0.55rem",
                fontWeight: 800,
              }}
            >
              {ticker}
              {isPremiumTicker(ticker) ? " premium" : ""}
              <button
                type="button"
                onClick={() => removeTicker(ticker)}
                style={{ border: 0, background: "transparent", cursor: "pointer", fontWeight: 900 }}
              >
                ×
              </button>
            </span>
          ))}

          {!canAddMoreNormal ? (
            <span style={{ color: "#92400e", fontSize: 12 }}>Normal ticker limit reached.</span>
          ) : null}
        </div>

        <p style={{ marginBottom: 0 }}>
          <strong>Status:</strong> {status}
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Harvest Queue</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0.75rem", marginBottom: "0.8rem" }}>
          <Metric label="Saved" value={String(savedCount)} />
          <Metric label="Failed" value={String(failedCount)} />
          <Metric label="Rows processed" value={safeInt(totalRows)} />
          <Metric label="Queue size" value={String(queue.length)} />
        </div>

        {!queue.length ? (
          <p style={{ color: "#6b7280" }}>No harvest run yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Ticker</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Chains</th>
                  <th style={thStyle}>Rows</th>
                  <th style={thStyle}>Snapshot</th>
                  <th style={thStyle}>Message</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.ticker}>
                    <td style={tdStyle}>
                      <strong>{item.ticker}</strong> {item.premium ? <span style={{ color: "#92400e" }}>premium</span> : null}
                    </td>
                    <td style={{ ...tdStyle, color: statusColor(item.status), fontWeight: 900 }}>{item.status}</td>
                    <td style={tdStyle}>{safeInt(item.chainCount)}</td>
                    <td style={tdStyle}>{safeInt(item.rowCount)}</td>
                    <td style={tdStyle}>{item.snapshotDate ?? "N/A"}</td>
                    <td style={tdStyle}>{item.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Portfolio Monitor</h2>

          <label style={labelStyle}>
            Selected portfolio
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              style={inputStyle}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0.75rem", marginTop: "0.8rem" }}>
            <Metric label="Positions" value={safeInt(portfolioSummary.positionCount)} />
            <Metric label="Stock shares" value={safeInt(portfolioSummary.stockShares)} />
            <Metric label="Short calls" value={safeInt(portfolioSummary.shortCalls)} />
            <Metric label="Short puts" value={safeInt(portfolioSummary.shortPuts)} />
            <Metric label="Long options" value={safeInt(portfolioSummary.longOptions)} />
            <Metric label="Open premium proxy" value={safeMoney(portfolioSummary.openPremiumProxy)} />
          </div>

          <p style={{ color: "#6b7280", fontSize: 12 }}>
            Next step: wire account value, cash, open P/L, day P/L, theta/day, buying power, and assignment exposure from the portfolio builder.
          </p>
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>News & Market Calendar</h2>

          <div style={{ display: "grid", gap: "0.65rem" }}>
            <PlaceholderRow title="Ticker news feed" detail="Pending provider/API selection." />
            <PlaceholderRow title="Earnings calendar" detail="Use selected harvest tickers as the watch universe." />
            <PlaceholderRow title="Macro calendar" detail="CPI, FOMC, jobs, OPEX, and major market events." />
            <PlaceholderRow title="Risk alerts" detail="Surface stale snapshots, failed harvests, and premium-heavy tickers." />
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.7rem", background: "#f9fafb" }}>
      <div style={{ color: "#6b7280", fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 20, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function PlaceholderRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem", background: "#f9fafb" }}>
      <strong>{title}</strong>
      <div style={{ color: "#6b7280", marginTop: 4 }}>{detail}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 10,
  background: "#fff",
  padding: "1rem",
};

const sectionTitleStyle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: "0.75rem",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 13,
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "0.45rem",
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #111827",
  borderRadius: 8,
  background: "#fff",
  color: "#111827",
  padding: "0.55rem 0.75rem",
  fontWeight: 800,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#111827",
  color: "#fff",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  padding: "0.5rem",
  color: "#374151",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #f3f4f6",
  padding: "0.5rem",
};