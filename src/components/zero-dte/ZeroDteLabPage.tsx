"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";
import type { ZeroDteLabRecommendation, OiIntelligence, OiCluster } from "../../lib/zero-dte-lab-engine";

type HarvestPayload = {
  ok: boolean;
  snapshotId?: string | null;
  saveError?: string | null;
  rowSaveError?: string | null;
  targetDate?: string;
  expirationDate?: string;
  isZeroDte?: boolean;
  spx?: { providerSymbol: string; price: number; rowCount: number };
  spy?: { providerSymbol: string; price: number; rowCount: number };
  recommendation?: ZeroDteLabRecommendation | null;
  error?: string;
  snapshot?: any;
};

type TradeState = {
  actualCenter: string;
  creditReceived: string;
  notes: string;
  saving: boolean;
  message: string;
};

const colors = {
  page: "#06101b",
  panel: "#0b1724",
  panel2: "#08131f",
  panel3: "#102235",
  border: "#24384d",
  borderSoft: "#1a2b3d",
  text: "#f8fafc",
  muted: "#a8c2dc",
  muted2: "#6d8aa5",
  cyan: "#26e6ff",
  green: "#38ff7d",
  red: "#ff5f7c",
  amber: "#ffb547",
  purple: "#ca7cff",
};

async function authHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = includeJson ? { "Content-Type": "application/json" } : {};
  const { data } = await getSupabaseAuthClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Login session is not ready. Refresh or sign in again.");
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
  }

  return payload as T;
}

export default function ZeroDteLabPage() {
  const [payload, setPayload] = useState<HarvestPayload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "harvesting" | "failed">("idle");
  const [message, setMessage] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [allowNext, setAllowNext] = useState(true);
  const [manualExpectedMove, setManualExpectedMove] = useState<string>("");
  const [trade, setTrade] = useState<TradeState>({ actualCenter: "", creditReceived: "", notes: "", saving: false, message: "" });

  const recommendation = payload?.recommendation ?? null;
  const snapshotId = payload?.snapshotId ?? payload?.snapshot?.id ?? null;
  const tradeDate = payload?.targetDate ?? payload?.snapshot?.trade_date ?? "";
  const expirationDate = payload?.expirationDate ?? payload?.snapshot?.expiration_date ?? recommendation?.expirationDate ?? "";

  const loadLatest = useCallback(async () => {
    setStatus("loading");
    setMessage("Loading latest 0DTE snapshot…");

    try {
      const headers = await authHeaders();
      const response = await fetch("/api/zero-dte/harvest", { headers, cache: "no-store" });
      const data = await readJson<HarvestPayload>(response);
      setPayload(data);
      setStatus("idle");
      setMessage(data.recommendation ? "Latest snapshot loaded." : "No 0DTE snapshot saved yet. Run a harvest.");
      if (data.recommendation) {
        setTrade((prev) => ({
          ...prev,
          actualCenter: prev.actualCenter || String(data.recommendation?.suggestedCenter ?? ""),
        }));
      }
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Failed to load 0DTE snapshot.");
    }
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  async function runHarvest() {
    setStatus("harvesting");
    setMessage("Harvesting real SPX/SPY option chains…");
    setTrade((prev) => ({ ...prev, message: "" }));

    try {
      const headers = await authHeaders(true);
      const body: Record<string, unknown> = {
        allowNextExpiration: allowNext,
      };

      if (targetDate) body.targetDate = targetDate;
      if (manualExpectedMove.trim()) body.manualExpectedMove = Number(manualExpectedMove);

      const response = await fetch("/api/zero-dte/harvest", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const data = await readJson<HarvestPayload>(response);
      setPayload(data);
      setStatus("idle");
      setMessage(data.saveError ? `Harvest complete, but DB save failed: ${data.saveError}` : "Harvest complete and saved.");
      setTrade((prev) => ({
        ...prev,
        actualCenter: String(data.recommendation?.suggestedCenter ?? ""),
      }));
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "0DTE harvest failed.");
    }
  }

  async function savePlannedTrade() {
    if (!recommendation || !snapshotId || !tradeDate || !expirationDate) {
      setTrade((prev) => ({ ...prev, message: "Run and save a snapshot before logging a trade." }));
      return;
    }

    setTrade((prev) => ({ ...prev, saving: true, message: "Saving planned trade…" }));

    try {
      const headers = await authHeaders(true);
      const actualCenter = Number(trade.actualCenter || recommendation.suggestedCenter);
      const wingWidth = recommendation.suggestedWingWidth;

      const response = await fetch("/api/zero-dte/trades", {
        method: "POST",
        headers,
        body: JSON.stringify({
          snapshotId,
          tradeDate,
          expirationDate,
          strategy: "iron_fly",
          suggestedCenter: recommendation.suggestedCenter,
          actualCenter,
          wingWidth,
          lowerWing: actualCenter - wingWidth,
          upperWing: actualCenter + wingWidth,
          creditReceived: trade.creditReceived ? Number(trade.creditReceived) : null,
          notes: trade.notes,
        }),
      });

      await readJson(response);
      setTrade((prev) => ({ ...prev, saving: false, message: "Planned trade saved." }));
    } catch (error) {
      setTrade((prev) => ({
        ...prev,
        saving: false,
        message: error instanceof Error ? error.message : "Failed to save trade.",
      }));
    }
  }

  const topComposite = recommendation?.composite.topClusters ?? [];

  return (
    <div style={styles.pageWrap}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>Bryan Lab</div>
          <h1 style={styles.title}>0DTE SPX Iron Fly Command</h1>
          <p style={styles.subtitle}>
            Real SPX/SPY 0DTE footprint harvest. No mock rows. SPY is converted into SPX-equivalent levels for alignment, OI gravity, dealer-pressure proxy, and center placement.
          </p>
        </div>
        <div style={styles.headerActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => void loadLatest()} disabled={status === "loading" || status === "harvesting"}>
            Reload latest
          </button>
          <button type="button" style={styles.primaryButton} onClick={() => void runHarvest()} disabled={status === "harvesting" || status === "loading"}>
            {status === "harvesting" ? "Harvesting…" : "Harvest SPX/SPY"}
          </button>
        </div>
      </header>

      <section style={styles.controlPanel}>
        <label style={styles.label}>
          Target date
          <input style={styles.input} type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </label>
        <label style={styles.label}>
          Manual expected move override
          <input style={styles.input} type="number" min="0" step="1" placeholder="optional" value={manualExpectedMove} onChange={(event) => setManualExpectedMove(event.target.value)} />
        </label>
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={allowNext} onChange={(event) => setAllowNext(event.target.checked)} />
          Use next real expiration if today has no 0DTE chain
        </label>
      </section>

      {message ? <div style={status === "failed" ? styles.errorBanner : styles.statusBanner}>{message}</div> : null}
      {payload?.saveError ? <div style={styles.warningBanner}>DB snapshot save failed: {payload.saveError}</div> : null}
      {payload?.rowSaveError ? <div style={styles.warningBanner}>DB row save failed: {payload.rowSaveError}</div> : null}

      {!recommendation ? (
        <section style={styles.emptyCard}>
          <h2 style={styles.sectionTitle}>No harvested footprint yet.</h2>
          <p style={styles.muted}>Run the SPX/SPY harvest. If Supabase tables are missing, run the included SQL file first.</p>
        </section>
      ) : (
        <>
          <section style={styles.metricGrid}>
            <MetricCard title="SPX" value={fmt(recommendation.spxPrice)} />
            <MetricCard title="SPY" value={fmt(recommendation.spyPrice)} />
            <MetricCard title="Expiration" value={`${recommendation.expirationDate}${recommendation.isZeroDte ? " 0DTE" : " next"}`} tone={recommendation.isZeroDte ? "green" : "amber"} />
            <MetricCard title="Expected Move" value={`±${fmt(recommendation.expectedMove)}`} tone="cyan" />
            <MetricCard title="Suggested Center" value={fmt(recommendation.suggestedCenter)} tone="cyan" />
            <MetricCard title="Wings" value={`±${fmt(recommendation.suggestedWingWidth)}`} />
            <MetricCard title="Alignment" value={`${recommendation.alignmentScore}%`} tone={scoreTone(recommendation.alignmentScore)} />
            <MetricCard title="Confidence" value={`${recommendation.confidenceScore}%`} tone={scoreTone(recommendation.confidenceScore)} />
          </section>

          {recommendation.warnings.length ? (
            <section style={styles.warningList}>
              {recommendation.warnings.map((warning) => (
                <div key={warning} style={styles.warningBanner}>{warning}</div>
              ))}
            </section>
          ) : null}

          <section style={styles.twoColWideLeft}>
            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>Iron Fly Placement</h2>
                  <p style={styles.muted}>Center is driven by composite OI gravity and strongest pin, then lightly adjusted by dealer-pressure proxy.</p>
                </div>
                <div style={styles.structureBadge}>{fmt(recommendation.lowerWing)} / {fmt(recommendation.suggestedCenter)} / {fmt(recommendation.upperWing)}</div>
              </div>
              <div style={styles.setupGrid}>
                <SetupBox title="Lower Wing" value={fmt(recommendation.lowerWing)} sub="Long put" />
                <SetupBox title="Center" value={fmt(recommendation.suggestedCenter)} sub="Short call + short put" highlight />
                <SetupBox title="Upper Wing" value={fmt(recommendation.upperWing)} sub="Long call" />
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Management Read</h2>
              <div style={styles.readBox}>{recommendation.management}</div>
              <div style={styles.smallMeta}>Generated {formatDateTime(recommendation.generatedAt)} using {recommendation.provider}</div>
            </div>
          </section>

          <section style={styles.threeCol}>
            <OiCard title="SPX OI Intelligence" data={recommendation.spx} />
            <OiCard title="SPY → SPX Equivalent" data={recommendation.spyEquivalent} />
            <OiCard title="Composite Footprint" data={recommendation.composite} />
          </section>

          <section style={styles.twoCol}>
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Dealer Pressure Proxy</h2>
              <div style={{ ...styles.bigNumber, color: pressureColor(recommendation.dealerPressure) }}>
                {recommendation.dealerPressure > 0 ? "+" : ""}{recommendation.dealerPressure}
              </div>
              <div style={styles.barTrack}>
                <div style={{ ...styles.barFill, width: `${Math.max(0, Math.min(100, (recommendation.dealerPressure + 100) / 2))}%` }} />
              </div>
              <p style={styles.muted}>Positive means call-side pressure dominates the near-spot footprint. Negative means put-side pressure dominates. Near zero is cleaner for an iron fly.</p>
            </div>

            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Notes</h2>
              <div style={styles.noteStack}>
                {recommendation.notes.map((note) => <div key={note} style={styles.note}>{note}</div>)}
              </div>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>Composite Top Clusters</h2>
            <p style={styles.muted}>Highest-scored OI clusters after SPY is converted into SPX-equivalent levels and scaled by relative notional.</p>
            <ClusterTable clusters={topComposite} />
          </section>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>Log Planned Trade</h2>
            <p style={styles.muted}>This is only for your validation trail. It records the planned center, credit, and notes against the harvested footprint.</p>
            <div style={styles.tradeGrid}>
              <label style={styles.label}>
                Actual center
                <input style={styles.input} type="number" step="5" value={trade.actualCenter} onChange={(event) => setTrade((prev) => ({ ...prev, actualCenter: event.target.value }))} />
              </label>
              <label style={styles.label}>
                Credit received
                <input style={styles.input} type="number" step="0.05" placeholder="optional" value={trade.creditReceived} onChange={(event) => setTrade((prev) => ({ ...prev, creditReceived: event.target.value }))} />
              </label>
              <label style={styles.labelWide}>
                Notes
                <input style={styles.input} type="text" placeholder="optional" value={trade.notes} onChange={(event) => setTrade((prev) => ({ ...prev, notes: event.target.value }))} />
              </label>
            </div>
            <div style={styles.tradeActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => void savePlannedTrade()} disabled={trade.saving || !snapshotId}>
                {trade.saving ? "Saving…" : "Save planned trade"}
              </button>
              {trade.message ? <span style={styles.smallMeta}>{trade.message}</span> : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={{ ...styles.metricValue, color: toneColor(tone) }}>{value}</div>
    </div>
  );
}

function SetupBox({ title, value, sub, highlight }: { title: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div style={highlight ? styles.setupBoxHighlight : styles.setupBox}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={styles.setupValue}>{value}</div>
      <div style={styles.smallMeta}>{sub}</div>
    </div>
  );
}

function OiCard({ title, data }: { title: string; data: OiIntelligence }) {
  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.oiGrid}>
        <MiniStat label="Gravity" value={fmt(data.gravity)} />
        <MiniStat label="Pin" value={fmt(data.strongestPin)} />
        <MiniStat label="Call Wall" value={fmt(data.callWall)} />
        <MiniStat label="Put Wall" value={fmt(data.putWall)} />
        <MiniStat label="Strength" value={`${data.oiStrength}%`} />
        <MiniStat label="Symmetry" value={`${data.symmetryScore}%`} />
        <MiniStat label="C/P Imbalance" value={`${data.callPutImbalance}%`} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.miniStat}>
      <div style={styles.metricTitle}>{label}</div>
      <div style={styles.miniValue}>{value}</div>
    </div>
  );
}

function ClusterTable({ clusters }: { clusters: OiCluster[] }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <Th>Strike</Th>
            <Th>Call OI</Th>
            <Th>Put OI</Th>
            <Th>Total OI</Th>
            <Th>Volume</Th>
            <Th>Score</Th>
          </tr>
        </thead>
        <tbody>
          {clusters.slice(0, 15).map((cluster) => (
            <tr key={cluster.strike}>
              <Td cyan>{fmt(cluster.strike)}</Td>
              <Td>{fmt(cluster.callOi)}</Td>
              <Td>{fmt(cluster.putOi)}</Td>
              <Td>{fmt(cluster.totalOi)}</Td>
              <Td>{fmt(cluster.totalVolume)}</Td>
              <Td>{fmt(cluster.totalScore)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, cyan }: { children: ReactNode; cyan?: boolean }) {
  return <td style={{ ...styles.td, color: cyan ? colors.cyan : colors.text }}>{children}</td>;
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function scoreTone(score: number) {
  if (score >= 70) return "green";
  if (score >= 50) return "amber";
  return "red";
}

function pressureColor(value: number) {
  if (value > 25) return colors.green;
  if (value < -25) return colors.red;
  return colors.cyan;
}

function toneColor(tone?: string) {
  if (tone === "green") return colors.green;
  if (tone === "amber") return colors.amber;
  if (tone === "red") return colors.red;
  if (tone === "purple") return colors.purple;
  return colors.cyan;
}

const styles: Record<string, any> = {
  pageWrap: {
    minHeight: "100vh",
    padding: 24,
    background: colors.page,
    color: colors.text,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 18,
    alignItems: "flex-start",
    marginBottom: 18,
  },
  kicker: {
    color: colors.cyan,
    textTransform: "uppercase",
    letterSpacing: "0.28em",
    fontSize: 12,
    fontWeight: 900,
  },
  title: {
    margin: "8px 0 8px",
    fontSize: 34,
    letterSpacing: "-0.04em",
    lineHeight: 1,
  },
  subtitle: {
    margin: 0,
    color: colors.muted,
    maxWidth: 920,
    fontSize: 14,
    lineHeight: 1.45,
  },
  headerActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    border: `1px solid ${colors.cyan}`,
    background: "#0b3a46",
    color: "#c8fbff",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryButton: {
    border: `1px solid ${colors.border}`,
    background: colors.panel3,
    color: colors.text,
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
  controlPanel: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 14,
    border: `1px solid ${colors.borderSoft}`,
    background: colors.panel,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  label: {
    display: "grid",
    gap: 7,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  labelWide: {
    display: "grid",
    gap: 7,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    gridColumn: "span 2",
  },
  checkboxLabel: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    color: colors.muted,
    fontSize: 13,
    fontWeight: 800,
  },
  input: {
    border: `1px solid ${colors.border}`,
    background: "#050b12",
    color: colors.text,
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
    width: "100%",
  },
  statusBanner: {
    border: `1px solid ${colors.border}`,
    background: colors.panel2,
    color: colors.muted,
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 14,
  },
  errorBanner: {
    border: `1px solid rgba(255, 95, 124, 0.45)`,
    background: "rgba(80, 15, 28, 0.55)",
    color: "#ffd5dc",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 14,
  },
  warningBanner: {
    border: `1px solid rgba(255, 181, 71, 0.45)`,
    background: "rgba(86, 54, 9, 0.45)",
    color: "#ffe1ab",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 10,
  },
  warningList: {
    display: "grid",
    gap: 8,
    marginBottom: 14,
  },
  emptyCard: {
    border: `1px solid ${colors.border}`,
    background: colors.panel,
    borderRadius: 18,
    padding: 24,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  metricCard: {
    border: `1px solid ${colors.borderSoft}`,
    background: colors.panel,
    borderRadius: 16,
    padding: 16,
  },
  metricTitle: {
    color: colors.muted2,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: 11,
    fontWeight: 900,
  },
  metricValue: {
    marginTop: 8,
    fontSize: 26,
    fontWeight: 950,
    letterSpacing: "-0.03em",
  },
  twoColWideLeft: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: 14,
    marginBottom: 14,
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 14,
  },
  threeCol: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  card: {
    border: `1px solid ${colors.borderSoft}`,
    background: colors.panel,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "flex-start",
    marginBottom: 16,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 20,
    letterSpacing: "-0.03em",
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 1.4,
    margin: "6px 0 0",
  },
  structureBadge: {
    border: `1px solid rgba(38, 230, 255, 0.36)`,
    background: "rgba(11, 58, 70, 0.52)",
    color: "#c8fbff",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  setupGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
  },
  setupBox: {
    border: `1px solid ${colors.border}`,
    background: colors.panel2,
    borderRadius: 14,
    padding: 14,
  },
  setupBoxHighlight: {
    border: `1px solid rgba(38, 230, 255, 0.48)`,
    background: "rgba(11, 58, 70, 0.45)",
    borderRadius: 14,
    padding: 14,
  },
  setupValue: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: 950,
    color: colors.text,
  },
  readBox: {
    border: `1px solid ${colors.border}`,
    background: colors.panel2,
    borderRadius: 14,
    padding: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 1.45,
    marginTop: 12,
  },
  smallMeta: {
    color: colors.muted2,
    fontSize: 12,
    marginTop: 8,
  },
  oiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginTop: 14,
  },
  miniStat: {
    border: `1px solid ${colors.borderSoft}`,
    background: colors.panel2,
    borderRadius: 12,
    padding: 10,
  },
  miniValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: 900,
    marginTop: 5,
  },
  bigNumber: {
    fontSize: 54,
    fontWeight: 950,
    lineHeight: 1,
    marginTop: 16,
  },
  barTrack: {
    height: 10,
    background: "#05101b",
    borderRadius: 999,
    border: `1px solid ${colors.borderSoft}`,
    overflow: "hidden",
    marginTop: 14,
  },
  barFill: {
    height: "100%",
    background: colors.cyan,
  },
  noteStack: {
    display: "grid",
    gap: 9,
    marginTop: 14,
  },
  note: {
    border: `1px solid ${colors.border}`,
    background: colors.panel2,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    fontSize: 13,
    lineHeight: 1.4,
  },
  tableWrap: {
    overflowX: "auto",
    marginTop: 14,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 760,
  },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    borderBottom: `1px solid ${colors.border}`,
    color: colors.muted2,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  td: {
    padding: "10px 10px",
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: 13,
  },
  tradeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
    marginTop: 14,
  },
  tradeActions: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginTop: 14,
  },
};
