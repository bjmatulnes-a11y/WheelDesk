"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyEsOrderFlowRead,
  updateEsOrderFlow,
  type EsOrderFlowRead,
  type EsOrderFlowSnapshot,
  type EsOrderFlowState,
} from "../lib/zeroDteEsOrderFlow";
import type { AdaptiveAuctionContext } from "../lib/zeroDteAdaptiveManagement";

type OrderFlowApiResponse = {
  ok: boolean;
  generatedAt: string;
  source?: string;
  snapshot?: EsOrderFlowSnapshot;
  capabilities?: {
    topOfBook: boolean;
    bookSizes: boolean;
    tapeProxy: boolean;
    fullDepth: boolean;
    trueTimeAndSales: boolean;
  };
  availableQuoteFields?: string[];
  note?: string;
  error?: string;
  failures?: string[];
};

type Props = {
  enabled?: boolean;
  spxPrice?: number | null;
  onManagementRead?: (read: AdaptiveAuctionContext | null) => void;
};

type FootprintBucket = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  totalVolume: number;
  delta: number;
  events: number;
  firstAt: string;
  lastAt: string;
};

const ES_TICK = 0.25;

export function ZeroDteEsOrderFlowPanel({
  enabled = true,
  spxPrice = null,
  onManagementRead,
}: Props) {
  const [read, setRead] = useState<EsOrderFlowRead>(() => emptyEsOrderFlowRead());
  const [capabilities, setCapabilities] = useState<OrderFlowApiResponse["capabilities"] | null>(null);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sandboxOpen, setSandboxOpen] = useState(true);
  const [footprintBuckets, setFootprintBuckets] = useState<Record<string, FootprintBucket>>({});
  const inFlightRef = useRef(false);
  const processedFootprintTimestampRef = useRef<string | null>(null);
  const managementPocHistoryRef = useRef<Array<{
    timestamp: string;
    pocEs: number;
    projectedPocSpx: number | null;
  }>>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const response = await fetch("/api/zero-dte/order-flow", {
          cache: "no-store",
        });
        const body = (await response.json()) as OrderFlowApiResponse;
        if (!response.ok || !body.ok || !body.snapshot) {
          throw new Error(body.error || `ES order-flow request failed (${response.status}).`);
        }
        if (cancelled) return;
        setCapabilities(body.capabilities ?? null);
        setFieldNames(body.availableQuoteFields ?? []);
        setRead((current) => updateEsOrderFlow(current.samples, body.snapshot!));
        setLastSuccessAt(Date.now());
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "ES order-flow request failed.",
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void load();
    const timer = window.setInterval(load, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const latestSample = read.latest;
    if (!latestSample || latestSample.timestamp === processedFootprintTimestampRef.current) return;
    processedFootprintTimestampRef.current = latestSample.timestamp;
    const tradePrice = latestSample.last ?? latestSample.mid;
    if (tradePrice == null || latestSample.volumeDelta <= 0) return;
    const bucketPrice = Math.round(tradePrice / ES_TICK) * ES_TICK;
    const key = bucketPrice.toFixed(2);
    setFootprintBuckets((current) => {
      const prior = current[key];
      const buyVolume = (prior?.buyVolume ?? 0) + latestSample.aggressiveBuyVolume;
      const sellVolume = (prior?.sellVolume ?? 0) + latestSample.aggressiveSellVolume;
      const unknownVolume = (prior?.unknownVolume ?? 0) + latestSample.unknownVolume;
      return {
        ...current,
        [key]: {
          price: bucketPrice,
          buyVolume,
          sellVolume,
          unknownVolume,
          totalVolume: buyVolume + sellVolume + unknownVolume,
          delta: buyVolume - sellVolume,
          events: (prior?.events ?? 0) + 1,
          firstAt: prior?.firstAt ?? latestSample.timestamp,
          lastAt: latestSample.timestamp,
        },
      };
    });
  }, [read.latest]);

  const latest = read.latest;
  const staleSeconds = lastSuccessAt == null ? null : Math.max(0, (now - lastSuccessAt) / 1000);
  const stale = staleSeconds != null && staleSeconds > 4;
  const stateTone = toneForState(read.state);
  const visible = useMemo(() => read.samples.slice(-90), [read.samples]);
  const managementProfile: {
    observedVolume: number;
    classificationPct: number | null;
    pocEs: number | null;
  } = useMemo(() => {
    const levels = Object.values(footprintBuckets) as FootprintBucket[];
    const observedVolume = levels.reduce((sum, level) => sum + level.totalVolume, 0);
    const classifiedVolume = levels.reduce(
      (sum, level) => sum + level.buyVolume + level.sellVolume,
      0,
    );
    const poc = levels.reduce<FootprintBucket | null>(
      (best, level) => (!best || level.totalVolume > best.totalVolume ? level : best),
      null,
    );
    return {
      observedVolume,
      classificationPct:
        observedVolume > 0 ? (classifiedVolume / observedVolume) * 100 : null,
      pocEs: poc?.price ?? null,
    };
  }, [footprintBuckets]);

  useEffect(() => {
    if (!enabled || !latest) {
      onManagementRead?.(null);
      return;
    }
    const esReference = latest.last ?? latest.mid;
    const basis =
      esReference !== null && spxPrice !== null && Number.isFinite(spxPrice) && spxPrice > 0
        ? esReference - spxPrice
        : null;
    const projectedPocSpx =
      managementProfile.pocEs !== null && basis !== null
        ? managementProfile.pocEs - basis
        : null;

    if (managementProfile.pocEs !== null) {
      const history = managementPocHistoryRef.current;
      const last = history.at(-1);
      if (!last || last.timestamp !== latest.timestamp) {
        history.push({
          timestamp: latest.timestamp,
          pocEs: managementProfile.pocEs,
          projectedPocSpx,
        });
      } else {
        history[history.length - 1] = {
          timestamp: latest.timestamp,
          pocEs: managementProfile.pocEs,
          projectedPocSpx,
        };
      }
      const nowMs = Date.parse(latest.timestamp);
      managementPocHistoryRef.current = history.filter(
        (item) => nowMs - Date.parse(item.timestamp) <= 5 * 60_000,
      );
    }

    const oldestProjected = managementPocHistoryRef.current.find(
      (item) => item.projectedPocSpx !== null,
    )?.projectedPocSpx ?? null;
    const pocMigration5mSpx =
      projectedPocSpx !== null && oldestProjected !== null
        ? projectedPocSpx - oldestProjected
        : null;

    onManagementRead?.({
      state: read.state,
      directionalPressurePct: latest.directionalPressurePct,
      efficiencyPct: latest.efficiencyPct,
      flowConfidencePct: latest.flowConfidencePct,
      observedPocEs: managementProfile.pocEs,
      projectedPocSpx,
      pocMigration5mSpx,
      observedVolume: managementProfile.observedVolume,
      classificationPct: managementProfile.classificationPct,
    });
  }, [
    enabled,
    latest,
    managementProfile,
    onManagementRead,
    read.state,
    spxPrice,
  ]);

  return (
    <div style={styles.shell}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>ES Auction Flow</div>
          <div style={styles.titleRow}>
            <strong style={styles.title}>Order Flow</strong>
            <span style={{ ...styles.statePill, color: stateTone.color, borderColor: stateTone.border, background: stateTone.bg }}>
              {labelState(read.state)}
            </span>
            <span style={styles.modePill}>REST FLOW · 1s</span>
            {capabilities?.fullDepth ? (
              <span style={styles.depthPill}>FULL DEPTH</span>
            ) : (
              <span style={styles.proxyPill}>TOP OF BOOK</span>
            )}
            <button
              type="button"
              onClick={() => setSandboxOpen((current) => !current)}
              style={styles.sandboxToggle}
            >
              {sandboxOpen ? "HIDE FOOTPRINT SANDBOX" : "OPEN FOOTPRINT SANDBOX"}
            </button>
          </div>
          <div style={styles.subtitle}>
            ES bid/ask pressure + aggregate trade-volume classification. Observational only until streamer validation.
          </div>
        </div>
        <div style={{ ...styles.freshness, color: stale ? "#ff7a7a" : "#8ea0b8" }}>
          {latest?.symbol ?? "/ES"} · {lastSuccessAt == null ? "connecting" : stale ? `${staleSeconds?.toFixed(0)}s stale` : "live"}
        </div>
      </div>

      <div style={styles.metricGrid}>
        <FlowMetric label="20s Delta" value={signedInteger(latest?.rollingDelta20s)} tone={deltaTone(latest?.rollingDelta20s ?? 0)} />
        <FlowMetric label="Flow Pressure" value={signedPct(latest?.directionalPressurePct)} tone={pressureTone(latest?.directionalPressurePct ?? 0)} />
        <FlowMetric label="Intensity" value={latest?.intensityZ == null ? "warming" : `${latest.intensityZ.toFixed(1)}σ`} tone={intensityTone(latest?.intensityZ)} />
        <FlowMetric label="Efficiency" value={latest?.efficiencyPct == null ? "warming" : `${latest.efficiencyPct.toFixed(0)}%`} tone={efficiencyTone(latest?.efficiencyPct)} />
        <FlowMetric label="Flow Confidence" value={latest?.flowConfidencePct == null ? "warming" : `${latest.flowConfidence} · ${latest.flowConfidencePct.toFixed(0)}%`} tone={confidenceTone(latest?.flowConfidencePct)} />
        <FlowMetric label="Book Imbalance" value={signedPct(latest?.bookImbalancePct)} tone={pressureTone(latest?.bookImbalancePct ?? 0)} />
        <FlowMetric label="20s Move" value={latest?.priceDisplacementTicks20s == null ? "—" : `${signed(latest.priceDisplacementTicks20s, 1)} ticks`} tone={deltaTone(latest?.priceDisplacementTicks20s ?? 0)} />
      </div>

      <div style={styles.bodyGrid}>
        <div style={styles.chartCard}>
          <div style={styles.cardHeader}>
            <strong>Aggressive-flow proxy</strong>
            <span>green = ask-side classification · red = bid-side classification · cyan = rolling pressure</span>
          </div>
          <OrderFlowSvg samples={visible} />
          <div style={styles.chartFooter}>
            <span>Samples {read.sampleCount}</span>
            <span>20s volume {integer(latest?.rollingVolume20s)}</span>
            <span>Current rate {latest ? `${latest.volumeRatePerSec.toFixed(1)}/s` : "—"}</span>
          </div>
        </div>

        <div style={styles.bookCard}>
          <div style={styles.cardHeader}>
            <strong>ES top of book</strong>
            <span>{capabilities?.bookSizes ? "live quantities" : "size fields unavailable"}</span>
          </div>
          <TopOfBook latest={latest} />
          <div style={styles.bookStats}>
            <BookStat label="Bid stacking" value={stacking(latest?.bidStacking)} positiveMeans="support" />
            <BookStat label="Ask stacking" value={stacking(latest?.askStacking)} positiveMeans="resistance" />
            <BookStat label="Microprice" value={latest?.microPrice == null ? "—" : latest.microPrice.toFixed(2)} />
            <BookStat label="Spread" value={latest?.spreadTicks == null ? "—" : `${latest.spreadTicks.toFixed(1)} ticks`} />
          </div>
        </div>
      </div>

      {sandboxOpen ? (
        <FootprintSandbox
          buckets={footprintBuckets}
          samples={read.samples}
          latest={latest}
          capabilities={capabilities}
          fieldNames={fieldNames}
          onReset={() => setFootprintBuckets({})}
        />
      ) : null}

      {error ? <div style={styles.error}>{error}</div> : null}
      {read.warnings.length ? (
        <div style={styles.warning}>{read.warnings[0]}</div>
      ) : null}
      {capabilities && !capabilities.trueTimeAndSales ? (
        <div style={styles.disclaimer}>
          V1 is deliberately conservative: Schwab REST snapshots can estimate aggressive flow from volume changes, but they are not a trade-by-trade Time & Sales feed and do not expose full DOM here. The panel reports that limitation rather than pretending otherwise.
          {fieldNames.length ? ` Quote fields detected: ${fieldNames.join(", ")}.` : ""}
        </div>
      ) : null}
    </div>
  );
}

function FootprintSandbox({
  buckets,
  samples,
  latest,
  capabilities,
  fieldNames,
  onReset,
}: {
  buckets: Record<string, FootprintBucket>;
  samples: EsOrderFlowRead["samples"];
  latest: EsOrderFlowRead["latest"];
  capabilities: OrderFlowApiResponse["capabilities"] | null;
  fieldNames: string[];
  onReset: () => void;
}) {
  const levels = Object.values(buckets).sort((a, b) => b.price - a.price);
  const totalObserved = levels.reduce((total, level) => total + level.totalVolume, 0);
  const classified = levels.reduce((total, level) => total + level.buyVolume + level.sellVolume, 0);
  const classificationPct = totalObserved > 0 ? (classified / totalObserved) * 100 : 0;
  const maxSideVolume = Math.max(
    1,
    ...levels.map((level) => Math.max(level.buyVolume, level.sellVolume, level.unknownVolume)),
  );
  const poc = levels.reduce<FootprintBucket | null>(
    (best, level) => (best == null || level.totalVolume > best.totalVolume ? level : best),
    null,
  );
  const distinctTradeTimes = new Set(
    samples
      .map((sample) => sample.sourceTradeTime)
      .filter((value): value is number => value != null && Number.isFinite(value)),
  ).size;
  const distinctQuoteTimes = new Set(
    samples
      .map((sample) => sample.sourceQuoteTime)
      .filter((value): value is number => value != null && Number.isFinite(value)),
  ).size;
  const currentPrice = latest?.last ?? latest?.mid ?? null;
  const displayed = nearestFootprintLevels(levels, currentPrice, 32);

  return (
    <div style={styles.sandboxShell}>
      <div style={styles.sandboxHeader}>
        <div>
          <div style={styles.eyebrow}>Experimental · no execution wiring</div>
          <strong style={styles.sandboxTitle}>ES Footprint / Volume-at-Price Sandbox</strong>
          <div style={styles.sandboxSubtitle}>
            Buckets Schwab 1-second REST volume changes at the observed ES trade price. This tests whether the feed is rich enough to reveal acceptance, heavy-volume nodes, and absorption before we touch SELL_READY.
          </div>
        </div>
        <button type="button" onClick={onReset} style={styles.resetButton}>RESET SANDBOX</button>
      </div>

      <div style={styles.sandboxMetricGrid}>
        <SandboxMetric label="Volume observed" value={integer(totalObserved)} />
        <SandboxMetric label="Classified" value={totalObserved > 0 ? `${classificationPct.toFixed(0)}%` : "warming"} />
        <SandboxMetric label="Price levels" value={levels.length.toLocaleString()} />
        <SandboxMetric label="POC proxy" value={poc ? poc.price.toFixed(2) : "warming"} />
        <SandboxMetric label="Trade-time changes" value={distinctTradeTimes.toLocaleString()} />
        <SandboxMetric label="Quote-time changes" value={distinctQuoteTimes.toLocaleString()} />
        <SandboxMetric label="Last size field" value={latest?.sourceLastSize == null ? "missing" : integer(latest.sourceLastSize)} />
        <SandboxMetric label="Total volume field" value={latest?.sourceTotalVolume == null ? "missing" : integer(latest.sourceTotalVolume)} />
      </div>

      <div style={styles.capabilityStrip}>
        <span style={capabilityTone(capabilities?.topOfBook)}>Top book {capabilities?.topOfBook ? "YES" : "NO"}</span>
        <span style={capabilityTone(capabilities?.bookSizes)}>Book sizes {capabilities?.bookSizes ? "YES" : "NO"}</span>
        <span style={capabilityTone(capabilities?.tapeProxy)}>Volume/tape proxy {capabilities?.tapeProxy ? "YES" : "NO"}</span>
        <span style={capabilityTone(capabilities?.trueTimeAndSales)}>True T&S {capabilities?.trueTimeAndSales ? "YES" : "NO"}</span>
        <span style={capabilityTone(capabilities?.fullDepth)}>Full DOM {capabilities?.fullDepth ? "YES" : "NO"}</span>
      </div>

      <div style={styles.footprintTable}>
        <div style={styles.footprintHeaderRow}>
          <span>BID-SIDE PROXY</span>
          <span>PRICE</span>
          <span>ASK-SIDE PROXY</span>
          <span>UNKNOWN</span>
          <span>DELTA</span>
          <span>TOTAL</span>
        </div>
        <div style={styles.footprintRows}>
          {displayed.length ? displayed.map((level) => {
            const isPoc = poc?.price === level.price;
            const isCurrent = currentPrice != null && Math.abs(level.price - currentPrice) <= ES_TICK / 2;
            const sellWidth = Math.max(2, (level.sellVolume / maxSideVolume) * 100);
            const buyWidth = Math.max(2, (level.buyVolume / maxSideVolume) * 100);
            return (
              <div
                key={level.price.toFixed(2)}
                style={{
                  ...styles.footprintRow,
                  ...(isCurrent ? styles.currentFootprintRow : {}),
                }}
              >
                <span style={styles.footprintSideCell}>
                  <span style={{ ...styles.sellVolumeBar, width: `${sellWidth}%` }} />
                  <b>{integer(level.sellVolume)}</b>
                </span>
                <strong style={styles.footprintPrice}>
                  {level.price.toFixed(2)}
                  {isPoc ? <em style={styles.pocBadge}>POC</em> : null}
                  {isCurrent ? <em style={styles.lastBadge}>LAST</em> : null}
                </strong>
                <span style={styles.footprintSideCell}>
                  <span style={{ ...styles.buyVolumeBar, width: `${buyWidth}%` }} />
                  <b>{integer(level.buyVolume)}</b>
                </span>
                <span>{integer(level.unknownVolume)}</span>
                <strong style={{ color: deltaTone(level.delta) }}>{signedInteger(level.delta)}</strong>
                <strong>{integer(level.totalVolume)}</strong>
              </div>
            );
          }) : (
            <div style={styles.emptyFootprint}>Waiting for positive ES volume changes…</div>
          )}
        </div>
      </div>

      <div style={styles.sandboxFooter}>
        <span>
          Interpretation test: repeated heavy volume at a price with little displacement can become an HVN/absorption candidate; thin levels can become LVN/fast-travel candidates.
        </span>
        <span>
          REST limitation: a 1-second volume increment may contain many CME trades, so the whole increment is assigned to the latest observed price/aggressor. Do not call this a true footprint unless Schwab exposes trade-by-trade streaming data.
        </span>
        {fieldNames.length ? <span>Detected Schwab quote fields: {fieldNames.join(", ")}.</span> : null}
      </div>
    </div>
  );
}

function SandboxMetric({ label, value }: { label: string; value: string }) {
  return <div style={styles.sandboxMetric}><span>{label}</span><strong>{value}</strong></div>;
}

function nearestFootprintLevels(levels: FootprintBucket[], currentPrice: number | null, maxRows: number) {
  if (levels.length <= maxRows) return levels;
  if (currentPrice == null) return levels.slice(0, maxRows);
  return levels
    .slice()
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, maxRows)
    .sort((a, b) => b.price - a.price);
}

function capabilityTone(active: boolean | undefined): React.CSSProperties {
  return {
    border: `1px solid ${active ? "#1f8f67" : "#5f4850"}`,
    background: active ? "#0c2a23" : "#21171b",
    color: active ? "#65e0b4" : "#b68b95",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 9,
    fontWeight: 800,
  };
}

function OrderFlowSvg({
  samples,
}: {
  samples: EsOrderFlowRead["samples"];
}) {
  const width = 1000;
  const height = 210;
  const zeroY = 105;
  if (!samples.length) {
    return <div style={styles.emptyChart}>Waiting for ES samples…</div>;
  }
  const maxDelta = Math.max(1, ...samples.map((sample) => Math.abs(sample.signedDelta)));
  const barWidth = Math.max(2, width / Math.max(90, samples.length) - 2);
  const pressurePoints = samples
    .map((sample, index) => {
      const x = (index / Math.max(1, samples.length - 1)) * width;
      const y = zeroY - (sample.directionalPressurePct / 100) * 82;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={styles.svg} preserveAspectRatio="none">
      <rect x="0" y="0" width={width} height={height} fill="#08101c" />
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="#314158" strokeWidth="1" />
      <line x1="0" y1="23" x2={width} y2="23" stroke="#16243a" strokeWidth="1" strokeDasharray="5 8" />
      <line x1="0" y1="187" x2={width} y2="187" stroke="#16243a" strokeWidth="1" strokeDasharray="5 8" />
      {samples.map((sample, index) => {
        const x = (index / Math.max(90, samples.length)) * width;
        const magnitude = Math.max(1, (Math.abs(sample.signedDelta) / maxDelta) * 78);
        const positive = sample.signedDelta >= 0;
        return (
          <rect
            key={`${sample.timestamp}:${index}`}
            x={x}
            y={positive ? zeroY - magnitude : zeroY}
            width={barWidth}
            height={sample.signedDelta === 0 ? 1 : magnitude}
            rx="1"
            fill={positive ? "#16c784" : "#ea3943"}
            opacity={sample.unknownVolume > 0 && sample.volumeDelta === sample.unknownVolume ? 0.25 : 0.82}
          />
        );
      })}
      <polyline points={pressurePoints} fill="none" stroke="#4cc9f0" strokeWidth="3" opacity="0.95" />
    </svg>
  );
}

function TopOfBook({ latest }: { latest: EsOrderFlowRead["latest"] }) {
  const bidPct = depthPct(latest?.bidSize, latest?.askSize);
  const askPct = depthPct(latest?.askSize, latest?.bidSize);
  const mid = latest?.bid != null && latest?.ask != null ? (latest.bid + latest.ask) / 2 : null;
  return (
    <div style={styles.ladder}>
      <div style={styles.ladderHeader}><span>BID SIZE</span><span>PRICE</span><span>ASK SIZE</span></div>
      <div style={styles.askRow}>
        <span />
        <strong>{latest?.ask?.toFixed(2) ?? "—"}</strong>
        <span style={styles.depthCell}>
          <span style={{ ...styles.askDepth, width: `${askPct}%` }} />
          <b>{integer(latest?.askSize)}</b>
        </span>
      </div>
      <div style={styles.midRow}><span /><strong>{mid?.toFixed(3) ?? "MARKET"}</strong><span /></div>
      <div style={styles.bidRow}>
        <span style={styles.depthCell}>
          <span style={{ ...styles.bidDepth, width: `${bidPct}%` }} />
          <b>{integer(latest?.bidSize)}</b>
        </span>
        <strong>{latest?.bid?.toFixed(2) ?? "—"}</strong>
        <span />
      </div>
      <div style={styles.lastTradeRow}>
        <span>LAST</span>
        <strong>{latest?.last?.toFixed(2) ?? "—"}</strong>
        <span>{latest?.volumeDelta ? `+${latest.volumeDelta} vol` : "—"}</span>
      </div>
    </div>
  );
}

function FlowMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </div>
  );
}

function BookStat({ label, value }: { label: string; value: string; positiveMeans?: string }) {
  return <div style={styles.bookStat}><span>{label}</span><strong>{value}</strong></div>;
}

function toneForState(state: EsOrderFlowState) {
  if (state === "RELEASE_UP" || state === "REVERSAL_UP") return { color: "#34d399", border: "#1f8f67", bg: "#0c2a23" };
  if (state === "RELEASE_DOWN" || state === "REVERSAL_DOWN") return { color: "#ff7a7a", border: "#9d454d", bg: "#2c161c" };
  if (state === "ABSORBING_HIGH" || state === "ABSORBING_LOW") return { color: "#f6c453", border: "#8c6e28", bg: "#2b2412" };
  if (state === "EXHAUSTING_UP" || state === "EXHAUSTING_DOWN") return { color: "#c084fc", border: "#7350a1", bg: "#241733" };
  return { color: "#9fb1c7", border: "#45566c", bg: "#111b2a" };
}

function labelState(state: EsOrderFlowState) {
  return state.replaceAll("_", " ");
}

function signedInteger(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString()}`;
}

function signedPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}%`;
}

function signed(value: number, decimals = 0) {
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

function integer(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

function stacking(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "flat";
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

function depthPct(primary: number | null | undefined, other: number | null | undefined) {
  const a = primary ?? 0;
  const b = other ?? 0;
  if (a + b <= 0) return 0;
  return Math.max(8, Math.min(100, (a / (a + b)) * 100));
}

function deltaTone(value: number) {
  return value > 0 ? "#34d399" : value < 0 ? "#ff7a7a" : "#d7e0eb";
}

function pressureTone(value: number) {
  return value >= 15 ? "#34d399" : value <= -15 ? "#ff7a7a" : "#d7e0eb";
}

function intensityTone(value: number | null | undefined) {
  if (value == null) return "#8ea0b8";
  if (value >= 2) return "#4cc9f0";
  if (value >= 1) return "#f6c453";
  return "#d7e0eb";
}

function efficiencyTone(value: number | null | undefined) {
  if (value == null) return "#8ea0b8";
  if (value >= 60) return "#34d399";
  if (value <= 30) return "#f6c453";
  return "#d7e0eb";
}

function confidenceTone(value: number | null | undefined) {
  if (value == null) return "#8ea0b8";
  if (value >= 70) return "#34d399";
  if (value >= 45) return "#f6c453";
  return "#8ea0b8";
}

const styles: Record<string, React.CSSProperties> = {
  shell: { border: "1px solid #253550", borderRadius: 14, background: "#0b1320", padding: 14, marginTop: 12, color: "#d7e0eb" },
  header: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" },
  eyebrow: { color: "#6f8198", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 800 },
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 3 },
  title: { color: "#f7fafc", fontSize: 17 },
  subtitle: { color: "#7f91a8", fontSize: 11, marginTop: 4 },
  statePill: { border: "1px solid", borderRadius: 999, padding: "3px 7px", fontSize: 10, fontWeight: 900, letterSpacing: 0.4 },
  modePill: { border: "1px solid #345270", color: "#7cc4ff", background: "#0d2234", borderRadius: 999, padding: "3px 7px", fontSize: 9, fontWeight: 900 },
  depthPill: { border: "1px solid #1f8f67", color: "#34d399", background: "#0c2a23", borderRadius: 999, padding: "3px 7px", fontSize: 9, fontWeight: 900 },
  proxyPill: { border: "1px solid #6e5930", color: "#f6c453", background: "#261f12", borderRadius: 999, padding: "3px 7px", fontSize: 9, fontWeight: 900 },
  sandboxToggle: { border: "1px solid #62518c", color: "#c4a7ff", background: "#181429", borderRadius: 999, padding: "4px 8px", fontSize: 9, fontWeight: 900, cursor: "pointer" },
  freshness: { fontSize: 11, fontWeight: 800, paddingTop: 3 },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))", gap: 8, marginTop: 12 },
  metric: { background: "#0e1928", border: "1px solid #1d2d43", borderRadius: 9, padding: "8px 9px", display: "flex", flexDirection: "column", gap: 3 },
  bodyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginTop: 10 },
  chartCard: { background: "#08101c", border: "1px solid #1b2b42", borderRadius: 10, overflow: "hidden" },
  bookCard: { background: "#08101c", border: "1px solid #1b2b42", borderRadius: 10, overflow: "hidden" },
  cardHeader: { display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderBottom: "1px solid #18263a", color: "#8fa2bb", fontSize: 9, flexWrap: "wrap" },
  svg: { width: "100%", height: 185, display: "block" },
  emptyChart: { height: 185, display: "grid", placeItems: "center", color: "#63758c", fontSize: 11 },
  chartFooter: { display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 10px", color: "#71849d", fontSize: 9, borderTop: "1px solid #18263a", flexWrap: "wrap" },
  ladder: { padding: 10, display: "grid", gap: 4 },
  ladderHeader: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", color: "#64778f", fontSize: 8, textAlign: "center", letterSpacing: .6 },
  askRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", minHeight: 36, alignItems: "center", textAlign: "center", background: "#1d1015", borderRadius: 6, color: "#ff9696" },
  bidRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", minHeight: 36, alignItems: "center", textAlign: "center", background: "#0d211c", borderRadius: 6, color: "#78e6bf" },
  midRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", textAlign: "center", color: "#f5f8fb", fontSize: 10, padding: "2px 0" },
  depthCell: { position: "relative", minHeight: 28, display: "grid", placeItems: "center", overflow: "hidden" },
  askDepth: { position: "absolute", right: 0, top: 0, bottom: 0, background: "#7c2833", opacity: .7 },
  bidDepth: { position: "absolute", left: 0, top: 0, bottom: 0, background: "#17684f", opacity: .72 },
  lastTradeRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", textAlign: "center", color: "#7f91a8", fontSize: 9, borderTop: "1px solid #17263a", paddingTop: 7 },
  bookStats: { display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid #17263a" },
  bookStat: { display: "flex", flexDirection: "column", gap: 2, padding: 8, borderRight: "1px solid #17263a", borderBottom: "1px solid #17263a", fontSize: 9, color: "#74869e" },
  sandboxShell: { marginTop: 12, border: "1px solid #493d6d", background: "#0b1020", borderRadius: 12, overflow: "hidden" },
  sandboxHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: 12, borderBottom: "1px solid #27223d" },
  sandboxTitle: { display: "block", color: "#e9ddff", fontSize: 15, marginTop: 2 },
  sandboxSubtitle: { color: "#8190aa", fontSize: 10, lineHeight: 1.45, marginTop: 4, maxWidth: 980 },
  resetButton: { border: "1px solid #4f5d75", background: "#101a29", color: "#b8c5d8", borderRadius: 8, padding: "6px 9px", fontSize: 9, fontWeight: 800, cursor: "pointer" },
  sandboxMetricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 7, padding: 10 },
  sandboxMetric: { display: "flex", flexDirection: "column", gap: 2, padding: "7px 8px", border: "1px solid #202c42", borderRadius: 8, background: "#0c1624", color: "#71839b", fontSize: 9 },
  capabilityStrip: { display: "flex", gap: 6, flexWrap: "wrap", padding: "0 10px 10px" },
  footprintTable: { margin: "0 10px 10px", border: "1px solid #202c42", borderRadius: 9, overflow: "hidden", background: "#08101c" },
  footprintHeaderRow: { display: "grid", gridTemplateColumns: "1.4fr 120px 1.4fr 90px 90px 90px", gap: 8, alignItems: "center", padding: "7px 9px", color: "#667991", fontSize: 8, fontWeight: 900, letterSpacing: .4, borderBottom: "1px solid #1b283b", textAlign: "center" },
  footprintRows: { maxHeight: 430, overflowY: "auto" },
  footprintRow: { display: "grid", gridTemplateColumns: "1.4fr 120px 1.4fr 90px 90px 90px", gap: 8, alignItems: "center", minHeight: 29, padding: "3px 9px", borderBottom: "1px solid #132035", color: "#9aabc1", fontSize: 9, textAlign: "center" },
  currentFootprintRow: { background: "#0c2530", boxShadow: "inset 3px 0 0 #4cc9f0" },
  footprintSideCell: { position: "relative", minHeight: 21, display: "grid", placeItems: "center", overflow: "hidden", borderRadius: 4, background: "#0c1420" },
  sellVolumeBar: { position: "absolute", right: 0, top: 0, bottom: 0, background: "#7f2f3a", opacity: .7 },
  buyVolumeBar: { position: "absolute", left: 0, top: 0, bottom: 0, background: "#17684f", opacity: .72 },
  footprintPrice: { color: "#f0f4f8", display: "flex", justifyContent: "center", gap: 5, alignItems: "center" },
  pocBadge: { fontStyle: "normal", fontSize: 7, padding: "2px 4px", borderRadius: 999, background: "#46351b", color: "#f6c453", border: "1px solid #80652f" },
  lastBadge: { fontStyle: "normal", fontSize: 7, padding: "2px 4px", borderRadius: 999, background: "#103045", color: "#74d4ff", border: "1px solid #2c6d8f" },
  emptyFootprint: { minHeight: 130, display: "grid", placeItems: "center", color: "#667991", fontSize: 10 },
  sandboxFooter: { display: "grid", gap: 4, padding: "9px 11px", borderTop: "1px solid #27223d", color: "#657891", fontSize: 9, lineHeight: 1.45 },
  error: { marginTop: 8, padding: "7px 9px", background: "#2b1418", border: "1px solid #713640", borderRadius: 8, color: "#ff8a8a", fontSize: 10 },
  warning: { marginTop: 8, padding: "7px 9px", background: "#261f12", border: "1px solid #6e5930", borderRadius: 8, color: "#e9c76b", fontSize: 10 },
  disclaimer: { marginTop: 8, color: "#62758e", fontSize: 9, lineHeight: 1.45 },
};
