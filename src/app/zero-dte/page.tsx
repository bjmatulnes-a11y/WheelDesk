"use client";

import { useEffect, useMemo, useState } from "react";
import { WheelDeskSideNav, SIDENAV_WIDTH } from "../../components/WheelDeskSideNav";
import type { SpxOiMapRow, SpyAlignmentRow, ZeroDteChainRow, ZeroDteRecommendation } from "../../lib/zeroDteOiIntelligence";

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

type QualityCheck = {
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

type HarvestResponse = {
  tradeDate: string;
  generatedAt: string;
  status: "ok" | "partial" | "error";
  spx?: HarvestSymbolResult;
  spy?: HarvestSymbolResult;
  recommendation?: ZeroDteRecommendation;
  errors: string[];
  qualityChecks?: QualityCheck[];
};

export default function ZeroDteCommandPage() {
  const [data, setData] = useState<HarvestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedMove, setExpectedMove] = useState("");
  const [rangePct, setRangePct] = useState("0.045");
  const [strictZeroDte, setStrictZeroDte] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (Number(expectedMove) > 0) params.set("expectedMove", expectedMove);
      if (Number(rangePct) > 0) params.set("rangePct", rangePct);
      if (strictZeroDte) params.set("strict", "1");

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

  const spxMapRows = useMemo(() => {
    const rows = rec?.spxChainMap ?? [];
    const spot = rec?.spxPrice ?? 0;
    return rows
      .filter((row) => !spot || Math.abs(row.strike - spot) <= Math.max((rec?.expectedMove ?? 70) * 1.8, 100))
      .sort((a, b) => a.strike - b.strike);
  }, [rec]);

  const spyAlignmentRows = useMemo(() => {
    return (rec?.spyAlignmentMap ?? [])
      .filter((row) => row.alignment !== "none")
      .slice(0, 15);
  }, [rec]);

  return (
    <div style={styles.shell}>
      <WheelDeskSideNav active="zero-dte" />

      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Personal Trading Lab</div>
            <h1 style={styles.title}>0DTE SPX Iron Fly Command</h1>
            <p style={styles.subtitle}>
              SPX is the traded instrument. SPY is converted to SPX-equivalent levels and used only for alignment, confirmation, and secondary pressure analytics.
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

          <label style={styles.checkboxCard}>
            <span style={styles.controlText}>Strict 0DTE</span>
            <span style={styles.checkboxRow}>
              <input
                checked={strictZeroDte}
                onChange={(e) => setStrictZeroDte(e.target.checked)}
                type="checkbox"
              />
              <span>Require same-day expiration</span>
            </span>
          </label>

          <div style={styles.statusBox}>
            <div style={styles.statusTitle}>Harvest Status</div>
            <div style={statusStyle(data?.status)}>{data?.status?.toUpperCase() ?? "NOT LOADED"}</div>
            {data?.generatedAt ? <div style={styles.timestamp}>{new Date(data.generatedAt).toLocaleString()}</div> : null}
          </div>
        </section>

        {error ? <ErrorPanel errors={[error, ...(data?.errors ?? [])]} /> : null}
        {!error && data?.errors?.length ? <ErrorPanel errors={data.errors} warning /> : null}
        {data?.qualityChecks?.length ? <QualityPanel checks={data.qualityChecks} /> : null}

        {!rec ? (
          <section style={styles.emptyCard}>
            <h2 style={styles.sectionTitle}>No live 0DTE recommendation yet</h2>
            <p style={styles.muted}>
              This page does not use mock data. If the harvest succeeds, SPX/SPY rows, expiration, and provider symbols will be shown below. Weekends/non-session days may show the next listed expiration as preview unless Strict 0DTE is enabled.
            </p>
          </section>
        ) : (
          <>
            <section style={styles.grid4}>
              <MetricCard title="SPX" value={fmt(rec.spxPrice)} />
              <MetricCard title="SPY" value={fmt(rec.spyPrice)} />
              <MetricCard title="Expected Move" value={`±${fmt(rec.expectedMove)}`} />
              <MetricCard title="SPY Alignment" value={`${rec.alignmentScore}%`} tone={scoreTone(rec.alignmentScore)} />
            </section>

            <section style={styles.heroGrid}>
              <div style={styles.heroCard}>
                <div style={styles.cardHeaderRow}>
                  <div>
                    <h2 style={styles.sectionTitle}>SPX Iron Fly Placement</h2>
                    <p style={styles.muted}>Center is SPX-primary: SPX gravity/pin + dealer pressure. SPY can confirm or warn, but it does not control the center.</p>
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
                <p style={styles.muted}>Entry/monitoring logic only. Validate against live platform pricing before placing the trade.</p>
                <div style={styles.managementBox}>{rec.management}</div>
                <div style={styles.notesList}>
                  {rec.notes.map((note, idx) => <div key={idx}>• {note}</div>)}
                </div>
              </div>
            </section>

            <section style={styles.grid4}>
              <MetricCard title="SPX Gravity" value={fmt(rec.spx.gravity)} />
              <MetricCard title="SPX Pin" value={fmt(rec.spx.strongestPin)} />
              <MetricCard title="SPX Put / Call Wall" value={`${fmt(rec.spx.putWall)} / ${fmt(rec.spx.callWall)}`} />
              <MetricCard title="Dealer Pressure" value={`${rec.dealerPressure > 0 ? "+" : ""}${rec.dealerPressure}`} tone={pressureTone(rec.dealerPressure)} />
            </section>

            <section style={styles.grid3}>
              <OiCard title="SPX OI Intelligence" data={rec.spx} />
              <OiCard title="SPY Alignment Lens" data={rec.spyEquivalent} />
              <OiCard title="Composite Reference" data={rec.composite} />
            </section>

            <section style={styles.tableCard}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>SPX OI Chain Map</h2>
                  <p style={styles.muted}>This is the primary map. Rows are SPX strikes around spot with SPX OI, volume, gamma-weight, and nearest SPY-equivalent confirmation.</p>
                </div>
                <div style={styles.sourceText}>
                  SPX exp: {data?.spx?.expirationDate ?? "—"} | SPY exp: {data?.spy?.expirationDate ?? "—"} | SPX rows: {data?.spx?.rows.length ?? 0} | SPY rows: {data?.spy?.rows.length ?? 0}
                </div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>SPX Strike</th>
                      <th style={styles.th}>Marks</th>
                      <th style={styles.th}>Call OI</th>
                      <th style={styles.th}>Put OI</th>
                      <th style={styles.th}>Total OI</th>
                      <th style={styles.th}>Volume</th>
                      <th style={styles.th}>Gamma Wt</th>
                      <th style={styles.th}>Bias</th>
                      <th style={styles.th}>SPY Eq</th>
                      <th style={styles.th}>SPY Align</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spxMapRows.map((row) => <SpxMapRow key={row.strike} row={row} />)}
                  </tbody>
                </table>
              </div>
            </section>

            <section style={styles.tableCard}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>SPY Confirmation Map</h2>
                  <p style={styles.muted}>Top SPY-equivalent OI clusters matched back to nearest SPX strikes. This is confirmation only.</p>
                </div>
                <div style={styles.sourceText}>
                  SPY notional weight: {(rec.spyNotionalWeight * 100).toFixed(1)}%
                </div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>SPY Eq Strike</th>
                      <th style={styles.th}>Nearest SPX</th>
                      <th style={styles.th}>Distance</th>
                      <th style={styles.th}>SPY Eq Score</th>
                      <th style={styles.th}>SPX Score</th>
                      <th style={styles.th}>Alignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spyAlignmentRows.map((row) => <SpyMapRow key={row.strike} row={row} />)}
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

function SpxMapRow({ row }: { row: SpxOiMapRow }) {
  const marks = [row.isPin ? "PIN" : null, row.isPutWall ? "PUT WALL" : null, row.isCallWall ? "CALL WALL" : null]
    .filter(Boolean)
    .join(" / ");

  return (
    <tr style={styles.tr}>
      <td style={styles.tdStrong}>{fmt(row.strike)}</td>
      <td style={styles.td}>{marks || "—"}</td>
      <td style={styles.td}>{fmt(row.callOi)}</td>
      <td style={styles.td}>{fmt(row.putOi)}</td>
      <td style={styles.td}>{fmt(row.totalOi)}</td>
      <td style={styles.td}>{fmt(row.totalVolume)}</td>
      <td style={styles.td}>{fmt(row.gammaWeight)}</td>
      <td style={styles.td}>{row.sideBias} ({row.sideBiasPct > 0 ? "+" : ""}{row.sideBiasPct}%)</td>
      <td style={styles.td}>{row.nearestSpyStrike ? `${fmt(row.nearestSpyStrike)} (${fmt(row.nearestSpyDistance)} pts)` : "—"}</td>
      <td style={{ ...styles.td, color: alignmentColor(row.spyAlignment) }}>{row.spyAlignment}</td>
    </tr>
  );
}

function SpyMapRow({ row }: { row: SpyAlignmentRow }) {
  return (
    <tr style={styles.tr}>
      <td style={styles.tdStrong}>{fmt(row.strike)}</td>
      <td style={styles.td}>{row.nearestSpxStrike ? fmt(row.nearestSpxStrike) : "—"}</td>
      <td style={styles.td}>{row.nearestSpxDistance !== null ? fmt(row.nearestSpxDistance) : "—"}</td>
      <td style={styles.td}>{fmt(row.score)}</td>
      <td style={styles.td}>{fmt(row.spxScore)}</td>
      <td style={{ ...styles.td, color: alignmentColor(row.alignment) }}>{row.alignment}</td>
    </tr>
  );
}

function ErrorPanel({ errors, warning }: { errors: string[]; warning?: boolean }) {
  return (
    <section style={warning ? styles.warningPanel : styles.errorPanel}>
      <h2 style={styles.sectionTitle}>{warning ? "Harvest Warning" : "Harvest Error"}</h2>
      {errors.map((err, idx) => <p key={idx} style={styles.errorText}>{err}</p>)}
    </section>
  );
}

function QualityPanel({ checks }: { checks: QualityCheck[] }) {
  return (
    <section style={styles.tableCard}>
      <h2 style={styles.sectionTitle}>Data Quality / Sanity Checks</h2>
      <div style={styles.qualityGrid}>
        {checks.map((check) => (
          <div key={`${check.label}-${check.message}`} style={styles.qualityCard}>
            <div style={styles.qualityTopLine}>
              <span style={styles.smallCaps}>{check.label}</span>
              <span style={qualityStyle(check.status)}>{check.status.toUpperCase()}</span>
            </div>
            <div style={styles.muted}>{check.message}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricCard({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.smallCaps}>{title}</div>
      <div style={{ ...styles.metricValue, color: tone ?? "#f8fafc" }}>{value}</div>
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

function OiCard({ title, data }: { title: string; data: ZeroDteRecommendation["spx"] }) {
  return (
    <div style={styles.panelCard}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.oiLine}><span>Gravity</span><strong>{fmt(data.gravity)}</strong></div>
      <div style={styles.oiLine}><span>Strongest Pin</span><strong>{fmt(data.strongestPin)}</strong></div>
      <div style={styles.oiLine}><span>Put Wall</span><strong>{fmt(data.putWall)}</strong></div>
      <div style={styles.oiLine}><span>Call Wall</span><strong>{fmt(data.callWall)}</strong></div>
      <div style={styles.oiLine}><span>OI Strength</span><strong>{data.oiStrength}%</strong></div>
      <div style={styles.oiLine}><span>Symmetry</span><strong>{data.symmetryScore}%</strong></div>
      <div style={styles.oiLine}><span>Call/Put Imbalance</span><strong>{data.callPutImbalance > 0 ? "+" : ""}{data.callPutImbalance}%</strong></div>
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  return (
    <div style={styles.scoreBadge}>
      <div style={styles.smallCaps}>{label}</div>
      <div style={{ ...styles.scoreValue, color: scoreTone(score) }}>{score}</div>
    </div>
  );
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function scoreTone(score: number) {
  if (score >= 70) return "#34d399";
  if (score <= 45) return "#fb7185";
  return "#fde047";
}

function pressureTone(score: number) {
  if (score >= 25) return "#34d399";
  if (score <= -25) return "#fb7185";
  return "#cbd5e1";
}

function alignmentColor(value: "aligned" | "near" | "none") {
  if (value === "aligned") return "#34d399";
  if (value === "near") return "#fde047";
  return "#94a3b8";
}

function statusStyle(status?: HarvestResponse["status"]): React.CSSProperties {
  return {
    fontSize: 16,
    fontWeight: 900,
    color: status === "ok" ? "#34d399" : status === "partial" ? "#fde047" : status === "error" ? "#fb7185" : "#94a3b8",
  };
}

function qualityStyle(status: QualityCheck["status"]): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 900,
    color: status === "ok" ? "#34d399" : status === "warn" ? "#fde047" : "#fb7185",
  };
}

const navWidth = typeof SIDENAV_WIDTH === "number" ? SIDENAV_WIDTH : 260;

const styles: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100vh", background: "#07111f", color: "#f8fafc" },
  main: { marginLeft: navWidth, padding: 24, minHeight: "100vh" },
  header: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 20 },
  kicker: { color: "#22d3ee", textTransform: "uppercase", letterSpacing: "0.22em", fontSize: 12, fontWeight: 900 },
  title: { fontSize: 32, lineHeight: 1.1, margin: "6px 0 8px", fontWeight: 900 },
  subtitle: { color: "#bfdbfe", maxWidth: 980, margin: 0, lineHeight: 1.45, fontSize: 14 },
  refreshButton: { border: "1px solid #22d3ee", background: "#083344", color: "#67e8f9", borderRadius: 8, padding: "12px 16px", fontWeight: 900, cursor: "pointer" },
  controls: { display: "grid", gridTemplateColumns: "320px 220px 220px 1fr", gap: 14, padding: "14px 0 16px", borderTop: "1px solid #1e3a5f", borderBottom: "1px solid #1e3a5f", marginBottom: 16 },
  controlLabel: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 14, display: "grid", gap: 8 },
  checkboxCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 14, display: "grid", gap: 12 },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1", fontSize: 14 },
  controlText: { color: "#93b5d9", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 12, fontWeight: 900 },
  input: { width: "100%", border: "1px solid #214568", background: "#07111f", color: "#f8fafc", borderRadius: 8, padding: "10px 12px", fontSize: 14 },
  statusBox: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 14 },
  statusTitle: { color: "#93b5d9", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 12, fontWeight: 900, marginBottom: 8 },
  timestamp: { color: "#93b5d9", fontSize: 12, marginTop: 4 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 16 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginBottom: 16 },
  heroGrid: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 16 },
  metricCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 16, padding: 18 },
  metricValue: { marginTop: 8, fontSize: 25, fontWeight: 900 },
  heroCard: { border: "1px solid rgba(34, 211, 238, 0.3)", background: "#081827", borderRadius: 18, padding: 20 },
  panelCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 18, padding: 18 },
  emptyCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 18, padding: 22 },
  sectionTitle: { margin: 0, fontSize: 20, fontWeight: 900 },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.45, margin: "6px 0 0" },
  cardHeaderRow: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", marginBottom: 16 },
  flyGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 },
  setupBox: { border: "1px solid #1e3a5f", background: "#09182a", borderRadius: 14, padding: 16 },
  setupBoxHighlight: { border: "1px solid rgba(34,211,238,0.6)", background: "rgba(8, 145, 178, 0.18)", borderRadius: 14, padding: 16 },
  setupValue: { fontSize: 28, fontWeight: 900, marginTop: 6 },
  structureBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 16, marginTop: 16 },
  structureText: { fontSize: 22, fontWeight: 900, color: "#67e8f9", marginTop: 6 },
  managementBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14, marginTop: 14, color: "#e2e8f0", lineHeight: 1.45 },
  notesList: { marginTop: 14, display: "grid", gap: 8, color: "#cbd5e1", fontSize: 13, lineHeight: 1.4 },
  scoreBadge: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: "12px 16px", minWidth: 110, textAlign: "center" },
  scoreValue: { fontSize: 30, fontWeight: 900 },
  smallCaps: { color: "#93b5d9", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 12, fontWeight: 900 },
  oiLine: { display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid rgba(148, 163, 184, 0.16)", color: "#cbd5e1", fontSize: 13 },
  tableCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: "#93b5d9", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11, padding: "10px 10px", borderBottom: "1px solid #1e3a5f", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(148, 163, 184, 0.12)" },
  td: { padding: "9px 10px", color: "#cbd5e1", whiteSpace: "nowrap" },
  tdStrong: { padding: "9px 10px", color: "#67e8f9", fontWeight: 900, whiteSpace: "nowrap" },
  sourceText: { color: "#93b5d9", fontSize: 12, textAlign: "right", maxWidth: 540 },
  errorPanel: { border: "1px solid #be123c", background: "rgba(76, 5, 25, 0.55)", borderRadius: 18, padding: 18, marginBottom: 16 },
  warningPanel: { border: "1px solid #a16207", background: "rgba(66, 32, 6, 0.55)", borderRadius: 18, padding: 18, marginBottom: 16 },
  errorText: { color: "#fecdd3", lineHeight: 1.45, margin: "8px 0 0" },
  qualityGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 },
  qualityCard: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  qualityTopLine: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 8 },
};
