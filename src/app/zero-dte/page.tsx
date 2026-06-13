"use client";

import { useEffect, useMemo, useState } from "react";
import { WheelDeskSideNav, SIDENAV_WIDTH } from "../../components/WheelDeskSideNav";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../../lib/zeroDteOiIntelligence";

type HarvestSymbolResult = {
  symbol: "SPX" | "SPY";
  yahooOptionSymbol: string;
  yahooQuoteSymbol: string;
  price: number;
  expirationTimestamp: number;
  expirationDate: string;
  isZeroDte?: boolean;
  rows: ZeroDteChainRow[];
  source: "yahoo";
};

type HarvestResponse = {
  tradeDate: string;
  generatedAt: string;
  status: "ok" | "partial" | "error";
  spx?: HarvestSymbolResult;
  spy?: HarvestSymbolResult;
  recommendation?: ZeroDteRecommendation;
  errors: string[];
};

export default function ZeroDteCommandPage() {
  const [data, setData] = useState<HarvestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedMove, setExpectedMove] = useState("");
  const [rangePct, setRangePct] = useState("0.045");

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (Number(expectedMove) > 0) params.set("expectedMove", expectedMove);
      if (Number(rangePct) > 0) params.set("rangePct", rangePct);

      const res = await fetch(`/api/zero-dte/harvest?${params.toString()}`, {
        cache: "no-store",
      });

      const json = (await res.json()) as HarvestResponse;
      setData(json);

      if (!res.ok) {
        setError(json.errors?.join(" ") || "0DTE harvest failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown 0DTE harvest failure.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = data?.recommendation;
  const rows = useMemo(() => rec?.composite.clusters.slice(0, 18) ?? [], [rec]);

  return (
    <div style={styles.shell}>
      <WheelDeskSideNav active="zero-dte" />

      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Personal Trading Lab</div>
            <h1 style={styles.title}>0DTE SPX / SPY Iron Fly Command</h1>
            <p style={styles.subtitle}>
              Real Yahoo harvest only. SPX and SPY are pulled server-side, SPY strikes are converted into SPX-equivalent levels, and the page calculates OI gravity, alignment, dealer pressure, expected move, and suggested IF center.
            </p>
          </div>

          <button type="button" onClick={load} disabled={loading} style={styles.refreshButton}>
            {loading ? "Harvesting..." : "Harvest 0DTE"}
          </button>
        </header>

        <section style={styles.controls}>
          <label style={styles.controlLabel}>
            <span style={styles.controlText}>Manual expected move override</span>
            <input
              value={expectedMove}
              onChange={(e) => setExpectedMove(e.target.value)}
              placeholder="optional, e.g. 66"
              type="number"
              step="any"
              style={styles.input}
            />
          </label>

          <label style={styles.controlLabel}>
            <span style={styles.controlText}>Chain range pct</span>
            <input
              value={rangePct}
              onChange={(e) => setRangePct(e.target.value)}
              type="number"
              step="0.005"
              style={styles.input}
            />
          </label>

          <div style={styles.statusBox}>
            <div style={styles.statusTitle}>Harvest Status</div>
            <div style={statusStyle(data?.status)}>{data?.status?.toUpperCase() ?? "NOT LOADED"}</div>
            {data?.generatedAt ? <div style={styles.timestamp}>{new Date(data.generatedAt).toLocaleString()}</div> : null}
          </div>
        </section>

        {error ? <ErrorPanel errors={[error, ...(data?.errors ?? [])]} /> : null}
        {!error && data?.errors?.length ? <ErrorPanel errors={data.errors} warning /> : null}

        {!rec ? (
          <section style={styles.emptyCard}>
            <h2 style={styles.sectionTitle}>No live 0DTE recommendation yet</h2>
            <p style={styles.muted}>
              This page does not use mock data. This page uses no mock data. On weekends/non-session days it may show the next listed expiration as a preview and mark the harvest as partial.
            </p>
          </section>
        ) : (
          <>
            <section style={styles.grid4}>
              <MetricCard title="SPX" value={fmt(rec.spxPrice)} />
              <MetricCard title="SPY" value={fmt(rec.spyPrice)} />
              <MetricCard title="Expected Move" value={`±${fmt(rec.expectedMove)}`} />
              <MetricCard title="Alignment" value={`${rec.alignmentScore}%`} tone={scoreTone(rec.alignmentScore)} />
            </section>

            <section style={styles.heroGrid}>
              <div style={styles.heroCard}>
                <div style={styles.cardHeaderRow}>
                  <div>
                    <h2 style={styles.sectionTitle}>Iron Fly Placement</h2>
                    <p style={styles.muted}>Center comes from composite OI gravity/pin with dealer-pressure adjustment.</p>
                  </div>
                  <ScoreBadge label="Confidence" score={rec.confidenceScore} />
                </div>

                <div style={styles.flyGrid}>
                  <SetupBox label="Lower Wing" value={fmt(rec.lowerWing)} sub="long put" />
                  <SetupBox label="Center" value={fmt(rec.suggestedCenter)} sub="short call / short put" highlight />
                  <SetupBox label="Upper Wing" value={fmt(rec.upperWing)} sub="long call" />
                </div>

                <div style={styles.structureBox}>
                  <div style={styles.smallCaps}>SPX Iron Fly</div>
                  <div style={styles.structureText}>{fmt(rec.lowerWing)} / {fmt(rec.suggestedCenter)} / {fmt(rec.upperWing)}</div>
                  <div style={styles.muted}>Suggested wing width: ±{fmt(rec.suggestedWingWidth)}</div>
                </div>
              </div>

              <div style={styles.panelCard}>
                <h2 style={styles.sectionTitle}>Management Read</h2>
                <p style={styles.muted}>This is entry/monitoring logic. It is not an auto-trade instruction.</p>
                <div style={styles.managementBox}>{rec.management}</div>
                <div style={styles.notesList}>
                  {rec.notes.map((note, idx) => <div key={idx}>• {note}</div>)}
                </div>
              </div>
            </section>

            <section style={styles.grid3}>
              <MetricCard title="Composite Gravity" value={fmt(rec.composite.gravity)} />
              <MetricCard title="Composite Pin" value={fmt(rec.composite.strongestPin)} />
              <MetricCard title="Dealer Pressure" value={`${rec.dealerPressure > 0 ? "+" : ""}${rec.dealerPressure}`} tone={pressureTone(rec.dealerPressure)} />
            </section>

            <section style={styles.grid3}>
              <OiCard title="SPX OI Intelligence" data={rec.spx} />
              <OiCard title="SPY as SPX Equivalent" data={rec.spyEquivalent} />
              <OiCard title="Composite Footprint" data={rec.composite} />
            </section>

            <section style={styles.tableCard}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>Top Composite Clusters</h2>
                  <p style={styles.muted}>SPX + SPY-equivalent levels sorted by footprint score.</p>
                </div>
                <div style={styles.sourceText}>
                  SPX exp: {data?.spx?.expirationDate ?? "—"} | SPY exp: {data?.spy?.expirationDate ?? "—"} | SPX rows: {data?.spx?.rows.length ?? 0} | SPY rows: {data?.spy?.rows.length ?? 0}
                </div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <Th>Strike</Th>
                      <Th>Call OI</Th>
                      <Th>Put OI</Th>
                      <Th>Total OI</Th>
                      <Th>Volume</Th>
                      <Th>Gamma Weight</Th>
                      <Th>Score</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((cluster) => (
                      <tr key={cluster.strike} style={styles.tr}>
                        <Td accent>{fmt(cluster.strike)}</Td>
                        <Td>{fmt(cluster.callOi)}</Td>
                        <Td>{fmt(cluster.putOi)}</Td>
                        <Td>{fmt(cluster.totalOi)}</Td>
                        <Td>{fmt(cluster.totalVolume)}</Td>
                        <Td>{fmt(cluster.gammaWeight)}</Td>
                        <Td>{fmt(cluster.score)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function ErrorPanel({ errors, warning }: { errors: string[]; warning?: boolean }) {
  const unique = Array.from(new Set(errors.filter(Boolean)));
  return (
    <section style={{ ...styles.errorCard, borderColor: warning ? "#92400e" : "#7f1d1d" }}>
      <h2 style={styles.sectionTitle}>{warning ? "Harvest Warning" : "Harvest Error"}</h2>
      {unique.map((e, idx) => <p key={idx} style={styles.errorText}>{e}</p>)}
    </section>
  );
}

function MetricCard({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.smallCaps}>{title}</div>
      <div style={{ ...styles.metricValue, color: tone ?? "#f8fbff" }}>{value}</div>
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  return (
    <div style={styles.scoreBadge}>
      <div style={styles.smallCaps}>{label}</div>
      <div style={{ ...styles.scoreNumber, color: scoreTone(score) }}>{score}</div>
    </div>
  );
}

function SetupBox({ label, value, sub, highlight }: { label: string; value: string | number; sub: string; highlight?: boolean }) {
  return (
    <div style={highlight ? styles.setupBoxHighlight : styles.setupBox}>
      <div style={styles.smallCaps}>{label}</div>
      <div style={styles.setupValue}>{value}</div>
      <div style={styles.muted}>{sub}</div>
    </div>
  );
}

function OiCard({ title, data }: { title: string; data: any }) {
  return (
    <div style={styles.panelCard}>
      <h2 style={styles.cardTitle}>{title}</h2>
      <div style={styles.miniGrid}>
        <Mini label="Gravity" value={fmt(data.gravity)} />
        <Mini label="Strong Pin" value={fmt(data.strongestPin)} />
        <Mini label="Put Wall" value={fmt(data.putWall)} />
        <Mini label="Call Wall" value={fmt(data.callWall)} />
        <Mini label="OI Strength" value={`${data.oiStrength}%`} />
        <Mini label="Symmetry" value={`${data.symmetryScore}%`} />
        <Mini label="Imbalance" value={`${data.callPutImbalance}%`} />
        <Mini label="Clusters" value={data.clusters.length} />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.miniBox}>
      <div style={styles.smallCaps}>{label}</div>
      <div style={styles.miniValue}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <td style={{ ...styles.td, color: accent ? "#67e8f9" : "#dbeafe" }}>{children}</td>;
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function scoreTone(score: number) {
  if (score >= 70) return "#34d399";
  if (score >= 50) return "#fde047";
  return "#fb7185";
}

function pressureTone(score: number) {
  if (score > 20) return "#34d399";
  if (score < -20) return "#fb7185";
  return "#dbeafe";
}

function statusStyle(status?: string): React.CSSProperties {
  const color = status === "ok" ? "#34d399" : status === "partial" ? "#fde047" : status === "error" ? "#fb7185" : "#94a3b8";
  return { fontWeight: 900, color, fontSize: 18 };
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    background: "#06101b",
    color: "#e5f2ff",
    display: "flex",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  main: {
    marginLeft: 0,
    width: `calc(100% - ${SIDENAV_WIDTH}px)`,
    minHeight: "100vh",
    padding: 24,
    boxSizing: "border-box",
    background: "radial-gradient(circle at top left, rgba(34,211,238,0.08), transparent 34%), #07111f",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, marginBottom: 18 },
  kicker: { color: "#22d3ee", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.28em", fontWeight: 900 },
  title: { margin: "6px 0 4px", fontSize: 32, letterSpacing: "-0.04em", color: "#f8fbff" },
  subtitle: { color: "#b8cce0", maxWidth: 900, lineHeight: 1.45, margin: 0, fontSize: 14 },
  refreshButton: { border: "1px solid #22d3ee", background: "#0b3947", color: "#67e8f9", borderRadius: 10, padding: "11px 16px", fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" },
  controls: { display: "grid", gridTemplateColumns: "minmax(220px, 320px) minmax(160px, 220px) minmax(180px, 1fr)", gap: 14, marginBottom: 16 },
  controlLabel: { border: "1px solid #22384c", background: "rgba(10,25,41,0.85)", borderRadius: 14, padding: 14, display: "grid", gap: 8 },
  controlText: { fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 },
  input: { background: "#071523", color: "#f8fbff", border: "1px solid #1d3448", borderRadius: 8, padding: "10px 11px", fontSize: 15 },
  statusBox: { border: "1px solid #22384c", background: "rgba(10,25,41,0.85)", borderRadius: 14, padding: 14 },
  statusTitle: { fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800, marginBottom: 4 },
  timestamp: { color: "#94a3b8", fontSize: 12, marginTop: 5 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 14 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginBottom: 14 },
  heroGrid: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 },
  metricCard: { border: "1px solid #22384c", background: "rgba(10,25,41,0.86)", borderRadius: 16, padding: 18 },
  metricValue: { marginTop: 7, fontSize: 27, fontWeight: 950, letterSpacing: "-0.03em" },
  heroCard: { border: "1px solid rgba(34,211,238,0.25)", background: "rgba(5,15,30,0.92)", borderRadius: 18, padding: 20, boxShadow: "0 0 28px rgba(34,211,238,0.08)" },
  panelCard: { border: "1px solid #22384c", background: "rgba(5,15,30,0.92)", borderRadius: 18, padding: 18 },
  cardHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 },
  sectionTitle: { margin: 0, color: "#f8fbff", fontSize: 20, letterSpacing: "-0.02em" },
  cardTitle: { margin: "0 0 14px", color: "#f8fbff", fontSize: 18 },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.4, margin: 0 },
  smallCaps: { fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.11em", fontWeight: 900 },
  scoreBadge: { minWidth: 112, border: "1px solid #1d3448", background: "#071523", borderRadius: 12, padding: "10px 12px", textAlign: "center" },
  scoreNumber: { fontSize: 32, fontWeight: 950, lineHeight: 1.05 },
  flyGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 },
  setupBox: { border: "1px solid #22384c", background: "rgba(10,25,41,0.9)", borderRadius: 14, padding: 16 },
  setupBoxHighlight: { border: "1px solid rgba(34,211,238,0.55)", background: "rgba(8,80,102,0.32)", borderRadius: 14, padding: 16 },
  setupValue: { marginTop: 8, fontSize: 30, fontWeight: 950, color: "#f8fbff" },
  structureBox: { marginTop: 14, border: "1px solid #22384c", background: "rgba(10,25,41,0.72)", borderRadius: 14, padding: 15 },
  structureText: { margin: "4px 0", color: "#67e8f9", fontSize: 24, fontWeight: 950 },
  managementBox: { marginTop: 14, border: "1px solid #22384c", background: "rgba(10,25,41,0.72)", borderRadius: 14, padding: 14, color: "#dbeafe", lineHeight: 1.45, fontWeight: 700 },
  notesList: { marginTop: 14, color: "#b8cce0", fontSize: 13, lineHeight: 1.55, display: "grid", gap: 4 },
  miniGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 },
  miniBox: { border: "1px solid #1d3448", background: "rgba(10,25,41,0.72)", borderRadius: 12, padding: 11 },
  miniValue: { marginTop: 4, color: "#f8fbff", fontWeight: 900 },
  tableCard: { border: "1px solid #22384c", background: "rgba(5,15,30,0.92)", borderRadius: 18, padding: 18, marginBottom: 24 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: "#94a3b8", borderBottom: "1px solid #22384c", padding: "11px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em" },
  tr: { borderBottom: "1px solid rgba(34,56,76,0.6)" },
  td: { padding: "11px 10px" },
  sourceText: { color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" },
  emptyCard: { border: "1px solid #22384c", background: "rgba(5,15,30,0.92)", borderRadius: 18, padding: 20 },
  errorCard: { border: "1px solid #7f1d1d", background: "rgba(69,10,10,0.32)", borderRadius: 16, padding: 16, marginBottom: 14 },
  errorText: { color: "#fecaca", margin: "8px 0 0", lineHeight: 1.45 },
};
