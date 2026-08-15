"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildHistoricalFootprintStudy,
  type HistoricalEsCandle,
} from "../lib/zeroDteHistoricalFootprint";

type ApiResponse = {
  ok: boolean;
  provider?: string;
  date?: string;
  requestedSymbol?: string | null;
  symbol?: string;
  contractCandidate?: string;
  previousClose?: number | null;
  candleCount?: number;
  candles?: HistoricalEsCandle[];
  limitations?: {
    trueTimeAndSales?: boolean;
    historicalBidAskVolume?: boolean;
    fullDepth?: boolean;
    reconstruction?: string;
  };
  note?: string;
  error?: string;
  failures?: string[];
};

type Aggregation = 5 | 15 | 30;
type SessionMode = "RTH" | "FULL";

export default function EsHistoricalFootprintLab() {
  const [date, setDate] = useState("2026-08-14");
  const [symbol, setSymbol] = useState("");
  const [aggregation, setAggregation] = useState<Aggregation>(30);
  const [session, setSession] = useState<SessionMode>("RTH");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      if (symbol.trim()) params.set("symbol", symbol.trim());
      const res = await fetch(`/api/zero-dte/es-history?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as ApiResponse;
      setResponse(body);
      if (!res.ok || !body.ok) {
        setError(body.error || `Historical ES request failed (${res.status}).`);
      }
    } catch (loadError) {
      setResponse(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Intentionally probe the Friday session once on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const study = useMemo(() => {
    if (!response?.ok || !response.candles?.length) return null;
    return buildHistoricalFootprintStudy({
      candles: response.candles,
      date,
      aggregationMinutes: aggregation,
      session,
    });
  }, [response, date, aggregation, session]);

  return (
    <section style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Experimental · historical reconstruction</div>
          <h1 style={styles.title}>ES Historical Footprint Lab</h1>
          <p style={styles.subtitle}>
            Requests Schwab 1-minute history and reconstructs a footprint-style volume-at-price matrix. Bid/ask cells are estimates from OHLCV, not historical Time &amp; Sales.
          </p>
        </div>
        <div style={styles.badge}>NO EXECUTION WIRING</div>
      </header>

      <div style={styles.controls}>
        <label style={styles.control}>
          <span>Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.control}>
          <span>Schwab symbol override</span>
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="auto (/ESU26 for Aug 14)"
            style={styles.input}
          />
        </label>
        <label style={styles.control}>
          <span>Footprint column</span>
          <select
            value={aggregation}
            onChange={(event) => setAggregation(Number(event.target.value) as Aggregation)}
            style={styles.input}
          >
            <option value={5}>5 minute</option>
            <option value={15}>15 minute</option>
            <option value={30}>30 minute</option>
          </select>
        </label>
        <label style={styles.control}>
          <span>Session</span>
          <select
            value={session}
            onChange={(event) => setSession(event.target.value as SessionMode)}
            style={styles.input}
          >
            <option value="RTH">SPX cash session</option>
            <option value="FULL">Full ES trading session</option>
          </select>
        </label>
        <button onClick={() => void load()} disabled={loading} style={styles.button}>
          {loading ? "TESTING SCHWAB…" : "LOAD HISTORY"}
        </button>
      </div>

      <DiagnosticStrip response={response} study={study} loading={loading} />

      {error ? (
        <div style={styles.failureCard}>
          <strong>Schwab historical futures probe did not return usable ES candles.</strong>
          <div style={styles.failureText}>{error}</div>
          {response?.contractCandidate ? (
            <div style={styles.failureText}>Auto contract tested: {response.contractCandidate}</div>
          ) : null}
          {response?.failures?.length ? (
            <div style={styles.failureList}>
              {response.failures.map((failure) => (
                <div key={failure}>• {failure}</div>
              ))}
            </div>
          ) : null}
          <div style={styles.failureHint}>
            If this fails for /ESU26 but succeeds when you type SPY in the symbol box, Schwab authentication and price history are working; the missing piece is historical futures support. We would then persist live CHART_FUTURES / quote samples going forward or use a second historical futures source.
          </div>
        </div>
      ) : null}

      {study?.buckets.length ? (
        <>
          <div style={styles.legendRow}>
            <span><b>Cell:</b> estimated bid × ask</span>
            <span><b>POC:</b> highest reconstructed volume price</span>
            <span><b>HVN:</b> top 20% profile levels</span>
            <span><b>LVN:</b> bottom 20% visited profile levels</span>
            <span><b>VA:</b> ~70% reconstructed volume area</span>
          </div>
          <FootprintMatrix study={study} />
          <div style={styles.disclaimer}>
            Reconstruction method: each 1-minute Schwab OHLCV candle is distributed across the 0.25-point ES prices it traversed, weighted toward the candle body/close. Estimated aggressor share uses candle direction and close location. This can reveal acceptance/HVN/LVN structure, but it cannot reproduce true historical bid×ask footprint cells without trade-by-trade data.
          </div>
        </>
      ) : !loading && response?.ok ? (
        <div style={styles.empty}>Schwab returned candles, but none matched the selected session/date.</div>
      ) : null}
    </section>
  );
}

function DiagnosticStrip({
  response,
  study,
  loading,
}: {
  response: ApiResponse | null;
  study: ReturnType<typeof buildHistoricalFootprintStudy> | null;
  loading: boolean;
}) {
  const metrics = [
    ["Source", loading ? "testing" : response?.provider ?? "—"],
    ["Symbol", response?.symbol ?? response?.contractCandidate ?? "—"],
    ["1m candles", response?.candleCount == null ? "—" : integer(response.candleCount)],
    ["Session candles", study ? integer(study.candleCount) : "—"],
    ["Footprint columns", study ? integer(study.buckets.length) : "—"],
    ["POC proxy", study?.poc == null ? "—" : study.poc.toFixed(2)],
    ["Value area", study?.valueAreaLow == null || study?.valueAreaHigh == null ? "—" : `${study.valueAreaLow.toFixed(2)}–${study.valueAreaHigh.toFixed(2)}`],
    ["Historical T&S", response?.limitations?.trueTimeAndSales ? "YES" : "NO"],
  ];
  return (
    <div style={styles.metrics}>
      {metrics.map(([label, value]) => (
        <div key={label} style={styles.metric}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function FootprintMatrix({
  study,
}: {
  study: ReturnType<typeof buildHistoricalFootprintStudy>;
}) {
  const prices = study.profile.map((level) => level.price);
  const profileByPrice = new Map(study.profile.map((level) => [level.price, level]));
  const bucketMaps = study.buckets.map(
    (bucket) => new Map(bucket.cells.map((cell) => [cell.price, cell])),
  );
  const maxCell = Math.max(
    1,
    ...study.buckets.flatMap((bucket) => bucket.cells.map((cell) => cell.totalVolume)),
  );
  const maxProfile = Math.max(1, ...study.profile.map((level) => level.totalVolume));
  const columns = `72px repeat(${study.buckets.length}, minmax(116px, 1fr)) 160px`;

  return (
    <div style={styles.matrixFrame}>
      <div style={styles.matrixScroller}>
        <div style={{ ...styles.matrix, gridTemplateColumns: columns }}>
          <div style={{ ...styles.corner, ...styles.stickyHeader, ...styles.stickyLeft }}>PRICE</div>
          {study.buckets.map((bucket) => (
            <div key={bucket.key} style={{ ...styles.bucketHeader, ...styles.stickyHeader }}>
              <strong>{bucket.label}</strong>
              <span>{bucket.open.toFixed(2)} → {bucket.close.toFixed(2)}</span>
              <span>H {bucket.high.toFixed(2)} · L {bucket.low.toFixed(2)}</span>
            </div>
          ))}
          <div style={{ ...styles.bucketHeader, ...styles.stickyHeader }}>
            <strong>SESSION PROFILE</strong>
            <span>reconstructed</span>
          </div>

          {prices.map((price) => {
            const profile = profileByPrice.get(price)!;
            const isValueArea =
              study.valueAreaLow != null &&
              study.valueAreaHigh != null &&
              price >= study.valueAreaLow &&
              price <= study.valueAreaHigh;
            return [
              <div
                key={`price:${price}`}
                style={{
                  ...styles.priceCell,
                  ...styles.stickyLeft,
                  ...(price === study.poc ? styles.pocPrice : {}),
                  ...(isValueArea ? styles.valueAreaPrice : {}),
                }}
              >
                <strong>{price.toFixed(2)}</strong>
                {profile.node !== "NORMAL" ? <small>{profile.node}</small> : null}
              </div>,
              ...study.buckets.map((bucket, index) => {
                const cell = bucketMaps[index].get(price);
                return (
                  <FootprintCell
                    key={`${bucket.key}:${price}`}
                    cell={cell}
                    maxCell={maxCell}
                    poc={price === study.poc}
                  />
                );
              }),
              <ProfileCell
                key={`profile:${price}`}
                level={profile}
                maxProfile={maxProfile}
              />,
            ];
          })}
        </div>
      </div>
    </div>
  );
}

function FootprintCell({
  cell,
  maxCell,
  poc,
}: {
  cell?: { bidVolume: number; askVolume: number; totalVolume: number; delta: number };
  maxCell: number;
  poc: boolean;
}) {
  if (!cell || cell.totalVolume <= 0) return <div style={styles.blankCell}>·</div>;
  const strength = Math.min(1, cell.totalVolume / maxCell);
  const deltaPct = cell.totalVolume > 0 ? cell.delta / cell.totalVolume : 0;
  const positive = deltaPct >= 0;
  const alpha = 0.08 + strength * 0.62;
  const background = positive
    ? `rgba(28, 182, 126, ${alpha.toFixed(3)})`
    : `rgba(225, 92, 92, ${alpha.toFixed(3)})`;
  return (
    <div
      style={{
        ...styles.footprintCell,
        background,
        ...(poc ? styles.pocCell : {}),
      }}
      title={`Estimated bid ${Math.round(cell.bidVolume)} · ask ${Math.round(cell.askVolume)} · delta ${Math.round(cell.delta)}`}
    >
      <span>{compact(cell.bidVolume)}</span>
      <b>×</b>
      <span>{compact(cell.askVolume)}</span>
    </div>
  );
}

function ProfileCell({
  level,
  maxProfile,
}: {
  level: ReturnType<typeof buildHistoricalFootprintStudy>["profile"][number];
  maxProfile: number;
}) {
  const width = Math.max(1, (level.totalVolume / maxProfile) * 100);
  return (
    <div style={styles.profileCell}>
      <span style={{ ...styles.profileBar, width: `${width}%` }} />
      <strong>{compact(level.totalVolume)}</strong>
      {level.node !== "NORMAL" ? <small>{level.node}</small> : null}
    </div>
  );
}

function integer(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function compact(value: number) {
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`;
  if (rounded >= 10_000) return `${(rounded / 1_000).toFixed(1)}K`;
  return rounded.toLocaleString("en-US");
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    border: "1px solid #21364d",
    borderRadius: 18,
    background: "#07111d",
    padding: 20,
    color: "#edf4fb",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 18,
    alignItems: "flex-start",
    marginBottom: 18,
  },
  eyebrow: { color: "#9a7cff", fontSize: 11, letterSpacing: 1.4, fontWeight: 800, textTransform: "uppercase" },
  title: { margin: "5px 0 5px", fontSize: 24 },
  subtitle: { margin: 0, maxWidth: 940, color: "#8fa3b8", lineHeight: 1.45, fontSize: 13 },
  badge: { border: "1px solid #675598", borderRadius: 999, padding: "7px 10px", color: "#bd9cff", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" },
  controls: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 14 },
  control: { display: "grid", gap: 5, color: "#8297ad", fontSize: 11, minWidth: 160 },
  input: { height: 38, borderRadius: 9, border: "1px solid #29435d", background: "#0b1927", color: "#eef6ff", padding: "0 10px", outline: "none" },
  button: { height: 38, borderRadius: 9, border: "1px solid #2f7894", background: "#0b3141", color: "#5de5ff", padding: "0 15px", fontWeight: 800, cursor: "pointer" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(8, minmax(105px, 1fr))", gap: 8, marginBottom: 14 },
  metric: { border: "1px solid #1f344a", borderRadius: 10, padding: "9px 10px", background: "#091725", display: "grid", gap: 3 },
  failureCard: { border: "1px solid #6f4933", borderRadius: 12, padding: 14, background: "#1a120e", color: "#ffd0aa", marginBottom: 14 },
  failureText: { marginTop: 6, color: "#d6a987", fontSize: 12 },
  failureList: { marginTop: 9, padding: 10, borderRadius: 8, background: "#100c09", color: "#cba58d", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" },
  failureHint: { marginTop: 11, color: "#96a9bd", fontSize: 12, lineHeight: 1.5 },
  legendRow: { display: "flex", flexWrap: "wrap", gap: "8px 18px", color: "#8ea2b7", fontSize: 11, margin: "10px 0" },
  matrixFrame: { border: "1px solid #223951", borderRadius: 12, overflow: "hidden", background: "#050d16" },
  matrixScroller: { overflow: "auto", maxHeight: "72vh" },
  matrix: { display: "grid", minWidth: "max-content" },
  stickyHeader: { position: "sticky", top: 0, zIndex: 5 },
  stickyLeft: { position: "sticky", left: 0, zIndex: 4 },
  corner: { padding: 8, background: "#0c1a28", color: "#8297ad", borderRight: "1px solid #1c3045", borderBottom: "1px solid #1c3045", fontSize: 10 },
  bucketHeader: { minHeight: 54, padding: "7px 8px", display: "grid", gap: 2, background: "#0c1a28", borderRight: "1px solid #1c3045", borderBottom: "1px solid #1c3045", color: "#8da3b9", fontSize: 9 },
  priceCell: { minHeight: 29, padding: "4px 6px", display: "flex", gap: 5, alignItems: "center", justifyContent: "space-between", background: "#071421", borderRight: "1px solid #1b2b3e", borderBottom: "1px solid #132337", fontSize: 10 },
  pocPrice: { color: "#ffd166", boxShadow: "inset 3px 0 0 #ffd166" },
  valueAreaPrice: { background: "#0b1b2a" },
  footprintCell: { minHeight: 29, padding: "4px 6px", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 4, borderRight: "1px solid #102235", borderBottom: "1px solid #102235", fontSize: 9, color: "#edf7ff", textAlign: "right" },
  pocCell: { outline: "1px solid rgba(255,209,102,.45)", outlineOffset: -1 },
  blankCell: { minHeight: 29, display: "grid", placeItems: "center", borderRight: "1px solid #102235", borderBottom: "1px solid #102235", color: "#1c3044", fontSize: 9 },
  profileCell: { minHeight: 29, position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "3px 7px", borderBottom: "1px solid #102235", overflow: "hidden", fontSize: 9 },
  profileBar: { position: "absolute", inset: "4px auto 4px 0", borderRadius: "0 5px 5px 0", background: "rgba(52, 181, 255, .28)" },
  disclaimer: { marginTop: 12, borderTop: "1px solid #1a2c3f", paddingTop: 11, color: "#748ba3", fontSize: 11, lineHeight: 1.5 },
  empty: { padding: 28, textAlign: "center", color: "#7f95ab" },
};
