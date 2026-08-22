"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildHistoricalFootprintStudy,
  type HistoricalEsCandle,
} from "../lib/zeroDteHistoricalFootprint";
import {
  buildHistoricalAuctionAnalytics,
  evaluateAuctionConfluence,
  latestAuctionMinuteAtOrBefore,
  type AuctionConfluenceEvaluation,
  type AuctionConfluenceTier,
  type HistoricalAuctionMinute,
  type HistoricalAuctionSummary,
} from "../lib/zeroDteAuctionAnalytics";
import { loadZeroDteShadowTrades } from "../lib/zeroDteShadowRepository";
import { authenticatedApiHeaders } from "../lib/auth/authenticated-api";
import type { ZeroDteShadowTrade } from "../lib/zeroDteShadowTrade";

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
  spxSymbol?: string;
  spxPreviousClose?: number | null;
  spxCandleCount?: number;
  spxCandles?: HistoricalEsCandle[];
  basisFailure?: string | null;
  limitations?: {
    trueTimeAndSales?: boolean;
    historicalBidAskVolume?: boolean;
    fullDepth?: boolean;
    reconstruction?: string;
    esSpxBasis?: boolean;
  };
  note?: string;
  error?: string;
  failures?: string[];
};

type Aggregation = 1 | 5 | 15 | 30;
type SessionMode = "RTH" | "FULL";

export default function EsHistoricalFootprintLab() {
  const [date, setDate] = useState("2026-08-14");
  const [symbol, setSymbol] = useState("");
  const [aggregation, setAggregation] = useState<Aggregation>(1);
  const [session, setSession] = useState<SessionMode>("RTH");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shadowTrades, setShadowTrades] = useState<ZeroDteShadowTrade[]>([]);
  const [shadowError, setShadowError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setShadowError(null);
    const shadowPromise = loadZeroDteShadowTrades(date)
      .then((trades) => setShadowTrades(trades))
      .catch((shadowLoadError) => {
        setShadowTrades([]);
        setShadowError(
          shadowLoadError instanceof Error ? shadowLoadError.message : String(shadowLoadError),
        );
      });
    try {
      const params = new URLSearchParams({ date });
      if (symbol.trim()) params.set("symbol", symbol.trim());
      const res = await fetch(`/api/zero-dte/es-history?${params.toString()}`, {
        headers: await authenticatedApiHeaders(),
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
      await shadowPromise;
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

  const auction = useMemo(() => {
    if (!response?.ok || !response.candles?.length) return null;
    return buildHistoricalAuctionAnalytics({
      candles: response.candles,
      date,
      session,
    });
  }, [response, date, session]);

  return (
    <section style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Experimental · historical reconstruction</div>
          <h1 style={styles.title}>ES Historical Footprint Lab</h1>
          <p style={styles.subtitle}>
            Requests Schwab 1-minute ES/SPX history and reconstructs auction structure from OHLCV. The matrix is a reconstructed volume-at-price study; it does not claim historical bid/ask Time &amp; Sales.
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
            <option value={1}>1 minute</option>
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

      {auction?.minutes.length ? (
        <>
          <AuctionEnginePanel auction={auction} />
          <SignalConfluencePanel
            auction={auction}
            trades={shadowTrades}
            spxCandles={response?.spxCandles ?? []}
            basisFailure={response?.basisFailure ?? null}
            error={shadowError}
          />
        </>
      ) : null}

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
            <span><b>Cell:</b> reconstructed volume-at-price; tint = candle-shape proxy</span>
            <span><b>POC:</b> highest reconstructed volume price</span>
            <span><b>HVN:</b> top 20% profile levels</span>
            <span><b>LVN:</b> bottom 20% visited profile levels</span>
            <span><b>VA:</b> ~70% reconstructed volume area</span>
          </div>
          <FootprintMatrix study={study} auction={auction} />
          <div style={styles.disclaimer}>
            Reconstruction method: each 1-minute Schwab OHLCV candle is distributed across the 0.25-point ES prices it traversed, weighted toward the candle body/close. Cell tint is a candle-shape proxy only. This can study POC/HVN/LVN, value migration, acceptance, stall, rejection and path efficiency, but it cannot reproduce historical trade-side order flow without a tape.
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
  const basis = buildBasisSummary(response?.candles ?? [], response?.spxCandles ?? []);
  const metrics = [
    ["Source", loading ? "testing" : response?.provider ?? "—"],
    ["ES symbol", response?.symbol ?? response?.contractCandidate ?? "—"],
    ["ES 1m", response?.candleCount == null ? "—" : integer(response.candleCount)],
    ["SPX 1m", response?.spxCandleCount == null ? "—" : integer(response.spxCandleCount)],
    ["Session candles", study ? integer(study.candleCount) : "—"],
    ["POC proxy", study?.poc == null ? "—" : study.poc.toFixed(2)],
    ["ES-SPX basis", basis.median == null ? "—" : `${signed(basis.median, 2)} pts`],
    ["Basis coverage", basis.coveragePct == null ? "—" : `${basis.coveragePct.toFixed(0)}%`],
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


function AuctionEnginePanel({ auction }: { auction: HistoricalAuctionSummary }) {
  const significant = auction.minutes.filter(
    (minute) => minute.state !== "WARMING" && minute.state !== "BALANCED",
  );
  const releaseCount = auction.featureCounts.release;
  const stallCount = auction.featureCounts.stall;
  const exhaustionCount = auction.featureCounts.exhaustion;
  const rejectionCount = auction.featureCounts.rejection;
  const bestCall = auction.topCallFade[0] ?? null;
  const bestPut = auction.topPutFade[0] ?? null;
  const bestCenter = auction.topCenters[0] ?? null;

  return (
    <div style={styles.auctionCard}>
      <div style={styles.auctionHeader}>
        <div>
          <div style={styles.auctionEyebrow}>Auction analytics engine · historical replay</div>
          <strong style={styles.auctionTitle}>Terrain + participation + efficiency + failure to progress</strong>
        </div>
        <span style={styles.advisoryBadge}>ADVISORY / RESEARCH</span>
      </div>

      <div style={styles.auctionMetrics}>
        <AuctionMetric label="Acceptance" value={auction.featureCounts.acceptance} />
        <AuctionMetric label="Release" value={releaseCount} />
        <AuctionMetric label="Stall" value={stallCount} />
        <AuctionMetric label="Exhaustion" value={exhaustionCount} />
        <AuctionMetric label="Rejection" value={rejectionCount} />
        <AuctionMetric
          label="Best call fade"
          value={bestCall ? `${Math.round(bestCall.callFadeScore)} · ${bestCall.label}` : "—"}
        />
        <AuctionMetric
          label="Best put fade"
          value={bestPut ? `${Math.round(bestPut.putFadeScore)} · ${bestPut.label}` : "—"}
        />
        <AuctionMetric
          label="Best center"
          value={bestCenter ? `${Math.round(bestCenter.centerConfidence)} · ${bestCenter.developingPoc.toFixed(2)}` : "—"}
        />
      </div>

      <div style={styles.engineFormula}>
        <b style={{ color: "#ffb454" }}>Data provenance:</b> this study is built from OHLCV bars only. There is no bid/ask tape.
        The &ldquo;footprint&rdquo; cells are synthesised from candle geometry, and the shape proxy reduces exactly to
        <code style={{ margin: "0 4px" }}>56 &times; body + 34 &times; closeLocation</code> &mdash; volume cancels out, so it carries
        no information beyond OHLC. It is <b>not</b> order-flow delta and is never scored as evidence independent of candle shape.
        <br />
        <b>Volume-derived (independent):</b> developing POC · POC migration · HVN/LVN nodes · above/below POC · volume/range &sigma; · 5m path efficiency.
        <br />
        <b>Shape-derived (one family):</b> shape proxy · failed extreme · shape reversal · wicks · stall · exhaustion · rejection · acceptance.
        <br />
        True absorption requires trade-side classification and is not claimed here; the former ABSORPTION states are now named STALL.
      </div>

      <div style={styles.timelineFrame}>
        <div style={styles.timelineHeaderRow}>
          <span>Time</span><span>State</span><span>Px / POC</span><span>Node</span><span>Shape</span><span>Vol σ</span><span>Eff</span><span>Call fade</span><span>Put fade</span><span>Center</span><span>Features</span>
        </div>
        <div style={styles.timelineScroller}>
          {significant.length ? significant.map((minute) => (
            <div key={minute.time} style={styles.timelineRow}>
              <strong>{minute.label}</strong>
              <span style={auctionStateStyle(minute.state)}>{shortAuctionState(minute.state)} {Math.round(minute.stateScore)}</span>
              <span>{minute.close.toFixed(2)} / {minute.developingPoc.toFixed(2)}</span>
              <span>{minute.node}</span>
              <span title="Synthetic shape proxy, not order-flow delta">{signed(minute.shapeProxyPct, 0)}%</span>
              <span>{signed(minute.volumeZ, 1)}σ</span>
              <span>{Math.round(minute.efficiency5mPct)}%</span>
              <strong>{Math.round(minute.callFadeScore)}</strong>
              <strong>{Math.round(minute.putFadeScore)}</strong>
              <strong>{Math.round(minute.centerConfidence)}</strong>
              <span style={styles.featureText}>{minute.features.join(" · ") || "—"}</span>
            </div>
          )) : <div style={styles.timelineEmpty}>No significant auction states cleared the research thresholds.</div>}
        </div>
      </div>
    </div>
  );
}

function AuctionMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.auctionMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SignalConfluencePanel({
  auction,
  trades,
  spxCandles,
  basisFailure,
  error,
}: {
  auction: HistoricalAuctionSummary;
  trades: ZeroDteShadowTrade[];
  spxCandles: HistoricalEsCandle[];
  basisFailure: string | null;
  error: string | null;
}) {
  const matches = trades.map((trade) => {
    const epoch = trade.signalCandleTime > 0
      ? trade.signalCandleTime
      : Math.max(0, Math.floor(Date.parse(trade.signalTime) / 1000) - 60);
    // Causal attribution only: never use an ES minute after SELL_READY.
    const minute = latestAuctionMinuteAtOrBefore(auction.minutes, epoch, 90);
    const target = trade.strategy === "call-credit-spread"
      ? "CALL_FADE" as const
      : trade.strategy === "put-credit-spread"
        ? "PUT_FADE" as const
        : "CENTER" as const;
    const confluence = evaluateAuctionConfluence(minute, target);
    const spxMinute = minute
      ? latestHistoricalCandleAtOrBefore(spxCandles, minute.time, 90)
      : null;
    const basis = minute && spxMinute ? minute.close - spxMinute.close : null;
    const projectedPoc = minute && basis != null ? minute.developingPoc - basis : null;
    const referenceStrike = tradeReferenceStrike(trade);
    const pocDistance = projectedPoc != null && referenceStrike != null
      ? referenceStrike - projectedPoc
      : null;
    return { trade, minute, confluence, basis, projectedPoc, referenceStrike, pocDistance };
  });

  const tierStats = buildTierStats(matches);
  const episodes = buildAuctionEpisodes(matches);

  return (
    <div style={styles.confluenceCard}>
      <div style={styles.auctionHeader}>
        <div>
          <div style={styles.auctionEyebrow}>WheelDesk signal correlation</div>
          <strong style={styles.auctionTitle}>Did the ES auction agree with SELL_READY?</strong>
        </div>
        <span style={styles.advisoryBadge}>{trades.length} PERSISTED SIGNAL{trades.length === 1 ? "" : "S"}</span>
      </div>

      <div style={styles.confluenceExplainer}>
        Confluence compares the trade-side auction score against the opposite side, measures the directional edge, and checks
        the auction state / shape / POC narrative. Evidence is grouped into two <b>independent families</b> &mdash; SHAPE (candle
        geometry) and VOLUME (POC and node distribution) &mdash; and correlated members inside a family are collapsed rather than
        summed, so one candle cannot be counted three times. <b>DEFINITIVE requires both families to agree.</b>
        <b style={{ color: "#ffb454" }}> LATE</b> marks a read where the move being faded has already released; those are capped at
        SUPPORTIVE. Historical matching is <b>causal</b>: only the latest completed ES minute at or before SELL_READY may be used.
        When Schwab SPX history is available, ES POC is projected onto the SPX scale using the contemporaneous ES-SPX basis.
        This is a research conviction tier, not position sizing or execution wiring.
      </div>
      {basisFailure ? <div style={styles.confluenceNote}>ES→SPX basis unavailable: {basisFailure}. State correlation remains valid; level-distance analysis is disabled.</div> : null}

      {tierStats.length ? (
        <div style={styles.tierSummaryGrid}>
          {tierStats.map((stat) => (
            <div key={stat.tier} style={styles.tierSummaryCard}>
              <span style={confluenceStyle(stat.tier)}>{stat.tier.replaceAll("_", " ")}</span>
              <strong>{stat.count} signal{stat.count === 1 ? "" : "s"}</strong>
              <small>{stat.closed ? `${stat.closed} closed · ${money(stat.pnl)}` : "no closed result"}</small>
              {stat.closed ? <small>MAE {money(stat.avgMae)} · MFE {money(stat.avgMfe)} · peak {stat.avgPeakCapture.toFixed(0)}%</small> : null}
            </div>
          ))}
        </div>
      ) : null}

      {episodes.length ? (
        <div style={styles.episodeStrip}>
          <strong>{episodes.length} auction episode{episodes.length === 1 ? "" : "s"}</strong>
          <span>{trades.length} signal rows are grouped so repeated entries around the same structure are not mistaken for independent evidence.</span>
          {episodes.slice(0, 8).map((episode) => (
            <small key={episode.key}>
              {episode.label}: {episode.count} signal{episode.count === 1 ? "" : "s"} · peak {episode.peakTier} {Math.round(episode.peakConviction)}
            </small>
          ))}
        </div>
      ) : null}

      {error ? <div style={styles.confluenceNote}>Shadow signal history could not load: {error}</div> : null}
      {!trades.length && !error ? (
        <div style={styles.confluenceNote}>No persisted Shadow Lab SELL signals were found for this date. Auction analytics still runs independently.</div>
      ) : null}
      {matches.length ? (
        <div style={styles.signalGridScroller}>
          <div style={styles.signalGrid}>
            {matches.map(({ trade, minute, confluence, basis, projectedPoc, pocDistance }) => (
              <div key={trade.id} style={styles.signalRow}>
                <div>
                  <strong>{trade.strategy === "call-credit-spread" ? "CALL CREDIT" : trade.strategy === "put-credit-spread" ? "PUT CREDIT" : "IRON FLY"}</strong>
                  <span>{formatTradeLegs(trade)} · engine {Math.round(trade.entryScore)}</span>
                </div>
                <div>
                  <span>SELL</span>
                  <strong>{minute?.label ?? new Date(trade.signalTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>
                </div>
                <div>
                  <span>{confluence.target === "CENTER" ? "Center" : "Own"}</span>
                  <strong>{Math.round(confluence.ownScore)}</strong>
                </div>
                <div>
                  <span>{confluence.target === "CENTER" ? "Directional" : "Opp"}</span>
                  <strong>{Math.round(confluence.opposingScore)}</strong>
                </div>
                <div>
                  <span>Edge</span>
                  <strong style={edgeStyle(confluence.edge)}>{signed(confluence.edge, 0)}</strong>
                </div>
                <div>
                  <span>Conviction</span>
                  <strong>{Math.round(confluence.convictionScore)}</strong>
                </div>
                <div>
                  <span>State</span>
                  <strong>{minute ? shortAuctionState(minute.state) : "—"}</strong>
                </div>
                <div>
                  <span>Families</span>
                  <strong title="Independent evidence families agreeing (max 2 without a tape)">
                    {confluence.independentFamilies}/2
                  </strong>
                </div>
                <div style={styles.confluenceStat}>
                  <span>Timing</span>
                  <strong style={confluence.timing === "LATE" ? { color: "#ffb454", fontWeight: 800 } : undefined}>
                    {confluence.timing}
                  </strong>
                </div>
                <div style={styles.confluenceStat}>
                  <span>Confluence</span>
                  <strong style={confluenceStyle(confluence.tier)}>{confluence.tier.replaceAll("_", " ")}</strong>
                </div>
                <div>
                  <span>Basis</span>
                  <strong>{basis == null ? "—" : signed(basis, 2)}</strong>
                </div>
                <div>
                  <span>SPX POC</span>
                  <strong>{projectedPoc == null ? "—" : projectedPoc.toFixed(2)}</strong>
                  {pocDistance == null ? null : <small>{signed(pocDistance, 1)} from ref</small>}
                </div>
                <div>
                  <span>Result</span>
                  <strong>{trade.pnlConservativeDollars == null ? (trade.state === "open" ? "OPEN" : "—") : money(trade.pnlConservativeDollars)}</strong>
                </div>
                <div style={styles.signalFeatureCell}>
                  <span>Narrative</span>
                  <strong>{confluence.summary}</strong>
                  {confluence.opposingEvidence.length ? (
                    <small style={styles.opposingText}>Opp: {confluence.opposingEvidence.slice(0, 3).join(" · ")}</small>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildTierStats(
  matches: Array<{ trade: ZeroDteShadowTrade; confluence: AuctionConfluenceEvaluation }>,
) {
  const order: AuctionConfluenceTier[] = [
    "DEFINITIVE",
    "CONFIRMED",
    "SUPPORTIVE",
    "MIXED",
    "NEUTRAL",
    "INSUFFICIENT",
    "CONFLICT",
    "NO_MATCH",
  ];
  return order.flatMap((tier) => {
    const rows = matches.filter((match) => match.confluence.tier === tier);
    if (!rows.length) return [];
    const closed = rows.filter((row) => row.trade.pnlConservativeDollars != null);
    const peakCaptureRows = closed
      .map((row) => peakCapturePct(row.trade))
      .filter((value): value is number => value != null);
    return [{
      tier,
      count: rows.length,
      closed: closed.length,
      pnl: closed.reduce((sum, row) => sum + (row.trade.pnlConservativeDollars ?? 0), 0),
      avgMae: average(closed.map((row) => -Math.abs(row.trade.maxAdverseExcursionDollars))),
      avgMfe: average(closed.map((row) => Math.max(0, row.trade.maxFavorableExcursionDollars))),
      avgPeakCapture: average(peakCaptureRows),
    }];
  });
}

function FootprintMatrix({
  study,
  auction,
}: {
  study: ReturnType<typeof buildHistoricalFootprintStudy>;
  auction: HistoricalAuctionSummary | null;
}) {
  const prices = study.profile.map((level) => level.price);
  const profileByPrice = new Map(study.profile.map((level) => [level.price, level]));
  const bucketMaps = study.buckets.map(
    (bucket) => new Map(bucket.cells.map((cell) => [cell.price, cell])),
  );
  const auctionByTime = new Map(
    (auction?.minutes ?? []).map((minute) => [minute.time, minute]),
  );
  const maxCell = Math.max(
    1,
    ...study.buckets.flatMap((bucket) => bucket.cells.map((cell) => cell.totalVolume)),
  );
  const maxProfile = Math.max(1, ...study.profile.map((level) => level.totalVolume));
  const bucketWidth = study.buckets.length > 150 ? 92 : 116;
  const columns = `72px repeat(${study.buckets.length}, ${bucketWidth}px) 160px`;

  return (
    <div style={styles.matrixFrame}>
      <div style={styles.matrixScroller}>
        <div style={{ ...styles.matrix, gridTemplateColumns: columns }}>
          <div style={{ ...styles.corner, ...styles.stickyHeader, ...styles.stickyLeft }}>PRICE</div>
          {study.buckets.map((bucket) => {
            const auctionMinute =
              bucket.endTime - bucket.startTime <= 61
                ? auctionByTime.get(bucket.startTime) ?? null
                : null;
            return (
              <div key={bucket.key} style={{ ...styles.bucketHeader, ...styles.stickyHeader }}>
                <strong>{bucket.label}</strong>
                <span>{bucket.open.toFixed(2)} → {bucket.close.toFixed(2)}</span>
                <span>H {bucket.high.toFixed(2)} · L {bucket.low.toFixed(2)}</span>
                {auctionMinute ? (
                  <span style={auctionStateStyle(auctionMinute.state)}>
                    {shortAuctionState(auctionMinute.state)} · {Math.round(auctionMinute.stateScore)}
                  </span>
                ) : null}
              </div>
            );
          })}
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
  cell?: { totalVolume: number; shapeProxy: number };
  maxCell: number;
  poc: boolean;
}) {
  if (!cell || cell.totalVolume <= 0) return <div style={styles.blankCell}>·</div>;
  const strength = Math.min(1, cell.totalVolume / maxCell);
  const shapePct = cell.totalVolume > 0 ? cell.shapeProxy / cell.totalVolume : 0;
  const positive = shapePct >= 0;
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
      title={`Reconstructed volume ${Math.round(cell.totalVolume)} · candle-shape proxy ${signed(shapePct * 100, 0)}% · NOT trade-side volume`}
    >
      <strong>{compact(cell.totalVolume)}</strong>
      <small>S {signed(shapePct * 100, 0)}%</small>
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


function shortAuctionState(state: HistoricalAuctionMinute["state"]) {
  switch (state) {
    case "RELEASE_UP": return "REL ↑";
    case "RELEASE_DOWN": return "REL ↓";
    case "STALL_HIGH": return "STALL HI";
    case "STALL_LOW": return "STALL LO";
    case "EXHAUSTION_UP": return "EXH ↑";
    case "EXHAUSTION_DOWN": return "EXH ↓";
    case "REJECTION_HIGH": return "REJ HIGH";
    case "REJECTION_LOW": return "REJ LOW";
    case "ACCEPTANCE": return "ACCEPT";
    case "BALANCED": return "BAL";
    default: return "WARM";
  }
}

function auctionStateStyle(state: HistoricalAuctionMinute["state"]): React.CSSProperties {
  if (state === "REJECTION_HIGH" || state === "EXHAUSTION_UP" || state === "STALL_HIGH") return { color: "#ff9b8e", fontWeight: 800 };
  if (state === "REJECTION_LOW" || state === "EXHAUSTION_DOWN" || state === "STALL_LOW") return { color: "#72e6bf", fontWeight: 800 };
  if (state === "RELEASE_UP" || state === "RELEASE_DOWN") return { color: "#68c8ff", fontWeight: 800 };
  if (state === "ACCEPTANCE") return { color: "#ffd166", fontWeight: 800 };
  return { color: "#879bb0", fontWeight: 700 };
}

function confluenceStyle(value: string): React.CSSProperties {
  if (value === "DEFINITIVE") return { color: "#62e8b8", fontWeight: 900 };
  if (value === "CONFIRMED") return { color: "#80eac4", fontWeight: 800 };
  if (value === "SUPPORTIVE") return { color: "#ffd166", fontWeight: 800 };
  if (value === "MIXED") return { color: "#f0a7ff", fontWeight: 800 };
  if (value === "CONFLICT") return { color: "#ff837b", fontWeight: 900 };
  if (value === "INSUFFICIENT") return { color: "#6f8296", fontStyle: "italic" };
  return { color: "#91a4b8" };
}

function edgeStyle(value: number): React.CSSProperties {
  if (value >= 15) return { color: "#62e8b8" };
  if (value <= -10) return { color: "#ff837b" };
  return { color: "#91a4b8" };
}

function formatTradeLegs(trade: ZeroDteShadowTrade) {
  const sold = trade.legs.filter((leg) => leg.action === "sell").map((leg) => leg.strike);
  const bought = trade.legs.filter((leg) => leg.action === "buy").map((leg) => leg.strike);
  if (trade.strategy === "iron-fly") {
    const center = sold[0];
    return center == null ? trade.label : `center ${center} · wings ${bought.sort((a, b) => a - b).join("/")}`;
  }
  return [...sold, ...bought].filter((value) => Number.isFinite(value)).join("/") || trade.label;
}

function latestHistoricalCandleAtOrBefore(
  candles: HistoricalEsCandle[],
  epochSeconds: number,
  toleranceSeconds = 90,
) {
  let best: HistoricalEsCandle | null = null;
  let bestLag = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    if (candle.time > epochSeconds) continue;
    const lag = epochSeconds - candle.time;
    if (lag < bestLag) {
      best = candle;
      bestLag = lag;
    }
  }
  return best && bestLag <= toleranceSeconds ? best : null;
}

function buildBasisSummary(esCandles: HistoricalEsCandle[], spxCandles: HistoricalEsCandle[]) {
  if (!esCandles.length || !spxCandles.length) {
    return { median: null as number | null, coveragePct: null as number | null };
  }
  const orderedSpx = [...spxCandles].sort((a, b) => a.time - b.time);
  const firstSpx = orderedSpx[0]?.time ?? 0;
  const lastSpx = orderedSpx.at(-1)?.time ?? 0;
  const eligibleEs = esCandles.filter((candle) => candle.time >= firstSpx && candle.time <= lastSpx);
  const values: number[] = [];
  for (const es of eligibleEs) {
    const spx = latestHistoricalCandleAtOrBefore(orderedSpx, es.time, 90);
    if (spx) values.push(es.close - spx.close);
  }
  if (!values.length) return { median: null, coveragePct: 0 };
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
  return { median, coveragePct: eligibleEs.length ? (values.length / eligibleEs.length) * 100 : 0 };
}

function tradeReferenceStrike(trade: ZeroDteShadowTrade) {
  if (trade.strategy === "iron-fly") return Number.isFinite(trade.entryMapCenter) ? trade.entryMapCenter : null;
  const optionType = trade.strategy === "call-credit-spread" ? "call" : "put";
  const short = trade.entryShortLegs.find((leg) => leg.optionType === optionType);
  if (short && Number.isFinite(short.strike)) return short.strike;
  const sellLeg = trade.legs.find((leg) => leg.action === "sell" && leg.optionType === optionType);
  return sellLeg && Number.isFinite(sellLeg.strike) ? sellLeg.strike : null;
}

function peakCapturePct(trade: ZeroDteShadowTrade) {
  if (!(trade.entrySellableCredit > 0) || trade.minBuybackDebit == null) return null;
  return Math.max(0, Math.min(100, ((trade.entrySellableCredit - trade.minBuybackDebit) / trade.entrySellableCredit) * 100));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

type EpisodeMatch = {
  trade: ZeroDteShadowTrade;
  confluence: AuctionConfluenceEvaluation;
  referenceStrike: number | null;
};

function buildAuctionEpisodes(matches: EpisodeMatch[]) {
  const tierRank: Record<AuctionConfluenceTier, number> = {
    NO_MATCH: 0, INSUFFICIENT: 1, CONFLICT: 2, NEUTRAL: 3, MIXED: 4, SUPPORTIVE: 5, CONFIRMED: 6, DEFINITIVE: 7,
  };
  const rows = [...matches].sort((a, b) => a.trade.signalCandleTime - b.trade.signalCandleTime);
  const episodes: Array<{ key: string; label: string; count: number; lastTime: number; peakTier: AuctionConfluenceTier; peakConviction: number }> = [];
  for (const row of rows) {
    const ref = row.referenceStrike == null ? "na" : row.referenceStrike.toFixed(2);
    const family = `${row.trade.strategy}:${ref}`;
    const time = row.trade.signalCandleTime || Math.floor(Date.parse(row.trade.signalTime) / 1000);
    const prior = [...episodes]
      .reverse()
      .find((episode) => episode.key.startsWith(`${family}:`) && time - episode.lastTime <= 20 * 60);
    if (prior) {
      prior.count += 1;
      prior.lastTime = time;
      if (tierRank[row.confluence.tier] > tierRank[prior.peakTier]) prior.peakTier = row.confluence.tier;
      prior.peakConviction = Math.max(prior.peakConviction, row.confluence.convictionScore);
      continue;
    }
    episodes.push({
      key: `${family}:${time}`,
      label: row.trade.strategy === "iron-fly" ? `IF ${ref}` : `${row.trade.strategy === "call-credit-spread" ? "CALL" : "PUT"} ${ref}`,
      count: 1,
      lastTime: time,
      peakTier: row.confluence.tier,
      peakConviction: row.confluence.convictionScore,
    });
  }
  return episodes;
}

function signed(value: number, digits: number) {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function money(value: number) {
  const absolute = Math.abs(value).toFixed(0);
  return `${value < 0 ? "-" : "+"}$${absolute}`;
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
  metrics: { display: "grid", gridTemplateColumns: "repeat(10, minmax(105px, 1fr))", gap: 8, marginBottom: 14 },
  metric: { border: "1px solid #1f344a", borderRadius: 10, padding: "9px 10px", background: "#091725", display: "grid", gap: 3 },
  failureCard: { border: "1px solid #6f4933", borderRadius: 12, padding: 14, background: "#1a120e", color: "#ffd0aa", marginBottom: 14 },
  failureText: { marginTop: 6, color: "#d6a987", fontSize: 12 },
  failureList: { marginTop: 9, padding: 10, borderRadius: 8, background: "#100c09", color: "#cba58d", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" },
  failureHint: { marginTop: 11, color: "#96a9bd", fontSize: 12, lineHeight: 1.5 },
  legendRow: { display: "flex", flexWrap: "wrap", gap: "8px 18px", color: "#8ea2b7", fontSize: 11, margin: "10px 0" },
  auctionCard: { border: "1px solid #25415b", borderRadius: 13, background: "#081625", padding: 13, marginBottom: 12 },
  confluenceCard: { border: "1px solid #30455f", borderRadius: 13, background: "#091522", padding: 13, marginBottom: 12 },
  auctionHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 },
  auctionEyebrow: { color: "#67d8ff", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 },
  auctionTitle: { display: "block", marginTop: 3, fontSize: 14, color: "#eef7ff" },
  advisoryBadge: { border: "1px solid #53647b", borderRadius: 999, padding: "5px 8px", fontSize: 9, color: "#aebed0", whiteSpace: "nowrap" },
  auctionMetrics: { display: "grid", gridTemplateColumns: "repeat(8, minmax(95px, 1fr))", gap: 7, marginBottom: 9 },
  auctionMetric: { border: "1px solid #20374d", borderRadius: 9, background: "#07131f", padding: "7px 8px", display: "grid", gap: 2, minHeight: 46 },
  engineFormula: { color: "#8ca1b6", fontSize: 10, lineHeight: 1.45, padding: "8px 0 10px" },
  timelineFrame: { border: "1px solid #1d3349", borderRadius: 9, overflow: "hidden" },
  timelineHeaderRow: { display: "grid", gridTemplateColumns: "62px 88px 112px 55px 62px 52px 48px 65px 65px 55px minmax(250px, 1fr)", gap: 7, padding: "6px 8px", background: "#0c1b2a", color: "#71889f", fontSize: 9, fontWeight: 800, minWidth: 980 },
  timelineScroller: { maxHeight: 285, overflow: "auto" },
  timelineRow: { display: "grid", gridTemplateColumns: "62px 88px 112px 55px 62px 52px 48px 65px 65px 55px minmax(250px, 1fr)", gap: 7, alignItems: "center", padding: "5px 8px", borderTop: "1px solid #13283c", color: "#b7c7d7", fontSize: 9, minWidth: 980 },
  timelineEmpty: { padding: 14, color: "#71869c", fontSize: 10 },
  featureText: { color: "#8398ad", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  confluenceNote: { border: "1px solid #273b51", borderRadius: 8, padding: 9, color: "#8196ab", fontSize: 10 },
  confluenceExplainer: { border: "1px solid #20384f", borderRadius: 9, padding: "8px 10px", color: "#8ea3b8", fontSize: 10, lineHeight: 1.45, marginBottom: 9, background: "#07131f" },
  tierSummaryGrid: { display: "grid", gridTemplateColumns: "repeat(7, minmax(105px, 1fr))", gap: 6, marginBottom: 9 },
  tierSummaryCard: { border: "1px solid #20364c", borderRadius: 9, padding: "7px 8px", background: "#07131f", display: "grid", gap: 2, minHeight: 58, fontSize: 9 },
  episodeStrip: { border: "1px solid #20364c", borderRadius: 9, padding: "8px 10px", background: "#07131f", display: "flex", flexWrap: "wrap", gap: "5px 12px", alignItems: "center", marginBottom: 9, color: "#8ea3b8", fontSize: 9 },
  signalGridScroller: { overflowX: "auto" },
  signalGrid: { display: "grid", gap: 6, minWidth: 1560 },
  signalRow: { display: "grid", gridTemplateColumns: "minmax(175px, 1.35fr) 62px 54px 62px 50px 62px 70px 55px 70px 82px 62px 86px 62px minmax(270px, 1.8fr)", gap: 8, alignItems: "center", border: "1px solid #1d3349", borderRadius: 9, background: "#07131f", padding: "7px 8px", fontSize: 9 },
  signalFeatureCell: { minWidth: 0, overflow: "hidden", display: "grid", gap: 2 },
  opposingText: { color: "#b98585", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
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
  footprintCell: { minHeight: 29, padding: "4px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5, borderRight: "1px solid #102235", borderBottom: "1px solid #102235", fontSize: 9, color: "#edf7ff", textAlign: "right" },
  pocCell: { outline: "1px solid rgba(255,209,102,.45)", outlineOffset: -1 },
  blankCell: { minHeight: 29, display: "grid", placeItems: "center", borderRight: "1px solid #102235", borderBottom: "1px solid #102235", color: "#1c3044", fontSize: 9 },
  profileCell: { minHeight: 29, position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "3px 7px", borderBottom: "1px solid #102235", overflow: "hidden", fontSize: 9 },
  profileBar: { position: "absolute", inset: "4px auto 4px 0", borderRadius: "0 5px 5px 0", background: "rgba(52, 181, 255, .28)" },
  disclaimer: { marginTop: 12, borderTop: "1px solid #1a2c3f", paddingTop: 11, color: "#748ba3", fontSize: 11, lineHeight: 1.5 },
  empty: { padding: 28, textAlign: "center", color: "#7f95ab" },
};
