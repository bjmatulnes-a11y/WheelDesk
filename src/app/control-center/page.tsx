"use client";

import { useEffect, useMemo, useState } from "react";
import ControlCenterSidebar from "../../components/control-center/ControlCenterSidebar";
import ControlCenterHeader from "../../components/control-center/ControlCenterHeader";
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
import { type ChainSnapshot, SUPPORTED_TICKERS } from "../../lib/types";
import {
  readCandles,
  readOptionSurfaceSnapshot,
  readOptionSurfaceSnapshots,
  saveCandles,
  type CandleRecord,
  type OptionSurfaceSnapshot
} from "../../lib/wheeldesk-storage";
import { buildWallMigrationSummary, findPriorSurfaceForTicker } from "../../lib/oi-wall-migration-engine";
import { getPriceSeries } from "../../lib/data-provider";

const selectedProfileStorageKey = "wheelDesk.selectedPortfolioProfileId";

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}


function toChainSnapshot(surface: OptionSurfaceSnapshot | null): ChainSnapshot | null {
  if (!surface?.chains?.length) return null;

  return {
    ticker: surface.ticker,
    snapshotDate: surface.snapshotDate,
    chains: surface.chains.map((chain) => ({
      expiration: chain.expiration,
      rows: chain.rows,
      summary: chain.summary
    }))
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

function EmptyState({ ticker }: { ticker: string }) {
  return (
    <section style={{ ...cardStyle, padding: "1.25rem" }}>
      <h2 style={{ marginTop: 0 }}>No saved OI surface for {ticker}</h2>
      <p style={{ color: colors.muted }}>
        Open the Dashboard, fetch the option chain, then save the daily OI surface. The Control Center reads from
        <code style={{ marginLeft: 4, color: colors.teal }}>wheeldesk_storage_v2.optionSurfaceSnapshots</code>.
      </p>
      <a href={`/dashboard?ticker=${encodeURIComponent(ticker)}`} style={{ color: colors.teal, fontWeight: 900 }}>Open Dashboard for {ticker}</a>
    </section>
  );
}

export default function ControlCenterPage() {
  const [mounted, setMounted] = useState(false);
  const [ticker, setTicker] = useState("SOFI");
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<OptionSurfaceSnapshot[]>([]);
  const [selectedSurfaceDate, setSelectedSurfaceDate] = useState("");
  const [candles, setCandles] = useState<CandleRecord[]>([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [status, setStatus] = useState("");

  function reloadSurfaces(nextTicker = ticker) {
    const loaded = readOptionSurfaceSnapshots(nextTicker).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    setSurfaceSnapshots(loaded);
    setSelectedSurfaceDate((current) => {
      if (current && loaded.some((surface) => surface.snapshotDate === current)) return current;
      return loaded[0]?.snapshotDate ?? "";
    });
  }

  useEffect(() => {
    setMounted(true);

    const urlTicker = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ticker")
      : null;

    const initialTicker = normalizeTicker(urlTicker) || "SOFI";
    setTicker(initialTicker);
    reloadSurfaces(initialTicker);

    const loadedProfiles = listPortfolioProfiles();
    setProfiles(loadedProfiles);
    const savedProfileId = window.localStorage.getItem(selectedProfileStorageKey);
    setSelectedProfileId(savedProfileId && loadedProfiles.some((profile) => profile.id === savedProfileId) ? savedProfileId : loadedProfiles[0]?.id ?? "");
  }, []);

  useEffect(() => {
    if (!mounted) return;
    reloadSurfaces(ticker);
  }, [ticker, mounted]);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;
    const requestedTicker = ticker;

    async function loadCandles() {
      setCandleLoading(true);
      setStatus(`Loading candles for ${requestedTicker}...`);

      try {
        const saved = readCandles(requestedTicker);
        if (saved.length) {
          if (!cancelled) {
            setCandles(saved);
            setStatus(`Loaded ${saved.length} saved candles for ${requestedTicker}.`);
          }
          return;
        }

        const series = await getPriceSeries(requestedTicker, "daily");
        const normalized = series
          .map((candle) => ({
            date: String((candle as any).date ?? (candle as any).time ?? "").slice(0, 10),
            open: Number((candle as any).open ?? (candle as any).close),
            high: Number((candle as any).high ?? (candle as any).close),
            low: Number((candle as any).low ?? (candle as any).close),
            close: Number((candle as any).close),
            volume: Number((candle as any).volume ?? 0)
          }))
          .filter((candle) => candle.date && Number.isFinite(candle.close));

        if (!cancelled) {
          if (normalized.length) {
            setCandles(normalized);
            saveCandles(requestedTicker, normalized);
            setStatus(`Fetched and saved ${normalized.length} candles for ${requestedTicker}.`);
          } else {
            setCandles([]);
            setStatus(`No candles returned for ${requestedTicker}. Open Dashboard or Scanner to fetch candles.`);
          }
        }
      } catch {
        if (!cancelled) {
          setCandles([]);
          setStatus(`Could not load candles for ${requestedTicker}. Open Dashboard or Scanner to fetch candles.`);
        }
      } finally {
        if (!cancelled) setCandleLoading(false);
      }
    }

    loadCandles();

    return () => {
      cancelled = true;
    };
  }, [ticker, mounted]);

  useEffect(() => {
    if (!mounted || !selectedProfileId || typeof window === "undefined") return;
    window.localStorage.setItem(selectedProfileStorageKey, selectedProfileId);
  }, [selectedProfileId, mounted]);

  const allTickers = useMemo(() => {
    if (!mounted) return Array.from(new Set([...SUPPORTED_TICKERS])).sort();
    const fromSurfaces = readOptionSurfaceSnapshots().map((surface) => normalizeTicker(surface.ticker)).filter(Boolean);
    return Array.from(new Set([...SUPPORTED_TICKERS, ...fromSurfaces])).sort();
  }, [mounted, surfaceSnapshots.length]);

  const surfaceDates = useMemo(() => surfaceSnapshots.map((surface) => surface.snapshotDate), [surfaceSnapshots]);

  const selectedSurface = useMemo(() => {
    if (!mounted || !ticker || !selectedSurfaceDate) return null;
    return readOptionSurfaceSnapshot({ ticker, snapshotDate: selectedSurfaceDate });
  }, [mounted, ticker, selectedSurfaceDate, surfaceSnapshots]);

  const analysisPrice = useMemo(() => {
    return candles.at(-1)?.close ?? selectedSurface?.price?.close ?? selectedSurface?.dailyStructure?.spot ?? 0;
  }, [candles, selectedSurface]);

  const activeChainSnapshot = useMemo(() => toChainSnapshot(selectedSurface), [selectedSurface]);

  const traderEdge = useMemo(() => {
    if (!selectedSurface) return null;
    return buildTraderEdgeSummary({
      ticker,
      surface: selectedSurface,
      candles,
      livePrice: analysisPrice
    });
  }, [ticker, selectedSurface, candles, analysisPrice]);

  const wallMigration = useMemo(() => {
    if (!selectedSurface) return null;
    const prior = findPriorSurfaceForTicker(surfaceSnapshots, selectedSurface.ticker, selectedSurface.snapshotDate);
    return buildWallMigrationSummary({ currentSurface: selectedSurface, priorSurface: prior });
  }, [selectedSurface, surfaceSnapshots]);

  const dealerPressure = useMemo(() => {
    return buildDealerPressureSummary({
      surface: selectedSurface,
      edge: traderEdge,
      wallMigration,
      candles,
      livePrice: analysisPrice
    });
  }, [selectedSurface, traderEdge, wallMigration, candles, analysisPrice]);

  const oiProjection = useMemo(() => {
    return buildOIProjectionReport({
      snapshot: activeChainSnapshot,
      currentPrice: analysisPrice
    });
  }, [activeChainSnapshot, analysisPrice]);

  const oiPath = useMemo(() => {
    return buildOIImpliedPath({
      projectionReport: oiProjection,
      edgeSummary: traderEdge,
      wallMigration,
      currentPrice: analysisPrice
    });
  }, [oiProjection, traderEdge, wallMigration, analysisPrice]);

  const forecastHorizonDays = useMemo(() => {
    const explicit = Number((oiPath as any)?.horizonDays ?? (oiPath as any)?.horizonSessions ?? 14);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(60, Math.round(explicit)));
    return 14;
  }, [oiPath]);

  const ivSurface = useMemo(() => {
    return buildIVSurfaceSummary({
      surface: selectedSurface,
      currentPrice: analysisPrice,
      horizonDays: forecastHorizonDays,
      candles
    });
  }, [selectedSurface, analysisPrice, forecastHorizonDays, candles]);

  const predictiveMatrix = useMemo(() => {
    return buildPredictiveMatrix({
      path: oiPath,
      dealerPressure,
      edgeSummary: traderEdge,
      wallMigration
    });
  }, [oiPath, dealerPressure, traderEdge, wallMigration]);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId), [profiles, selectedProfileId]);

  const adaptiveControl = useMemo(() => {
    return buildAdaptivePositionControl({
      ticker,
      positions: selectedProfile?.positions ?? [],
      path: oiPath,
      predictiveMatrix,
      dealerPressure,
      edgeSummary: traderEdge,
      wallMigration
    });
  }, [ticker, selectedProfile, oiPath, predictiveMatrix, dealerPressure, traderEdge, wallMigration]);

  if (!mounted) {
    return (
      <main style={{ display: "flex", minHeight: "100vh", background: `radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), ${colors.bg}` }}>
        <ControlCenterSidebar />
        <div style={{ flex: 1, padding: "1.1rem 1.4rem 2rem", minWidth: 0 }}>
          <section style={{ ...cardStyle, padding: "1.25rem" }}>
            <h1 style={{ margin: 0, color: colors.text }}>Control Center</h1>
            <p style={{ color: colors.muted, marginBottom: 0 }}>Loading Adaptive Position Control...</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main style={{ display: "flex", minHeight: "100vh", background: `radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), ${colors.bg}` }}>
      <ControlCenterSidebar />

      <div style={{ flex: 1, padding: "1.1rem 1.4rem 2rem", minWidth: 0 }}>
        <ControlCenterHeader
          ticker={ticker}
          tickers={allTickers}
          selectedDate={selectedSurfaceDate}
          dates={surfaceDates}
          confidence={adaptiveControl?.confidence ?? predictiveMatrix?.modelScore ?? null}
          onTickerChange={(nextTicker) => {
            const normalized = normalizeTicker(nextTicker);
            if (!normalized || normalized === ticker) return;
            setTicker(normalized);
            setCandles([]);
            setCandleLoading(true);
            setStatus(`Switching to ${normalized}...`);
          }}
          onDateChange={setSelectedSurfaceDate}
        />

        <div style={{ marginTop: "1rem" }}>
          <ControlSummaryCards control={adaptiveControl} matrix={predictiveMatrix} />
        </div>

        {!selectedSurface ? (
          <div style={{ marginTop: "1rem" }}><EmptyState ticker={ticker} /></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "1rem", alignItems: "start", marginTop: "1rem" }}>
              <ForecastChartPanel
                key={`${ticker}-${selectedSurfaceDate}`}
                ticker={ticker}
                candles={candles}
                edge={traderEdge}
                path={oiPath}
                matrix={predictiveMatrix}
                ivSurface={ivSurface}
                isLoading={candleLoading}
              />

              <div style={{ display: "grid", gap: "1rem" }}>
                <ScenarioPlaybookCard control={adaptiveControl} />
                <IVSurfaceCard summary={ivSurface} />
                <ModelReadoutCard dealer={dealerPressure} matrix={predictiveMatrix} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "1rem", marginTop: "1rem" }}>
              <PredictiveMatrixPanel matrix={predictiveMatrix} />
              <ControlMatrixCard control={adaptiveControl} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "0.85rem", marginTop: "1rem" }}>
              <MetricPill label="Current / Analysis Price" value={money(analysisPrice)} tone={colors.green} />
              <MetricPill label="14D Expected Move" value={ivSurface ? `±${money(ivSurface.expectedMove.oneSigma)}` : "N/A"} tone={colors.teal} />
              <MetricPill label="ATM IV" value={ivSurface?.atmIv != null ? `${(ivSurface.atmIv * 100).toFixed(1)}%` : "N/A"} tone={colors.teal} />
              <MetricPill label="Magnet" value={money(traderEdge?.magnet ?? dealerPressure?.magnet)} tone={colors.amber} />
              <MetricPill label="Support / Put Wall" value={money(traderEdge?.support ?? dealerPressure?.support)} tone={colors.red} />
              <MetricPill label="Resistance / Call Wall" value={money(traderEdge?.resistance ?? dealerPressure?.resistance)} tone={colors.green} />
            </div>

            {adaptiveControl?.riskNotes?.length ? (
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
