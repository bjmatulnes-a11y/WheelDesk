"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { WheelDeskSideNav } from "./WheelDeskSideNav";
import type { SpxOiMapRow, SpyAlignmentRow, ZeroDteChainRow, ZeroDteRecommendation } from "../lib/zeroDteOiIntelligence";
import { buildIronFlyPositionReport, type IronFlyPositionReport, type IronFlySideReport } from "../lib/zeroDteIronFlyManager";
import { ZeroDteTradeSelectionPanel } from "./ZeroDteTradeSelectionPanel";
import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";

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
  mood?: ZeroDteMoodRead;
  tradeSelection?: ZeroDteTradeSelection;
  errors: string[];
  qualityChecks?: QualityCheck[];
};

type PositionState = {
  center: string;
  wingWidth: string;
  quantity: string;
  entryCredit: string;
  entryPutShortCredit: string;
  entryCallShortCredit: string;
};

const defaultPosition: PositionState = {
  center: "",
  wingWidth: "",
  quantity: "1",
  entryCredit: "",
  entryPutShortCredit: "",
  entryCallShortCredit: "",
};

export default function ZeroDteCommandClient() {
  const [data, setData] = useState<HarvestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedMove, setExpectedMove] = useState("");
  const [rangePct, setRangePct] = useState("0.045");
  const [strictZeroDte, setStrictZeroDte] = useState(false);
  const [manualMood, setManualMood] = useState("");
  const [spreadWidth, setSpreadWidth] = useState("20");
  const [position, setPosition] = useState<PositionState>(defaultPosition);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (Number(expectedMove) > 0) params.set("expectedMove", expectedMove);
      if (Number(rangePct) > 0) params.set("rangePct", rangePct);
      if (strictZeroDte) params.set("strict", "1");
      if (Number(manualMood) || manualMood.trim() === "0") params.set("mood", manualMood);
      if (Number(spreadWidth) > 0) params.set("spreadWidth", spreadWidth);

      const res = await fetch(`/api/zero-dte/harvest?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as HarvestResponse;
      setData(json);

      if (!res.ok) setError(json.errors?.join(" ") || "0DTE harvest failed.");
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

  function applySuggestion() {
    if (!rec) return;
    setPosition((prev) => ({
      ...prev,
      center: String(rec.suggestedCenter),
      wingWidth: String(rec.suggestedWingWidth),
    }));
  }

  const spxMapRows = useMemo(() => {
    const rows = rec?.spxChainMap ?? [];
    const spot = rec?.spxPrice ?? 0;
    return rows
      .filter((row) => !spot || Math.abs(row.strike - spot) <= Math.max((rec?.expectedMove ?? 70) * 1.8, 100))
      .sort((a, b) => a.strike - b.strike);
  }, [rec]);

  const spyAlignmentRows = useMemo(() => {
    return (rec?.spyAlignmentMap ?? []).filter((row) => row.alignment !== "none").slice(0, 15);
  }, [rec]);

  const positionReport = useMemo(() => {
    if (!rec || !data?.spx?.rows.length) return null;

    const center = Number(position.center) > 0 ? Number(position.center) : rec.suggestedCenter;
    const wingWidth = Number(position.wingWidth) > 0 ? Number(position.wingWidth) : rec.suggestedWingWidth;

    return buildIronFlyPositionReport({
      spxRows: data.spx.rows,
      recommendation: rec,
      center,
      lowerWing: center - wingWidth,
      upperWing: center + wingWidth,
      quantity: Number(position.quantity) || 1,
      entryCredit: Number(position.entryCredit) || 0,
      entryPutShortCredit: Number(position.entryPutShortCredit) || null,
      entryCallShortCredit: Number(position.entryCallShortCredit) || null,
    });
  }, [data?.spx?.rows, position, rec]);

  return (
    <div style={styles.shell}>
      <WheelDeskSideNav active="zero-dte" />

      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Personal Trading Lab</div>
            <h1 style={styles.title}>0DTE SPX Iron Fly Command</h1>
            <p style={styles.subtitle}>
              SPX is the traded instrument. SPY is converted into SPX-equivalent levels and used only for alignment, confirmation, and secondary pressure analytics.
            </p>
          </div>
          <button onClick={load} disabled={loading} style={styles.primaryButton}>{loading ? "Harvesting…" : "Harvest 0DTE"}</button>
        </header>

        <section style={styles.controlsGrid}>
          <label style={styles.controlCard}>
            <span style={styles.controlText}>Manual expected move override</span>
            <input value={expectedMove} onChange={(e) => setExpectedMove(e.target.value)} placeholder="optional, e.g. 66" type="number" step="0.5" style={styles.input} />
          </label>

          <label style={styles.controlCard}>
            <span style={styles.controlText}>Chain range pct</span>
            <input value={rangePct} onChange={(e) => setRangePct(e.target.value)} type="number" step="0.005" style={styles.input} />
          </label>

          <label style={styles.controlCard}>
            <span style={styles.controlText}>TOS mood override</span>
            <input value={manualMood} onChange={(e) => setManualMood(e.target.value)} placeholder="optional, e.g. 78 or -82" type="number" step="0.5" style={styles.input} />
          </label>

          <label style={styles.controlCard}>
            <span style={styles.controlText}>Credit spread width</span>
            <input value={spreadWidth} onChange={(e) => setSpreadWidth(e.target.value)} placeholder="20" type="number" step="5" style={styles.input} />
          </label>

          <label style={styles.checkboxCard}>
            <span style={styles.controlText}>Strict 0DTE</span>
            <span style={styles.checkboxRow}>
              <input checked={strictZeroDte} onChange={(e) => setStrictZeroDte(e.target.checked)} type="checkbox" />
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
            <p style={styles.muted}>This page does not use mock data. If the harvest succeeds, SPX/SPY rows, expiration, provider symbols, and the OI map will appear here.</p>
          </section>
        ) : (
          <>
            <section style={styles.chartCard}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>SPX OI Chain Map</h2>
                  <p style={styles.muted}>Old-school chain view: SPX strikes on the X-axis, open interest on the Y-axis. Calls plot above baseline, puts below. Center, wings, spot, pin, and walls are overlaid.</p>
                </div>
                <div style={styles.sourceText}>SPX-primary placement | SPY confirmation only</div>
              </div>
              <SpxOiHistogram rows={spxMapRows} rec={rec} />
            </section>

            <ZeroDteTradeSelectionPanel mood={data?.mood ?? null} tradeSelection={data?.tradeSelection ?? null} />

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
                  <div style={styles.smallCaps}>Suggested SPX Iron Fly</div>
                  <div style={styles.structureText}>{fmt(rec.lowerWing)} / {fmt(rec.suggestedCenter)} / {fmt(rec.upperWing)}</div>
                  <div style={styles.muted}>Suggested wing width: ±{fmt(rec.suggestedWingWidth)}</div>
                </div>
              </div>

              <div style={styles.panelCard}>
                <h2 style={styles.sectionTitle}>Placement Read</h2>
                <p style={styles.muted}>This is the opening placement logic. The live position cockpit below handles defense after entry.</p>
                <div style={styles.managementBox}>{rec.management}</div>
                <div style={styles.notesList}>{rec.notes.map((note, idx) => <div key={idx}>• {note}</div>)}</div>
              </div>
            </section>

            <PositionCockpit
              position={position}
              setPosition={setPosition}
              rec={rec}
              report={positionReport}
              applySuggestion={applySuggestion}
            />

            <section style={styles.grid4}>
              <MetricCard title="SPX Gravity" value={fmt(rec.spx.gravity)} />
              <MetricCard title="SPX Pin" value={fmt(rec.spx.strongestPin)} />
              <MetricCard title="SPX Put / Call Wall" value={`${fmt(rec.spx.putWall)} / ${fmt(rec.spx.callWall)}`} />
              <MetricCard title={`Dealer Pressure ${rec.dealerPressureSource === "dealer-pressure-engine" ? "(Engine)" : "(Local)"}`} value={`${rec.dealerPressure > 0 ? "+" : ""}${rec.dealerPressure}`} tone={pressureTone(rec.dealerPressure)} />
            </section>



            <DealerPressureEnginePanel rec={rec} />

            <section style={styles.grid3}>
              <OiCard title="SPX OI Intelligence" data={rec.spx} />
              <OiCard title="SPY Alignment Lens" data={rec.spyEquivalent} />
              <OiCard title="Composite Reference" data={rec.composite} />
            </section>

            <section style={styles.tableCard}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>SPX OI Chain Map Table</h2>
                  <p style={styles.muted}>Primary SPX strikes around spot with SPX OI, volume, gamma-weight, side bias, and nearest SPY-equivalent confirmation.</p>
                </div>
                <div style={styles.sourceText}>SPX exp: {data?.spx?.expirationDate ?? "—"} | SPY exp: {data?.spy?.expirationDate ?? "—"} | SPX rows: {data?.spx?.rows.length ?? 0} | SPY rows: {data?.spy?.rows.length ?? 0}</div>
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
                  <tbody>{spxMapRows.map((row) => <SpxMapRow key={row.strike} row={row} />)}</tbody>
                </table>
              </div>
            </section>

            <section style={styles.tableCard}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.sectionTitle}>SPY Confirmation Map</h2>
                  <p style={styles.muted}>Top SPY-equivalent OI clusters matched back to nearest SPX strikes. This is confirmation only.</p>
                </div>
                <div style={styles.sourceText}>SPY notional weight: {(rec.spyNotionalWeight * 100).toFixed(1)}%</div>
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
                  <tbody>{spyAlignmentRows.map((row) => <SpyMapRow key={`${row.strike}-${row.nearestSpxStrike}`} row={row} />)}</tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function PositionCockpit({
  position,
  setPosition,
  rec,
  report,
  applySuggestion,
}: {
  position: PositionState;
  setPosition: React.Dispatch<React.SetStateAction<PositionState>>;
  rec: ZeroDteRecommendation;
  report: IronFlyPositionReport | null;
  applySuggestion: () => void;
}) {
  return (
    <section style={styles.cockpitCard}>
      <div style={styles.cardHeaderRow}>
        <div>
          <h2 style={styles.sectionTitle}>Live Iron Fly Position Cockpit</h2>
          <p style={styles.muted}>After you enter the trade, type the actual fill. This monitors the fly as one position, not two unrelated spreads.</p>
        </div>
        <button onClick={applySuggestion} style={styles.secondaryButton}>Use Suggested Strikes</button>
      </div>

      <div style={styles.positionGrid}>
        <label style={styles.controlCard}><span style={styles.controlText}>Center</span><input value={position.center} onChange={(e) => setPosition((p) => ({ ...p, center: e.target.value }))} placeholder={String(rec.suggestedCenter)} type="number" style={styles.input} /></label>
        <label style={styles.controlCard}><span style={styles.controlText}>Wing width</span><input value={position.wingWidth} onChange={(e) => setPosition((p) => ({ ...p, wingWidth: e.target.value }))} placeholder={String(rec.suggestedWingWidth)} type="number" style={styles.input} /></label>
        <label style={styles.controlCard}><span style={styles.controlText}>Contracts</span><input value={position.quantity} onChange={(e) => setPosition((p) => ({ ...p, quantity: e.target.value }))} type="number" min="1" step="1" style={styles.input} /></label>
        <label style={styles.controlCard}><span style={styles.controlText}>Actual total credit</span><input value={position.entryCredit} onChange={(e) => setPosition((p) => ({ ...p, entryCredit: e.target.value }))} placeholder="required, SPX points" type="number" step="0.05" style={styles.input} /></label>
        <label style={styles.controlCard}><span style={styles.controlText}>Put short credit</span><input value={position.entryPutShortCredit} onChange={(e) => setPosition((p) => ({ ...p, entryPutShortCredit: e.target.value }))} placeholder="optional" type="number" step="0.05" style={styles.input} /></label>
        <label style={styles.controlCard}><span style={styles.controlText}>Call short credit</span><input value={position.entryCallShortCredit} onChange={(e) => setPosition((p) => ({ ...p, entryCallShortCredit: e.target.value }))} placeholder="optional" type="number" step="0.05" style={styles.input} /></label>
      </div>

      {!report ? null : (
        <>
          {report.errors.length ? <ErrorPanel errors={report.errors} warning /> : null}
          <section style={styles.grid4NoMargin}>
            <MetricCard title="Position Status" value={report.status.toUpperCase()} tone={statusColor(report.status)} />
            <MetricCard title="Action" value={report.action} tone={statusColor(report.status)} />
            <MetricCard title="Open P/L Est." value={report.openPnl == null ? "—" : money(report.openPnl)} tone={report.openPnl != null && report.openPnl >= 0 ? "#34d399" : "#fb7185"} />
            <MetricCard title="Max Risk Est." value={money(report.maxRisk)} />
          </section>

          <section style={styles.grid3NoMargin}>
            <MetricCard title="Current Close Debit" value={report.currentCloseDebit == null ? "—" : fmt(report.currentCloseDebit)} />
            <MetricCard title="Breakevens" value={`${fmt(report.lowerBreakeven)} / ${fmt(report.upperBreakeven)}`} />
            <MetricCard title="Clock Phase" value={report.clock.sessionPhase.replace("_", " ").toUpperCase()} tone={report.clock.newEntryAllowed ? "#34d399" : "#fde047"} />
          </section>

          <section style={styles.grid2NoMargin}>
            <SideDefenseCard side={report.putSide} />
            <SideDefenseCard side={report.callSide} />
          </section>

          <div style={styles.managementBoxWide}>
            {report.managementPlan.map((line, idx) => <div key={idx}>• {line}</div>)}
          </div>
        </>
      )}
    </section>
  );
}

function SpxOiHistogram({ rows, rec }: { rows: SpxOiMapRow[]; rec: ZeroDteRecommendation }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.strike));

  if (chartRows.length < 2) return <div style={styles.chartEmpty}>Not enough SPX OI rows to draw the chain map.</div>;

  const width = 1120;
  const height = 330;
  const left = 46;
  const right = 30;
  const top = 28;
  const bottom = 42;
  const mid = 168;
  const minStrike = chartRows[0].strike;
  const maxStrike = chartRows[chartRows.length - 1].strike;
  const span = Math.max(maxStrike - minStrike, 1);
  const maxOi = Math.max(1, ...chartRows.map((row) => Math.max(row.callOi, row.putOi)));
  const barWidth = Math.max(4, Math.min(16, (width - left - right) / Math.max(chartRows.length * 2.6, 1)));
  const labelEvery = Math.max(1, Math.ceil(chartRows.length / 9));

  const x = (strike: number) => left + ((strike - minStrike) / span) * (width - left - right);
  const yCall = (oi: number) => mid - (oi / maxOi) * (mid - top);
  const yPut = (oi: number) => mid + (oi / maxOi) * (height - bottom - mid);

  const markers = [
    { label: "SPOT", strike: rec.spxPrice, color: "#f8fafc", dash: "4 4" },
    { label: "CENTER", strike: rec.suggestedCenter, color: "#fde047" },
    { label: "LOWER", strike: rec.lowerWing, color: "#fb7185", dash: "3 5" },
    { label: "UPPER", strike: rec.upperWing, color: "#34d399", dash: "3 5" },
    { label: "PIN", strike: rec.spx.strongestPin, color: "#67e8f9" },
    { label: "PUT WALL", strike: rec.spx.putWall, color: "#f472b6", dash: "6 4" },
    { label: "CALL WALL", strike: rec.spx.callWall, color: "#22c55e", dash: "6 4" },
  ].filter((marker) => typeof marker.strike === "number" && marker.strike >= minStrike && marker.strike <= maxStrike) as Array<{ label: string; strike: number; color: string; dash?: string }>;

  const topRows = [...chartRows].sort((a, b) => b.totalOi - a.totalOi).slice(0, 5).sort((a, b) => a.strike - b.strike);

  return (
    <div style={styles.chartShell}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="SPX open interest chain map" style={styles.chartSvg}>
        <rect x={0} y={0} width={width} height={height} rx={16} fill="#06111f" />
        {[0.25, 0.5, 0.75, 1].map((pct) => {
          const y1 = mid - pct * (mid - top);
          const y2 = mid + pct * (height - bottom - mid);
          return <g key={`grid-${pct}`}><line x1={left} x2={width - right} y1={y1} y2={y1} stroke="rgba(148,163,184,0.12)" /><line x1={left} x2={width - right} y1={y2} y2={y2} stroke="rgba(148,163,184,0.12)" /></g>;
        })}
        <line x1={left} x2={width - right} y1={mid} y2={mid} stroke="rgba(226,232,240,0.35)" />
        <text x={12} y={top + 8} fill="#67e8f9" fontSize={11} fontWeight={900}>CALL OI</text>
        <text x={12} y={height - bottom - 8} fill="#fb7185" fontSize={11} fontWeight={900}>PUT OI</text>

        {chartRows.map((row) => {
          const cx = x(row.strike);
          const callY = yCall(row.callOi);
          const putY = yPut(row.putOi);
          return <g key={`bars-${row.strike}`}><rect x={cx - barWidth - 1} y={callY} width={barWidth} height={mid - callY} rx={2} fill="rgba(34,211,238,0.78)" /><rect x={cx + 1} y={mid} width={barWidth} height={putY - mid} rx={2} fill="rgba(251,113,133,0.78)" />{row.spyAlignment === "aligned" || row.spyAlignment === "near" ? <circle cx={cx} cy={mid} r={row.spyAlignment === "aligned" ? 4 : 3} fill={row.spyAlignment === "aligned" ? "#34d399" : "#fde047"} opacity={0.95} /> : null}</g>;
        })}

        {markers.map((marker, idx) => {
          const mx = x(marker.strike);
          const labelY = 16 + (idx % 3) * 14;
          return <g key={`${marker.label}-${marker.strike}`}><line x1={mx} x2={mx} y1={top} y2={height - bottom} stroke={marker.color} strokeWidth={1.5} strokeDasharray={marker.dash} /><text x={mx + 4} y={labelY} fill={marker.color} fontSize={10} fontWeight={900}>{marker.label}</text></g>;
        })}

        {chartRows.map((row, idx) => idx % labelEvery === 0 || idx === chartRows.length - 1 ? <text key={`label-${row.strike}`} x={x(row.strike)} y={height - 14} fill="#93b5d9" fontSize={10} textAnchor="middle">{fmt(row.strike)}</text> : null)}
      </svg>

      <div style={styles.chartLegend}>
        <span><b style={{ color: "#67e8f9" }}>Cyan</b> call OI above baseline</span>
        <span><b style={{ color: "#fb7185" }}>Red</b> put OI below baseline</span>
        <span><b style={{ color: "#fde047" }}>Yellow</b> suggested IF center</span>
        <span><b style={{ color: "#34d399" }}>Green dot</b> SPY aligned/confirming</span>
      </div>

      <div style={styles.topStrikeStrip}>{topRows.map((row) => <div key={`top-${row.strike}`} style={styles.topStrikePill}><span>{fmt(row.strike)}</span><strong>{fmt(row.totalOi)}</strong></div>)}</div>
    </div>
  );
}

function SideDefenseCard({ side }: { side: IronFlySideReport }) {
  return (
    <div style={styles.panelCardTight}>
      <div style={styles.cardHeaderRow}>
        <h3 style={styles.sideTitle}>{side.side.toUpperCase()} SIDE</h3>
        <span style={{ ...styles.statusPill, color: statusColor(side.status), borderColor: statusColor(side.status) }}>{side.status.toUpperCase()}</span>
      </div>
      <div style={styles.oiLine}><span>Short / Long</span><strong>{fmt(side.shortStrike)} / {fmt(side.longStrike)}</strong></div>
      <div style={styles.oiLine}><span>Short mark</span><strong>{fmt(side.currentShortMark)}</strong></div>
      <div style={styles.oiLine}><span>Long mark</span><strong>{fmt(side.currentLongMark)}</strong></div>
      <div style={styles.oiLine}><span>Short mark multiple</span><strong>{side.shortMarkMultiple == null ? "—" : `${side.shortMarkMultiple.toFixed(2)}x`}</strong></div>
      <div style={styles.oiLine}><span>Distance to BE</span><strong>{fmt(side.distanceToBreakeven)}</strong></div>
      <div style={styles.managementBoxSmall}>{side.reasons.map((reason, idx) => <div key={idx}>• {reason}</div>)}</div>
    </div>
  );
}

function SpxMapRow({ row }: { row: SpxOiMapRow }) {
  const marks = [row.isPin ? "PIN" : null, row.isPutWall ? "PUT WALL" : null, row.isCallWall ? "CALL WALL" : null].filter(Boolean).join(" / ");
  return <tr style={styles.tr}><td style={styles.tdStrong}>{fmt(row.strike)}</td><td style={styles.td}>{marks || "—"}</td><td style={styles.td}>{fmt(row.callOi)}</td><td style={styles.td}>{fmt(row.putOi)}</td><td style={styles.td}>{fmt(row.totalOi)}</td><td style={styles.td}>{fmt(row.totalVolume)}</td><td style={styles.td}>{fmt(row.gammaWeight)}</td><td style={styles.td}>{row.sideBias} ({row.sideBiasPct > 0 ? "+" : ""}{row.sideBiasPct}%)</td><td style={styles.td}>{row.nearestSpyStrike ? `${fmt(row.nearestSpyStrike)} (${fmt(row.nearestSpyDistance)} pts)` : "—"}</td><td style={{ ...styles.td, color: alignmentColor(row.spyAlignment) }}>{row.spyAlignment}</td></tr>;
}

function SpyMapRow({ row }: { row: SpyAlignmentRow }) {
  return <tr style={styles.tr}><td style={styles.tdStrong}>{fmt(row.strike)}</td><td style={styles.td}>{row.nearestSpxStrike ? fmt(row.nearestSpxStrike) : "—"}</td><td style={styles.td}>{row.nearestSpxDistance !== null ? fmt(row.nearestSpxDistance) : "—"}</td><td style={styles.td}>{fmt(row.score)}</td><td style={styles.td}>{fmt(row.spxScore)}</td><td style={{ ...styles.td, color: alignmentColor(row.alignment) }}>{row.alignment}</td></tr>;
}

function ErrorPanel({ errors, warning }: { errors: string[]; warning?: boolean }) {
  return <section style={warning ? styles.warningPanel : styles.errorPanel}><h2 style={styles.sectionTitle}>{warning ? "Harvest Warning" : "Harvest Error"}</h2>{errors.map((err, idx) => <p key={idx} style={styles.errorText}>{err}</p>)}</section>;
}

function QualityPanel({ checks }: { checks: QualityCheck[] }) {
  return <section style={styles.tableCard}><h2 style={styles.sectionTitle}>Data Quality / Sanity Checks</h2><div style={styles.qualityGrid}>{checks.map((check) => <div key={`${check.label}-${check.message}`} style={styles.qualityCard}><div style={styles.qualityTopLine}><span style={styles.smallCaps}>{check.label}</span><span style={qualityStyle(check.status)}>{check.status.toUpperCase()}</span></div><div style={styles.muted}>{check.message}</div></div>)}</div></section>;
}

function MetricCard({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return <div style={styles.metricCard}><div style={styles.smallCaps}>{title}</div><div style={{ ...styles.metricValue, color: tone ?? "#f8fafc" }}>{value}</div></div>;
}

function SetupBox({ label, value, sub, highlight }: { label: string; value: string | number; sub: string; highlight?: boolean }) {
  return <div style={highlight ? styles.setupBoxHighlight : styles.setupBox}><div style={styles.smallCaps}>{label}</div><div style={styles.setupValue}>{value}</div><div style={styles.muted}>{sub}</div></div>;
}

function DealerPressureEnginePanel({ rec }: { rec: ZeroDteRecommendation }) {
  const summary = rec.dealerPressureRead?.summary;
  if (!summary) {
    return (
      <section style={styles.panelCardInline}>
        <div style={styles.cardHeaderRowNoMargin}>
          <div>
            <h2 style={styles.sectionTitle}>Dealer Pressure Engine</h2>
            <p style={styles.muted}>Using local fallback pressure because dealer-pressure-engine did not return a usable summary.</p>
          </div>
          <div style={styles.sourceText}>source: {rec.dealerPressureSource}</div>
        </div>
      </section>
    );
  }

  return (
    <section style={styles.panelCardInline}>
      <div style={styles.cardHeaderRowNoMargin}>
        <div>
          <h2 style={styles.sectionTitle}>Dealer Pressure Engine</h2>
          <p style={styles.muted}>{summary.interpretation}</p>
        </div>
        <div style={styles.sourceText}>source: {rec.dealerPressureSource}</div>
      </div>

      <div style={styles.grid4NoMarginTight}>
        <MetricCard title="Regime" value={summary.regime} />
        <MetricCard title="Hedge Bias" value={summary.hedgeFlowBias.toUpperCase()} />
        <MetricCard title="Pin / Snap" value={`${Math.round(summary.pinRiskScore)} / ${Math.round(summary.snapRiskScore)}`} />
        <MetricCard title="Engine Confidence" value={`${Math.round(summary.confidenceScore)}%`} tone={scoreTone(summary.confidenceScore)} />
      </div>
    </section>
  );
}

function OiCard({ title, data }: { title: string; data: ZeroDteRecommendation["spx"] }) {
  return <div style={styles.panelCard}><h2 style={styles.sectionTitle}>{title}</h2><div style={styles.oiLine}><span>Gravity</span><strong>{fmt(data.gravity)}</strong></div><div style={styles.oiLine}><span>Strongest Pin</span><strong>{fmt(data.strongestPin)}</strong></div><div style={styles.oiLine}><span>Put Wall</span><strong>{fmt(data.putWall)}</strong></div><div style={styles.oiLine}><span>Call Wall</span><strong>{fmt(data.callWall)}</strong></div><div style={styles.oiLine}><span>OI Strength</span><strong>{data.oiStrength}%</strong></div><div style={styles.oiLine}><span>Symmetry</span><strong>{data.symmetryScore}%</strong></div><div style={styles.oiLine}><span>Call/Put Imbalance</span><strong>{data.callPutImbalance > 0 ? "+" : ""}{data.callPutImbalance}%</strong></div></div>;
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  return <div style={styles.scoreBadge}><div style={styles.smallCaps}>{label}</div><div style={{ ...styles.scoreValue, color: scoreTone(score) }}>{score}</div></div>;
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
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

function statusColor(status: IronFlyPositionReport["status"] | IronFlySideReport["status"]) {
  if (status === "safe") return "#34d399";
  if (status === "watch") return "#67e8f9";
  if (status === "pressure") return "#fde047";
  if (status === "defend") return "#fb923c";
  return "#fb7185";
}

function alignmentColor(value: "aligned" | "near" | "none") {
  if (value === "aligned") return "#34d399";
  if (value === "near") return "#fde047";
  return "#94a3b8";
}

function statusStyle(status?: HarvestResponse["status"]): React.CSSProperties {
  return { fontSize: 16, fontWeight: 900, color: status === "ok" ? "#34d399" : status === "partial" ? "#fde047" : status === "error" ? "#fb7185" : "#94a3b8" };
}

function qualityStyle(status: QualityCheck["status"]): React.CSSProperties {
  return { color: status === "ok" ? "#34d399" : status === "warn" ? "#fde047" : "#fb7185", fontWeight: 900 };
}

const styles: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100vh", display: "flex", background: "#07111f", color: "#f8fafc" },
  main: { flex: 1, minWidth: 0, padding: 24, maxWidth: 1500, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, borderBottom: "1px solid rgba(56,189,248,0.24)", paddingBottom: 18, marginBottom: 16 },
  eyebrow: { color: "#22d3ee", fontSize: 12, fontWeight: 900, letterSpacing: "0.32em", textTransform: "uppercase" },
  title: { margin: "6px 0 4px", fontSize: 34, lineHeight: 1.05, fontWeight: 950 },
  subtitle: { maxWidth: 900, margin: 0, color: "#cbd5e1", fontSize: 14, lineHeight: 1.5 },
  primaryButton: { background: "#0e7490", color: "white", border: "1px solid #22d3ee", borderRadius: 10, padding: "12px 18px", fontWeight: 900, cursor: "pointer" },
  secondaryButton: { background: "#0f2235", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.45)", borderRadius: 10, padding: "10px 14px", fontWeight: 900, cursor: "pointer" },
  controlsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 },
  controlCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 14, display: "grid", gap: 8 },
  checkboxCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 14, display: "grid", gap: 10 },
  checkboxRow: { display: "flex", gap: 8, alignItems: "center", color: "#cbd5e1", fontSize: 13 },
  controlText: { color: "#93b5d9", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" },
  input: { width: "100%", background: "#07111f", color: "#f8fafc", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" },
  statusBox: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 14 },
  statusTitle: { color: "#93b5d9", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 },
  timestamp: { color: "#94a3b8", fontSize: 12, marginTop: 6 },
  warningPanel: { border: "1px solid #a16207", background: "#2b170d", borderRadius: 16, padding: 18, marginBottom: 16 },
  errorPanel: { border: "1px solid #be123c", background: "#230914", borderRadius: 16, padding: 18, marginBottom: 16 },
  errorText: { color: "#fecdd3", margin: "8px 0", lineHeight: 1.5 },
  emptyCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 16, padding: 20 },
  chartCard: { border: "1px solid rgba(34,211,238,0.28)", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  chartShell: { display: "grid", gap: 12 },
  chartSvg: { width: "100%", height: "auto", display: "block", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 16, background: "#06111f" },
  chartEmpty: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 16, color: "#94a3b8" },
  chartLegend: { display: "flex", flexWrap: "wrap", gap: 12, color: "#94a3b8", fontSize: 12 },
  topStrikeStrip: { display: "flex", flexWrap: "wrap", gap: 8 },
  topStrikePill: { display: "flex", gap: 8, alignItems: "center", border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 999, padding: "6px 10px", color: "#cbd5e1", fontSize: 12 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 16 },
  grid4NoMargin: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, margin: "16px 0" },
  grid4NoMarginTight: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, margin: "14px 0 0" },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 16 },
  grid3NoMargin: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, margin: "0 0 16px" },
  grid2NoMargin: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, margin: "0 0 16px" },
  heroGrid: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 },
  heroCard: { border: "1px solid rgba(34,211,238,0.28)", background: "#0b1b2b", borderRadius: 18, padding: 18 },
  panelCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 18, padding: 18 },
  panelCardInline: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  panelCardTight: { border: "1px solid #1e3a5f", background: "#071827", borderRadius: 16, padding: 14 },
  cockpitCard: { border: "1px solid rgba(253,224,71,0.35)", background: "#111827", borderRadius: 18, padding: 18, marginBottom: 16 },
  cardHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 },
  cardHeaderRowNoMargin: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 0 },
  sectionTitle: { margin: 0, fontSize: 20, fontWeight: 900 },
  sideTitle: { margin: 0, fontSize: 15, fontWeight: 950, letterSpacing: "0.08em" },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.45 },
  sourceText: { color: "#93b5d9", fontSize: 12, textAlign: "right" },
  flyGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 },
  setupBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  setupBoxHighlight: { border: "1px solid rgba(253,224,71,0.55)", background: "rgba(253,224,71,0.08)", borderRadius: 14, padding: 14 },
  setupValue: { marginTop: 6, fontSize: 28, fontWeight: 950 },
  structureBox: { marginTop: 14, border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  structureText: { marginTop: 4, fontSize: 26, color: "#67e8f9", fontWeight: 950 },
  managementBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14, color: "#e2e8f0", lineHeight: 1.5, marginTop: 12 },
  managementBoxWide: { border: "1px solid #334155", background: "#07111f", borderRadius: 14, padding: 14, color: "#e2e8f0", lineHeight: 1.65 },
  managementBoxSmall: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 12, padding: 12, color: "#cbd5e1", lineHeight: 1.5, fontSize: 12, marginTop: 10 },
  notesList: { display: "grid", gap: 8, color: "#cbd5e1", fontSize: 13, lineHeight: 1.45, marginTop: 12 },
  metricCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 16, padding: 16, minHeight: 84 },
  smallCaps: { color: "#93b5d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" },
  metricValue: { marginTop: 8, fontSize: 24, fontWeight: 950, overflowWrap: "anywhere" },
  scoreBadge: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: "10px 14px", minWidth: 94, textAlign: "center" },
  scoreValue: { fontSize: 28, fontWeight: 950 },
  oiLine: { display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(148,163,184,0.12)", padding: "9px 0", color: "#cbd5e1", fontSize: 13 },
  positionGrid: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 },
  tableCard: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: "#93b5d9", borderBottom: "1px solid #1e3a5f", padding: "10px 8px", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(148,163,184,0.10)" },
  td: { padding: "10px 8px", color: "#cbd5e1", whiteSpace: "nowrap" },
  tdStrong: { padding: "10px 8px", color: "#67e8f9", fontWeight: 900, whiteSpace: "nowrap" },
  qualityGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 },
  qualityCard: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 12 },
  qualityTopLine: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  statusPill: { border: "1px solid", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 950 },
};
