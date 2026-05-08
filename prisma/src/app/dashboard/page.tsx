"use client";

import { useEffect, useMemo, useState } from "react";
import { ChainGraph } from "../../components/chain-graph";
import { ChartPanel } from "../../components/ChartPanel";
import { DecisionCard } from "../../components/decision-card";
import { OIProjectionCard } from "../../components/oi-projection-card";
import { OISummaryCard } from "../../components/oi-summary-card";
import { OIChainTable } from "../../components/oi-chain-table";
import { SnapshotComparisonCard } from "../../components/snapshot-comparison-card";
import { SnapshotSelector } from "../../components/snapshot-selector";
import { buildDailyStructureDrift } from "../../lib/daily-structure-compare";
import { buildOISurfaceComparison } from "../../lib/oi-surface-compare";
import { OISurfaceComparisonCard } from "../../components/OISurfaceComparisonCard";
import {
  deleteChainSnapshots,
  getSavedChainSnapshots,
  makeSnapshotKey,
  getOptionChain,
  getPriceSeries
} from "../../lib/data-provider";
import {
  clearExpiredDashboardCache,
  loadCachedCandles,
  loadCachedOptionChain,
  saveCachedCandles,
  saveCachedOptionChain
} from "../../lib/dashboard-cache";
import {
  buildDailyStructureSnapshot,
  listDailyStructureSnapshots,
  saveDailyStructureSnapshot
} from "../../lib/daily-structure-store";
import { buildSnapshotStructureSeries } from "../../lib/chart-overlay";
import { buildSnapshotComparison } from "../../lib/compare-snapshots";
import { analyzeOIIntelligence } from "../../lib/oi-intelligence-engine";
import { buildOIProjectionReport } from "../../lib/oi-projection-engine";
import { getSurfacePrevailingLevels } from "../../lib/oi-prevailing-levels";
import { rankPrevailingChains } from "../../lib/prevailing-chain";
import { calculateBollinger, runPositionEngine } from "../../lib/position-engine";
import { createLocalPersistenceAdapter } from "../../lib/storage";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { PortfolioPosition, PortfolioProfile } from "../../lib/portfolio-types";
import {
  ChainSnapshot,
  ChainSnapshotEntry,
  DashboardPreferences,
  ExpirationSummary,
  OverlayFlags,
  SUPPORTED_TICKERS,
  SUPPORTED_TIMEFRAMES,
  SupportedTicker,
  Timeframe
} from "../../lib/types";

const today = new Date().toISOString().slice(0, 10);
const SELECTED_PROFILE_STORAGE_KEY = "wheelDesk.selectedPortfolioProfileId";
const WATCHLIST_STORAGE_KEY = "wheelDesk.dashboardWatchlist";

const defaultOverlays: OverlayFlags = {
  showSavedOiHistory: true,
  showOiCenter: true,
  showOiRange: true,
  showWalls: true,
  showOiZones: false
};



function summarizeTickerPositions(ticker: string, positions: PortfolioPosition[]) {
  const matching = positions.filter((p) => p.symbol?.toUpperCase() === ticker.toUpperCase());
  const shares = matching
    .filter((p) => p.instrumentType === "stock")
    .reduce((sum, p) => sum + (p.side === "long" ? 1 : -1) * (p.qty ?? 0), 0);

  const shortCalls = matching.filter((p) => p.instrumentType === "call" && p.side === "short");
  const shortPuts = matching.filter((p) => p.instrumentType === "put" && p.side === "short");

  return { matching, shares, shortCalls, shortPuts };
}

function PortfolioContextCard({
  ticker,
  profiles,
  selectedProfileId,
  onSelectProfile
}: {
  ticker: string;
  profiles: PortfolioProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
}) {
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const positions = selectedProfile?.positions ?? [];
  const summary = summarizeTickerPositions(ticker, positions);

  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>Portfolio Context</h3>

      <label style={{ display: "grid", gap: 4, maxWidth: 360 }}>
        Selected Portfolio
        <select value={selectedProfileId} onChange={(e) => onSelectProfile(e.target.value)}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      {!selectedProfile ? (
        <p style={{ color: "#6b7280" }}>
          No portfolio profile selected. Market structure can still be used without portfolio context.
        </p>
      ) : summary.matching.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 4 }}>
            <strong>No {ticker} position in selected portfolio.</strong>
          </p>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            You can still analyze {ticker} market structure. Add a {ticker} position on the Portfolio page to enable
            position-aware decisions.
          </p>
          <a href="/portfolio">Open Portfolio</a>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 13 }}>
          <div>
            <strong>{ticker} exposure:</strong>
          </div>
          <div>Shares: {summary.shares.toLocaleString()}</div>
          <div>
            Short Calls:{" "}
            {summary.shortCalls.length
              ? summary.shortCalls.map((p) => `${p.qty ?? 0} @ ${p.strike ?? "?"} exp ${p.expiration ?? "?"}`).join(", ")
              : "none"}
          </div>
          <div>
            Short Puts:{" "}
            {summary.shortPuts.length
              ? summary.shortPuts.map((p) => `${p.qty ?? 0} @ ${p.strike ?? "?"} exp ${p.expiration ?? "?"}`).join(", ")
              : "none"}
          </div>
          <div style={{ marginTop: 4 }}>
            <a href="/portfolio">Manage Portfolio</a>
          </div>
        </div>
      )}
    </section>
  );
}

function OIIntelligenceCard({
  report
}: {
  report: ReturnType<typeof analyzeOIIntelligence> | null;
}) {
  if (!report) return null;

  return (
    <section style={{ border: "1px solid #7c3aed", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
      <h3 style={{ marginTop: 0 }}>OI Intelligence</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, fontSize: 13 }}>
        <div>
          <strong>Active Call Wall:</strong> {report.adjustedCallWall.toFixed(2)}
        </div>
        <div>
          <strong>Active Put Wall:</strong> {report.adjustedPutWall.toFixed(2)}
        </div>
        <div>
          <strong>Active Center:</strong> {report.adjustedCenter.toFixed(2)}
        </div>
      </div>

      <p style={{ marginBottom: 4 }}>{report.activeStructureSummary}</p>
      <p style={{ marginTop: 0 }}>{report.anomalySummary}</p>

      <h4>Readout</h4>
      <ul>
        {report.intelligenceReadout.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {report.anomalies.length > 0 && (
        <>
          <h4>Anomalies</h4>
          <div style={{ display: "grid", gap: 8 }}>
            {report.anomalies.map((a) => (
              <div
                key={`${a.type}-${a.side}-${a.strike}`}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "0.65rem",
                  background: a.severity === "high" ? "#fef2f2" : "#fffbeb"
                }}
              >
                <div>
                  <strong>{a.severity.toUpperCase()}:</strong> {a.description}
                </div>
                <div>OI: {a.openInterest.toLocaleString()} contracts</div>
                <div>Share equivalent: {a.shareEquivalent.toLocaleString()} shares</div>
                <div>{a.interpretation}</div>
                <div>
                  <strong>Action:</strong> {a.action}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const storage = createLocalPersistenceAdapter();

  const [ticker, setTicker] = useState<SupportedTicker>("AAPL");
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [watchlist, setWatchlist] = useState<SupportedTicker[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [asOfDate, setAsOfDate] = useState(today);
  const [overlays, setOverlays] = useState<OverlayFlags>(defaultOverlays);
  const [status, setStatus] = useState("No option chain loaded yet.");
  const [lastSaveStatus, setLastSaveStatus] = useState("idle");

  const [portfolioProfiles, setPortfolioProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");

  const [fetchedSnapshot, setFetchedSnapshot] = useState<ChainSnapshot | null>(null);
  const [savedChainSnapshots, setSavedChainSnapshots] = useState<ChainSnapshotEntry[]>([]);
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("");
  const [compareSnapshotDate, setCompareSnapshotDate] = useState("");
  const [selectedExpiration, setSelectedExpiration] = useState("");
  const [selectionOwner, setSelectionOwner] = useState<"manual" | "snapshot" | "auto">("auto");
  const [allowAutoSelection, setAllowAutoSelection] = useState(true);
  const [hasFetchedChain, setHasFetchedChain] = useState(false);
  const [chainSelectionStatus, setChainSelectionStatus] = useState("preserved");
  const [mounted, setMounted] = useState(false);  
  const [dailyStructureHistory, setDailyStructureHistory] = useState(() =>
    listDailyStructureSnapshots("AAPL")
  );

  const [candles, setCandles] = useState<Awaited<ReturnType<typeof getPriceSeries>>>([]);
  const currentPrice = candles.at(-1)?.close ?? 0;
  useEffect(() => {
  setMounted(true);
}, []);
  useEffect(() => {
    clearExpiredDashboardCache();

    const cachedCandles = loadCachedCandles(ticker, timeframe);
    if (cachedCandles) {
      setCandles(cachedCandles);
      return;
    }

    getPriceSeries(ticker, timeframe)
      .then((series) => {
        setCandles(series);
        saveCachedCandles(ticker, timeframe, series);
      })
      .catch(() => setStatus("Failed to load price chart."));
  }, [ticker, timeframe]);

  useEffect(() => {
    const cachedChain = loadCachedOptionChain(ticker, asOfDate);
    if (!cachedChain) return;

    setFetchedSnapshot(cachedChain);
    setHasFetchedChain(true);
    setSelectedSnapshotDate(cachedChain.snapshotDate);
    setDailyStructureHistory(listDailyStructureSnapshots(ticker));
    setStatus(`Restored cached option chain for ${ticker} (${cachedChain.snapshotDate}).`);
  }, [ticker, asOfDate]);

  useEffect(() => {
    const profiles = listPortfolioProfiles();
    setPortfolioProfiles(profiles);

    const savedId = window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
    const selected = savedId && profiles.some((p) => p.id === savedId) ? savedId : profiles[0]?.id ?? "";
    setSelectedProfileId(selected);
  }, []);

  useEffect(() => {
    if (!selectedProfileId) return;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    const saved = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) {
          setWatchlist(parsed);
          return;
        }
      } catch {
        // ignore bad storage
      }
    }

    setWatchlist([ticker]);
  }, []);

  useEffect(() => {
    if (!watchlist.length) return;
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    try {
      const savedChain = getSavedChainSnapshots(ticker);
      const prefs = storage.getPreferences(ticker);

      setSavedChainSnapshots(savedChain);
      setDailyStructureHistory(listDailyStructureSnapshots(ticker));

      if (prefs) {
        setTimeframe(prefs.selectedTimeframe);
        setSelectedSnapshotDate("");
        setSelectedExpiration("");
        setSelectionOwner("auto");
        setAllowAutoSelection(true);
        setOverlays({ ...defaultOverlays, ...prefs.overlays });
      } else {
        setSelectedSnapshotDate("");
        setSelectedExpiration("");
        setSelectionOwner("auto");
        setAllowAutoSelection(true);
      }

      setCompareSnapshotDate("");
    } catch {
      setSavedChainSnapshots([]);
      setDailyStructureHistory([]);
    }
  }, [ticker]);

useEffect(() => {
  setSelectionOwner((prev) => (prev === "manual" ? "manual" : "auto"));

  const cached = loadCachedOptionChain(ticker, asOfDate);

  if (cached) {
    setFetchedSnapshot(cached);
    setHasFetchedChain(true);
    setSelectedSnapshotDate(cached.snapshotDate);

    setStatus(`Loaded cached chain for ${ticker} (${cached.snapshotDate})`);
  } else {
    setHasFetchedChain(false);
    setFetchedSnapshot(null);
    setSelectedExpiration("");
    setStatus("No option chain loaded yet.");
  }
}, [ticker, asOfDate]);

  useEffect(() => {
    setTickerInput(ticker);
  }, [ticker]);

  useEffect(() => {
    const prefs: DashboardPreferences = {
      ticker,
      selectedTimeframe: timeframe,
      selectedSnapshotDate,
      selectedExpiration,
      overlays,
      updatedAt: new Date().toISOString()
    };

    storage.savePreferences(ticker, prefs);
  }, [ticker, timeframe, selectedSnapshotDate, selectedExpiration, overlays]);

  useEffect(() => {
  if (!ticker) return;

  setWatchlist((prev) => {
    const normalized = ticker.toUpperCase() as SupportedTicker;
    const deduped = prev.filter((item) => item.toUpperCase() !== normalized);

    return [normalized, ...deduped].slice(0, 12);
  });
}, [ticker]);

  const chainUniverse = useMemo(() => fetchedSnapshot?.chains ?? [], [fetchedSnapshot]);
 
  const rankedChains = useMemo(() => {
    if (!chainUniverse.length) return [];
    return rankPrevailingChains(chainUniverse, currentPrice || chainUniverse[0]?.summary.combinedCenter || 0);
  }, [chainUniverse, currentPrice]);

  const chainsForSelector = useMemo(() => {
    return [...rankedChains].sort((a, b) => a.expiration.localeCompare(b.expiration));
  }, [rankedChains]);

  useEffect(() => {
    if (!hasFetchedChain) return;
    if (!rankedChains.length) return;

    if (selectedExpiration && rankedChains.some((c) => c.expiration === selectedExpiration)) {
      setAllowAutoSelection(false);
      return;
    }

    if (!allowAutoSelection) return;

    const topByScore = [...rankedChains].sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore)[0];

    if (topByScore) {
      setSelectedExpiration(topByScore.expiration);
      setSelectionOwner("auto");
    }
  }, [hasFetchedChain, rankedChains, selectedExpiration, allowAutoSelection]);

  const activeChain = useMemo(
    () => rankedChains.find((c) => c.expiration === selectedExpiration),
    [rankedChains, selectedExpiration]
  );

  const oiIntelligence = useMemo(() => {
    if (!activeChain || !currentPrice) return null;

    return analyzeOIIntelligence({
      rows: activeChain.rows,
      summary: activeChain.summary,
      currentPrice
    });
  }, [activeChain, currentPrice]);

  const availableSnapshotDates = useMemo(() => {
    if (!selectedExpiration) return [];

    return [...new Set(savedChainSnapshots.filter((s) => s.expiration === selectedExpiration).map((s) => s.snapshotDate))].sort((a, b) =>
      b.localeCompare(a)
    );
  }, [savedChainSnapshots, selectedExpiration]);

  const selectedProfile = useMemo(
    () => portfolioProfiles.find((p) => p.id === selectedProfileId),
    [portfolioProfiles, selectedProfileId]
  );

  const selectedProfilePositions = selectedProfile?.positions ?? [];

  const tickerPortfolioSummary = useMemo(
    () => summarizeTickerPositions(ticker, selectedProfilePositions),
    [ticker, selectedProfilePositions]
  );

  const comparisonResult = useMemo(() =>
      buildSnapshotComparison({
        ticker,
        snapshots: savedChainSnapshots.filter((s) => s.expiration === selectedExpiration),
        primarySnapshotDate: selectedSnapshotDate,
        compareSnapshotDate,
        selectedExpiration,
        currentPrice
      }),
    [ticker, selectedSnapshotDate, compareSnapshotDate, selectedExpiration, savedChainSnapshots, currentPrice]
  );

  const comparison = comparisonResult.comparison;
  const bollinger = useMemo(() => calculateBollinger(candles, 20), [candles]);

  const fallbackSummary: ExpirationSummary = useMemo(
    () => ({
      expiration: "N/A",
      totalCallOi: 0,
      totalPutOi: 0,
      callWeightedStrike: currentPrice,
      putWeightedStrike: currentPrice,
      combinedCenter: currentPrice,
      lowerRange: bollinger.lower || currentPrice,
      upperRange: bollinger.upper || currentPrice,
      callWall: currentPrice,
      putWall: currentPrice,
      prevailingScore: 0
    }),
    [currentPrice, bollinger.lower, bollinger.upper]
  );

  const adjustedSummary: ExpirationSummary = useMemo(() => {
    if (!activeChain) return fallbackSummary;
    if (!oiIntelligence) return activeChain.summary;

    return {
      ...activeChain.summary,
      callWall: oiIntelligence.adjustedCallWall,
      putWall: oiIntelligence.adjustedPutWall,
      combinedCenter: oiIntelligence.adjustedCenter
    };
  }, [activeChain, oiIntelligence, fallbackSummary]);

  const oiProjectionReport = useMemo(() => {
    return buildOIProjectionReport({
      snapshot: fetchedSnapshot,
      currentPrice
    });
  }, [fetchedSnapshot, currentPrice]);

  const surfacePrevailingLevels = useMemo(() => {
    return getSurfacePrevailingLevels({
      snapshot: fetchedSnapshot,
      projectionReport: oiProjectionReport,
      currentPrice
    });
  }, [fetchedSnapshot, oiProjectionReport, currentPrice]);
    
  const structureDrift = buildDailyStructureDrift({
  history: dailyStructureHistory,
  selectedDate: selectedSnapshotDate
});
  const surfaceComparison = buildOISurfaceComparison(
  dailyStructureHistory,
  selectedSnapshotDate
); 
    
  const decision = useMemo(() => {
    return runPositionEngine({
      currentPrice,
      ticker,
      timeframe,
      oi: adjustedSummary,
      bollinger,
      portfolioProfile: selectedProfile ?? null,
      tickerPositions: tickerPortfolioSummary.matching,
      structureComparison: comparison
    });
  }, [
    adjustedSummary,
    currentPrice,
    ticker,
    timeframe,
    bollinger,
    selectedProfile,
    tickerPortfolioSummary,
    comparison
  ]);

  const snapshotSeries = useMemo(() => {
    if (!selectedExpiration) return [];

    const chainHistory = savedChainSnapshots.filter((s) => s.expiration === selectedExpiration);
    const historySource = overlays.showSavedOiHistory ? chainHistory : [];

    const primary = buildSnapshotStructureSeries({
      snapshots: historySource,
      role: "primary",
      maxSnapshotDate: selectedSnapshotDate || undefined
    });

    const compareDate = compareSnapshotDate || comparison?.priorSnapshotDate;

    const compare = compareDate
      ? buildSnapshotStructureSeries({
          snapshots: historySource,
          role: "compare",
          maxSnapshotDate: compareDate
        })
      : [];

    return [...primary, ...compare];
  }, [savedChainSnapshots, selectedExpiration, selectedSnapshotDate, compareSnapshotDate, comparison, overlays.showSavedOiHistory]);

  const fallbackOverlayDates = useMemo(
    () =>
      snapshotSeries
        .filter((o) => o.matchType === "fallback_nearest_expiration")
        .map((o) => `${o.role}:${o.snapshotDate}→${o.expirationUsed}`),
    [snapshotSeries]
  );

  const overlayStatus = useMemo(() => {
    if (!selectedExpiration) return "no expiration chain selected";

    const exact = savedChainSnapshots.some(
      (s) => s.snapshotDate === selectedSnapshotDate && s.expiration === selectedExpiration
    );

    if (exact) return "rendered exact chain snapshot";
    return "no saved snapshot for selected date/expiration";
  }, [savedChainSnapshots, selectedSnapshotDate, selectedExpiration]);

  const selectedSavedChainSnapshot = useMemo(() => {
    if (!selectedExpiration || !selectedSnapshotDate) return undefined;

    const lookupKey = makeSnapshotKey(ticker, selectedSnapshotDate, selectedExpiration);
    return savedChainSnapshots.find((s) => s.snapshotKey === lookupKey);
  }, [savedChainSnapshots, ticker, selectedExpiration, selectedSnapshotDate]);

  useEffect(() => {
    if (selectionOwner === "manual") return;

    if (selectedSavedChainSnapshot) {
      setSelectionOwner("snapshot");
      setAllowAutoSelection(false);
    }
  }, [selectedSavedChainSnapshot, selectionOwner]);

  const derivedDte = useMemo(() => {
    if (!selectedExpiration) return null;

    const reference = selectedSnapshotDate || asOfDate || today;
    const expTs = new Date(`${selectedExpiration}T00:00:00Z`).getTime();
    const refTs = new Date(`${reference}T00:00:00Z`).getTime();

    return Math.max(0, Math.round((expTs - refTs) / (1000 * 60 * 60 * 24)));
  }, [selectedExpiration, selectedSnapshotDate, asOfDate]);

  const selectedChainSnapshotCount = useMemo(
    () => savedChainSnapshots.filter((s) => s.expiration === selectedExpiration).length,
    [savedChainSnapshots, selectedExpiration]
  );

  useEffect(() => {
    if (!selectedSnapshotDate && availableSnapshotDates.length) {
      setSelectedSnapshotDate(availableSnapshotDates[0]);
    }
  }, [availableSnapshotDates, selectedSnapshotDate]);

  const fetchChain = async () => {
    try {
      setStatus("Fetching option chain...");
      const snap = await getOptionChain(ticker, asOfDate);

      setFetchedSnapshot(snap);
      saveCachedOptionChain(snap);
      setHasFetchedChain(true);
      setSelectedSnapshotDate(snap.snapshotDate);

      const fetchedExpirations = snap.chains.map((c) => c.expiration);
      const existedInFetched = Boolean(selectedExpiration && fetchedExpirations.includes(selectedExpiration));

      const hasSnapshotBackedSelection = Boolean(
        selectedExpiration &&
          savedChainSnapshots.some(
            (s) => s.snapshotDate === (selectedSnapshotDate || asOfDate) && s.expiration === selectedExpiration
          )
      );

      if (selectionOwner === "manual" && selectedExpiration) {
        setAllowAutoSelection(false);
      } else if (existedInFetched) {
        setAllowAutoSelection(false);
        if (selectionOwner !== "manual") setSelectionOwner("snapshot");
      } else if (hasSnapshotBackedSelection) {
        setAllowAutoSelection(false);
        setSelectionOwner("snapshot");
      } else if (allowAutoSelection || !selectedExpiration) {
        const topByScore = [...snap.chains].sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore)[0];
        setSelectedExpiration(topByScore?.expiration ?? "");
        setSelectionOwner("auto");
      }

      if (!snap.chains.length) {
        setStatus("No expirations returned for selected ticker/date.");
      } else {
        setStatus(`Loaded ${snap.chains.length} expirations and computed OI structure (${ticker} ${snap.snapshotDate}).`);
      }
    } catch {
      setStatus("Fetch failed. Please retry.");
    }
  };

  const canSaveSnapshot = Boolean(
    ticker &&
      asOfDate &&
      hasFetchedChain &&
      selectedExpiration &&
      activeChain &&
      oiProjectionReport &&
      surfacePrevailingLevels
  );

  const saveSnapshot = () => {
    const selectedExp = selectedExpiration;

    if (!selectedExp || !activeChain) {
      setLastSaveStatus("save failed (no active chain selected)");
      return;
    }

    try {
      const saveKey = makeSnapshotKey(ticker, asOfDate, selectedExp);

      const dteAtCapture = Math.max(
        0,
        Math.round(
          (new Date(`${selectedExp}T00:00:00Z`).getTime() - new Date(`${asOfDate}T00:00:00Z`).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );

      const expDate = new Date(`${selectedExp}T00:00:00Z`);
      const chainKind =
        expDate.getUTCDay() === 5 && expDate.getUTCDate() >= 15 && expDate.getUTCDate() <= 21
          ? "monthly"
          : "weekly";

      storage.saveChainSnapshot({
        snapshotKey: saveKey,
        ticker,
        snapshotDate: asOfDate,
        expiration: selectedExp,
        dteAtCapture,
        chainKind,
        rows: activeChain.rows,
        summary: activeChain.summary,
        prevailingScore: activeChain.summary.prevailingScore
      });

      const exact = storage.getChainSnapshot(ticker, asOfDate, selectedExp);

      if (!exact) {
        setLastSaveStatus(`save failed: ${saveKey}`);
        setStatus("Save failed: snapshot did not persist.");
        return;
      }

      if (oiProjectionReport && surfacePrevailingLevels) {
        const dailySnapshot = buildDailyStructureSnapshot({
          ticker,
          snapshotDate: asOfDate,
          spot: currentPrice,
          projection: oiProjectionReport,
          prevailingLevels: surfacePrevailingLevels
        });

        saveDailyStructureSnapshot(dailySnapshot);
        setDailyStructureHistory(listDailyStructureSnapshots(ticker));
      }

      const savedChain = getSavedChainSnapshots(ticker);
      setSavedChainSnapshots(savedChain);
      setSelectedSnapshotDate(asOfDate);
      setLastSaveStatus(`save success: ${saveKey}`);
      setStatus(`Saved daily structure snapshot ${asOfDate} for ${ticker}.`);
    } catch {
      setLastSaveStatus("save failed");
      setStatus("Save failed: exception while writing snapshot.");
    }
  };

  const deleteSnapshotsForChain = () => {
    const selectedExp = selectedExpiration;
    if (!selectedExp) return;

    const ok = window.confirm(`Delete saved snapshots for ${ticker} / ${selectedExp}?\nThis cannot be undone.`);
    if (!ok) return;

    const removed = deleteChainSnapshots(ticker, selectedExp);
    const savedChain = getSavedChainSnapshots(ticker);

    setSavedChainSnapshots(savedChain);
    setDailyStructureHistory(listDailyStructureSnapshots(ticker));
    setStatus(`Deleted ${removed} saved snapshots for ${ticker} ${selectedExp}.`);
  };

  const toggle = (key: keyof OverlayFlags) => setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));

  const commitTickerInput = () => {
    const normalized = tickerInput.trim().toUpperCase();

    if (!normalized || normalized === ticker) return;
    setTicker(normalized as SupportedTicker);
  };

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "1rem", display: "grid", gap: "1rem" }}>
      <h1 style={{ marginBottom: 0 }}>Trading Operator Console</h1>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.9rem" }}>
        <h3 style={{ marginTop: 0 }}>Top Controls</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.6rem", alignItems: "end" }}>
          <label>
            Ticker
            <input
              list="ticker-list"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTickerInput();
                }
              }}
              placeholder="Type ticker"
            />
            <datalist id="ticker-list">
              {SUPPORTED_TICKERS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          <label>
            Timeframe
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
              {SUPPORTED_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>

          <label>
            Snapshot Date
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </label>

          <button onClick={fetchChain}>Fetch Option Chain</button>
          <button onClick={saveSnapshot} disabled={!canSaveSnapshot}>
            Save Snapshot
          </button>
          <button onClick={deleteSnapshotsForChain} disabled={!selectedExpiration}>
            Delete chain snapshots
          </button>
        </div>

{mounted && watchlist.length > 0 && (
  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
    <span style={{ fontSize: 12, color: "#4b5563" }}>Watchlist:</span>
    {watchlist.map((w) => (
      <button
        key={w}
        onClick={() => setTicker(w)}
        style={{
          padding: "2px 8px",
          background: w === ticker ? "#111827" : "#e5e7eb",
          color: w === ticker ? "#fff" : "#111827",
          borderRadius: 14
        }}
      >
        {w}
      </button>
    ))}
  </div>
)}

        <div style={{ marginTop: "0.7rem", display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.5rem" }}>
          <label>
            <input type="checkbox" checked={overlays.showSavedOiHistory} onChange={() => toggle("showSavedOiHistory")} /> show saved OI history
          </label>
          <label>
            <input type="checkbox" checked={overlays.showOiCenter} onChange={() => toggle("showOiCenter")} /> show OI center
          </label>
          <label>
            <input type="checkbox" checked={overlays.showOiRange} onChange={() => toggle("showOiRange")} /> show OI range
          </label>
          <label>
            <input type="checkbox" checked={overlays.showWalls} onChange={() => toggle("showWalls")} /> show walls
          </label>
          <label>
            <input type="checkbox" checked={overlays.showOiZones} onChange={() => toggle("showOiZones")} /> show OI zones
          </label>
        </div>

        <p style={{ marginBottom: 0 }}>
          <strong>Status:</strong> {status}
        </p>

        <section style={{ marginTop: 8, padding: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 6, background: "#ffffff", fontSize: 13 }}>
          <strong>Selected Chain Summary</strong>
          <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8 }}>
            <div>Expiration: {selectedExpiration || "N/A"}</div>
            <div>DTE: {derivedDte ?? "N/A"}</div>
            <div>Score: {activeChain?.summary.prevailingScore?.toFixed(2) ?? "N/A"}</div>
            <div>Saved chain snapshots: {mounted ? selectedChainSnapshotCount : 0}</div>
            <div>Daily structure saves: {mounted ? dailyStructureHistory.length : 0}</div>
          </div>

          {surfacePrevailingLevels && (
            <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              <div>Surface Support: {surfacePrevailingLevels.support?.strike.toFixed(2) ?? "N/A"}</div>
              <div>Surface Resistance: {surfacePrevailingLevels.resistance?.strike.toFixed(2) ?? "N/A"}</div>
              <div>Surface Magnet: {surfacePrevailingLevels.magnet.strike.toFixed(2)}</div>
            </div>
          )}

          {oiIntelligence && oiIntelligence.anomalies.length > 0 && (
            <div style={{ marginTop: 6, color: "#7c2d12", fontWeight: 600 }}>
              Adjusted structure active: anomaly-filtered walls and center are being used.
            </div>
          )}
        </section>

        <p style={{ marginTop: 4, marginBottom: 0, color: "#4b5563" }}>
          Data source: Yahoo provider through <code>src/lib/data-provider.ts</code>.
        </p>

        <div style={{ marginTop: "0.7rem" }}>
          <SnapshotSelector
            snapshotDates={availableSnapshotDates}
            selectedDate={selectedSnapshotDate}
            onSelectDate={(date) => {
              setSelectedSnapshotDate(date);
              if (compareSnapshotDate === date) setCompareSnapshotDate("");
            }}
            compareDate={compareSnapshotDate}
            onSelectCompareDate={setCompareSnapshotDate}
            chains={chainsForSelector}
            selectedExpiration={selectedExpiration}
            onSelectExpiration={(exp) => {
              setSelectedExpiration(exp);
              setSelectionOwner("manual");
              setAllowAutoSelection(false);
            }}
          />
        </div>
      </section>

      <ChartPanel
        candles={candles}
        summary={adjustedSummary}
        prevailingLevels={surfacePrevailingLevels}
        overlays={overlays}
        ticker={ticker}
        timeframe={timeframe}
        selectedSnapshotDate={selectedSnapshotDate}
        snapshotSeries={snapshotSeries}
        showSavedOiHistory={overlays.showSavedOiHistory}
        fallbackOverlayDates={fallbackOverlayDates}
        overlayStatus={overlayStatus}
        hasExactSnapshot={Boolean(selectedSavedChainSnapshot)}
        structureDrift={structureDrift}  
      />

      {selectedExpiration && selectedSnapshotDate && !selectedSavedChainSnapshot && (
        <div style={{ fontSize: 12, color: "#b45309" }}>
          No saved chain snapshot exists for this expiration on this date.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <PortfolioContextCard
          ticker={ticker}
          profiles={portfolioProfiles}
          selectedProfileId={selectedProfileId}
          onSelectProfile={setSelectedProfileId}
        />
        <OISummaryCard summary={adjustedSummary} currentPrice={currentPrice} />
      </div>

      <OIIntelligenceCard report={oiIntelligence} />

      <OIProjectionCard report={oiProjectionReport} />

      <DecisionCard decision={decision} />

      {activeChain ? (
        <>
          <ChainGraph rows={activeChain.rows} summary={adjustedSummary} currentPrice={currentPrice} />
          <OIChainTable rows={activeChain.rows} />
        </>
      ) : (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "0.9rem", background: "#fff" }}>
          <p>No option chain loaded yet. Use top controls to fetch and save a snapshot.</p>
        </section>
      )}
      <OISurfaceComparisonCard data={surfaceComparison} />  
      <SnapshotComparisonCard comparison={comparison} reason={comparisonResult.reason} message={comparisonResult.message} />
    
        
    </main>
  );
}