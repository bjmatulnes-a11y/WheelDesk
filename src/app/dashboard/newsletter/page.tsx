"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildStructureNewsletterReport,
  listNewsletterTickers,
  reportMoney,
  reportScore,
  type StructureNewsletterReport,
  type StructureReportRow,
} from "../../../lib/structure-newsletter-engine";
import { saveCandles, type CandleRecord } from "../../../lib/wheeldesk-storage";
import { getPriceSeries } from "../../../lib/data-provider";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}

function downloadText(filename: string, value: string): void {
  const blob = new Blob([value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


function normalizeStorageTicker(value: string): string {
  const t = String(value ?? "").trim().toUpperCase();
  if (["SPX", "^SPX", "$SPX", "GSPC", "^GSPC"].includes(t)) return "^SPX";
  if (["VIX", "^VIX", "$VIX"].includes(t)) return "^VIX";
  return t;
}

function yahooTickerFor(value: string): string {
  const t = normalizeStorageTicker(value);
  if (t === "^SPX") return "^GSPC";
  if (t === "^VIX") return "^VIX";
  return t;
}

function normalizeFetchedCandles(raw: any[]): CandleRecord[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c: any) => ({
      date: String(c?.date ?? c?.time ?? c?.timestamp ?? "").slice(0, 10),
      open: Number(c?.open ?? c?.o ?? c?.close),
      high: Number(c?.high ?? c?.h ?? c?.close),
      low: Number(c?.low ?? c?.l ?? c?.close),
      close: Number(c?.close ?? c?.c),
      volume: Number(c?.volume ?? c?.v ?? 0) || undefined,
    }))
    .filter((c) => c.date && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchAndSaveChartCandles(ticker: string, timeframe = "daily"): Promise<{ ticker: string; yahooTicker: string; count: number }> {
  const storageTicker = normalizeStorageTicker(ticker);
  const yahooTicker = yahooTickerFor(ticker);
  const series = await getPriceSeries(yahooTicker, timeframe as any);
  const candles = normalizeFetchedCandles(series as any[]);
  if (candles.length) {
    saveCandles(storageTicker, candles);
  }
  return { ticker: storageTicker, yahooTicker, count: candles.length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function MarketStructureChart({ candles, row, title }: { candles: CandleRecord[]; row: StructureReportRow | null; title: string }) {
  const data = candles.slice(-80).filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  const width = 980;
  const height = 360;
  const padL = 54;
  const padR = 92;
  const padT = 28;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  if (!data.length) {
    return (
      <div className="chartEmpty">
        No saved candles for {row?.ticker ?? title}. Click Load / Refresh Charts, then regenerate the newsletter.
      </div>
    );
  }

  const railValues = [row?.support, row?.magnet, row?.resistance, row?.bullishUnlock, row?.bearishFailure, row?.spot]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const priceValues = data.flatMap((c) => [c.high, c.low, c.close]).concat(railValues);
  const rawMin = Math.min(...priceValues);
  const rawMax = Math.max(...priceValues);
  const span = rawMax - rawMin || rawMax * 0.02 || 1;
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;

  const x = (index: number) => padL + (index / Math.max(1, data.length - 1)) * plotW;
  const y = (price: number) => padT + (max - price) / (max - min) * plotH;
  const candleW = clamp(plotW / Math.max(1, data.length) * 0.55, 3, 8);

  function rail(value: number | null | undefined, label: string, color: string, dash?: string) {
    if (value == null || !Number.isFinite(value)) return null;
    const yy = y(value);
    if (yy < padT - 10 || yy > height - padB + 10) return null;
    return (
      <g key={label}>
        <line x1={padL} x2={width - padR + 8} y1={yy} y2={yy} stroke={color} strokeWidth="1.5" strokeDasharray={dash} />
        <rect x={width - padR + 10} y={yy - 10} width="76" height="20" rx="3" fill={color} />
        <text x={width - padR + 48} y={yy + 4} textAnchor="middle" fontSize="10" fill="white" fontWeight="700">
          {label} {reportMoney(value)}
        </text>
      </g>
    );
  }

  const linePath = data
    .map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`)
    .join(" ");

  return (
    <div className="chartWrap keepTogether">
      <div className="chartTitleRow">
        <div>
          <h3>{title}</h3>
          <div className="muted">
            {row ? `${row.ticker} · spot ${reportMoney(row.spot)} · ${row.label} · ${row.wallMigration}` : "Saved candle structure"}
          </div>
        </div>
        <div className="chartLegend">
          <span className="legendItem blue">Support</span>
          <span className="legendItem purple">Magnet</span>
          <span className="legendItem red">Resistance</span>
          <span className="legendItem green">Unlock</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="structureSvg" role="img" aria-label={`${title} chart`}>
        <rect x="0" y="0" width={width} height={height} fill="white" />
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const yy = padT + p * plotH;
          const price = max - p * (max - min);
          return (
            <g key={p}>
              <line x1={padL} x2={width - padR} y1={yy} y2={yy} stroke="#e2e8f0" />
              <text x={width - padR + 6} y={yy + 4} fontSize="10" fill="#475569">{reportMoney(price)}</text>
            </g>
          );
        })}
        <path d={linePath} fill="none" stroke="#64748b" strokeWidth="1.2" opacity="0.55" />
        {data.map((c, i) => {
          const xx = x(i);
          const up = c.close >= (c.open ?? c.close);
          const color = up ? "#16a34a" : "#dc2626";
          const openY = y(c.open ?? c.close);
          const closeY = y(c.close);
          const top = Math.min(openY, closeY);
          const bodyH = Math.max(2, Math.abs(closeY - openY));
          return (
            <g key={`${c.date}-${i}`}>
              <line x1={xx} x2={xx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" />
              <rect x={xx - candleW / 2} y={top} width={candleW} height={bodyH} fill={color} />
            </g>
          );
        })}
        {rail(row?.support, "Support", "#2563eb")}
        {rail(row?.magnet, "Magnet", "#7c3aed", "4 3")}
        {rail(row?.resistance, "Resistance", "#dc2626")}
        {rail(row?.bullishUnlock, "Unlock", "#16a34a", "5 3")}
        {rail(row?.bearishFailure, "Failure", "#b91c1c", "5 3")}
        <line x1={padL} x2={padL} y1={padT} y2={height - padB} stroke="#cbd5e1" />
        <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="#cbd5e1" />
        {data.length ? (
          <>
            <text x={padL} y={height - 10} fontSize="10" fill="#475569">{data[0]?.date}</text>
            <text x={width - padR} y={height - 10} textAnchor="end" fontSize="10" fill="#475569">{data.at(-1)?.date}</text>
          </>
        ) : null}
      </svg>
    </div>
  );
}

function RailCard({ label, value, note, variant = "default" }: { label: string; value: string; note?: string; variant?: string }) {
  return (
    <div className={`railCard ${variant}`}>
      <div className="railLabel">{label}</div>
      <div className="railValue">{value}</div>
      {note ? <div className="railNote">{note}</div> : null}
    </div>
  );
}

function MarketStructureSection({ row }: { row: StructureReportRow | null }) {
  if (!row) {
    return (
      <section className="card keepTogether">
        <h2>Structure Ledger</h2>
        <p className="muted">No saved market OI structure available.</p>
      </section>
    );
  }

  return (
    <section className="card keepTogether">
      <div className="sectionHeader">
        <div>
          <h2>Structure Ledger</h2>
          <div className="muted">{row.ticker} · {row.snapshotDate} · {row.regime}</div>
        </div>
        <div className="scoreBox">
          <div className="scoreValue">{reportScore(row.edgeScore)}</div>
          <div className="muted">edge</div>
        </div>
      </div>
      <div className="badgeRow">
        <span className="badge primary">{row.label}</span>
        <span className="badge">{row.wallMigration}</span>
        <span className="badge">Proof: {row.proof}</span>
      </div>
      <div className="railGrid strongRails">
        <RailCard label="Spot" value={reportMoney(row.spot)} />
        <RailCard label="Support" value={reportMoney(row.support)} note="lower guardrail" variant="support" />
        <RailCard label="OI Magnet" value={reportMoney(row.magnet)} note="reversion reference" variant="magnet" />
        <RailCard label="Resistance" value={reportMoney(row.resistance)} note="upper guardrail" variant="resistance" />
        <RailCard label="Bullish Unlock" value={reportMoney(row.bullishUnlock)} note="only above this rail" variant="unlock" />
        <RailCard label="Bearish Failure" value={reportMoney(row.bearishFailure)} note="only below this rail" variant="failure" />
      </div>
      {row.suppressedRailNotes.length ? (
        <div className="warningBox">
          <strong>Rail sanity filter:</strong>
          <ul>
            {row.suppressedRailNotes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FocusSection({ row, candles }: { row: StructureReportRow | null; candles: CandleRecord[] }) {
  if (!row) return null;
  return (
    <section className="card keepTogether">
      <h2>Optional Stock of Interest: {row.ticker}</h2>
      <div className="badgeRow">
        <span className="badge primary">{row.label}</span>
        <span className="badge">Edge {reportScore(row.edgeScore)}</span>
        <span className="badge">{row.wallMigration}</span>
      </div>
      <MarketStructureChart candles={candles} row={row} title={`${row.ticker} Structure Snapshot`} />
      <p><strong>Read:</strong> {row.action}</p>
    </section>
  );
}

function Notables({ rows }: { rows: StructureReportRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="card keepTogether">
      <h2>Concise Notables</h2>
      <p className="muted">Only the names worth a sentence. The newsletter remains market-structure first.</p>
      <div className="notableList">
        {rows.map((row) => (
          <div className="notableItem" key={`${row.ticker}-${row.snapshotDate}`}>
            <strong>{row.ticker}</strong> — {row.label}; rails {reportMoney(row.support)} / {reportMoney(row.magnet)} / {reportMoney(row.resistance)}. {row.action}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function StructureNewsletterPage() {
  const [hydrated, setHydrated] = useState(false);
  const [tickers, setTickers] = useState<string[]>([]);
  const [weekOf, setWeekOf] = useState(todayKey());
  const [marketTicker, setMarketTicker] = useState("^SPX");
  const [vixTicker, setVixTicker] = useState("^VIX");
  const [stockOfInterest, setStockOfInterest] = useState("");
  const [marketCall, setMarketCall] = useState("");
  const [calendarNotes, setCalendarNotes] = useState("");
  const [earningsNotes, setEarningsNotes] = useState("");
  const [authorNote, setAuthorNote] = useState("");
  const [report, setReport] = useState<StructureNewsletterReport | null>(null);
  const [chartStatus, setChartStatus] = useState("Chart history not loaded yet.");
  const [isLoadingCharts, setIsLoadingCharts] = useState(false);

  useEffect(() => {
    const loaded = listNewsletterTickers();
    setTickers(loaded);
    setMarketTicker((current) => current && loaded.includes(current) ? current : loaded.includes("^SPX") ? "^SPX" : loaded.includes("SPY") ? "SPY" : loaded[0] ?? "^SPX");
    setVixTicker((current) => current && loaded.includes(current) ? current : loaded.includes("^VIX") ? "^VIX" : loaded.includes("$VIX") ? "$VIX" : "^VIX");
    setStockOfInterest((current) => current && loaded.includes(current) ? current : loaded.find((ticker) => !ticker.includes("SPX") && !ticker.includes("VIX")) ?? "");
    setHydrated(true);
  }, []);

  const marketTickerOptions = useMemo(() => Array.from(new Set(["^SPX", "SPY", ...tickers])), [tickers]);
  const vixTickerOptions = useMemo(() => Array.from(new Set(["^VIX", "$VIX", "VIX", ...tickers.filter((ticker) => ticker.includes("VIX"))])), [tickers]);

  async function loadRequiredCharts(): Promise<void> {
    setIsLoadingCharts(true);
    setChartStatus("Loading chart history...");

    try {
      const wanted = Array.from(new Set([marketTicker, vixTicker, stockOfInterest].filter(Boolean).map(normalizeStorageTicker)));
      const results = [] as { ticker: string; yahooTicker: string; count: number }[];
      for (const ticker of wanted) {
        results.push(await fetchAndSaveChartCandles(ticker));
      }
      setChartStatus(
        results
          .map((r) => `${r.ticker}: ${r.count} candles${r.yahooTicker !== r.ticker ? ` via ${r.yahooTicker}` : ""}`)
          .join(" | ") || "No chart tickers selected."
      );
    } catch (error) {
      setChartStatus(error instanceof Error ? `Chart load failed: ${error.message}` : "Chart load failed.");
    } finally {
      setIsLoadingCharts(false);
    }
  }

  async function generate(): Promise<void> {
    // Make the newsletter self-contained: it can populate chart history without visiting Scanner/Dashboard first.
    await loadRequiredCharts();
    setReport(buildStructureNewsletterReport({ weekOf, marketTicker: normalizeStorageTicker(marketTicker), vixTicker: normalizeStorageTicker(vixTicker), stockOfInterest: stockOfInterest ? normalizeStorageTicker(stockOfInterest) : "", marketCall, calendarNotes, earningsNotes, authorNote, maxNotables: 3 }));
  }

  return (
    <main className="page">
      <style jsx global>{`
        body { font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; }
        .page { max-width: 1180px; margin: 0 auto; padding: 24px; }
        .topNav { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 18px; }
        .topNav a { margin-left: 12px; }
        h1 { margin: 0; font-size: 34px; letter-spacing: -0.03em; }
        h2 { margin: 0 0 10px; font-size: 22px; }
        h3 { margin: 0; font-size: 16px; }
        p { line-height: 1.45; }
        .muted { color: #64748b; }
        .controls { border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 18px; background: white; }
        .controlsGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
        label { display: block; font-weight: 700; font-size: 13px; margin-bottom: 5px; }
        input, select, textarea { width: 100%; border: 1px solid #94a3b8; border-radius: 6px; padding: 7px; font: inherit; box-sizing: border-box; }
        textarea { min-height: 72px; resize: vertical; }
        .textGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .buttonRow { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap; }
        button { border: 1px solid #64748b; background: white; border-radius: 6px; padding: 7px 11px; font: inherit; cursor: pointer; }
        button.primary { background: #0f172a; color: white; border-color: #0f172a; }
        .advisory { border: 1px solid #cbd5e1; border-radius: 14px; overflow: hidden; background: white; }
        .reportHeader { padding: 28px; background: linear-gradient(135deg, #0f172a, #172554); color: white; }
        .reportHeader h1 { color: white; }
        .reportHeader .muted { color: #cbd5e1; }
        .headerGrid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: end; }
        .callout { border-left: 5px solid #2563eb; background: #eff6ff; padding: 16px; margin: 18px; border-radius: 8px; }
        .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; margin: 18px; background: white; }
        .sectionHeader { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
        .scoreBox { text-align: right; min-width: 90px; }
        .scoreValue { font-size: 32px; font-weight: 900; color: #92400e; line-height: 1; }
        .badgeRow { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 14px; }
        .badge { border: 1px solid #cbd5e1; border-radius: 999px; padding: 4px 9px; font-size: 13px; background: #f8fafc; }
        .badge.primary { background: #ecfdf5; border-color: #86efac; color: #166534; font-weight: 700; }
        .railGrid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
        .railCard { border: 1px solid #dbeafe; background: #eff6ff; border-radius: 10px; padding: 12px; }
        .railCard.support { background: #eff6ff; border-color: #93c5fd; }
        .railCard.magnet { background: #f5f3ff; border-color: #c4b5fd; }
        .railCard.resistance, .railCard.failure { background: #fef2f2; border-color: #fca5a5; }
        .railCard.unlock { background: #ecfdf5; border-color: #86efac; }
        .railLabel { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; font-weight: 900; }
        .railValue { font-size: 20px; font-weight: 900; margin-top: 4px; }
        .railNote { font-size: 12px; color: #64748b; margin-top: 2px; }
        .warningBox { border: 1px solid #fed7aa; background: #fff7ed; padding: 12px; border-radius: 10px; margin-top: 12px; color: #9a3412; }
        .twoCol { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px; }
        .empty { border: 1px dashed #94a3b8; border-radius: 12px; padding: 40px; color: #64748b; text-align: center; background: white; }
        .chartWrap { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; margin: 18px; background: #fff; }
        .chartTitleRow { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
        .structureSvg { width: 100%; height: auto; display: block; }
        .chartEmpty { border: 1px dashed #94a3b8; border-radius: 12px; padding: 48px; text-align: center; color: #64748b; background: #f8fafc; }
        .chartLegend { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; }
        .legendItem { padding: 3px 7px; border-radius: 999px; border: 1px solid #cbd5e1; }
        .legendItem.blue { color: #1d4ed8; } .legendItem.purple { color: #6d28d9; } .legendItem.red { color: #b91c1c; } .legendItem.green { color: #15803d; }
        .notableList { display: grid; gap: 10px; }
        .notableItem { border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
        @media print {
          body { background: white; }
          .noPrint, .topNav { display: none !important; }
          .page { max-width: none; padding: 0; }
          .advisory { border: none; border-radius: 0; }
          .card, .callout, .chartWrap { margin-left: 0; margin-right: 0; }
          .keepTogether { break-inside: avoid; }
        }
      `}</style>

      <div className="topNav noPrint">
        <div>
          <h1>WheelDesk Structure Newsletter</h1>
          <div className="muted">Internal generator. SPX-first structure advisory with clean chart overlays.</div>
        </div>
        <div>
          <a href="/dashboard">Dashboard</a>
          <a href="/dashboard/scanner">Scanner</a>
          <a href="/dashboard/validation">Validation</a>
        </div>
      </div>

      <section className="controls noPrint">
        <div className="controlsGrid">
          <div><label>Week of</label><input type="date" value={weekOf} onChange={(event) => setWeekOf(event.target.value)} /></div>
          <div><label>Market structure focus</label><select value={marketTicker} onChange={(event) => setMarketTicker(event.target.value)}>{marketTickerOptions.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}</select></div>
          <div><label>Volatility read</label><select value={vixTicker} onChange={(event) => setVixTicker(event.target.value)}>{vixTickerOptions.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}</select></div>
          <div><label>Optional stock of interest</label><select value={stockOfInterest} onChange={(event) => setStockOfInterest(event.target.value)}><option value="">None</option>{tickers.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}</select></div>
        </div>
        <div><label>Executive market call</label><textarea value={marketCall} onChange={(event) => setMarketCall(event.target.value)} placeholder="Write the 1–3 week market call here. Leave blank to auto-generate from SPX structure." /></div>
        <div className="textGrid" style={{ marginTop: 12 }}>
          <div><label>Market calendar / macro events</label><textarea value={calendarNotes} onChange={(event) => setCalendarNotes(event.target.value)} placeholder="CPI, FOMC, Treasury auctions, OPEX, jobs, Powell speakers..." /></div>
          <div><label>Earnings / notable event watch</label><textarea value={earningsNotes} onChange={(event) => setEarningsNotes(event.target.value)} placeholder="Earnings-heavy week, mega-cap reports, sector-specific events..." /></div>
        </div>
        <div style={{ marginTop: 12 }}><label>Author note / risk language</label><textarea value={authorNote} onChange={(event) => setAuthorNote(event.target.value)} placeholder="Optional closing note." /></div>
        <div className="buttonRow">
          <button disabled={!hydrated || isLoadingCharts} onClick={loadRequiredCharts}>Load / Refresh Charts</button>
          <button className="primary" disabled={!hydrated || isLoadingCharts} onClick={generate}>Generate Structure Note</button>
          <button disabled={!report} onClick={() => report && copyText(report.markdown)}>Copy Markdown</button>
          <button disabled={!report} onClick={() => report && downloadText(`wheeldesk-structure-note-${report.weekOf}.md`, report.markdown)}>Download Markdown</button>
          <button disabled={!report} onClick={() => window.print()}>Print / Save PDF</button>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>{chartStatus}</div>
      </section>

      {!report ? (
        <div className="empty noPrint">{hydrated ? "Generate the structure note after selecting SPX/SPY and entering the weekly calendar context." : "Loading saved WheelDesk tickers..."}</div>
      ) : (
        <article className="advisory">
          <header className="reportHeader keepTogether">
            <div className="headerGrid">
              <div><h1>WheelDesk Weekly Structure Note</h1><div className="muted">Week of {report.weekOf}</div></div>
              <div style={{ textAlign: "right" }}><div className="muted">Market focus</div><div style={{ fontSize: 30, fontWeight: 900 }}>{report.market?.ticker ?? report.marketTicker}</div></div>
            </div>
          </header>
          <section className="callout keepTogether"><h2>Executive Market Call</h2><p>{report.marketCall}</p></section>
          <MarketStructureChart candles={report.marketCandles} row={report.market} title="SPX / Market Structure Chart" />
          <MarketStructureSection row={report.market} />
          <div className="twoCol keepTogether">
            <section className="card" style={{ margin: 0 }}><h2>Structure Read</h2><p>{report.structureRead}</p></section>
            <section className="card" style={{ margin: 0 }}><h2>Premium Seller Implication</h2><p>{report.premiumSellerImplication}</p></section>
          </div>
          <div className="twoCol keepTogether">
            <section className="card" style={{ margin: 0 }}><h2>Market Calendar / Macro Events</h2><p>{report.calendarNotes || "No major calendar notes entered."}</p></section>
            <section className="card" style={{ margin: 0 }}><h2>Earnings / Event Watch</h2><p>{report.earningsNotes || "No earnings/event notes entered."}</p></section>
          </div>
          {report.vix ? (
            <section className="card keepTogether">
              <h2>VIX / Volatility Structure</h2>
              <p>{report.vix.ticker}: {report.vix.label}. Rails {reportMoney(report.vix.support)} / {reportMoney(report.vix.magnet)} / {reportMoney(report.vix.resistance)}. Use VIX as the premium-risk backdrop, not a wheel candidate.</p>
              <MarketStructureChart candles={report.vixCandles} row={report.vix} title="VIX / Volatility Backdrop" />
            </section>
          ) : null}
          <FocusSection row={report.stockOfInterest} candles={report.stockCandles} />
          <Notables rows={report.notables} />
          <section className="card keepTogether"><h2>Risk Framework</h2><p>This advisory is a market-structure map, not a price prediction. OI walls are reference zones. News, earnings, macro events, and fresh flow can invalidate the structure. Use the rails to define where the read changes, not as guaranteed targets.</p>{report.authorNote ? <p>{report.authorNote}</p> : null}</section>
        </article>
      )}
    </main>
  );
}
