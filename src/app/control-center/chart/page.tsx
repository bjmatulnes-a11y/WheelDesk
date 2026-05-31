"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthGate from "../../../components/auth/AuthGate";
import ForecastChartPanel from "../../../components/control-center/ForecastChartPanel";
import OIFieldHorizonMatrix from "../../../components/control-center/OIFieldHorizonMatrix";
import OIFieldCaptureCard from "../../../components/control-center/OIFieldCaptureCard";
import { colors, cardStyle } from "../../../components/control-center/styles";
import { buildDealerPressureSummary } from "../../../lib/dealer-pressure-engine";
import { buildFlowIntelligenceView } from "../../../lib/flow-intelligence-view";
import { buildIVSurfaceSummary } from "../../../lib/iv-surface-engine";
import { buildOIImpliedPath } from "../../../lib/oi-implied-path-engine";
import { buildOIFieldForecast } from "../../../lib/oi-field-engine-v2";
import { buildOIIntelligenceView } from "../../../lib/oi-intelligence-view";
import { buildOIProjectionReport } from "../../../lib/oi-projection-engine";
import { buildPredictiveMatrix } from "../../../lib/predictive-matrix-engine";
import { buildTraderEdgeSummary } from "../../../lib/trader-edge-engine";
import {
  buildWallMigrationSummary,
  findPriorSurfaceForTicker,
} from "../../../lib/oi-wall-migration-engine";
import { getPriceSeries } from "../../../lib/data-provider";
import { safeFixed } from "../../../lib/format";
import type { ChainSnapshot, Timeframe } from "../../../lib/types";
import type {
  CandleRecord,
  OptionSurfaceSnapshot,
} from "../../../lib/wheeldesk-storage";

const TIMEFRAMES = ["daily", "weekly", "1h", "30m", "15m", "5m", "1m"] as const;
const CLASSIC_OI_PATH_MAX_DTE = 30;

type OverlayFlags = {
  prevailingSurfaceLevels: boolean;
  selectedChainLevels: boolean;
  selectedChainPath: boolean;
  selectedChainIvSurface: boolean;
  dealerPressure: boolean;
  wallMigration: boolean;
  flowIntelligence: boolean;
};

const defaultOverlayFlags: OverlayFlags = {
  prevailingSurfaceLevels: true,
  selectedChainLevels: false,
  selectedChainPath: true,
  selectedChainIvSurface: true,
  dealerPressure: true,
  wallMigration: true,
  flowIntelligence: true,
};

const candleOnlyOverlayFlags: OverlayFlags = {
  prevailingSurfaceLevels: false,
  selectedChainLevels: false,
  selectedChainPath: false,
  selectedChainIvSurface: false,
  dealerPressure: false,
  wallMigration: false,
  flowIntelligence: false,
};

const allOverlayFlags: OverlayFlags = {
  prevailingSurfaceLevels: true,
  selectedChainLevels: true,
  selectedChainPath: true,
  selectedChainIvSurface: true,
  dealerPressure: true,
  wallMigration: true,
  flowIntelligence: true,
};

function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeCandleTime(candle: any, timeframe: string): string {
  const raw =
    candle?.datetime ?? candle?.timestamp ?? candle?.time ?? candle?.date ?? "";
  if (!raw) return "";

  if (timeframe === "daily" || timeframe === "weekly") {
    return String(raw).slice(0, 10);
  }

  if (typeof raw === "number") {
    const millis = raw > 1_000_000_000_000 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toISOString();
}

function surfaceDateOf(surface: any): string {
  return String(
    surface?.snapshotDate ?? surface?.snapshot_date ?? surface?.date ?? "",
  ).slice(0, 10);
}

function expirationOf(chain: any): string {
  return String(
    chain?.expiration ??
      chain?.expirationDate ??
      chain?.expiration_date ??
      chain?.expiry ??
      "",
  );
}

function readNumeric(...values: any[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function rowOpenInterest(row: any): number {
  // Preserve existing side-row support:
  // { side: "call", openInterest } / { side: "put", open_interest }
  const sideRowOi = readNumeric(
    row?.openInterest,
    row?.open_interest,
    row?.oi,
    row?.raw?.openInterest,
    row?.raw?.open_interest,
    row?.raw?.oi,
  );
  if (sideRowOi != null) return sideRowOi;

  // Add wide-row support:
  // { strike, callOi, putOi } reconstructed from Supabase.
  const callOi =
    readNumeric(
      row?.callOi,
      row?.call_oi,
      row?.callOpenInterest,
      row?.call_open_interest,
      row?.callsOpenInterest,
      row?.calls_open_interest,
      row?.raw?.callOi,
      row?.raw?.call_oi,
      row?.raw?.callOpenInterest,
      row?.raw?.call_open_interest,
    ) ?? 0;

  const putOi =
    readNumeric(
      row?.putOi,
      row?.put_oi,
      row?.putOpenInterest,
      row?.put_open_interest,
      row?.putsOpenInterest,
      row?.puts_open_interest,
      row?.raw?.putOi,
      row?.raw?.put_oi,
      row?.raw?.putOpenInterest,
      row?.raw?.put_open_interest,
    ) ?? 0;

  return callOi + putOi;
}

function totalChainOi(chain: any): number {
  return ((chain?.rows ?? []) as any[]).reduce(
    (sum, row) => sum + rowOpenInterest(row),
    0,
  );
}

function dteFromExpiration(
  expiration: string,
  snapshotDate: string,
): number | null {
  if (!expiration || !snapshotDate) return null;
  const exp = new Date(`${expiration.slice(0, 10)}T00:00:00Z`);
  const snap = new Date(`${snapshotDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(exp.getTime()) || Number.isNaN(snap.getTime())) return null;
  return Math.max(
    0,
    Math.round((exp.getTime() - snap.getTime()) / (1000 * 60 * 60 * 24)),
  );
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
    surfaceKey:
      raw.surfaceKey ?? raw.surface_key ?? `${ticker}_${snapshotDate}`,
    chains,
    dailyStructure:
      raw.dailyStructure ?? raw.daily_structure ?? raw.structure ?? null,
    price: raw.price ?? {
      date: snapshotDate,
      close: Number(
        raw.spot ?? raw.dailyStructure?.spot ?? raw.daily_structure?.spot ?? 0,
      ),
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
        .filter((snapshot): snapshot is OptionSurfaceSnapshot =>
          Boolean(snapshot),
        );
    }
  }

  const normalized = normalizeSurfaceSnapshot(
    payload?.snapshot ?? payload?.surface ?? payload,
  );
  return normalized ? [normalized] : [];
}

async function fetchSupabaseSurfaces(
  ticker: string,
): Promise<OptionSurfaceSnapshot[]> {
  const response = await fetch(
    `/api/supabase/surface-snapshot?ticker=${encodeURIComponent(ticker)}&limit=120`,
    {
      cache: "no-store",
    },
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error ?? `Supabase surface request failed: ${response.status}`,
    );
  }

  return extractSnapshots(payload).sort((a, b) =>
    b.snapshotDate.localeCompare(a.snapshotDate),
  );
}

function toChainSnapshot(
  surface: OptionSurfaceSnapshot | null,
): ChainSnapshot | null {
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

function makeSingleChainSurface(
  surface: OptionSurfaceSnapshot | null,
  chain: any | null,
): OptionSurfaceSnapshot | null {
  if (!surface || !chain) return null;
  return { ...surface, chains: [chain] } as OptionSurfaceSnapshot;
}

function findMatchingExpirationSurface(
  surface: OptionSurfaceSnapshot | null,
  expiration: string,
): OptionSurfaceSnapshot | null {
  if (!surface || !expiration) return null;
  const matchingChain = (surface.chains as any[] | undefined)?.find(
    (chain) => expirationOf(chain) === expiration,
  );
  if (!matchingChain) return null;
  return makeSingleChainSurface(surface, matchingChain);
}

function makeDteWindowSurface(
  surface: OptionSurfaceSnapshot | null,
  maxDte = CLASSIC_OI_PATH_MAX_DTE,
): OptionSurfaceSnapshot | null {
  if (!surface?.chains?.length) return null;
  const snapshotDate = surfaceDateOf(surface);
  const chains = ((surface.chains ?? []) as any[])
    .map((chain) => {
      const expiration = expirationOf(chain).slice(0, 10);
      const dte = Number(
        chain?.dteAtCapture ??
          chain?.dte ??
          chain?.summary?.dte ??
          dteFromExpiration(expiration, snapshotDate),
      );
      return { chain, dte };
    })
    .filter(
      (item) =>
        Number.isFinite(item.dte) && item.dte >= 0 && item.dte <= maxDte,
    )
    .map((item) => item.chain);

  if (!chains.length) return null;
  return { ...surface, chains } as OptionSurfaceSnapshot;
}

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return safeFixed(value, Math.abs(value) >= 1000 ? 0 : 2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${safeFixed(value * 100, 1)}%`;
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
        whiteSpace: "nowrap",
      }}
    >
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function ChartOverlayControls({
  overlays,
  setOverlays,
}: {
  overlays: OverlayFlags;
  setOverlays: Dispatch<SetStateAction<OverlayFlags>>;
}) {
  const buttonStyle = {
    border: "1px solid rgba(148, 163, 184, 0.24)",
    background: "rgba(15, 23, 42, 0.68)",
    color: colors.text,
    borderRadius: 999,
    padding: "0.42rem 0.66rem",
    fontSize: 11,
    fontWeight: 950,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };

  return (
    <section
      style={{
        ...cardStyle,
        padding: "0.85rem 1rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ color: colors.text, fontSize: 13, fontWeight: 950 }}>
            Chart Room overlays
          </div>
          <div style={{ color: colors.muted, fontSize: 12 }}>
            Use this tab as the dedicated visual workspace while Control Center
            stays open.
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setOverlays(defaultOverlayFlags)}
            style={buttonStyle}
          >
            Default
          </button>
          <button
            type="button"
            onClick={() => setOverlays(allOverlayFlags)}
            style={buttonStyle}
          >
            All overlays
          </button>
          <button
            type="button"
            onClick={() => setOverlays(candleOnlyOverlayFlags)}
            style={buttonStyle}
          >
            Candles only
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Toggle
          checked={overlays.prevailingSurfaceLevels}
          label="Prevailing levels"
          onChange={(checked) =>
            setOverlays((current) => ({
              ...current,
              prevailingSurfaceLevels: checked,
            }))
          }
        />
        <Toggle
          checked={overlays.selectedChainLevels}
          label="Chain OI levels"
          onChange={(checked) =>
            setOverlays((current) => ({
              ...current,
              selectedChainLevels: checked,
            }))
          }
        />
        <Toggle
          checked={overlays.selectedChainPath}
          label="Classic 30D OI path"
          onChange={(checked) =>
            setOverlays((current) => ({
              ...current,
              selectedChainPath: checked,
            }))
          }
        />
        <Toggle
          checked={overlays.selectedChainIvSurface}
          label="IV band"
          onChange={(checked) =>
            setOverlays((current) => ({
              ...current,
              selectedChainIvSurface: checked,
            }))
          }
        />
        <Toggle
          checked={overlays.dealerPressure}
          label="Dealer pressure"
          onChange={(checked) =>
            setOverlays((current) => ({ ...current, dealerPressure: checked }))
          }
        />
        <Toggle
          checked={overlays.wallMigration}
          label="Wall migration"
          onChange={(checked) =>
            setOverlays((current) => ({ ...current, wallMigration: checked }))
          }
        />
        <Toggle
          checked={overlays.flowIntelligence}
          label="Flow intelligence"
          onChange={(checked) =>
            setOverlays((current) => ({
              ...current,
              flowIntelligence: checked,
            }))
          }
        />
      </div>
    </section>
  );
}

function MetricPill({
  label,
  value,
  tone = colors.teal,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div style={{ ...cardStyle, padding: "0.85rem" }}>
      <div style={{ color: colors.muted, fontSize: 12 }}>{label}</div>
      <div style={{ color: tone, fontSize: 22, fontWeight: 950, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function ChartRoomContent() {
  const searchParams = useSearchParams();
  const initialTicker =
    normalizeTicker(searchParams.get("ticker") ?? searchParams.get("symbol")) ||
    "SOFI";
  const initialSurfaceDate = String(
    searchParams.get("surfaceDate") ?? searchParams.get("surface") ?? "",
  ).slice(0, 10);
  const initialExpiration = String(searchParams.get("expiration") ?? "");
  const initialTimeframe = String(
    searchParams.get("tf") ?? searchParams.get("timeframe") ?? "daily",
  );

  const [mounted, setMounted] = useState(false);
  const [ticker, setTicker] = useState(initialTicker);
  const [tickerInput, setTickerInput] = useState(initialTicker);
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<
    OptionSurfaceSnapshot[]
  >([]);
  const [selectedSurfaceDate, setSelectedSurfaceDate] =
    useState(initialSurfaceDate);
  const [selectedExpiration, setSelectedExpiration] =
    useState(initialExpiration);
  const [candleTimeframe, setCandleTimeframe] = useState<string>(
    TIMEFRAMES.includes(initialTimeframe as any) ? initialTimeframe : "daily",
  );
  const [candles, setCandles] = useState<CandleRecord[]>([]);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [candleLoading, setCandleLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [overlays, setOverlays] = useState<OverlayFlags>(defaultOverlayFlags);

  useEffect(() => {
    setMounted(true);
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
          if (
            current &&
            loaded.some((surface) => surface.snapshotDate === current)
          )
            return current;
          if (
            initialSurfaceDate &&
            loaded.some(
              (surface) => surface.snapshotDate === initialSurfaceDate,
            )
          )
            return initialSurfaceDate;
          return loaded[0]?.snapshotDate ?? "";
        });

        setStatus(
          loaded.length
            ? `Loaded ${loaded.length} Supabase surface(s) for ${ticker}.`
            : `No Supabase surface found for ${ticker}.`,
        );
      } catch (error) {
        if (cancelled) return;
        setSurfaceSnapshots([]);
        setSelectedSurfaceDate("");
        setSelectedExpiration("");
        setStatus(
          error instanceof Error
            ? error.message
            : `Could not load Supabase surfaces for ${ticker}.`,
        );
      } finally {
        if (!cancelled) setSurfaceLoading(false);
      }
    }

    loadSurfaces();

    return () => {
      cancelled = true;
    };
  }, [ticker, mounted, initialSurfaceDate]);

  useEffect(() => {
    if (!mounted || !ticker) return;

    let cancelled = false;
    const requestedTicker = ticker;
    const requestedTimeframe = candleTimeframe;

    async function loadCandles() {
      setCandleLoading(true);
      try {
        const series = await getPriceSeries(
          requestedTicker,
          requestedTimeframe as Timeframe,
        );
        const normalized = series
          .map((candle) => ({
            date: normalizeCandleTime(candle, requestedTimeframe),
            open: Number((candle as any).open ?? (candle as any).close),
            high: Number((candle as any).high ?? (candle as any).close),
            low: Number((candle as any).low ?? (candle as any).close),
            close: Number((candle as any).close),
            volume: Number((candle as any).volume ?? 0),
          }))
          .filter((candle) => candle.date && Number.isFinite(candle.close));

        if (!cancelled) setCandles(normalized as CandleRecord[]);
      } catch {
        if (!cancelled) setCandles([]);
      } finally {
        if (!cancelled) setCandleLoading(false);
      }
    }

    loadCandles();

    return () => {
      cancelled = true;
    };
  }, [ticker, candleTimeframe, mounted]);

  const selectedSurface = useMemo(() => {
    if (!selectedSurfaceDate) return surfaceSnapshots[0] ?? null;
    return (
      surfaceSnapshots.find(
        (surface) => surface.snapshotDate === selectedSurfaceDate,
      ) ??
      surfaceSnapshots[0] ??
      null
    );
  }, [surfaceSnapshots, selectedSurfaceDate]);

  const expirationOptions = useMemo(() => {
    const chains = (selectedSurface?.chains ?? []) as any[];
    const maxOi = Math.max(0, ...chains.map((chain) => totalChainOi(chain)));

    return chains
      .map((chain: any) => {
        const expiration = expirationOf(chain);
        const chainOi = totalChainOi(chain);
        return {
          expiration,
          dte:
            chain?.dteAtCapture ??
            dteFromExpiration(expiration, selectedSurface?.snapshotDate ?? ""),
          score: chainScore(chain),
          dominanceScore: maxOi > 0 ? (chainOi / maxOi) * 100 : null,
          totalOi: chainOi,
        };
      })
      .filter((item) => item.expiration)
      .sort((a, b) => String(a.expiration).localeCompare(String(b.expiration)));
  }, [selectedSurface]);

  useEffect(() => {
    if (!selectedSurface) {
      setSelectedExpiration("");
      return;
    }

    setSelectedExpiration((current) => {
      if (
        current &&
        expirationOptions.some((item) => item.expiration === current)
      )
        return current;
      if (
        initialExpiration &&
        expirationOptions.some((item) => item.expiration === initialExpiration)
      )
        return initialExpiration;
      return expirationOptions[0]?.expiration ?? "";
    });
  }, [selectedSurface, expirationOptions, initialExpiration]);

  const selectedChain = useMemo(() => {
    if (!selectedSurface?.chains?.length) return null;
    return (
      (selectedSurface.chains as any[]).find(
        (chain) => expirationOf(chain) === selectedExpiration,
      ) ??
      selectedSurface.chains[0] ??
      null
    );
  }, [selectedSurface, selectedExpiration]);

  const selectedChainSurface = useMemo(
    () => makeSingleChainSurface(selectedSurface, selectedChain),
    [selectedSurface, selectedChain],
  );

  const priorFullSurface = useMemo(() => {
    if (!selectedSurface) return null;
    return findPriorSurfaceForTicker(
      surfaceSnapshots,
      selectedSurface.ticker,
      selectedSurface.snapshotDate,
    );
  }, [selectedSurface, surfaceSnapshots]);

  const priorSelectedChainSurface = useMemo(
    () => findMatchingExpirationSurface(priorFullSurface, selectedExpiration),
    [priorFullSurface, selectedExpiration],
  );

  const classicWindowSurface = useMemo(
    () => makeDteWindowSurface(selectedSurface, CLASSIC_OI_PATH_MAX_DTE),
    [selectedSurface],
  );

  const priorClassicWindowSurface = useMemo(
    () => makeDteWindowSurface(priorFullSurface, CLASSIC_OI_PATH_MAX_DTE),
    [priorFullSurface],
  );

  const analysisPrice = useMemo(() => {
    const lastClose = candles.length
      ? candles[candles.length - 1]?.close
      : null;
    const surfaceClose = Number(
      selectedSurface?.price?.close ??
        selectedSurface?.dailyStructure?.spot ??
        0,
    );
    return Number.isFinite(surfaceClose) && surfaceClose > 0
      ? surfaceClose
      : Number(lastClose ?? 0);
  }, [candles, selectedSurface]);

  const surfaceTraderEdge = useMemo(() => {
    if (!selectedSurface) return null;
    return buildTraderEdgeSummary({
      ticker,
      surface: selectedSurface,
      candles,
      livePrice: analysisPrice,
    });
  }, [ticker, selectedSurface, candles, analysisPrice]);

  const chainTraderEdge = useMemo(() => {
    if (!selectedChainSurface) return null;
    return buildTraderEdgeSummary({
      ticker,
      surface: selectedChainSurface,
      candles,
      livePrice: analysisPrice,
    });
  }, [ticker, selectedChainSurface, candles, analysisPrice]);

  const chainWallMigration = useMemo(
    () =>
      buildWallMigrationSummary({
        currentSurface: selectedChainSurface,
        priorSurface: priorSelectedChainSurface,
      }),
    [selectedChainSurface, priorSelectedChainSurface],
  );

  const classicTraderEdge = useMemo(() => {
    if (!classicWindowSurface) return null;
    return buildTraderEdgeSummary({
      ticker,
      surface: classicWindowSurface,
      candles,
      livePrice: analysisPrice,
    });
  }, [ticker, classicWindowSurface, candles, analysisPrice]);

  const classicWallMigration = useMemo(
    () =>
      buildWallMigrationSummary({
        currentSurface: classicWindowSurface,
        priorSurface: priorClassicWindowSurface,
      }),
    [classicWindowSurface, priorClassicWindowSurface],
  );

  const chainDealerPressure = useMemo(
    () =>
      buildDealerPressureSummary({
        surface: selectedChainSurface,
        edge: chainTraderEdge,
        wallMigration: chainWallMigration,
        candles,
        livePrice: analysisPrice,
      }),
    [
      selectedChainSurface,
      chainTraderEdge,
      chainWallMigration,
      candles,
      analysisPrice,
    ],
  );

  const classicProjectionReport = useMemo(
    () =>
      buildOIProjectionReport({
        snapshot: toChainSnapshot(classicWindowSurface),
        currentPrice: analysisPrice,
        maxDte: CLASSIC_OI_PATH_MAX_DTE,
      }),
    [classicWindowSurface, analysisPrice],
  );

  const classicOIPath = useMemo(
    () =>
      buildOIImpliedPath({
        projectionReport: classicProjectionReport,
        edgeSummary: classicTraderEdge,
        wallMigration: classicWallMigration,
        currentPrice: analysisPrice,
      }),
    [
      classicProjectionReport,
      classicTraderEdge,
      classicWallMigration,
      analysisPrice,
    ],
  );

  const chainProjectionReport = useMemo(
    () =>
      buildOIProjectionReport({
        snapshot: toChainSnapshot(selectedChainSurface),
        currentPrice: analysisPrice,
      }),
    [selectedChainSurface, analysisPrice],
  );

  const chainOIPath = useMemo(
    () =>
      buildOIImpliedPath({
        projectionReport: chainProjectionReport,
        edgeSummary: chainTraderEdge,
        wallMigration: chainWallMigration,
        currentPrice: analysisPrice,
      }),
    [chainProjectionReport, chainTraderEdge, chainWallMigration, analysisPrice],
  );

  const predictiveMatrix = useMemo(
    () =>
      buildPredictiveMatrix({
        path: chainOIPath,
        dealerPressure: chainDealerPressure,
        edgeSummary: chainTraderEdge,
        wallMigration: chainWallMigration,
      }),
    [chainOIPath, chainDealerPressure, chainTraderEdge, chainWallMigration],
  );

  const selectedExpirationDte = useMemo(() => {
    return (
      expirationOptions.find((item) => item.expiration === selectedExpiration)
        ?.dte ?? null
    );
  }, [expirationOptions, selectedExpiration]);

  const oiFieldForecast = useMemo(
    () =>
      buildOIFieldForecast({
        path: chainOIPath,
        projectionReport: chainProjectionReport,
        edgeSummary: chainTraderEdge,
        wallMigration: chainWallMigration,
        currentPrice: analysisPrice,
        selectedExpirationDte,
      }),
    [
      chainOIPath,
      chainProjectionReport,
      chainTraderEdge,
      chainWallMigration,
      analysisPrice,
      selectedExpirationDte,
    ],
  );

  const chainIVSurface = useMemo(() => {
    const dte =
      expirationOptions.find((item) => item.expiration === selectedExpiration)
        ?.dte ?? 14;
    return buildIVSurfaceSummary({
      surface: selectedChainSurface,
      currentPrice: analysisPrice,
      horizonDays: dte,
      candles,
    });
  }, [
    selectedChainSurface,
    analysisPrice,
    expirationOptions,
    selectedExpiration,
    candles,
  ]);

  const flowIntelligence = useMemo(
    () =>
      buildFlowIntelligenceView({
        surface: selectedChainSurface,
        currentPrice: analysisPrice,
      }),
    [selectedChainSurface, analysisPrice],
  );

  const chainOIIntelligence = useMemo(
    () =>
      buildOIIntelligenceView({
        surface: selectedChainSurface,
        currentPrice: analysisPrice,
      }),
    [selectedChainSurface, analysisPrice],
  );

  const selectedChainOIChartEdge = chainOIIntelligence?.report
    ? {
        magnet: chainOIIntelligence.report.adjustedCenter,
        resistance: chainOIIntelligence.report.adjustedCallWall,
        support: chainOIIntelligence.report.adjustedPutWall,
      }
    : null;

  const chartEdge = overlays.selectedChainLevels
    ? selectedChainOIChartEdge
    : overlays.prevailingSurfaceLevels
      ? surfaceTraderEdge
      : null;

  const chartEdgeLabelMode = overlays.selectedChainLevels ? "oi" : "control";
  const chartPath = overlays.selectedChainPath ? classicOIPath : null;
  const chartIvSurface = overlays.selectedChainIvSurface
    ? chainIVSurface
    : null;
  const chartMatrix =
    overlays.dealerPressure || overlays.wallMigration ? predictiveMatrix : null;
  const chartFlowOverlay = overlays.flowIntelligence ? flowIntelligence : null;

  function applyTickerChange() {
    const normalized = normalizeTicker(tickerInput);
    if (!normalized) return;
    setTicker(normalized);
    setTickerInput(normalized);
    setSurfaceSnapshots([]);
    setSelectedSurfaceDate("");
    setSelectedExpiration("");
    setCandles([]);
  }

  const controlCenterHref = `/control-center?ticker=${encodeURIComponent(ticker)}`;

  return (
    <AuthGate>
      <main
        style={{
          minHeight: "100vh",
          background: `radial-gradient(circle at top left, rgba(34, 211, 238, 0.13), transparent 28%), ${colors.bg}`,
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: 1840,
            margin: "0 auto",
            display: "grid",
            gap: "1rem",
          }}
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: colors.teal,
                  fontSize: 12,
                  fontWeight: 950,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                WheelDesk Chart Room
              </div>
              <h1
                style={{
                  color: colors.text,
                  margin: "0.3rem 0 0",
                  fontSize: "clamp(2rem, 4vw, 4.2rem)",
                  letterSpacing: "-0.06em",
                }}
              >
                {ticker} structure chart
              </h1>
              <p
                style={{
                  color: colors.muted,
                  margin: "0.35rem 0 0",
                  maxWidth: 850,
                }}
              >
                Dedicated large-screen chart workspace. Keep Control Center open
                in the original tab while this view runs the chart, OI path, IV
                band, dealer pressure, wall migration, and flow overlays.
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
              <Link
                href={controlCenterHref}
                style={{
                  border: "1px solid rgba(34, 211, 238, 0.35)",
                  background: "rgba(34, 211, 238, 0.12)",
                  color: colors.teal,
                  borderRadius: 999,
                  padding: "0.62rem 0.86rem",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 950,
                }}
              >
                ← Back to Control Center
              </Link>
            </div>
          </header>

          <section
            style={{
              ...cardStyle,
              padding: "0.9rem 1rem",
              display: "grid",
              gap: "0.85rem",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
                gap: "0.75rem",
                alignItems: "end",
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: 6,
                  color: colors.muted,
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                Ticker
                <div style={{ display: "flex", gap: "0.45rem" }}>
                  <input
                    value={tickerInput}
                    onChange={(event) =>
                      setTickerInput(event.target.value.toUpperCase())
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyTickerChange();
                    }}
                    style={{
                      width: "100%",
                      border: "1px solid rgba(148, 163, 184, 0.24)",
                      background: "rgba(15, 23, 42, 0.88)",
                      color: colors.text,
                      borderRadius: 12,
                      padding: "0.68rem 0.75rem",
                      fontWeight: 950,
                    }}
                  />
                  <button
                    type="button"
                    onClick={applyTickerChange}
                    style={{
                      border: "1px solid rgba(34, 211, 238, 0.35)",
                      background: "rgba(34, 211, 238, 0.12)",
                      color: colors.teal,
                      borderRadius: 12,
                      padding: "0 0.75rem",
                      fontWeight: 950,
                      cursor: "pointer",
                    }}
                  >
                    Load
                  </button>
                </div>
              </label>

              <label
                style={{
                  display: "grid",
                  gap: 6,
                  color: colors.muted,
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                Surface Date
                <select
                  value={selectedSurfaceDate}
                  onChange={(event) =>
                    setSelectedSurfaceDate(event.target.value)
                  }
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.24)",
                    background: "rgba(15, 23, 42, 0.88)",
                    color: colors.text,
                    borderRadius: 12,
                    padding: "0.68rem 0.75rem",
                    fontWeight: 850,
                  }}
                >
                  {!surfaceSnapshots.length ? (
                    <option value="">No surfaces</option>
                  ) : null}
                  {surfaceSnapshots.map((surface) => (
                    <option
                      key={surface.snapshotDate}
                      value={surface.snapshotDate}
                    >
                      {surface.snapshotDate}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: "grid",
                  gap: 6,
                  color: colors.muted,
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                Expiration Chain
                <select
                  value={selectedExpiration}
                  onChange={(event) =>
                    setSelectedExpiration(event.target.value)
                  }
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.24)",
                    background: "rgba(15, 23, 42, 0.88)",
                    color: colors.text,
                    borderRadius: 12,
                    padding: "0.68rem 0.75rem",
                    fontWeight: 850,
                  }}
                >
                  {!expirationOptions.length ? (
                    <option value="">No chains</option>
                  ) : null}
                  {expirationOptions.map((item) => (
                    <option key={item.expiration} value={item.expiration}>
                      {item.expiration}
                      {item.dte != null ? ` | ${item.dte}D` : ""}
                      {item.dominanceScore != null
                        ? ` | dom ${safeFixed(item.dominanceScore, 1)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: "grid",
                  gap: 6,
                  color: colors.muted,
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                Candles
                <select
                  value={candleTimeframe}
                  onChange={(event) => setCandleTimeframe(event.target.value)}
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.24)",
                    background: "rgba(15, 23, 42, 0.88)",
                    color: colors.text,
                    borderRadius: 12,
                    padding: "0.68rem 0.75rem",
                    fontWeight: 850,
                  }}
                >
                  {TIMEFRAMES.map((timeframe) => (
                    <option key={timeframe} value={timeframe}>
                      {timeframe}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ color: colors.muted, fontSize: 12 }}>
              {surfaceLoading || candleLoading
                ? "Loading chart room data..."
                : status}
            </div>
          </section>

          <ChartOverlayControls overlays={overlays} setOverlays={setOverlays} />

          <section
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
              gap: "0.75rem",
            }}
          >
            <MetricPill
              label="Current / Analysis"
              value={fmt(analysisPrice)}
              tone={colors.green}
            />
            <MetricPill
              label="Surface"
              value={selectedSurface?.snapshotDate ?? "N/A"}
              tone={colors.text}
            />
            <MetricPill
              label="Expiration"
              value={selectedExpiration || "N/A"}
              tone={colors.teal}
            />
            <MetricPill
              label="Rows"
              value={String(
                selectedChainSurface?.chains?.[0]?.rows?.length ?? 0,
              )}
              tone={colors.teal}
            />
            <MetricPill
              label="ATM IV"
              value={pct(chainIVSurface?.atmIv)}
              tone={colors.amber}
            />
            <MetricPill
              label="Flow Bias"
              value={(flowIntelligence?.bias ?? "neutral").toUpperCase()}
              tone={
                flowIntelligence?.bias === "bearish"
                  ? colors.red
                  : flowIntelligence?.bias === "bullish"
                    ? colors.green
                    : colors.amber
              }
            />
          </section>

          {selectedSurface ? (
            <div style={{ display: "grid", gap: "0.85rem" }}>
              <OIFieldHorizonMatrix forecast={oiFieldForecast} />
              <OIFieldCaptureCard
                ticker={ticker}
                spot={analysisPrice}
                snapshotDate={selectedSurfaceDate}
                expiration={selectedExpiration}
                dte={selectedExpirationDte}
                forecast={oiFieldForecast}
                classicPath={classicOIPath}
                chainPath={chainOIPath}
                forecastOverlayMaxDte={CLASSIC_OI_PATH_MAX_DTE}
                ivSurface={chainIVSurface}
                selectedSurface={selectedSurface}
                selectedChainSurface={selectedChainSurface}
                source="chart_room"
                compact
              />
            </div>
          ) : null}

          {selectedSurface ? (
            <ForecastChartPanel
              key={`chart-room-${ticker}-${selectedSurfaceDate}-${selectedExpiration}-${candleTimeframe}-${String(overlays.prevailingSurfaceLevels)}-${String(overlays.selectedChainLevels)}-${String(overlays.selectedChainPath)}-${String(overlays.selectedChainIvSurface)}-${String(overlays.dealerPressure)}-${String(overlays.wallMigration)}-${String(overlays.flowIntelligence)}`}
              ticker={ticker}
              candles={candles}
              edge={chartEdge}
              edgeLabelMode={chartEdgeLabelMode}
              path={chartPath}
              matrix={chartMatrix}
              ivSurface={chartIvSurface}
              flowOverlay={chartFlowOverlay}
              fieldForecast={
                overlays.selectedChainPath ? oiFieldForecast : null
              }
              surfaceDate={selectedSurfaceDate}
              expiration={selectedExpiration}
              structureFocus
              isLoading={candleLoading || surfaceLoading}
              chartHeight={760}
            />
          ) : (
            <section style={{ ...cardStyle, padding: "1.25rem" }}>
              <h2 style={{ marginTop: 0, color: colors.text }}>
                No Supabase OI surface loaded for {ticker}
              </h2>
              <p style={{ color: colors.muted }}>
                Chart Room needs a saved option surface from Supabase.
                Load/harvest a ticker first, then open Chart Room from Control
                Center.
              </p>
              <Link
                href="/dashboard"
                style={{ color: colors.teal, fontWeight: 950 }}
              >
                Open Dashboard Harvest
              </Link>
            </section>
          )}
        </div>
      </main>
    </AuthGate>
  );
}

export default function ControlCenterChartRoomPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            background: colors.bg,
            color: colors.text,
            padding: "2rem",
          }}
        >
          Loading Chart Room...
        </div>
      }
    >
      <ChartRoomContent />
    </Suspense>
  );
}
