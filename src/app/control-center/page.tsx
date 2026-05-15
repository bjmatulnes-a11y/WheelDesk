"use client";

import { useEffect, useMemo, useState } from "react";
import { WheelDeskSideNav } from "../../components/WheelDeskSideNav";
import ControlSummaryCards from "../../components/control-center/ControlSummaryCards";
import ForecastChartPanel from "../../components/control-center/ForecastChartPanel";
import ScenarioPlaybookCard from "../../components/control-center/ScenarioPlaybookCard";
import ModelReadoutCard from "../../components/control-center/ModelReadoutCard";
import IVSurfaceCard from "../../components/control-center/IVSurfaceCard";
import PredictiveMatrixPanel from "../../components/control-center/PredictiveMatrixPanel";
import ControlMatrixCard from "../../components/control-center/ControlMatrixCard";
import { colors, cardStyle } from "../../components/control-center/styles";
import { buildDealerPressureSummary } from "../../lib/dealer-pressure-engine";
import { buildAdaptivePositionControl } from "../../lib/nonlinear-mpc-engine";
import { buildOIImpliedPath } from "../../lib/oi-implied-path-engine";
import { buildOIProjectionReport } from "../../lib/oi-projection-engine";
import { buildPredictiveMatrix } from "../../lib/predictive-matrix-engine";
import { buildIVSurfaceSummary } from "../../lib/iv-surface-engine";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { type PortfolioProfile } from "../../lib/portfolio-types";
import { buildTraderEdgeSummary } from "../../lib/trader-edge-engine";
import { type ChainSnapshot, SUPPORTED_TICKERS, type SupportedTicker, type Timeframe } from "../../lib/types";
import { buildWallMigrationSummary, findPriorSurfaceForTicker } from "../../lib/oi-wall-migration-engine";
import { getPriceSeries } from "../../lib/data-provider";
import { safeFixed } from "../../lib/format";
import type { CandleRecord, OptionSurfaceSnapshot } from "../../lib/wheeldesk-storage";

const selectedProfileStorageKey = "wheelDesk.selectedPortfolioProfileId";
const TIMEFRAMES = ["daily", "weekly", "1h", "30m", "15m", "5m"] as const;

type OverlayFlags = {
  prevailingLevels: boolean;
  oiImpliedPath: boolean;
  ivSurface: boolean;
  dealerPressure: boolean;
  wallMigration: boolean;
};

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return safeFixed(value, 2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${safeFixed(value * 100, 1)}%`;
}

function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function surfaceDateOf(surface: any): string {
  return String(surface?.snapshotDate ?? surface?.snapshot_date ?? surface?.date ?? "").slice(0, 10);
}

function expirationOf(chain: any): string {
  return String(chain?.expiration ?? chain?.expirationDate ?? chain?.expiration_date ?? chain?.expiry ?? "");
}

function chainScore(chain: any): number | null {
  const candidates = [
    chain?.summary?.prevailingScore,
    chain?.summary?.score,
    chain?.summary?.edgeScore,
    chain?.prevailingScore,
    chain?.score,
  ];

  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function dteFromExpiration(expiration: string, snapshotDate: string): number | null {
  if (!expiration || !snapshotDate) return null;

  const exp = new Date(`${expiration.slice(0, 10)}T00:00:00Z`);
  const snap = new Date(`${snapshotDate.slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(exp.getTime()) || Number.isNaN(snap.getTime())) return null;

  return Math.max(0, Math.round((exp.getTime() - snap.getTime()) / (1000 * 60 * 60 * 24)));
}

function normalizeSurfaceSnapshot(raw: any): OptionSurfaceSnapshot | null {
  if (!raw) return null;

  const ticker = normalizeTicker(raw.ticker ?? raw.symbol);
  const snapshotDate = surfaceDateOf(raw);
  const rawChains = raw.chains ?? raw.optionChains ?? raw.surface?.chains ?? [];

  if (!ticker || !snapshotDate || !Array.isArray(rawChains)) return null;

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

async function fetchSupabaseSurfaces(ticker: string): Promise<OptionSurfaceSnapshot[]> {
  const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Supabase surface request failed: ${response.status}`);
  }

  return extractSnapshots(payload).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
}

function toChainSnapshot(surface: OptionSurfaceSnapshot | null): ChainSnapshot | null {
  if (!surface?.chains?.length) return null;

  return {
    ticker: surface.ticker,
    snapshotDate: surface.snapshotDate,
    chains: surface.chains.map((chain: any) => ({
      expiration: chain.expiration,
      rows: chain.rows ?? [],
      summary: chain.summary ?? {},
    })),
  } as ChainSnapshot;
}

function MetricPill({ label, value, tone = colors.teal }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ ...cardStyle, padding: "0.85rem" }}>
      <div style={{ color: colors.muted, fontSize: 12 }}>{label}</div>
      <div style={{ color: tone, fontSize: 22, fontWeight: 900, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function EmptyState({ ticker, status }: { ticker: string; status: string }) {
  return (
    <section style={{ ...cardStyle, padding: "1.25rem" }}>
      <h2 style={{ marginTop: 0, color: colors.text }}>No Supabase OI surface loaded for {ticker}</h2>
      <p style={{ color: colors.muted }}>
        Dashboard harvest now saves full option surfaces directly to Supabase. Run the ticker harvest, then return
        to Control Center to analyze the saved surface.
      </p>
      {status ? <p style={{ color: colors.amber }}>{status}</p> : null}
      <a href={`/dashboard`} style={{ color: colors.teal, fontWeight: 900 }}>
        Open Dashboard Harvest
      </a>
    </section>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        color: checked ? colors.teal : colors.muted,
        fontSize: 12,
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </label>
  );
}

export default function ControlCenterPage() {
  const [mounted, setMounted] = useState(false);
  const [ticker, setTicker] = useState("SOFI");
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<OptionSurfaceSnapshot[]>([]);
  const [selectedSurfaceDate, setSelectedSurfaceDate] = useState("");
  const [selectedExpiration, setSelectedExpiration] = useState("");
  const [candleTimeframe, setCandleTimeframe] = useState<string>("daily");
  const [candles, setCandles] = useState<CandleRecord[]>([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [status, setStatus] = useState("");
const [overlays, setOverlays] = useState<OverlayFlags>({
  prevailingLevels: false,
  oiImpliedPath: false,
  ivSurface: false,
  dealerPressure: false,
  wallMigration: false,
});
  useEffect(() => {
    setMounted(true);

    const urlTicker = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ticker")
      : null;

    const initialTicker = normalizeTicker(urlTicker) || "SOFI";
    setTicker(initialTicker);

    const loadedProfiles = listPortfolioProfiles();
    setProfiles(loadedProfiles);

    const savedProfileId =
      typeof window !== "undefined" ? window.localStorage.getItem(selectedProfileStorageKey) : null;

    setSelectedProfileId(
      savedProfileId && loadedProfiles.some((profile) => profile.id === savedProfileId)
        ? savedProfileId
        : loadedProfiles[0]?.id ?? ""
    );
  }, []);

  useEffect(() => {
    if (!mounted || !ticker) return;

    let cancelled = false;

    async function loadSurfaces() {
      setSurfaceLoading(true);
      setStatus(`Loading Supabase surfaces for ${ticker}...`);

      try {
        const loaded = await fetchSupabaseSurfaces(ticker);

        if (cancelled) return;

        setSurfaceSnapshots(loaded);
        setSelectedSurfaceDate((current) => {
          if (current && loaded.some((surface) => surface.snapshotDate === current)) return current;
          return loaded[0]?.snapshotDate ?? "";
        });

        setStatus(
          loaded.length
            ? `Loaded ${loaded.length} Supabase surface(s) for ${ticker}.`
            : `No Supabase surface found for ${ticker}.`
        );
      } catch (error) {
        if (cancelled) return;

        setSurfaceSnapshots([]);
        setSelectedSurfaceDate("");
        setSelectedExpiration("");
        setStatus(error instanceof Error ? error.message : `Could not load Supabase surfaces for ${ticker}.`);
      } finally {
        if (!cancelled) setSurfaceLoading(false);
      }
    }

    loadSurfaces();

    return () => {
      cancelled = true;
    };
  }, [ticker, mounted]);

  useEffect(() => {
    if (!mounted || !ticker) return;

    let cancelled = false;
    const requestedTicker = ticker;
    const requestedTimeframe = candleTimeframe;

    async function loadCandles() {
      setCandleLoading(true);
      setStatus(`Loading ${requestedTimeframe} candles for ${requestedTicker}...`);

      try {
        const series = await getPriceSeries(requestedTicker as SupportedTicker, requestedTimeframe as Timeframe);
        const normalized = series
          .map((candle) => ({
            date: String((candle as any).date ?? (candle as any).time ?? "").slice(0, 10),
            open: Number((candle as any).open ?? (candle as any).close),
            high: Number((candle as any).high ?? (candle as any).close),
            low: Number((candle as any).low ?? (candle as any).close),
            close: Number((candle as any).close),
            volume: Number((candle as any).volume ?? 0),
          }))
          .filter((candle) => candle.date && Number.isFinite(candle.close));

        if (cancelled) return;

        setCandles(normalized as CandleRecord[]);
        setStatus(
          normalized.length
            ? `Loaded ${normalized.length} ${requestedTimeframe} candles for ${requestedTicker}.`
            : `No ${requestedTimeframe} candles returned for ${requestedTicker}.`
        );
      } catch {
        if (cancelled) return;

        setCandles([]);
        setStatus(`Could not load ${requestedTimeframe} candles for ${requestedTicker}.`);
      } finally {
        if (!cancelled) setCandleLoading(false);
      }
    }

    loadCandles();

    return () => {
      cancelled = true;
    };
  }, [ticker, candleTimeframe, mounted]);

  useEffect(() => {
    if (!mounted || !selectedProfileId || typeof window === "undefined") return;
    window.localStorage.setItem(selectedProfileStorageKey, selectedProfileId);
  }, [selectedProfileId, mounted]);

  const allTickers = useMemo(() => {
    const surfaceTickers = surfaceSnapshots.map((surface) => normalizeTicker(surface.ticker)).filter(Boolean);
    return Array.from(new Set([...SUPPORTED_TICKERS, "^SPX", "SPY", "QQQ", ...surfaceTickers])).sort();
  }, [surfaceSnapshots]);

  const surfaceDates = useMemo(() => surfaceSnapshots.map((surface) => surface.snapshotDate), [surfaceSnapshots]);

  const selectedSurface = useMemo(() => {
    if (!selectedSurfaceDate) return surfaceSnapshots[0] ?? null;
    return surfaceSnapshots.find((surface) => surface.snapshotDate === selectedSurfaceDate) ?? null;
  }, [surfaceSnapshots, selectedSurfaceDate]);

  const expirationOptions = useMemo(() => {
    return (selectedSurface?.chains ?? [])
      .map((chain: any) => ({
        expiration: expirationOf(chain),
        dte: chain?.dteAtCapture ?? dteFromExpiration(expirationOf(chain), selectedSurface?.snapshotDate ?? ""),
        score: chainScore(chain),
      }))
      .filter((item) => item.expiration)
      .sort((a, b) => String(a.expiration).localeCompare(String(b.expiration)));
  }, [selectedSurface]);

  useEffect(() => {
    if (!selectedSurface) {
      setSelectedExpiration("");
      return;
    }

    setSelectedExpiration((current) => {
      if (current && expirationOptions.some((item) => item.expiration === current)) return current;
      return expirationOptions[0]?.expiration ?? "";
    });
  }, [selectedSurface, expirationOptions]);

  const selectedChain = useMemo(() => {
    if (!selectedSurface?.chains?.length) return null;

    return (
      (selectedSurface.chains as any[]).find((chain) => expirationOf(chain) === selectedExpiration) ??
      selectedSurface.chains[0] ??
      null
    );
  }, [selectedSurface, selectedExpiration]);

  const selectedSurfaceForAnalysis = useMemo(() => {
    if (!selectedSurface || !selectedChain) return selectedSurface;

    return {
      ...selectedSurface,
      chains: [selectedChain],
    } as OptionSurfaceSnapshot;
  }, [selectedSurface, selectedChain]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  const analysisPrice = useMemo(() => {
    return (
      candles.at(-1)?.close ??
      selectedSurfaceForAnalysis?.price?.close ??
      selectedSurfaceForAnalysis?.dailyStructure?.spot ??
      0
    );
  }, [candles, selectedSurfaceForAnalysis]);

  const activeChainSnapshot = useMemo(() => toChainSnapshot(selectedSurfaceForAnalysis), [selectedSurfaceForAnalysis]);

  const traderEdge = useMemo(() => {
    if (!selectedSurfaceForAnalysis) return null;

    return buildTraderEdgeSummary({
      ticker,
      surface: selectedSurfaceForAnalysis,
      candles,
      livePrice: analysisPrice,
    });
  }, [ticker, selectedSurfaceForAnalysis, candles, analysisPrice]);

  const wallMigration = useMemo(() => {
    if (!selectedSurfaceForAnalysis) return null;

    const prior = findPriorSurfaceForTicker(
      surfaceSnapshots,
      selectedSurfaceForAnalysis.ticker,
      selectedSurfaceForAnalysis.snapshotDate
    );

    return buildWallMigrationSummary({
      currentSurface: selectedSurfaceForAnalysis,
      priorSurface: prior,
    });
  }, [selectedSurfaceForAnalysis, surfaceSnapshots]);

  const dealerPressure = useMemo(() => {
    return buildDealerPressureSummary({
      surface: selectedSurfaceForAnalysis,
      edge: traderEdge,
      wallMigration,
      candles,
      livePrice: analysisPrice,
    });
  }, [selectedSurfaceForAnalysis, traderEdge, wallMigration, candles, analysisPrice]);

  const oiProjection = useMemo(() => {
    return buildOIProjectionReport({
      snapshot: activeChainSnapshot,
      currentPrice: analysisPrice,
    });
  }, [activeChainSnapshot, analysisPrice]);

  const oiPath = useMemo(() => {
    return buildOIImpliedPath({
      projectionReport: oiProjection,
      edgeSummary: traderEdge,
      wallMigration,
      currentPrice: analysisPrice,
    });
  }, [oiProjection, traderEdge, wallMigration, analysisPrice]);

  const forecastHorizonDays = useMemo(() => {
    const explicit = Number((oiPath as any)?.horizonDays ?? (oiPath as any)?.horizonSessions ?? 14);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(60, Math.round(explicit)));
    return 14;
  }, [oiPath]);

  const ivSurface = useMemo(() => {
    return buildIVSurfaceSummary({
      surface: selectedSurfaceForAnalysis,
      currentPrice: analysisPrice,
      horizonDays: forecastHorizonDays,
      candles,
    });
  }, [selectedSurfaceForAnalysis, analysisPrice, forecastHorizonDays, candles]);

  const predictiveMatrix = useMemo(() => {
    return buildPredictiveMatrix({
      path: oiPath,
      dealerPressure,
      edgeSummary: traderEdge,
      wallMigration,
    });
  }, [oiPath, dealerPressure, traderEdge, wallMigration]);

  const adaptiveControl = useMemo(() => {
    return buildAdaptivePositionControl({
      ticker,
      positions: selectedProfile?.positions ?? [],
      path: oiPath,
      predictiveMatrix,
      dealerPressure,
      edgeSummary: traderEdge,
      wallMigration,
    });
  }, [ticker, selectedProfile, oiPath, predictiveMatrix, dealerPressure, traderEdge, wallMigration]);

  const chartEdge = overlays.prevailingLevels ? traderEdge : null;
  const chartPath = overlays.oiImpliedPath ? oiPath : null;
  const chartIvSurface = overlays.ivSurface ? ivSurface : null;
  const activeChainScore = chainScore(selectedChain);
  const chartMatrix =
  overlays.oiImpliedPath || overlays.dealerPressure || overlays.wallMigration
    ? predictiveMatrix
    : null;  

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), ${colors.bg}`,
      }}
    >
      <WheelDeskSideNav active="control-center" />

      <div style={{ flex: 1, padding: "1.1rem 1.4rem 2rem", minWidth: 0 }}>
        <section style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: 0, color: colors.text, fontSize: 28, letterSpacing: "-0.04em" }}>Control Center</h1>
            <p style={{ color: colors.muted, margin: "0.35rem 0 0" }}>
              Supabase-driven OI surface analysis, candle timeframe control, and chart overlay toggles.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: "0.7rem", minWidth: 720 }}>
            <label style={styles.label}>
              Symbol
              <select
                value={ticker}
                onChange={(event) => {
                  const normalized = normalizeTicker(event.target.value);
                  if (!normalized || normalized === ticker) return;
                  setTicker(normalized);
                  setCandles([]);
                  setSelectedSurfaceDate("");
                  setSelectedExpiration("");
                  setStatus(`Switching to ${normalized}...`);
                }}
                style={styles.select}
              >
                {allTickers.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              OI Surface
              <select
                value={selectedSurfaceDate}
                onChange={(event) => setSelectedSurfaceDate(event.target.value)}
                style={styles.select}
                disabled={!surfaceDates.length || surfaceLoading}
              >
                {!surfaceDates.length ? <option value="">No surfaces</option> : null}
                {surfaceDates.map((date) => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              Expiration Chain
              <select
                value={selectedExpiration}
                onChange={(event) => setSelectedExpiration(event.target.value)}
                style={styles.select}
                disabled={!expirationOptions.length}
              >
                {!expirationOptions.length ? <option value="">No chains</option> : null}
                {expirationOptions.map((item) => (
                  <option key={item.expiration} value={item.expiration}>
                    {item.expiration}
                    {item.dte != null ? ` | ${item.dte}D` : ""}
                    {item.score != null ? ` | score ${safeFixed(item.score, 2)}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              Candles
              <select
                value={candleTimeframe}
                onChange={(event) => setCandleTimeframe(event.target.value)}
                style={styles.select}
              >
                {TIMEFRAMES.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>{timeframe}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section style={{ ...cardStyle, marginTop: "1rem", padding: "0.85rem 1rem", display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Toggle
              checked={overlays.prevailingLevels}
              label="Prevailing levels"
              onChange={(checked) => setOverlays((current) => ({ ...current, prevailingLevels: checked }))}
            />
            <Toggle
              checked={overlays.oiImpliedPath}
              label="OI implied path"
              onChange={(checked) => setOverlays((current) => ({ ...current, oiImpliedPath: checked }))}
            />
            <Toggle
              checked={overlays.ivSurface}
              label="IV surface / band"
              onChange={(checked) => setOverlays((current) => ({ ...current, ivSurface: checked }))}
            />
            <Toggle
              checked={overlays.dealerPressure}
              label="Dealer pressure readout"
              onChange={(checked) => setOverlays((current) => ({ ...current, dealerPressure: checked }))}
            />
            <Toggle
              checked={overlays.wallMigration}
              label="Wall migration"
              onChange={(checked) => setOverlays((current) => ({ ...current, wallMigration: checked }))}
            />
          </div>

          <div style={{ color: colors.muted, fontSize: 12 }}>
            Surface: <strong style={{ color: colors.text }}>{selectedSurfaceDate || "N/A"}</strong> · Chain:{" "}
            <strong style={{ color: colors.text }}>{selectedExpiration || "N/A"}</strong> · Score:{" "}
            <strong style={{ color: colors.teal }}>{activeChainScore != null ? safeFixed(activeChainScore, 2) : "N/A"}</strong>
          </div>
        </section>

        <div style={{ marginTop: "1rem" }}>
          <ControlSummaryCards control={adaptiveControl} matrix={predictiveMatrix} />
        </div>

        {!selectedSurfaceForAnalysis ? (
          <div style={{ marginTop: "1rem" }}>
            <EmptyState ticker={ticker} status={status} />
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "1rem", alignItems: "start", marginTop: "1rem" }}>
             <ForecastChartPanel
  key={`${ticker}-${selectedSurfaceDate}-${selectedExpiration}-${candleTimeframe}-${String(overlays.prevailingLevels)}-${String(overlays.oiImpliedPath)}-${String(overlays.ivSurface)}-${String(overlays.dealerPressure)}-${String(overlays.wallMigration)}`}
  ticker={ticker}
  candles={candles}
  edge={chartEdge}
  path={chartPath}
  matrix={chartMatrix}
  ivSurface={chartIvSurface}
  isLoading={candleLoading || surfaceLoading}
/>

              <div style={{ display: "grid", gap: "1rem" }}>
                <ScenarioPlaybookCard control={adaptiveControl} />
                <IVSurfaceCard summary={ivSurface} />
                {overlays.dealerPressure ? <ModelReadoutCard dealer={dealerPressure} matrix={predictiveMatrix} /> : null}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "1rem", marginTop: "1rem" }}>
              <PredictiveMatrixPanel matrix={predictiveMatrix} />
              <ControlMatrixCard control={adaptiveControl} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "0.85rem", marginTop: "1rem" }}>
              <MetricPill label="Current / Analysis Price" value={money(analysisPrice)} tone={colors.green} />
              <MetricPill label="Expected Move" value={ivSurface ? `±${money(ivSurface.expectedMove.oneSigma)}` : "N/A"} tone={colors.teal} />
              <MetricPill label="ATM IV" value={pct(ivSurface?.atmIv)} tone={colors.teal} />
              <MetricPill label="Magnet" value={money(traderEdge?.magnet ?? dealerPressure?.magnet)} tone={colors.amber} />
              <MetricPill label="Support / Put Wall" value={money(traderEdge?.support ?? dealerPressure?.support)} tone={colors.red} />
              <MetricPill label="Resistance / Call Wall" value={money(traderEdge?.resistance ?? dealerPressure?.resistance)} tone={colors.green} />
            </div>

            {overlays.wallMigration && adaptiveControl?.riskNotes?.length ? (
              <section style={{ ...cardStyle, padding: "1rem", marginTop: "1rem" }}>
                <h3 style={{ marginTop: 0, color: colors.amber }}>Control Warnings</h3>
                <ul style={{ marginBottom: 0, color: colors.muted }}>
                  {adaptiveControl.riskNotes.map((note, index) => <li key={index}>{note}</li>)}
                </ul>
              </section>
            ) : null}
          </>
        )}

        {status ? <div style={{ color: colors.muted, marginTop: "1rem", fontSize: 12 }}>{status}</div> : null}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  label: {
    display: "grid",
    gap: 4,
    color: colors.muted,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  select: {
    border: "1px solid #24465d",
    background: "#071523",
    color: colors.text,
    borderRadius: 10,
    padding: "0.55rem 0.65rem",
    fontWeight: 900,
    outline: "none",
  },
};
