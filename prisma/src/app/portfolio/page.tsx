"use client";

import { useEffect, useMemo, useState } from "react";
import { PortfolioGreeksSummary } from "../../components/portfolio-greeks-summary";
import { PortfolioPositionsTable } from "../../components/portfolio-positions-table";
import { PriceSlicesTable } from "../../components/price-slices-table";
import { ProfileManager } from "../../components/profile-manager";
import { RiskProfileChart } from "../../components/risk-profile-chart";
import {
  aggregateGreeks,
  enrichPositionsWithGreeks
} from "../../lib/greeks-engine";
import { makeOptionQuoteKey } from "../../lib/option-quote-key";
import {
  deletePortfolioProfile,
  listPortfolioProfiles,
  upsertPortfolioProfile
} from "../../lib/portfolio-store";
import {
  MarketQuoteContext,
  OptionQuoteMap,
  PortfolioProfile,
  PortfolioPosition,
  PriceSlice,
  RiskProfileMode,
  UnderlyingQuoteMap
} from "../../lib/portfolio-types";
import { buildRiskProfile, evaluateSlices } from "../../lib/risk-engine";
import { createLocalPersistenceAdapter } from "../../lib/storage";
import { yahooProvider } from "../../lib/yahoo-provider";

const SELECTED_PROFILE_STORAGE_KEY = "wheelDesk.selectedPortfolioProfileId";

function makeProfile(name: string): PortfolioProfile {
  return {
    id: `profile-${Date.now()}`,
    name,
    positions: [],
    slices: [],
    updatedAt: new Date().toISOString()
  };
}

function expirationDateFromTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function findYahooExpirationTimestamp(symbol: string, expiration: string): Promise<number | undefined> {
  const expirations = await yahooProvider.getOptionExpirations(symbol);
  return expirations.find((ts) => expirationDateFromTimestamp(ts) === expiration);
}

export default function PortfolioPage() {
  const [isMounted, setIsMounted] = useState(false);

  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [slices, setSlices] = useState<PriceSlice[]>([]);
  const [riskMode, setRiskMode] = useState<RiskProfileMode>("expiration");
  const [structureContext, setStructureContext] = useState<any>(null);
  const [underlyingQuotes, setUnderlyingQuotes] = useState<UnderlyingQuoteMap>({});
  const [optionQuotes, setOptionQuotes] = useState<OptionQuoteMap>({});
  const [quoteStatus, setQuoteStatus] = useState("Idle");
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined);
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    const next = listPortfolioProfiles();
    setProfiles(next);

    const savedId = window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
    const validSaved = savedId && next.some((p) => p.id === savedId);

    setSelectedProfileId(validSaved ? savedId : next[0]?.id ?? "");
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted || !selectedProfileId) return;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, selectedProfileId);
  }, [isMounted, selectedProfileId]);

  useEffect(() => {
    if (!isMounted) return;
    const selected = profiles.find((x) => x.id === selectedProfileId);
    setPositions(selected?.positions ?? []);
    setSlices(selected?.slices ?? []);
  }, [isMounted, profiles, selectedProfileId]);

  const symbols = useMemo(
    () =>
      Array.from(
        new Set(
          positions
            .map((p) => p.symbol?.trim().toUpperCase())
            .filter(Boolean)
        )
      ) as string[],
    [positions]
  );

  const optionRequests = useMemo(
    () =>
      positions
        .filter(
          (p) =>
            (p.instrumentType === "call" || p.instrumentType === "put") &&
            p.symbol &&
            p.expiration &&
            typeof p.strike === "number"
        )
        .map((p) => ({
          symbol: p.symbol.toUpperCase(),
          expiration: p.expiration!,
          type: p.instrumentType,
          strike: p.strike!
        })),
    [positions]
  );

  useEffect(() => {
    if (!isMounted) return;

    if (symbols.length === 0) {
      setUnderlyingQuotes({});
      setQuoteStatus("No symbols");
      return;
    }

    let cancelled = false;

    (async () => {
      setQuoteStatus("Loading quotes...");

      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const q = await yahooProvider.getQuote(symbol);
            return [
              symbol,
              {
                currentPrice: q.price,
                previousClose: q.previousClose
              }
            ] as const;
          } catch {
            return [symbol, {}] as const;
          }
        })
      );

      if (cancelled) return;

      setUnderlyingQuotes(Object.fromEntries(entries));
      setQuoteStatus("Quotes loaded");
    })();

    return () => {
      cancelled = true;
    };
  }, [isMounted, symbols]);

  useEffect(() => {
    if (!isMounted) return;

    if (optionRequests.length === 0) {
      setOptionQuotes({});
      return;
    }

    let cancelled = false;

    (async () => {
      const quoteMap: OptionQuoteMap = {};
      const groupedBySymbolAndExpiration = new Map<string, typeof optionRequests>();

      for (const req of optionRequests) {
        const groupKey = `${req.symbol}__${req.expiration}`;
        groupedBySymbolAndExpiration.set(groupKey, [
          ...(groupedBySymbolAndExpiration.get(groupKey) ?? []),
          req
        ]);
      }

      for (const requests of groupedBySymbolAndExpiration.values()) {
        const first = requests[0];

        try {
          const expirationTs = await findYahooExpirationTimestamp(first.symbol, first.expiration);
          if (!expirationTs) continue;

          const chain = await yahooProvider.getOptionChain(first.symbol, expirationTs);

          for (const req of requests) {
            const rows = req.type === "call" ? chain.calls : chain.puts;

            const match = rows.find((r) => Math.abs(Number(r.strike) - req.strike) < 0.001);
            console.log("OPTION MATCH DEBUG", {
              symbol: req.symbol,
              expiration: req.expiration,
              type: req.type,
              strike: req.strike,
              chainExpiration: chain.expirationDate,
              rowCount: rows.length,
              match
             });

            const key = makeOptionQuoteKey(
              req.symbol,
              req.expiration,
              req.type,
              req.strike
            );

            if (!match) continue;

            const bid = typeof match.bid === "number" ? match.bid : undefined;
            const ask = typeof match.ask === "number" ? match.ask : undefined;
            const lastPrice = typeof match.lastPrice === "number" ? match.lastPrice : undefined;
            const mark =
              bid !== undefined && ask !== undefined && ask > 0
                ? (bid + ask) / 2
                : lastPrice;

            quoteMap[key] = {
              bid,
              ask,
              lastPrice,
              mark,
              previousCloseMark: undefined,
              impliedVolatility:
                typeof match.impliedVolatility === "number"
                  ? match.impliedVolatility
                  : undefined,
              openInterest:
                typeof match.openInterest === "number"
                  ? match.openInterest
                  : undefined,
              volume:
                typeof match.volume === "number"
                  ? match.volume
                  : undefined
            };
          }
        } catch {
          // Missing option chain should not break the portfolio page.
        }
      }

      if (!cancelled) {
        setOptionQuotes(quoteMap);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isMounted, optionRequests]);

  const primarySymbol = useMemo(() => symbols[0] ?? "AAPL", [symbols]);

  const currentPrice = useMemo(() => {
    const quoteSpot = underlyingQuotes[primarySymbol]?.currentPrice;
    if (typeof quoteSpot === "number" && Number.isFinite(quoteSpot)) {
      return quoteSpot;
    }

    return 100;
  }, [primarySymbol, underlyingQuotes]);

  const quoteContext: MarketQuoteContext = useMemo(
    () => ({
      underlyingQuotes,
      optionQuotes
    }),
    [underlyingQuotes, optionQuotes]
  );

  const valuationDate = useMemo(() => new Date(), []);

  const enrichedPositions = useMemo(
    () => enrichPositionsWithGreeks(positions, quoteContext, valuationDate),
    [positions, quoteContext, valuationDate]
  );

  const summary = useMemo(
    () => aggregateGreeks(positions, quoteContext, valuationDate),
    [positions, quoteContext, valuationDate]
  );

  const chartPositions = useMemo(() => {
    const filtered = positions.filter(
      (p) => p.symbol?.toUpperCase() === primarySymbol && p.includeInRiskProfile !== false
    );
    return filtered.length > 0
      ? filtered
      : positions.filter((p) => p.includeInRiskProfile !== false);
  }, [positions, primarySymbol]);

  const profileCurve = useMemo(
    () =>
      buildRiskProfile(chartPositions, currentPrice, riskMode, valuationDate, {
        min: minPrice,
        max: maxPrice
      }),
    [chartPositions, currentPrice, riskMode, valuationDate, minPrice, maxPrice]
  );

  const sliceResults = useMemo(
    () =>
      evaluateSlices(
        chartPositions,
        slices,
        currentPrice,
        quoteContext,
        riskMode,
        valuationDate
      ),
    [chartPositions, slices, currentPrice, quoteContext, riskMode, valuationDate]
  );

  useEffect(() => {
    if (!isMounted) return;

    const storage = createLocalPersistenceAdapter();
    const snapshots = storage
      .listChainSnapshots(primarySymbol)
      .sort((a: any, b: any) => b.snapshotDate.localeCompare(a.snapshotDate));

    setStructureContext(snapshots[0]?.summary ?? null);
  }, [isMounted, primarySymbol]);

  const persistCurrentProfile = (
    nextPositions: PortfolioPosition[],
    nextSlices: PriceSlice[]
  ) => {
    const current = profiles.find((p) => p.id === selectedProfileId);
    if (!current) return;

    const updated: PortfolioProfile = {
      ...current,
      positions: nextPositions,
      slices: nextSlices,
      updatedAt: new Date().toISOString()
    };

    const all = upsertPortfolioProfile(updated);
    setProfiles(all);
  };

  const createProfile = (name: string) => {
    const next = upsertPortfolioProfile(makeProfile(name));
    setProfiles(next);

    const created =
      next.find((p) => p.name === name) ??
      next[next.length - 1] ??
      null;

    setSelectedProfileId(created?.id ?? "");
  };

  const removeProfile = (id: string) => {
    const next = deletePortfolioProfile(id);
    setProfiles(next);
    setSelectedProfileId(next[0]?.id ?? "");
  };

  const quickAddStructureSlices = () => {
    if (!structureContext) return;

    const rawValues = [
      currentPrice,
      structureContext.combinedCenter,
      structureContext.lowerRange,
      structureContext.upperRange,
      structureContext.callWall,
      structureContext.putWall
    ];

    const uniqueValues = [...new Set(rawValues.map((v: number) => Number(v.toFixed(2))))];

    const nextSlices: PriceSlice[] = uniqueValues.map((v) => ({
      id: `slice-${v}`,
      underlyingPrice: v
    }));

    setSlices(nextSlices);
    persistCurrentProfile(positions, nextSlices);
  };

  if (!isMounted) {
    return (
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "1rem",
          display: "grid",
          gap: "1rem"
        }}
      >
        <h1 style={{ marginBottom: 0 }}>Portfolio Risk Console</h1>
        <p style={{ color: "#6b7280" }}>Loading portfolio...</p>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "1rem",
        display: "grid",
        gap: "1rem"
      }}
    >
      <h1 style={{ marginBottom: 0 }}>Portfolio Risk Console</h1>

      <ProfileManager
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        onSelectProfile={setSelectedProfileId}
        onCreateProfile={createProfile}
        onDeleteProfile={removeProfile}
      />

      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 8,
          background: "#fff",
          padding: "0.8rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 12
        }}
      >
        <div>
          <strong>Primary symbol:</strong> {primarySymbol}
        </div>
        <div>
          <strong>Current spot:</strong> {currentPrice.toFixed(2)}
        </div>
        <div>
          <strong>Valuation date:</strong> {valuationDate.toLocaleDateString()}
        </div>
        <div>
          <strong>Quote status:</strong> {quoteStatus}
        </div>
      </section>

      <PortfolioPositionsTable
        positions={enrichedPositions}
        onChange={(next) => {
          setPositions(next);
          persistCurrentProfile(next, slices);
        }}
      />

      <PortfolioGreeksSummary summary={summary} />

      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 8,
          background: "#fff",
          padding: "0.8rem",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap"
        }}
      >
        <strong>Risk Mode</strong>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            checked={riskMode === "expiration"}
            onChange={() => setRiskMode("expiration")}
          />
          Expiration
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            checked={riskMode === "theoretical"}
            onChange={() => setRiskMode("theoretical")}
          />
          Theo
        </label>

        <span style={{ marginLeft: 16 }}>Min Price</span>
        <input
          type="number"
          value={minPrice ?? ""}
          onChange={(e) => setMinPrice(e.target.value === "" ? undefined : Number(e.target.value))}
          style={{ width: 80 }}
        />

        <span>Max Price</span>
        <input
          type="number"
          value={maxPrice ?? ""}
          onChange={(e) => setMaxPrice(e.target.value === "" ? undefined : Number(e.target.value))}
          style={{ width: 80 }}
        />
      </section>

      <RiskProfileChart
        points={profileCurve}
        currentPrice={currentPrice}
        slices={sliceResults
          .map((s) => s.underlyingPrice)
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v))}
      />

      <PriceSlicesTable
        slices={slices}
        results={sliceResults}
        onChangeSlices={(next) => {
          setSlices(next);
          persistCurrentProfile(positions, next);
        }}
        onQuickAdd={quickAddStructureSlices}
      />

      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 8,
          background: "#fff",
          padding: "0.8rem"
        }}
      >
        <h3 style={{ marginTop: 0 }}>Structure Context (optional)</h3>

        {structureContext ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
              gap: 8,
              fontSize: 12
            }}
          >
            <div>OI Center: {Number(structureContext.combinedCenter).toFixed(2)}</div>
            <div>OI Lower: {Number(structureContext.lowerRange).toFixed(2)}</div>
            <div>OI Upper: {Number(structureContext.upperRange).toFixed(2)}</div>
            <div>Call Wall: {Number(structureContext.callWall).toFixed(2)}</div>
            <div>Put Wall: {Number(structureContext.putWall).toFixed(2)}</div>
            <div>Score: {Number(structureContext.prevailingScore).toFixed(2)}</div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
            No market-structure snapshot found for {primarySymbol}.
          </p>
        )}
      </section>
    </main>
  );
}