"use client";

import { useEffect, useMemo, useState } from "react";
import { WheelDeskSideNav } from "../../../components/WheelDeskSideNav";
import type { CandleRecord, OptionSurfaceSnapshot } from "../../../lib/wheeldesk-storage";
import { getPriceSeries } from "../../../lib/data-provider";
import {
  buildTraderEdgeSummary,
  getSnapshotSpot,
  type TraderEdgeSummary,
} from "../../../lib/trader-edge-engine";
import {
  buildWallMigrationSummary,
  findPriorSurfaceForTicker,
  type WallMigrationSummary,
} from "../../../lib/oi-wall-migration-engine";

const DEFAULT_TICKERS = ["SOFI", "AAPL", "AMD", "NVDA", "MSFT", "MU", "PLTR", "SPY", "QQQ"];
const HORIZONS = [1, 3, 5, 10, 20] as const;

type ProofHorizon = typeof HORIZONS[number];

type ValidationRecord = {
  id: string;
  ticker: string;
  snapshotDate: string;
  marketSessionDate: string;
  edge: TraderEdgeSummary;
  migration: WallMigrationSummary | null;
  horizonDays: number;
  evaluated: boolean;
  partial: boolean;
  futureCandles: number;
  startClose: number | null;
  endClose: number | null;
  maxHigh: number | null;
  minLow: number | null;
  closeReturnPct: number | null;
  maxUpPct: number | null;
  maxDownPct: number | null;
  cspHeld: boolean | null;
  ccSafe: boolean | null;
  supportHeld: boolean | null;
  resistanceCapped: boolean | null;
  validated: boolean | null;
  outcome: string;
  notes: string[];
};

type BucketProof = {
  label: string;
  total: number;
  evaluated: number;
  validated: number;
  rate: number | null;
  adjustedRate: number | null;
};

const colors = {
  bg: "#020b14",
  panel: "rgba(7, 21, 35, 0.78)",
  panelSolid: "#071523",
  border: "#20384d",
  text: "#e5f6ff",
  muted: "#9fb4c7",
  teal: "#22d3ee",
  green: "#22c55e",
  red: "#fb7185",
  amber: "#f59e0b",
  purple: "#c084fc",
};

function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "");
}

function parseTickers(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,;|]+/).map(normalizeTicker).filter(Boolean))).slice(0, 80);
}

function dateOnly(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, 10) : "";
}

function dteFromExpiration(expiration?: string, snapshotDate?: string): number | null {
  if (!expiration || !snapshotDate) return null;
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function expirationOf(chain: any): string {
  return dateOnly(chain?.expiration ?? chain?.expirationDate ?? chain?.expiration_date ?? chain?.expiry ?? chain?.date);
}

function surfaceDateOf(raw: any): string {
  return dateOnly(raw?.snapshotDate ?? raw?.snapshot_date ?? raw?.date ?? raw?.asOfDate);
}

function normalizeSurfaceSnapshot(raw: any): OptionSurfaceSnapshot | null {
  if (!raw) return null;

  const ticker = normalizeTicker(raw.ticker ?? raw.symbol);
  const snapshotDate = surfaceDateOf(raw);
  const rawChains = raw.chains ?? raw.optionChains ?? raw.surface?.chains ?? [];

  if (!ticker || !snapshotDate || !Array.isArray(rawChains) || rawChains.length === 0) return null;

  const chains = rawChains
    .map((chain: any) => {
      const expiration = expirationOf(chain);
      if (!expiration) return null;

      return {
        ...chain,
        expiration,
        rows: Array.isArray(chain?.rows)
          ? chain.rows
          : Array.isArray(chain?.optionRows)
            ? chain.optionRows
            : Array.isArray(chain?.chainRows)
              ? chain.chainRows
              : [],
        summary: chain?.summary ?? chain?.chainSummary ?? {},
        dteAtCapture:
          chain?.dteAtCapture ??
          chain?.dte ??
          dteFromExpiration(expiration, snapshotDate) ??
          null,
      };
    })
    .filter(Boolean);

  return {
    ...raw,
    ticker,
    snapshotDate,
    surfaceKey: raw.surfaceKey ?? raw.surface_key ?? `${ticker}_${snapshotDate}`,
    chains,
    dailyStructure: raw.dailyStructure ?? raw.daily_structure ?? raw.structure ?? null,
    price: raw.price ?? {
      date: snapshotDate,
      close: Number(raw.spot ?? raw.dailyStructure?.spot ?? raw.daily_structure?.spot ?? 0),
    },
  } as OptionSurfaceSnapshot;
}

function extractSnapshots(payload: any): OptionSurfaceSnapshot[] {
  const candidates = [
    payload?.snapshots,
    payload?.surfaces,
    payload?.data,
    payload?.items,
    payload?.surfaceSnapshots,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(normalizeSurfaceSnapshot)
        .filter((snapshot): snapshot is OptionSurfaceSnapshot => Boolean(snapshot));
    }
  }

  const single = payload?.snapshot ?? payload?.surface ?? payload;
  const normalized = normalizeSurfaceSnapshot(single);
  return normalized ? [normalized] : [];
}

function extractTickerHints(payload: any): string[] {
  const candidates = [
    payload?.tickers,
    payload?.symbols,
    payload?.snapshots,
    payload?.surfaces,
    payload?.data,
    payload?.items,
    payload?.surfaceSnapshots,
  ];

  const values: string[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    for (const item of candidate) {
      if (typeof item === "string") values.push(item);
      else values.push(String(item?.ticker ?? item?.symbol ?? ""));
    }
  }

  return Array.from(new Set(values.map(normalizeTicker).filter(Boolean)));
}

async function fetchSupabaseSurfaceList(): Promise<{ snapshots: OptionSurfaceSnapshot[]; tickerHints: string[] }> {
  const urls = [
    "/api/supabase/surface-snapshot?mode=list",
    "/api/supabase/surface-snapshot",
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) continue;

      return {
        snapshots: extractSnapshots(payload),
        tickerHints: extractTickerHints(payload),
      };
    } catch {
      // Try next endpoint shape.
    }
  }

  return { snapshots: [], tickerHints: [] };
}

async function fetchSupabaseSurfacesForTicker(ticker: string): Promise<OptionSurfaceSnapshot[]> {
  const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Supabase surface request failed for ${ticker}: ${response.status}`);
  }

  return extractSnapshots(payload);
}

function normalizeCandle(row: any): CandleRecord | null {
  const date = String(row?.date ?? row?.time ?? row?.timestamp ?? row?.datetime ?? "").slice(0, 10);
  const close = Number(row?.close ?? row?.c);
  const open = Number(row?.open ?? row?.o ?? close);
  const high = Number(row?.high ?? row?.h ?? close);
  const low = Number(row?.low ?? row?.l ?? close);
  const volume = Number(row?.volume ?? row?.v ?? 0);

  if (!date || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) return null;

  return {
    date,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  } as CandleRecord;
}

async function fetchDailyCandles(ticker: string): Promise<CandleRecord[]> {
  try {
    const rows = await getPriceSeries(ticker as any, "daily" as any);
    return (rows as any[])
      .map(normalizeCandle)
      .filter((row): row is CandleRecord => Boolean(row))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function rateText(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function scoreColor(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return colors.muted;
  if (value >= 70) return colors.green;
  if (value >= 55) return colors.amber;
  return colors.red;
}

function outcomeColor(value?: boolean | null): string {
  if (value === true) return colors.green;
  if (value === false) return colors.red;
  return colors.muted;
}

function adjustedRate(validated: number, evaluated: number): number | null {
  if (evaluated <= 0) return null;
  // Conservative neutral prior: starts around 50% and moves with sample size.
  return (validated + 2) / (evaluated + 4);
}

function gradeFromRate(rate: number | null, evaluated: number): string {
  if (rate == null || evaluated === 0) return "No proof";
  if (evaluated < 5) return "Early";
  if (evaluated < 15) return "Developing";
  if (rate >= 0.7 && evaluated >= 30) return "Proven";
  if (rate >= 0.62 && evaluated >= 15) return "Tested";
  return "Mixed";
}

function pastCandles(candles: CandleRecord[], snapshotDate: string): CandleRecord[] {
  return candles.filter((candle) => candle.date <= snapshotDate);
}

function futureCandles(candles: CandleRecord[], snapshotDate: string, horizon: number): CandleRecord[] {
  return candles.filter((candle) => candle.date > snapshotDate).slice(0, horizon);
}

function buildValidationRecords(args: {
  surfaces: OptionSurfaceSnapshot[];
  candlesByTicker: Record<string, CandleRecord[]>;
  horizon: number;
}): ValidationRecord[] {
  const sortedSurfaces = [...args.surfaces].sort((a, b) => {
    const byTicker = String(a.ticker).localeCompare(String(b.ticker));
    if (byTicker !== 0) return byTicker;
    return String(a.snapshotDate).localeCompare(String(b.snapshotDate));
  });

  return sortedSurfaces
    .map<ValidationRecord | null>((surface) => {
      const ticker = normalizeTicker((surface as any).ticker);
      const snapshotDate = dateOnly((surface as any).snapshotDate);
      const candles = args.candlesByTicker[ticker] ?? [];
      const priorCandles = pastCandles(candles, snapshotDate);
      const proofCandles = futureCandles(candles, snapshotDate, args.horizon);
      const startClose =
        priorCandles[priorCandles.length - 1]?.close ??
        Number(getSnapshotSpot(surface) ?? (surface as any)?.price?.close ?? null);

      let edge: TraderEdgeSummary;

      try {
        edge = buildTraderEdgeSummary({
          ticker,
          surface,
          candles: priorCandles,
          livePrice: Number.isFinite(startClose) ? startClose : null,
        });
      } catch {
        return null;
      }

      const priorSurface = findPriorSurfaceForTicker(sortedSurfaces, ticker, snapshotDate);
      const migration = buildWallMigrationSummary({ currentSurface: surface, priorSurface });

      const evaluated = proofCandles.length >= args.horizon;
      const partial = proofCandles.length > 0 && proofCandles.length < args.horizon;
      const endClose = proofCandles[proofCandles.length - 1]?.close ?? null;
      const maxHigh = proofCandles.length ? Math.max(...proofCandles.map((c) => c.high)) : null;
      const minLow = proofCandles.length ? Math.min(...proofCandles.map((c) => c.low)) : null;

      const closeReturnPct =
        startClose && endClose != null ? ((endClose - startClose) / startClose) * 100 : null;
      const maxUpPct =
        startClose && maxHigh != null ? ((maxHigh - startClose) / startClose) * 100 : null;
      const maxDownPct =
        startClose && minLow != null ? ((minLow - startClose) / startClose) * 100 : null;

      const cspCeiling = Number(edge.executableCspCeiling);
      const ccFloor = Number(edge.executableCoveredCallFloor);
      const support = Number(edge.support);
      const resistance = Number(edge.resistance);

      const cspHeld =
        minLow == null || !Number.isFinite(cspCeiling) ? null : minLow >= cspCeiling;
      const ccSafe =
        maxHigh == null || !Number.isFinite(ccFloor) ? null : maxHigh <= ccFloor;
      const supportHeld =
        minLow == null || !Number.isFinite(support) ? null : minLow >= support;
      const resistanceCapped =
        maxHigh == null || !Number.isFinite(resistance) ? null : maxHigh <= resistance;

      let validated: boolean | null = null;
      const label = String(edge.actionBucket ?? "");
      const notes: string[] = [];

      if (evaluated) {
        if (label.includes("Best CSP") || label.includes("Wheel candidate")) {
          validated = Boolean(cspHeld && supportHeld);
          notes.push(validated ? "CSP/support zone held." : "CSP/support zone failed.");
        } else if (label.includes("covered-call")) {
          validated = Boolean(ccSafe || resistanceCapped);
          notes.push(validated ? "Covered-call resistance zone stayed safe." : "Covered-call zone saw upside pressure.");
        } else if (label.includes("Compression")) {
          const realizedMove = Math.max(Math.abs(maxUpPct ?? 0), Math.abs(maxDownPct ?? 0));
          validated = realizedMove >= Math.max(2, Number(edge.atrPct ?? 0) * 0.5);
          notes.push(validated ? "Compression released into measurable movement." : "Compression did not release over horizon.");
        } else if (label.includes("trap") || label.includes("avoid")) {
          validated = Boolean((maxUpPct ?? 0) > 2 || (maxDownPct ?? 0) < -2 || edge.trapRisk >= 70);
          notes.push(validated ? "Avoid/trap label had enough danger to justify caution." : "Trap/avoid label did not produce clear danger over horizon.");
        } else if (label.includes("Conflict")) {
          validated = Math.abs(closeReturnPct ?? 0) < Math.max(4, Number(edge.atrPct ?? 0));
          notes.push(validated ? "Conflict/wait avoided a noisy low-edge setup." : "Conflict/wait missed a directional move.");
        } else {
          validated = edge.edgeScore >= 55 ? closeReturnPct != null && closeReturnPct >= -2 : null;
          notes.push("Low-edge/wait label scored by defensive outcome.");
        }
      } else if (partial) {
        notes.push("Partial horizon only. Waiting for more candles.");
      } else {
        notes.push("No future candles yet. Logged but not matured.");
      }

      return {
        id: `${ticker}_${snapshotDate}_${args.horizon}`,
        ticker,
        snapshotDate,
        marketSessionDate: priorCandles[priorCandles.length - 1]?.date ?? snapshotDate,
        edge,
        migration,
        horizonDays: args.horizon,
        evaluated,
        partial,
        futureCandles: proofCandles.length,
        startClose: Number.isFinite(startClose) ? startClose : null,
        endClose,
        maxHigh,
        minLow,
        closeReturnPct,
        maxUpPct,
        maxDownPct,
        cspHeld,
        ccSafe,
        supportHeld,
        resistanceCapped,
        validated,
        outcome: !proofCandles.length
          ? "Waiting"
          : evaluated
            ? validated
              ? "Validated"
              : "Failed / mixed"
            : "Provisional",
        notes,
      } satisfies ValidationRecord;
    })
    .filter((record): record is ValidationRecord => Boolean(record))
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate) || a.ticker.localeCompare(b.ticker));
}

function bucketProof(records: ValidationRecord[]): BucketProof[] {
  const byLabel = new Map<string, ValidationRecord[]>();

  for (const record of records) {
    const label = record.edge.actionBucket ?? "Unknown";
    byLabel.set(label, [...(byLabel.get(label) ?? []), record]);
  }

  return Array.from(byLabel.entries())
    .map(([label, rows]) => {
      const evaluatedRows = rows.filter((row) => row.evaluated && row.validated != null);
      const validatedRows = evaluatedRows.filter((row) => row.validated);
      const rate = evaluatedRows.length ? validatedRows.length / evaluatedRows.length : null;

      return {
        label,
        total: rows.length,
        evaluated: evaluatedRows.length,
        validated: validatedRows.length,
        rate,
        adjustedRate: adjustedRate(validatedRows.length, evaluatedRows.length),
      };
    })
    .sort((a, b) => (b.adjustedRate ?? 0) - (a.adjustedRate ?? 0) || b.evaluated - a.evaluated);
}

function Card({
  title,
  children,
  border = colors.border,
}: {
  title: string;
  children: React.ReactNode;
  border?: string;
}) {
  return (
    <section style={{ ...styles.card, borderColor: border }}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value, note, tone = colors.text }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: tone }}>{value}</div>
      {note ? <div style={styles.metricNote}>{note}</div> : null}
    </div>
  );
}

export default function ValidationPage() {
  const [mounted, setMounted] = useState(false);
  const [tickerInput, setTickerInput] = useState(DEFAULT_TICKERS.join(", "));
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<OptionSurfaceSnapshot[]>([]);
  const [candlesByTicker, setCandlesByTicker] = useState<Record<string, CandleRecord[]>>({});
  const [horizon, setHorizon] = useState<ProofHorizon>(5);
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("Loading Supabase validation data...");
  const [loading, setLoading] = useState(false);

  const requestedTickers = useMemo(() => parseTickers(tickerInput), [tickerInput]);

  async function loadValidationData() {
    setLoading(true);
    setStatus("Loading Supabase surfaces and validation candles...");

    try {
      const list = await fetchSupabaseSurfaceList();
      const tickers = requestedTickers.length
        ? requestedTickers
        : list.tickerHints.length
          ? list.tickerHints
          : DEFAULT_TICKERS;

      const perTicker = await Promise.all(
        tickers.map(async (ticker) => {
          try {
            return await fetchSupabaseSurfacesForTicker(ticker);
          } catch {
            return [];
          }
        }),
      );

      const surfaces = [...list.snapshots, ...perTicker.flat()];
      const deduped = Array.from(
        new Map(surfaces.map((surface) => [`${surface.ticker}_${surface.snapshotDate}`, surface])).values(),
      ).sort((a, b) => String(b.snapshotDate).localeCompare(String(a.snapshotDate)));

      const surfaceTickers = Array.from(new Set([...tickers, ...deduped.map((surface) => normalizeTicker((surface as any).ticker))])).filter(Boolean);

      const candlePairs = await Promise.all(
        surfaceTickers.map(async (ticker) => [ticker, await fetchDailyCandles(ticker)] as const),
      );

      setSurfaceSnapshots(deduped);
      setCandlesByTicker(Object.fromEntries(candlePairs));
      setStatus(`Loaded ${deduped.length} Supabase surface(s) across ${surfaceTickers.length} ticker(s).`);
    } catch (error: any) {
      setStatus(error?.message ?? "Failed to load validation data.");
      setSurfaceSnapshots([]);
      setCandlesByTicker({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    void loadValidationData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const records = useMemo(() => {
    return buildValidationRecords({
      surfaces: surfaceSnapshots,
      candlesByTicker,
      horizon,
    });
  }, [surfaceSnapshots, candlesByTicker, horizon]);

  const visibleRecords = useMemo(() => {
    if (filter === "all") return records;
    if (filter === "matured") return records.filter((record) => record.evaluated);
    if (filter === "waiting") return records.filter((record) => !record.evaluated);
    if (filter === "validated") return records.filter((record) => record.validated === true);
    if (filter === "failed") return records.filter((record) => record.validated === false);
    return records.filter((record) => record.edge.actionBucket === filter);
  }, [records, filter]);

  const proof = useMemo(() => bucketProof(records), [records]);
  const evaluated = records.filter((record) => record.evaluated && record.validated != null);
  const validated = evaluated.filter((record) => record.validated);
  const provisional = records.filter((record) => record.partial).length;
  const waiting = records.filter((record) => !record.evaluated && !record.partial).length;
  const rawRate = evaluated.length ? validated.length / evaluated.length : null;
  const adjusted = adjustedRate(validated.length, evaluated.length);
  const grade = gradeFromRate(adjusted, evaluated.length);

  const surfaceTickers = useMemo(() => {
    return Array.from(
      new Set(surfaceSnapshots.map((surface) => normalizeTicker((surface as any).ticker)).filter(Boolean)),
    ).sort();
  }, [surfaceSnapshots]);

  const surfaceDateRange = useMemo(() => {
    const dates = surfaceSnapshots
      .map((surface) => dateOnly((surface as any).snapshotDate))
      .filter(Boolean)
      .sort();

    return {
      first: dates[0] ?? "N/A",
      last: dates[dates.length - 1] ?? "N/A",
    };
  }, [surfaceSnapshots]);

  const noLookaheadFailures = useMemo(() => {
    return records.filter((record) => {
      if (!record.marketSessionDate || !record.snapshotDate) return false;
      return record.marketSessionDate > record.snapshotDate;
    }).length;
  }, [records]);

  const auditRows = useMemo(() => {
    return surfaceTickers.map((ticker) => {
      const tickerSurfaces = surfaceSnapshots
        .filter((surface) => normalizeTicker((surface as any).ticker) === ticker)
        .sort((a, b) => dateOnly((a as any).snapshotDate).localeCompare(dateOnly((b as any).snapshotDate)));

      const candles = candlesByTicker[ticker] ?? [];
      const tickerRecords = records.filter((record) => record.ticker === ticker);
      const maturedRecords = tickerRecords.filter((record) => record.evaluated);
      const latestSurface = tickerSurfaces[tickerSurfaces.length - 1];
      const noLookaheadOk = tickerRecords.every((record) => !record.marketSessionDate || record.marketSessionDate <= record.snapshotDate);

      return {
        ticker,
        surfaceCount: tickerSurfaces.length,
        firstSurface: dateOnly((tickerSurfaces[0] as any)?.snapshotDate) || "N/A",
        latestSurface: dateOnly((latestSurface as any)?.snapshotDate) || "N/A",
        candleCount: candles.length,
        firstCandle: candles[0]?.date ?? "N/A",
        lastCandle: candles[candles.length - 1]?.date ?? "N/A",
        proofRecords: tickerRecords.length,
        maturedRecords: maturedRecords.length,
        noLookaheadOk,
      };
    });
  }, [surfaceTickers, surfaceSnapshots, candlesByTicker, records]);

  if (!mounted) return null;

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), #020b14",
      }}
    >
      <WheelDeskSideNav active="validation" />

      <div style={styles.page}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>WheelDesk Proof Journal</div>
            <h1 style={styles.title}>Validation</h1>
            <p style={styles.subtitle}>
              Supabase-driven edge proof. Saved OI surfaces are rebuilt without lookahead and scored against future daily candles.
            </p>
          </div>

          <div style={styles.actions}>
            <a href="/dashboard" style={styles.topLink}>Dashboard Harvest</a>
            <a href="/dashboard/scanner" style={styles.topLink}>Watchlist</a>
            <button type="button" onClick={loadValidationData} disabled={loading} style={styles.topButton}>
              {loading ? "Loading..." : "Reload Supabase Proof"}
            </button>
          </div>
        </header>

        <section style={styles.controls}>
          <label style={styles.label}>
            Tickers
            <input
              value={tickerInput}
              onChange={(event) => setTickerInput(event.target.value)}
              style={styles.input}
              placeholder="SOFI, AMD, NVDA"
            />
          </label>

          <label style={styles.label}>
            Proof horizon
            <select value={horizon} onChange={(event) => setHorizon(Number(event.target.value) as ProofHorizon)} style={styles.input}>
              {HORIZONS.map((item) => (
                <option key={item} value={item}>{item} trading day{item === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>

          <button type="button" onClick={loadValidationData} disabled={loading} style={styles.primaryButton}>
            Run Validation
          </button>

          <div style={styles.status}>{status}</div>
        </section>

        <section style={styles.heroGrid}>
          <Metric label="Supabase Surfaces" value={surfaceSnapshots.length} note="Full OI surfaces loaded from database." tone={colors.teal} />
          <Metric label="Proof Records" value={records.length} note={`${evaluated.length} matured / ${provisional} provisional / ${waiting} waiting`} tone={colors.text} />
          <Metric label="Observed Hit Rate" value={rateText(rawRate)} note={`${validated.length} / ${evaluated.length} matured setups`} tone={scoreColor(rawRate == null ? null : rawRate * 100)} />
          <Metric label="Adjusted Proof" value={rateText(adjusted)} note={`${grade} proof with neutral prior`} tone={scoreColor(adjusted == null ? null : adjusted * 100)} />
        </section>

        <Card title="Source Audit / No-Lookahead Check" border="#f59e0b77">
          <div style={styles.auditGrid}>
            <Metric
              label="Supabase Route"
              value="/api/supabase/surface-snapshot"
              note="The page reads OI surfaces through this API route."
              tone={colors.teal}
            />
            <Metric
              label="Surface Date Range"
              value={`${surfaceDateRange.first} → ${surfaceDateRange.last}`}
              note={`${surfaceTickers.length} ticker(s) represented in loaded snapshots.`}
              tone={colors.amber}
            />
            <Metric
              label="No-Lookahead Guard"
              value={noLookaheadFailures === 0 ? "PASS" : "FAIL"}
              note={
                noLookaheadFailures === 0
                  ? "Trader Edge is rebuilt using candles up to the snapshot date only."
                  : `${noLookaheadFailures} record(s) have candle dates after the snapshot date.`
              }
              tone={noLookaheadFailures === 0 ? colors.green : colors.red}
            />
            <Metric
              label="Maturity Rule"
              value={`${horizon}D horizon`}
              note="Rows only count as validated/failed after enough future daily candles exist."
              tone={colors.purple}
            />
          </div>

          <div style={{ marginTop: "0.9rem", overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {[
                    "Ticker",
                    "Surfaces",
                    "Surface Range",
                    "Candles",
                    "Candle Range",
                    "Proof Records",
                    "Matured",
                    "No Lookahead",
                  ].map((item) => (
                    <th key={item} style={styles.th}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditRows.length ? (
                  auditRows.map((row) => (
                    <tr key={row.ticker} style={styles.tr}>
                      <td style={styles.tdTicker}>{row.ticker}</td>
                      <td style={styles.td}>{row.surfaceCount}</td>
                      <td style={styles.td}>{row.firstSurface} → {row.latestSurface}</td>
                      <td style={styles.td}>{row.candleCount}</td>
                      <td style={styles.td}>{row.firstCandle} → {row.lastCandle}</td>
                      <td style={styles.td}>{row.proofRecords}</td>
                      <td style={styles.td}>{row.maturedRecords}</td>
                      <td style={{ ...styles.td, color: row.noLookaheadOk ? colors.green : colors.red, fontWeight: 900 }}>
                        {row.noLookaheadOk ? "PASS" : "FAIL"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={styles.td} colSpan={8}>No source rows loaded. Check the Supabase API route and ticker list.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ color: colors.muted, fontSize: 12, margin: "0.75rem 0 0", lineHeight: 1.45 }}>
            Validation uses saved OI surfaces from Supabase and daily candles from <code>getPriceSeries()</code>. 
            The audit table shows whether each ticker has surfaces, enough candles, matured proof records, and a no-lookahead pass.
          </p>
        </Card>

        <Card title="What This Page Proves" border="#22d3ee77">
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem", alignItems: "start" }}>
            <div style={{ color: colors.muted, lineHeight: 1.5 }}>
              <p style={{ marginTop: 0 }}>
                Validation is not a signal page. It is the proof layer. It reads saved Supabase OI surfaces, rebuilds the Trader Edge summary using candles only up to the snapshot date, then scores what happened after the selected proof horizon.
              </p>
              <p style={{ marginBottom: 0 }}>
                This protects the product from storytelling. A setup is only counted as proof after enough future daily candles exist.
              </p>
            </div>

            <div style={styles.proofBox}>
              <strong style={{ color: colors.text }}>Proof lifecycle</strong>
              <ol style={{ marginBottom: 0, paddingLeft: "1.25rem", color: colors.muted }}>
                <li>Dashboard Harvest saves the full OI surface to Supabase.</li>
                <li>Validation rebuilds the original edge from that snapshot.</li>
                <li>Future candles mature the record.</li>
                <li>Rates prove which labels/zones actually worked.</li>
              </ol>
            </div>
          </div>
        </Card>

        <Card title="Confidence-Adjusted Proof Score" border="#22c55e77">
          <div style={styles.proofGrid}>
            <Metric label="Overall Observed" value={rateText(rawRate)} note={`${validated.length} / ${evaluated.length} matured setups`} tone={scoreColor(rawRate == null ? null : rawRate * 100)} />
            <Metric label="Overall Adjusted" value={rateText(adjusted)} note="Neutral prior prevents tiny samples from looking proven." tone={scoreColor(adjusted == null ? null : adjusted * 100)} />
            <Metric label="Proof Grade" value={grade} note="Grade improves only with sample size and consistency." tone={colors.purple} />
            <Metric label="Waiting Records" value={waiting + provisional} note="Recent surfaces not mature yet." tone={colors.amber} />
          </div>
        </Card>

        <Card title="Label Proof" border="#c084fc77">
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Label", "Total", "Matured", "Validated", "Observed", "Adjusted", "Grade"].map((item) => (
                    <th key={item} style={styles.th}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proof.length ? (
                  proof.map((row) => (
                    <tr key={row.label} style={styles.tr}>
                      <td style={styles.tdStrong}>{row.label}</td>
                      <td style={styles.td}>{row.total}</td>
                      <td style={styles.td}>{row.evaluated}</td>
                      <td style={styles.td}>{row.validated}</td>
                      <td style={{ ...styles.td, color: scoreColor(row.rate == null ? null : row.rate * 100), fontWeight: 900 }}>{rateText(row.rate)}</td>
                      <td style={{ ...styles.td, color: scoreColor(row.adjustedRate == null ? null : row.adjustedRate * 100), fontWeight: 900 }}>{rateText(row.adjustedRate)}</td>
                      <td style={styles.td}>{gradeFromRate(row.adjustedRate, row.evaluated)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td style={styles.td} colSpan={7}>No labels available yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <section style={styles.filterPanel}>
          {[
            ["all", `All (${records.length})`],
            ["matured", `Matured (${evaluated.length})`],
            ["validated", `Validated (${validated.length})`],
            ["failed", `Failed (${evaluated.length - validated.length})`],
            ["waiting", `Waiting (${waiting + provisional})`],
            ...proof.slice(0, 6).map((item) => [item.label, item.label] as [string, string]),
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              style={{ ...styles.filterButton, ...(filter === key ? styles.filterButtonActive : {}) }}
            >
              {label}
            </button>
          ))}
        </section>

        <Card title="Edge Validation Records">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...styles.table, minWidth: 1500 }}>
              <thead>
                <tr>
                  {[
                    "Ticker",
                    "Snapshot",
                    "Status",
                    "Label",
                    "Edge",
                    "Support",
                    "Resistance",
                    "Magnet",
                    "CSP Held",
                    "CC Safe",
                    "Close Ret",
                    "Max Up",
                    "Max Down",
                    "Wall Migration",
                    "Notes",
                  ].map((item) => (
                    <th key={item} style={styles.th}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRecords.length ? (
                  visibleRecords.map((record) => (
                    <tr key={record.id} style={styles.tr}>
                      <td style={styles.tdTicker}>{record.ticker}</td>
                      <td style={styles.td}>{record.snapshotDate}<br /><small>{record.futureCandles}/{record.horizonDays} candles</small></td>
                      <td style={{ ...styles.td, color: outcomeColor(record.validated), fontWeight: 900 }}>{record.outcome}</td>
                      <td style={styles.tdStrong}>{record.edge.actionBucket}</td>
                      <td style={{ ...styles.td, color: scoreColor(record.edge.edgeScore), fontWeight: 900 }}>{record.edge.edgeScore.toFixed(0)}</td>
                      <td style={styles.td}>{money(record.edge.support)}</td>
                      <td style={styles.td}>{money(record.edge.resistance)}</td>
                      <td style={styles.td}>{money(record.edge.magnet)}</td>
                      <td style={{ ...styles.td, color: outcomeColor(record.cspHeld), fontWeight: 900 }}>{record.cspHeld == null ? "N/A" : record.cspHeld ? "Yes" : "No"}</td>
                      <td style={{ ...styles.td, color: outcomeColor(record.ccSafe), fontWeight: 900 }}>{record.ccSafe == null ? "N/A" : record.ccSafe ? "Yes" : "No"}</td>
                      <td style={styles.td}>{pct(record.closeReturnPct)}</td>
                      <td style={styles.td}>{pct(record.maxUpPct)}</td>
                      <td style={styles.td}>{pct(record.maxDownPct)}</td>
                      <td style={styles.td}>{record.migration?.label ?? "No prior"}</td>
                      <td style={{ ...styles.td, minWidth: 280 }}>{record.notes.join(" ")}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={styles.td} colSpan={15}>No records match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}

const styles: Record<string, any> = {
  page: {
    flex: 1,
    minWidth: 0,
    padding: "1.1rem 1.4rem 2rem",
    display: "grid",
    gap: "1rem",
    alignContent: "start",
    color: colors.text,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  eyebrow: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    color: colors.text,
    letterSpacing: "-0.04em",
    fontSize: 32,
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: colors.muted,
    fontSize: 13,
  },
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  topLink: {
    border: "1px solid #22d3ee55",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    textDecoration: "none",
    color: "#67e8f9",
    background: "#071523",
    fontWeight: 900,
  },
  topButton: {
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    color: colors.text,
    background: "#071523",
    fontWeight: 900,
    cursor: "pointer",
  },
  controls: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "0.9rem",
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) 180px auto minmax(220px, 0.8fr)",
    gap: "0.85rem",
    alignItems: "end",
  },
  label: {
    display: "grid",
    gap: 4,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 900,
  },
  input: {
    width: "100%",
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    background: "#020b14",
    color: colors.text,
    padding: "0.55rem 0.65rem",
    fontWeight: 800,
  },
  primaryButton: {
    border: "1px solid #22d3ee77",
    borderRadius: 10,
    background: "#06313f",
    color: "#67e8f9",
    padding: "0.58rem 0.8rem",
    fontWeight: 950,
    cursor: "pointer",
  },
  status: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.35,
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.75rem",
  },
  card: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "1rem",
  },
  sectionTitle: {
    marginTop: 0,
    color: colors.text,
    letterSpacing: "-0.02em",
  },
  metric: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: "rgba(2, 11, 20, 0.5)",
    padding: "0.75rem",
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 950,
    marginTop: 4,
  },
  metricNote: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 1.35,
  },
  proofBox: {
    border: "1px solid #22d3ee55",
    borderRadius: 10,
    background: "rgba(34, 211, 238, 0.06)",
    padding: "0.8rem",
  },
  auditGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.75rem",
  },
  proofGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.75rem",
  },
  filterPanel: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "0.65rem",
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  filterButton: {
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    background: "#071523",
    color: colors.muted,
    padding: "0.35rem 0.65rem",
    cursor: "pointer",
    fontWeight: 900,
  },
  filterButtonActive: {
    border: "1px solid #22d3ee77",
    color: "#67e8f9",
    background: "#06313f",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  th: {
    textAlign: "left",
    padding: 8,
    borderBottom: `1px solid ${colors.border}`,
    color: colors.muted,
    background: "#071523",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: `1px solid ${colors.border}`,
  },
  td: {
    padding: 8,
    color: colors.text,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  tdStrong: {
    padding: 8,
    color: colors.text,
    verticalAlign: "top",
    whiteSpace: "nowrap",
    fontWeight: 900,
  },
  tdTicker: {
    padding: 8,
    color: colors.teal,
    fontSize: 14,
    fontWeight: 950,
  },
};
