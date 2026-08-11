"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyEsOrderFlowRead,
  updateEsOrderFlow,
  type EsOrderFlowRead,
  type EsOrderFlowSnapshot,
  type EsOrderFlowState,
} from "../lib/zeroDteEsOrderFlow";

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
};

export function ZeroDteEsOrderFlowPanel({ enabled = true }: Props) {
  const [read, setRead] = useState<EsOrderFlowRead>(() => emptyEsOrderFlowRead());
  const [capabilities, setCapabilities] = useState<OrderFlowApiResponse["capabilities"] | null>(null);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);

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

  const latest = read.latest;
  const staleSeconds = lastSuccessAt == null ? null : Math.max(0, (now - lastSuccessAt) / 1000);
  const stale = staleSeconds != null && staleSeconds > 4;
  const stateTone = toneForState(read.state);
  const visible = useMemo(() => read.samples.slice(-90), [read.samples]);

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
  error: { marginTop: 8, padding: "7px 9px", background: "#2b1418", border: "1px solid #713640", borderRadius: 8, color: "#ff8a8a", fontSize: 10 },
  warning: { marginTop: 8, padding: "7px 9px", background: "#261f12", border: "1px solid #6e5930", borderRadius: 8, color: "#e9c76b", fontSize: 10 },
  disclaimer: { marginTop: 8, color: "#62758e", fontSize: 9, lineHeight: 1.45 },
};
