"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildWeeklyAdvisoryReport,
  buildWeeklyReport,
  formatReportMoney,
  formatReportScore,
  type WeeklyAdvisoryReport,
  type WeeklyReport,
  type WeeklyReportRow,
} from "../../../lib/weekly-report-engine";
import { readWheelDeskStorage } from "../../../lib/wheeldesk-storage";
import {
  importYahooCandlesForTicker,
  yahooSymbolForTicker,
} from "../../../lib/candle-importer";

type ReportMode = "advisory" | "scanner";
type CandleLike = { date?: string; time?: string | number; close?: number; open?: number; high?: number; low?: number };

function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getStoredTickers(): string[] {
  const storage = readWheelDeskStorage() as any;
  const tickers = new Set<string>();

  for (const surface of storage.optionSurfaceSnapshots ?? []) {
    const ticker = normalizeTicker(surface?.ticker);
    if (ticker) tickers.add(ticker);
  }

  for (const item of storage.watchlists ?? []) {
    if (typeof item === "string") {
      const ticker = normalizeTicker(item);
      if (ticker) tickers.add(ticker);
      continue;
    }
    for (const value of [item?.ticker, item?.symbol]) {
      const ticker = normalizeTicker(value);
      if (ticker) tickers.add(ticker);
    }
    for (const nested of item?.tickers ?? item?.symbols ?? []) {
      const ticker = normalizeTicker(nested?.ticker ?? nested?.symbol ?? nested);
      if (ticker) tickers.add(ticker);
    }
  }

  return Array.from(tickers).filter(Boolean).sort();
}

function readCandles(ticker: string): CandleLike[] {
  const storage = readWheelDeskStorage() as any;
  const key = normalizeTicker(ticker);
  const candles = storage.candles?.[key] ?? storage.candles?.[ticker] ?? [];
  return Array.isArray(candles) ? candles : [];
}

function copyToClipboard(text: string, onDone: () => void): void {
  navigator.clipboard.writeText(text).then(onDone).catch(() => undefined);
}

function money(value: number | null | undefined): string {
  return formatReportMoney(value);
}

function score(value: number | null | undefined): string {
  return formatReportScore(value);
}

function fileSafeDate(value: string): string {
  return value.replace(/[^0-9a-zA-Z-]/g, "-");
}

function defaultMarketSymbol(tickers: string[]): string {
  return tickers.find((ticker) => ["^SPX", "SPX", "SPY"].includes(ticker)) ?? tickers.find((ticker) => ticker === "QQQ") ?? tickers[0] ?? "";
}

function defaultFocusSymbol(tickers: string[]): string {
  return tickers.find((ticker) => !["^SPX", "SPX", "SPY", "QQQ", "^VIX", "VIX"].includes(ticker)) ?? tickers[0] ?? "";
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 24, lineHeight: 1.05 }}>{value}</div>
      {note && <div style={{ color: "#64748b", fontSize: 12 }}>{note}</div>}
    </div>
  );
}

function MiniPriceChart({ ticker, row }: { ticker: string; row: WeeklyReportRow | null }) {
  const candles = readCandles(ticker).filter((c) => typeof c.close === "number" && Number.isFinite(c.close)).slice(-90);
  if (candles.length < 2) {
    return <div style={chartPlaceholder}>No saved candles for {ticker}. Open the dashboard once to populate chart history.</div>;
  }

  const closes = candles.map((c) => Number(c.close));
  const levelValues = [row?.support, row?.magnet, row?.resistance].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const min = Math.min(...closes, ...levelValues);
  const max = Math.max(...closes, ...levelValues);
  const pad = Math.max((max - min) * 0.12, max * 0.01);
  const lo = min - pad;
  const hi = max + pad;
  const width = 720;
  const height = 250;
  const x = (i: number) => (i / Math.max(candles.length - 1, 1)) * width;
  const y = (value: number) => height - ((value - lo) / Math.max(hi - lo, 1)) * height;
  const path = closes.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const level = (value: number | null | undefined, label: string, color: string, dash = "6 5") => {
    if (value == null || !Number.isFinite(value)) return null;
    const yy = y(value);
    return (
      <g key={label}>
        <line x1={0} y1={yy} x2={width} y2={yy} stroke={color} strokeWidth={1.3} strokeDasharray={dash} />
        <text x={width - 6} y={yy - 4} textAnchor="end" fontSize={10} fill={color} fontWeight={700}>{label} {money(value)}</text>
      </g>
    );
  };

  return (
    <div style={chartBox}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>{ticker} Structure Chart</strong>
        <span style={muted}>90-session price path with WheelDesk rails</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 250, display: "block", background: "#ffffff" }}>
        {[0.2, 0.4, 0.6, 0.8].map((ratio) => <line key={ratio} x1={0} x2={width} y1={height * ratio} y2={height * ratio} stroke="#e2e8f0" strokeWidth={1} />)}
        {level(row?.resistance, "Resistance", "#dc2626")}
        {level(row?.magnet, "Magnet", "#7c3aed", "3 4")}
        {level(row?.support, "Support", "#2563eb")}
        <path d={path} fill="none" stroke="#0f172a" strokeWidth={2.2} />
        <circle cx={x(candles.length - 1)} cy={y(closes[closes.length - 1])} r={4} fill="#16a34a" />
      </svg>
    </div>
  );
}

function PressureMatrix({ row }: { row: WeeklyReportRow | null }) {
  if (!row) return <p style={muted}>No pressure matrix available.</p>;
  return (
    <div style={matrixGrid}>
      <Metric label="Support" value={money(row.support)} note="failure rail" />
      <Metric label="OI Magnet" value={money(row.magnet)} note="reversion reference" />
      <Metric label="Resistance" value={money(row.resistance)} note="unlock rail" />
      <Metric label="CSP Guardrail" value={money(row.cspZone)} note="sell at/below" />
      <Metric label="CC Guardrail" value={money(row.ccZone)} note="sell at/above" />
      <Metric label="Wall Migration" value={row.wallMigrationLabel} note={row.wallMigrationBias} />
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={metricCard}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900 }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: "#64748b" }}>{note}</div>}
    </div>
  );
}

function NotableCards({ rows }: { rows: WeeklyReportRow[] }) {
  if (!rows.length) return <p style={muted}>No additional notables selected.</p>;
  return (
    <div style={notableGrid}>
      {rows.map((row) => (
        <div key={`${row.ticker}-${row.snapshotDate}`} style={notableCard}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <strong>{row.ticker}</strong>
            <span style={{ fontWeight: 900 }}>{score(row.edgeScore)}</span>
          </div>
          <div style={{ color: "#334155", fontWeight: 700 }}>{row.actionBucket}</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>{row.bestAction}</div>
        </div>
      ))}
    </div>
  );
}

function ScannerExportTable({ rows }: { rows: WeeklyReportRow[] }) {
  if (!rows.length) return <p style={muted}>No scanner rows.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th style={th}>Ticker</th><th style={th}>Setup</th><th style={th}>Edge</th><th style={th}>Support</th><th style={th}>Magnet</th><th style={th}>Resistance</th><th style={th}>CSP</th><th style={th}>CC</th><th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.ticker}-${row.snapshotDate}-${row.actionBucket}`}>
              <td style={td}><strong>{row.ticker}</strong><br /><span style={muted}>{row.snapshotDate}</span></td>
              <td style={td}>{row.actionBucket}<br /><span style={muted}>{row.compression}</span></td>
              <td style={td}><strong>{score(row.edgeScore)}</strong></td>
              <td style={td}>{money(row.support)}</td>
              <td style={td}>{money(row.magnet)}</td>
              <td style={td}>{money(row.resistance)}</td>
              <td style={td}><strong>{money(row.cspZone)}</strong></td>
              <td style={td}><strong>{money(row.ccZone)}</strong></td>
              <td style={td}>{row.bestAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdvisoryPdfPreview({ report }: { report: WeeklyAdvisoryReport }) {
  const focus = report.focusRow;
  const market = report.selectedMarketRow;
  return (
    <article id="weekly-report-print" className="report-page" style={reportShell}>
      <header style={reportHeader}>
        <div>
          <div style={eyebrow}>WheelDesk Weekly</div>
          <h1 style={reportTitle}>Premium Map Advisory</h1>
          <p style={reportSubtitle}>Week of {report.weekOf} · Generated {report.generatedAt}</p>
        </div>
        <div style={brandBadge}>WD</div>
      </header>

      <section style={heroBox}>
        <div style={sectionKicker}>Executive Market Call</div>
        <p style={leadText}>{report.marketPosture}</p>
        <p style={{ ...bodyText, marginBottom: 0 }}><strong>Premium seller posture:</strong> {report.premiumSellerPosture}</p>
      </section>

      <section style={sectionBlock}>
        <h2 style={sectionTitle}>SPX / Market Structure</h2>
        <MiniPriceChart ticker={report.selectedMarketTicker || "SPY"} row={market} />
        <PressureMatrix row={market} />
      </section>

      <section style={twoCol}>
        <div style={advisoryCard}>
          <div style={sectionKicker}>Market Calendar</div>
          <p style={bodyText}>{report.marketCalendar}</p>
        </div>
        <div style={advisoryCard}>
          <div style={sectionKicker}>Earnings / Event Watch</div>
          <p style={bodyText}>{report.earningsWatch}</p>
        </div>
      </section>

      <div className="page-break" />

      <section style={sectionBlock}>
        <h2 style={sectionTitle}>Stock of Interest - {report.focusTicker || "N/A"}</h2>
        <MiniPriceChart ticker={report.focusTicker} row={focus} />
        <p style={bodyText}>{focus ? `${focus.ticker} is labeled ${focus.actionBucket}. ${focus.bestAction}` : "No focus row available."}</p>
        <PressureMatrix row={focus} />
      </section>

      <section style={twoCol}>
        <div style={advisoryCard}>
          <div style={sectionKicker}>Trigger Map</div>
          <ul style={tightList}>{report.triggerBullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
        </div>
        <div style={advisoryCard}>
          <div style={sectionKicker}>Trade Permission</div>
          <ul style={tightList}>
            <li>CSPs: use the CSP guardrail, not the support wall itself.</li>
            <li>Covered calls: avoid selling below the CC guardrail unless call-away is acceptable.</li>
            <li>Compression: wait for wall break or sell outside the active OI range.</li>
          </ul>
        </div>
      </section>

      <section style={sectionBlock}>
        <h2 style={sectionTitle}>Notables to Watch</h2>
        <NotableCards rows={report.notables} />
      </section>

      <section style={riskBox}>
        <h2 style={sectionTitle}>Risk Framework</h2>
        <ul style={tightList}>{report.riskFramework.map((item) => <li key={item}>{item}</li>)}</ul>
        <p style={disclaimer}>Not financial advice. This report is for education and research only.</p>
      </section>
    </article>
  );
}

export default function WeeklyReportsPage() {
  const [mounted, setMounted] = useState(false);
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [weekOf, setWeekOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<ReportMode>("advisory");
  const [scannerReport, setScannerReport] = useState<WeeklyReport | null>(null);
  const [advisoryReport, setAdvisoryReport] = useState<WeeklyAdvisoryReport | null>(null);
  const [focusTicker, setFocusTicker] = useState<string>("");
  const [marketTicker, setMarketTicker] = useState<string>("");
  const [marketCalendar, setMarketCalendar] = useState("");
  const [earningsWatch, setEarningsWatch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const tickers = getStoredTickers();
    const focus = defaultFocusSymbol(tickers);
    const market = defaultMarketSymbol(tickers);
    setAvailableTickers(tickers);
    setSelectedTickers(tickers);
    setFocusTicker(focus);
    setMarketTicker(market);
    setScannerReport(buildWeeklyReport({ tickers, weekOf }));
    setAdvisoryReport(buildWeeklyAdvisoryReport({ tickers, weekOf, focusTicker: focus, inputs: { selectedMarketTicker: market } }));
  }, []);

  const selectedSet = useMemo(() => new Set(selectedTickers), [selectedTickers]);

  function regenerate(nextTickers = selectedTickers, nextFocus = focusTicker, nextMarket = marketTicker) {
    setScannerReport(buildWeeklyReport({ tickers: nextTickers, weekOf }));
    setAdvisoryReport(buildWeeklyAdvisoryReport({
      tickers: nextTickers,
      weekOf,
      focusTicker: nextFocus,
      inputs: { selectedMarketTicker: nextMarket, marketCalendar, earningsWatch },
    }));
  }

  function toggleTicker(ticker: string) {
    const next = selectedSet.has(ticker) ? selectedTickers.filter((item) => item !== ticker) : [...selectedTickers, ticker].sort();
    setSelectedTickers(next);
    regenerate(next, focusTicker, marketTicker);
  }

  function setCopyStatus(label: string) {
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  async function importMarketChartCandles() {
    if (!marketTicker) return;
    setImportStatus(`Importing candles for ${marketTicker}...`);
    try {
      const count = await importYahooCandlesForTicker(marketTicker, "1y");
      setImportStatus(`Imported ${count} candles for ${marketTicker} using Yahoo symbol ${yahooSymbolForTicker(marketTicker)}.`);
      regenerate(selectedTickers, focusTicker, marketTicker);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Unknown candle import error");
    }
  }

  async function importFocusCandles() {
    if (!focusTicker) return;
    setImportStatus(`Importing candles for ${focusTicker}...`);
    try {
      const count = await importYahooCandlesForTicker(focusTicker, "1y");
      setImportStatus(`Imported ${count} candles for ${focusTicker}.`);
      regenerate(selectedTickers, focusTicker, marketTicker);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Unknown candle import error");
    }
  }

  async function importSelectedCandles() {
    const targets = Array.from(new Set([marketTicker, focusTicker, ...selectedTickers].filter(Boolean).map(normalizeTicker)));
    if (!targets.length) return;
    setImportStatus(`Importing candles for ${targets.length} symbols...`);
    const results: string[] = [];

    for (const ticker of targets) {
      try {
        const count = await importYahooCandlesForTicker(ticker, "1y");
        results.push(`${ticker}: ${count}`);
      } catch (error) {
        results.push(`${ticker}: failed`);
      }
    }

    setImportStatus(`Candle import complete — ${results.join(", ")}.`);
    regenerate(selectedTickers, focusTicker, marketTicker);
  }

  const markdown = mode === "advisory" ? advisoryReport?.markdown ?? "" : scannerReport?.markdown ?? "";
  const csv = scannerReport?.csv ?? "";

  if (!mounted) return <main style={{ padding: "1.5rem" }}>Loading report builder...</main>;

  return (
    <main style={{ padding: "1.25rem", display: "grid", gap: "1rem", background: "#f8fafc", minHeight: "100vh" }}>
      <style jsx global>{`
        @page { size: Letter; margin: 0.45in; }
        @media print {
          body { background: #fff !important; }
          body * { visibility: hidden; }
          #weekly-report-print, #weekly-report-print * { visibility: visible; }
          #weekly-report-print { position: absolute; left: 0; top: 0; width: 100%; max-width: none !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; box-shadow: none !important; }
          .no-print { display: none !important; }
          .page-break { break-before: page; page-break-before: always; height: 0; }
          table, tr, svg { page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, letterSpacing: -0.7 }}>Weekly Reports</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#64748b" }}>Create a high-level advisory PDF: market call, SPX chart, event calendar, one stock of interest, and concise notables.</p>
        </div>
        <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
          <Link href="/dashboard/scanner">Scanner</Link><Link href="/dashboard">Dashboard</Link><Link href="/dashboard/validation">Validation</Link>
        </div>
      </div>

      <section className="no-print" style={controlsShell}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "end", flexWrap: "wrap" }}>
          <label><strong>Report Mode</strong><select value={mode} onChange={(e) => setMode(e.target.value as ReportMode)} style={control}><option value="advisory">Advisory PDF / Newsletter</option><option value="scanner">Scanner Export</option></select></label>
          <label><strong>Week of</strong><input type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} style={control} /></label>
          <label><strong>Market Chart</strong><select value={marketTicker} onChange={(e) => { setMarketTicker(e.target.value); regenerate(selectedTickers, focusTicker, e.target.value); }} style={control}>{availableTickers.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label><strong>Stock of Interest</strong><select value={focusTicker} onChange={(e) => { setFocusTicker(e.target.value); regenerate(selectedTickers, e.target.value, marketTicker); }} style={control}>{availableTickers.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <button type="button" onClick={() => regenerate()}>Generate</button>
          <button type="button" onClick={() => copyToClipboard(markdown, () => setCopyStatus("Markdown copied"))}>Copy Markdown</button>
          <button type="button" onClick={() => downloadText(`wheeldesk-weekly-${fileSafeDate(weekOf)}.md`, markdown, "text/markdown")}>Download Markdown</button>
          <button type="button" onClick={() => downloadText(`wheeldesk-scanner-${fileSafeDate(weekOf)}.csv`, csv, "text/csv")}>Export CSV</button>
          <button type="button" onClick={() => window.print()}>Print / Save PDF</button>
          <button type="button" onClick={importMarketChartCandles}>Import market chart candles</button>
          <button type="button" onClick={importFocusCandles}>Import focus candles</button>
          <button type="button" onClick={importSelectedCandles}>Import selected candles</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <label><strong>Market Calendar / Macro Events</strong><textarea value={marketCalendar} onChange={(e) => setMarketCalendar(e.target.value)} placeholder="Example: CPI Wednesday, Fed speakers, Treasury auctions, OPEX Friday..." style={textarea} /></label>
          <label><strong>Earnings / Notables</strong><textarea value={earningsWatch} onChange={(e) => setEarningsWatch(e.target.value)} placeholder="Example: Earnings-heavy week; watch AAPL, AMD, NVDA..." style={textarea} /></label>
        </div>

        <div>
          <strong>Ticker universe</strong>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" onClick={() => { setSelectedTickers(availableTickers); regenerate(availableTickers); }}>Select all</button>
            <button type="button" onClick={() => { setSelectedTickers([]); regenerate([]); }}>Clear</button>
            {availableTickers.map((ticker) => <button key={ticker} type="button" onClick={() => toggleTicker(ticker)} style={{ borderRadius: 999, padding: "0.35rem 0.65rem", border: "1px solid #cbd5e1", background: selectedSet.has(ticker) ? "#111827" : "#fff", color: selectedSet.has(ticker) ? "#fff" : "#111827", fontWeight: 800 }}>{ticker}</button>)}
          </div>
        </div>
        {(copied || importStatus) && (
          <div style={{ display: "grid", gap: 4 }}>
            {copied && <div style={{ color: "#15803d", fontWeight: 700 }}>{copied}</div>}
            {importStatus && <div style={{ color: importStatus.toLowerCase().includes("failed") ? "#b91c1c" : "#15803d", fontWeight: 700 }}>{importStatus}</div>}
          </div>
        )}
      </section>

      <section className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "0.75rem" }}>
        <StatCard label="Selected" value={String(selectedTickers.length)} note="ticker universe" />
        <StatCard label="Market" value={marketTicker || "N/A"} note="chart anchor" />
        <StatCard label="Focus" value={advisoryReport?.focusTicker || "N/A"} note={advisoryReport?.focusRow?.actionBucket} />
        <StatCard label="CSP" value={String(scannerReport?.cspCandidates.length ?? 0)} />
        <StatCard label="Compression" value={String(scannerReport?.compressionCoils.length ?? 0)} />
      </section>

      {mode === "scanner" && scannerReport && <section className="no-print" style={previewShell}><h2 style={{ marginTop: 0 }}>Scanner Export Preview</h2><ScannerExportTable rows={scannerReport.rows} /></section>}
      {mode === "advisory" && advisoryReport && <section className="no-print" style={previewShell}><h2 style={{ marginTop: 0 }}>Advisory Preview</h2><p style={muted}>The PDF intentionally avoids a giant watchlist table. It leads with the market read, SPX chart, event calendar, and one stock of interest. Scanner export remains available as CSV/appendix.</p></section>}
      {mode === "advisory" && advisoryReport && <AdvisoryPdfPreview report={advisoryReport} />}
    </main>
  );
}

const muted: React.CSSProperties = { color: "#64748b" };
const controlsShell: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", padding: "1rem", display: "grid", gap: "1rem" };
const control: React.CSSProperties = { display: "block", marginTop: 4, minWidth: 140 };
const textarea: React.CSSProperties = { display: "block", marginTop: 4, width: "100%", minHeight: 70, padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 8 };
const statCard: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", padding: "0.85rem" };
const statLabel: React.CSSProperties = { color: "#64748b", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 };
const previewShell: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", padding: "1rem" };
const reportShell: React.CSSProperties = { maxWidth: 940, margin: "0 auto", background: "#fff", border: "1px solid #dbeafe", borderRadius: 18, padding: "1.1rem", display: "grid", gap: "1rem", boxShadow: "0 14px 40px rgba(15,23,42,0.06)" };
const reportHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "4px solid #111827", paddingBottom: 16 };
const eyebrow: React.CSSProperties = { textTransform: "uppercase", color: "#2563eb", fontWeight: 900, letterSpacing: 1.2, fontSize: 12 };
const reportTitle: React.CSSProperties = { margin: "0.15rem 0", fontSize: 38, letterSpacing: -1.2 };
const reportSubtitle: React.CSSProperties = { margin: 0, color: "#64748b" };
const brandBadge: React.CSSProperties = { width: 64, height: 64, borderRadius: 16, background: "#111827", color: "#fff", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 24 };
const heroBox: React.CSSProperties = { background: "linear-gradient(135deg,#eff6ff,#f8fafc)", border: "1px solid #bfdbfe", borderRadius: 16, padding: "1rem" };
const sectionKicker: React.CSSProperties = { textTransform: "uppercase", color: "#2563eb", fontWeight: 900, fontSize: 11, letterSpacing: 0.8, marginBottom: 6 };
const leadText: React.CSSProperties = { fontSize: 18, lineHeight: 1.45, margin: "0 0 0.75rem" };
const bodyText: React.CSSProperties = { lineHeight: 1.45, margin: 0 };
const sectionBlock: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 16, padding: "1rem", background: "#fff" };
const sectionTitle: React.CSSProperties = { margin: "0 0 0.75rem", fontSize: 22, letterSpacing: -0.4 };
const chartBox: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 12, padding: "0.75rem", background: "#f8fafc" };
const chartPlaceholder: React.CSSProperties = { border: "1px dashed #94a3b8", borderRadius: 12, padding: "2rem", textAlign: "center", color: "#64748b", background: "#f8fafc" };
const matrixGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 };
const metricCard: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 10, padding: "0.65rem", background: "#fff" };
const twoCol: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" };
const advisoryCard: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 14, padding: "0.9rem", background: "#fff" };
const tightList: React.CSSProperties = { margin: 0, paddingLeft: "1.1rem", lineHeight: 1.45 };
const notableGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 };
const notableCard: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 12, padding: "0.75rem", background: "#f8fafc" };
const riskBox: React.CSSProperties = { borderTop: "3px solid #111827", paddingTop: 14 };
const disclaimer: React.CSSProperties = { fontSize: 11, color: "#64748b", marginTop: 10 };
const th: React.CSSProperties = { textAlign: "left", padding: 8, borderBottom: "1px solid #e2e8f0" };
const td: React.CSSProperties = { padding: 8, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
