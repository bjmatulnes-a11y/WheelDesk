"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { WheelDeskSideNav } from "../../components/WheelDeskSideNav";
import { PortfolioGreeksSummary } from "../../components/portfolio-greeks-summary";
import { PortfolioPositionsTable } from "../../components/portfolio-positions-table";
import { PriceSlicesTable } from "../../components/price-slices-table";
import { ProfileManager } from "../../components/profile-manager";
import { RiskProfileComparisonChart } from "../../components/risk-profile-comparison-chart";
import WheelBasisTracker from "../../components/portfolio/WheelBasisTracker";
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
  EnrichedPortfolioPosition,
  MarketQuoteContext,
  OptionQuoteMap,
  PortfolioCashOutline,
  PortfolioProfile,
  PortfolioPosition,
  PriceSlice,
  RiskProfileMode,
  SliceResult,
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
    cashOutline: {},
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

function cleanNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function money(value?: number, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function cashTone(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "#111827";
  if (value < 0) return "#dc2626";
  if (value > 0) return "#16a34a";
  return "#111827";
}

function CashValue({ value }: { value?: number }) {
  return <span style={{ color: cashTone(value), fontWeight: 900 }}>{money(value)}</span>;
}

function num(value?: number, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function absQty(position: Pick<PortfolioPosition, "qty">): number {
  return Math.abs(Number(position.qty) || 0);
}

function sideSign(side: PortfolioPosition["side"]): number {
  return side === "long" ? 1 : -1;
}

function getPositionSymbol(position: PortfolioPosition): string {
  return position.symbol?.trim().toUpperCase() || "UNSET";
}

function getDte(expiration?: string): number | null {
  if (!expiration) return null;
  const now = new Date();
  const expiry = new Date(`${expiration}T16:00:00`);
  const diff = expiry.getTime() - now.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function legLabel(position: PortfolioPosition): string {
  const symbol = getPositionSymbol(position);
  const qty = absQty(position);

  if (position.instrumentType === "stock") {
    return `${symbol} ${position.side} ${num(qty, 0)} shares`;
  }

  const strike = typeof position.strike === "number" ? position.strike.toFixed(2) : "N/A";
  const type = position.instrumentType.toUpperCase();
  return `${symbol} ${position.side} ${num(qty, 0)} ${position.expiration ?? "No exp"} ${strike}${type}`;
}

function positionMarketValue(position: EnrichedPortfolioPosition): number {
  const sign = sideSign(position.side);
  const qty = Math.abs(Number(position.qty) || 0);
  const mark = cleanNumber(position.mark) ?? cleanNumber(position.theoreticalValue) ?? cleanNumber(position.entryPrice) ?? 0;

  if (position.instrumentType === "stock") {
    return sign * qty * mark;
  }

  return sign * qty * 100 * mark;
}

function shortPutAssignmentReserve(positions: PortfolioPosition[]): number {
  return positions
    .filter((p) => p.instrumentType === "put" && p.side === "short" && typeof p.strike === "number")
    .reduce((sum, p) => sum + Math.abs(Number(p.qty) || 0) * Number(p.strike) * 100, 0);
}

function optionContractCount(positions: PortfolioPosition[], type: "call" | "put", side?: "long" | "short"): number {
  return positions
    .filter((p) => p.instrumentType === type && (!side || p.side === side))
    .reduce((sum, p) => sum + Math.abs(Number(p.qty) || 0), 0);
}

function stockShareCount(positions: PortfolioPosition[]): number {
  return positions
    .filter((p) => p.instrumentType === "stock")
    .reduce((sum, p) => sum + sideSign(p.side) * (Number(p.qty) || 0), 0);
}

type ExpirationBucket = {
  expiration: string;
  label: string;
  dte: number | null;
  positions: EnrichedPortfolioPosition[];
  netDelta: number;
  netTheta: number;
  theoreticalValue: number;
  shortPutReserve: number;
};

function buildExpirationBuckets(positions: EnrichedPortfolioPosition[]): ExpirationBucket[] {
  const groups = new Map<string, EnrichedPortfolioPosition[]>();

  for (const position of positions) {
    const key = position.instrumentType === "stock" ? "__stock" : position.expiration || "__no_exp";
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }

  return Array.from(groups.entries())
    .map(([expiration, groupPositions]) => {
      const dte = expiration.startsWith("__") ? null : getDte(expiration);
      const label = expiration === "__stock" ? "Shares / no expiration" : expiration === "__no_exp" ? "Options missing expiration" : `${expiration} (${dte ?? "N/A"} DTE)`;

      return {
        expiration,
        label,
        dte,
        positions: groupPositions,
        netDelta: groupPositions.reduce((sum, p) => sum + (cleanNumber(p.delta) ?? 0), 0),
        netTheta: groupPositions.reduce((sum, p) => sum + (cleanNumber(p.theta) ?? 0), 0),
        theoreticalValue: groupPositions.reduce((sum, p) => sum + positionMarketValue(p), 0),
        shortPutReserve: shortPutAssignmentReserve(groupPositions)
      };
    })
    .sort((a, b) => {
      if (a.expiration === "__stock") return -1;
      if (b.expiration === "__stock") return 1;
      if (a.expiration === "__no_exp") return 1;
      if (b.expiration === "__no_exp") return -1;
      return a.expiration.localeCompare(b.expiration);
    });
}

type TheoreticalExposure = {
  netLiqEstimate: number;
  openPl: number;
  dayPl: number;
  stockShares: number;
  stockLots: number;
  netDelta: number;
  netTheta: number;
  netVega: number;
  longCalls: number;
  shortCalls: number;
  longPuts: number;
  shortPuts: number;
  shortPutReserve: number;
};

function buildTheoreticalExposure(positions: EnrichedPortfolioPosition[], summary: { delta: number; theta: number; vega: number; totalPlOpen: number; totalPlDay: number }): TheoreticalExposure {
  const netLiqEstimate = positions.reduce((sum, p) => sum + positionMarketValue(p), 0);

  return {
    netLiqEstimate,
    openPl: summary.totalPlOpen,
    dayPl: summary.totalPlDay,
    stockShares: stockShareCount(positions),
    stockLots: Math.floor(Math.abs(stockShareCount(positions)) / 100),
    netDelta: summary.delta,
    netTheta: summary.theta,
    netVega: summary.vega,
    longCalls: optionContractCount(positions, "call", "long"),
    shortCalls: optionContractCount(positions, "call", "short"),
    longPuts: optionContractCount(positions, "put", "long"),
    shortPuts: optionContractCount(positions, "put", "short"),
    shortPutReserve: shortPutAssignmentReserve(positions)
  };
}

function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 8
      }}
    >
      {children}
    </div>
  );
}

function MetricCard({ label, value, help }: { label: string; value: ReactNode; help?: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        padding: "0.65rem",
        background: "#fff"
      }}
    >
      <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {help ? <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{help}</div> : null}
    </div>
  );
}

function PortfolioProfileSummary({ exposure }: { exposure: TheoreticalExposure }) {
  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#f8fafc",
        padding: "0.8rem",
        display: "grid",
        gap: "0.75rem"
      }}
    >
      <div>
        <h3 style={{ margin: 0 }}>Profile Overview</h3>
        <p style={{ margin: "0.25rem 0 0", fontSize: 12, color: "#4b5563" }}>
          Inventory view only. Trade suggestions stay in the Wheel Workspace.
        </p>
      </div>

      <CardGrid>
        <MetricCard label="Net Theo / Mark Value" value={money(exposure.netLiqEstimate)} help="Long positions positive; shorts shown as liabilities." />
        <MetricCard label="Open P/L" value={money(exposure.openPl)} />
        <MetricCard label="Day P/L" value={money(exposure.dayPl)} />
        <MetricCard label="Net Delta" value={num(exposure.netDelta, 1)} help="Approximate share-equivalent exposure." />
        <MetricCard label="Net Theta / Day" value={money(exposure.netTheta)} />
        <MetricCard label="Net Vega" value={num(exposure.netVega, 1)} />
        <MetricCard label="Shares / Lots" value={`${num(exposure.stockShares, 0)} / ${num(exposure.stockLots, 0)}`} />
        <MetricCard label="Options" value={`${exposure.longCalls} LC / ${exposure.shortCalls} SC / ${exposure.longPuts} LP / ${exposure.shortPuts} SP`} />
      </CardGrid>
    </section>
  );
}

function CashOutlineSection({
  cashOutline,
  positions,
  primarySymbol,
  currentPrice,
  onChange
}: {
  cashOutline: PortfolioCashOutline;
  positions: PortfolioPosition[];
  primarySymbol: string;
  currentPrice: number;
  onChange: (next: PortfolioCashOutline) => void;
}) {
  const cashBalance = cleanNumber(cashOutline.cashBalance) ?? 0;
  const buyingPower = cleanNumber(cashOutline.buyingPower) ?? cashBalance;
  const manualReserve = cleanNumber(cashOutline.manualReserve) ?? 0;
  const existingShortPutReserve = shortPutAssignmentReserve(positions);
  const availableForTrades = buyingPower - existingShortPutReserve - manualReserve;
  const deployableCash = Math.max(0, availableForTrades);
  const oneLotAtSpot = currentPrice > 0 ? Math.floor(deployableCash / (currentPrice * 100)) : 0;

  const setNumber = (key: keyof PortfolioCashOutline, value: string) => {
    onChange({
      ...cashOutline,
      [key]: value === "" ? undefined : Number(value)
    });
  };

  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem",
        display: "grid",
        gap: "0.75rem"
      }}
    >
      <div>
        <h3 style={{ margin: 0 }}>Cash & Trade Capacity</h3>
        <p style={{ margin: "0.25rem 0 0", fontSize: 12, color: "#4b5563" }}>
          Cash outline for future trades. Existing short-put assignment reserve is calculated from the profile.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Cash Balance
          <input
            type="number"
            value={cashOutline.cashBalance ?? ""}
            onChange={(e) => setNumber("cashBalance", e.target.value)}
            style={{ width: "100%" }}
            placeholder="25000"
          />
        </label>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Buying Power
          <input
            type="number"
            value={cashOutline.buyingPower ?? ""}
            onChange={(e) => setNumber("buyingPower", e.target.value)}
            style={{ width: "100%" }}
            placeholder="Defaults to cash"
          />
        </label>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Manual Reserve
          <input
            type="number"
            value={cashOutline.manualReserve ?? ""}
            onChange={(e) => setNumber("manualReserve", e.target.value)}
            style={{ width: "100%" }}
            placeholder="Emergency / holdback"
          />
        </label>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Notes
          <input
            value={cashOutline.notes ?? ""}
            onChange={(e) => onChange({ ...cashOutline, notes: e.target.value })}
            style={{ width: "100%" }}
            placeholder="Example: keep $10k dry"
          />
        </label>
      </div>

      <CardGrid>
        <MetricCard label="Cash Balance" value={<CashValue value={cashBalance} />} />
        <MetricCard label="Buying Power" value={<CashValue value={buyingPower} />} />
        <MetricCard label="Existing Short-Put Reserve" value={money(existingShortPutReserve)} help="Strike × 100 × open short puts." />
        <MetricCard label="Manual Reserve" value={money(manualReserve)} />
        <MetricCard
          label="Available for New Trades"
          value={<CashValue value={availableForTrades} />}
          help={availableForTrades < 0 ? "Buying power is below reserves." : "Buying power minus reserves."}
        />
        <MetricCard label={`Approx ${primarySymbol} 100-share Lots`} value={num(oneLotAtSpot, 0)} help={`Uses current spot ${money(currentPrice)}.`} />
      </CardGrid>
    </section>
  );
}

function ExpirationLadder({ buckets }: { buckets: ExpirationBucket[] }) {
  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Expiration Ladder</h3>
      <p style={{ marginTop: 0, fontSize: 12, color: "#4b5563" }}>
        Inventory by expiration. This makes it easier to see what expires first and where obligations sit.
      </p>

      {buckets.length === 0 ? (
        <p style={{ fontSize: 12, color: "#6b7280" }}>No positions in this profile.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {buckets.map((bucket) => (
            <div key={bucket.expiration} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.65rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                <strong>{bucket.label}</strong>
                <span>Net Delta: {num(bucket.netDelta, 1)}</span>
                <span>Theo / Mark: {money(bucket.theoreticalValue)}</span>
                <span>Short-Put Reserve: {money(bucket.shortPutReserve)}</span>
              </div>

              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem", fontSize: 12 }}>
                {bucket.positions.map((position) => (
                  <li key={position.id}>
                    <strong>{legLabel(position)}</strong>{" "}
                    <span style={{ color: "#4b5563" }}>
                      Mark {money(position.mark)} · Delta {num(position.delta, 1)} · Theta {money(position.theta)} · P/L open {money(position.plOpen)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RiskModeComparison({ expirationResults, theoreticalResults }: { expirationResults: SliceResult[]; theoreticalResults: SliceResult[] }) {
  const rows = expirationResults.map((expirationResult) => {
    const theoreticalResult = theoreticalResults.find((r) => r.id === expirationResult.id);
    return {
      id: expirationResult.id,
      price: expirationResult.underlyingPrice,
      expirationPl: expirationResult.plAtSlice,
      theoreticalPl: theoreticalResult?.plAtSlice,
      expirationNetLiq: expirationResult.theoreticalNetLiq,
      theoreticalNetLiq: theoreticalResult?.theoreticalNetLiq
    };
  });

  if (rows.length === 0) return null;

  return (
    <section
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        padding: "0.8rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Expiration vs Theoretical Slices</h3>
      <p style={{ marginTop: 0, fontSize: 12, color: "#4b5563" }}>
        Side-by-side view of profile behavior at your selected price slices.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Price", "Expiration P/L", "Theoretical P/L", "Expiration Net Liq", "Theoretical Net Liq"].map((header) => (
              <th key={header} align="left" style={{ borderBottom: "1px solid #e5e7eb", padding: 4 }}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={{ padding: 4 }}>{money(row.price)}</td>
              <td style={{ padding: 4 }}>{money(row.expirationPl)}</td>
              <td style={{ padding: 4 }}>{money(row.theoreticalPl)}</td>
              <td style={{ padding: 4 }}>{money(row.expirationNetLiq)}</td>
              <td style={{ padding: 4 }}>{money(row.theoreticalNetLiq)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}


export default function PortfolioPage() {
  const [isMounted, setIsMounted] = useState(false);

  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [slices, setSlices] = useState<PriceSlice[]>([]);
  const [cashOutline, setCashOutline] = useState<PortfolioCashOutline>({});
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
    setCashOutline(selected?.cashOutline ?? {});
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

  const theoreticalExposure = useMemo(
    () => buildTheoreticalExposure(enrichedPositions, summary),
    [enrichedPositions, summary]
  );

  const expirationBuckets = useMemo(
    () => buildExpirationBuckets(enrichedPositions),
    [enrichedPositions]
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

  const expirationProfileCurve = useMemo(
    () =>
      buildRiskProfile(chartPositions, currentPrice, "expiration", valuationDate, {
        min: minPrice,
        max: maxPrice
      }),
    [chartPositions, currentPrice, valuationDate, minPrice, maxPrice]
  );

  const theoreticalProfileCurve = useMemo(
    () =>
      buildRiskProfile(chartPositions, currentPrice, "theoretical", valuationDate, {
        min: minPrice,
        max: maxPrice
      }),
    [chartPositions, currentPrice, valuationDate, minPrice, maxPrice]
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

  const expirationSliceResults = useMemo(
    () =>
      evaluateSlices(
        chartPositions,
        slices,
        currentPrice,
        quoteContext,
        "expiration",
        valuationDate
      ),
    [chartPositions, slices, currentPrice, quoteContext, valuationDate]
  );

  const theoreticalSliceResults = useMemo(
    () =>
      evaluateSlices(
        chartPositions,
        slices,
        currentPrice,
        quoteContext,
        "theoretical",
        valuationDate
      ),
    [chartPositions, slices, currentPrice, quoteContext, valuationDate]
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
    nextSlices: PriceSlice[],
    nextCashOutline: PortfolioCashOutline = cashOutline
  ) => {
    const current = profiles.find((p) => p.id === selectedProfileId);
    if (!current) return;

    const updated: PortfolioProfile = {
      ...current,
      positions: nextPositions,
      slices: nextSlices,
      cashOutline: nextCashOutline,
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
          display: "flex",
          minHeight: "100vh",
          background: "radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), #020b14"
        }}
      >
        <WheelDeskSideNav active="positions" />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "1.1rem 1.4rem 2rem",
            display: "grid",
            gap: "1rem",
            alignContent: "start"
          }}
        >
          <h1 style={{ marginBottom: 0, color: "#e5f6ff", letterSpacing: "-0.04em" }}>
            Portfolio Risk Console
          </h1>
          <p style={{ color: "#9fb4c7" }}>Loading portfolio...</p>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), #020b14"
      }}
    >
      <WheelDeskSideNav active="positions" />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: "1.1rem 1.4rem 2rem",
          display: "grid",
          gap: "1rem",
          alignContent: "start"
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <div>
            <div
              style={{
                color: "#67e8f9",
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase"
              }}
            >
              WheelDesk
            </div>
            <h1 style={{ margin: 0, color: "#e5f6ff", letterSpacing: "-0.04em" }}>
              Portfolio Risk Console
            </h1>
            <p style={{ color: "#9fb4c7", margin: "0.25rem 0 0", fontSize: 13 }}>
              Position inventory, greeks, cash capacity, and risk profile management.
            </p>
          </div>

          <a
            href="/control-center"
            style={{
              border: "1px solid #22d3ee55",
              borderRadius: 10,
              padding: "0.6rem 0.8rem",
              background: "#071523",
              color: "#67e8f9",
              textDecoration: "none",
              fontWeight: 900
            }}
          >
            Open Control Center
          </a>
        </header>

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

      <PortfolioProfileSummary exposure={theoreticalExposure} />

      <CashOutlineSection
        cashOutline={cashOutline}
        positions={positions}
        primarySymbol={primarySymbol}
        currentPrice={currentPrice}
        onChange={(next) => {
          setCashOutline(next);
          persistCurrentProfile(positions, slices, next);
        }}
      />

      <WheelBasisTracker
        profileId={selectedProfileId}
        positions={positions}
      />

      <ExpirationLadder buckets={expirationBuckets} />

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
        <strong>Price Slice Mode</strong>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            checked={riskMode === "expiration"}
            onChange={() => setRiskMode("expiration")}
          />
          Expiration slices
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            checked={riskMode === "theoretical"}
            onChange={() => setRiskMode("theoretical")}
          />
          Theoretical slices
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

      <RiskProfileComparisonChart
        expirationPoints={expirationProfileCurve}
        theoreticalPoints={theoreticalProfileCurve}
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

      <RiskModeComparison
        expirationResults={expirationSliceResults}
        theoreticalResults={theoreticalSliceResults}
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
      </div>
    </main>
  );
}