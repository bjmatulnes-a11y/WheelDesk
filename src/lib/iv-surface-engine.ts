import { type CandleRecord, type OptionSurfaceSnapshot } from "./wheeldesk-storage";

export type IVSkewBias = "bullish" | "neutral" | "bearish" | "unknown";
export type IVTermStructure = "front-loaded" | "normal" | "compressed" | "unknown";
export type IVVolRegime = "compressed" | "normal" | "elevated" | "event-loaded" | "unknown";

export type IVSurfaceHeatmapCell = {
  label: string;
  moneyness: number;
  iv: number | null;
};

export type IVSurfaceHeatmapRow = {
  expiration: string;
  dte: number;
  atmIv: number | null;
  cells: IVSurfaceHeatmapCell[];
};

export type IVSurfaceExpectedMove = {
  horizonDays: number;

  /** ATM-based 1σ estimate, retained for backwards compatibility. */
  oneSigma: number;
  halfSigma: number;

  /** Surface-derived, skew-aware move estimates. */
  upsideOneSigma: number;
  downsideOneSigma: number;
  upsideHalfSigma: number;
  downsideHalfSigma: number;

  /** Chart levels. Upper uses upside/call-wing IV. Lower uses downside/put-wing IV. */
  upperOneSigma: number;
  lowerOneSigma: number;
  upperHalfSigma: number;
  lowerHalfSigma: number;

  /** Percent values are based on the asymmetric surface bands. */
  upsideMovePct: number;
  downsideMovePct: number;
  expectedMovePct: number;
};

export type IVSurfaceSummary = {
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  horizonDays: number;
  matchedDte: number | null;
  atmIv: number | null;
  upperBandIv: number | null;
  lowerBandIv: number | null;
  frontIv: number | null;
  backIv: number | null;
  frontBackSpread: number | null;
  putWingIv: number | null;
  callWingIv: number | null;
  skewSpread: number | null;
  skewBias: IVSkewBias;
  termStructure: IVTermStructure;
  volRegime: IVVolRegime;
  confidenceAdjustment: number;
  expectedMove: IVSurfaceExpectedMove;
  heatmap: IVSurfaceHeatmapRow[];
  notes: string[];
};

type IVPoint = {
  expiration: string;
  dte: number;
  strike: number;
  iv: number;
  callIv?: number | null;
  putIv?: number | null;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number | null | undefined, digits = 4): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dateOnly(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const s = new Date(`${dateOnly(start)}T00:00:00Z`).getTime();
  const e = new Date(`${dateOnly(end)}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

function median(values: number[]): number | null {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function average(values: number[]): number | null {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function normalizeIv(value: unknown): number | null {
  const n = toNumber(value);
  if (n == null || n <= 0) return null;

  // Yahoo-style IV is usually decimal (0.24). If a source sends 24, normalize to 0.24.
  if (n > 3) return n / 100;
  return n;
}

function rowIv(row: any): number | null {
  return (
    normalizeIv(row?.iv) ??
    normalizeIv(row?.impliedVolatility) ??
    normalizeIv(row?.markIv) ??
    normalizeIv(row?.midIv) ??
    normalizeIv(row?.callIv) ??
    normalizeIv(row?.putIv) ??
    null
  );
}

function rowCallIv(row: any): number | null {
  return normalizeIv(row?.callIv ?? row?.callIV ?? row?.callImpliedVolatility ?? row?.call?.impliedVolatility);
}

function rowPutIv(row: any): number | null {
  return normalizeIv(row?.putIv ?? row?.putIV ?? row?.putImpliedVolatility ?? row?.put?.impliedVolatility);
}

function collectPoints(surface: OptionSurfaceSnapshot | null, currentPrice: number): IVPoint[] {
  if (!surface?.chains?.length || !Number.isFinite(currentPrice) || currentPrice <= 0) return [];

  const points: IVPoint[] = [];

  for (const chain of surface.chains) {
    const expiration = dateOnly(chain.expiration);
    const dte = daysBetween(surface.snapshotDate, expiration);
    if (!expiration || dte <= 0) continue;

    for (const row of chain.rows ?? []) {
      const strike = toNumber(row?.strike);
      const iv = rowIv(row);
      if (strike == null || strike <= 0 || iv == null || iv <= 0) continue;
      points.push({
        expiration,
        dte,
        strike,
        iv,
        callIv: rowCallIv(row),
        putIv: rowPutIv(row)
      });
    }
  }

  return points.sort((a, b) => {
    const dteCompare = a.dte - b.dte;
    if (dteCompare !== 0) return dteCompare;
    return a.strike - b.strike;
  });
}

function atmIvForDte(points: IVPoint[], targetDte: number, currentPrice: number): number | null {
  if (!points.length || currentPrice <= 0) return null;

  const expirations = Array.from(new Set(points.map((point) => point.expiration)))
    .map((expiration) => {
      const rows = points.filter((point) => point.expiration === expiration);
      const dte = rows[0]?.dte ?? 0;
      const near = rows
        .filter((point) => Math.abs(point.strike / currentPrice - 1) <= 0.035)
        .sort((a, b) => Math.abs(a.strike - currentPrice) - Math.abs(b.strike - currentPrice));
      return { expiration, dte, iv: median(near.slice(0, 5).map((point) => point.iv)) };
    })
    .filter((row) => row.iv != null) as Array<{ expiration: string; dte: number; iv: number }>;

  if (!expirations.length) return null;

  const nearest = expirations.sort((a, b) => Math.abs(a.dte - targetDte) - Math.abs(b.dte - targetDte))[0];
  return nearest?.iv ?? null;
}

function realizedVolFallback(candles?: CandleRecord[]): number | null {
  const closes = (candles ?? [])
    .map((candle) => toNumber(candle.close))
    .filter((value): value is number => value != null && value > 0)
    .slice(-45);

  if (closes.length < 12) return null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  const mean = average(returns) ?? 0;
  const variance = average(returns.map((value) => (value - mean) ** 2));
  if (variance == null) return null;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function expectedMove(
  currentPrice: number,
  atmIv: number | null,
  horizonDays: number,
  upperBandIv?: number | null,
  lowerBandIv?: number | null
): IVSurfaceExpectedMove {
  const effectiveAtmIv = atmIv ?? 0;
  const effectiveUpperIv = upperBandIv ?? atmIv ?? 0;
  const effectiveLowerIv = lowerBandIv ?? atmIv ?? 0;
  const time = Math.sqrt(Math.max(1, horizonDays) / 252);

  const oneSigma = currentPrice > 0 ? currentPrice * effectiveAtmIv * time : 0;
  const halfSigma = oneSigma * 0.5;

  // This is the important part: the chart band is asymmetric and comes from the IV surface.
  // Upper band uses the upside/call wing; lower band uses the downside/put wing.
  const upsideOneSigma = currentPrice > 0 ? currentPrice * effectiveUpperIv * time : 0;
  const downsideOneSigma = currentPrice > 0 ? currentPrice * effectiveLowerIv * time : 0;
  const upsideHalfSigma = upsideOneSigma * 0.5;
  const downsideHalfSigma = downsideOneSigma * 0.5;

  return {
    horizonDays,
    oneSigma: round(oneSigma, 2) ?? 0,
    halfSigma: round(halfSigma, 2) ?? 0,
    upsideOneSigma: round(upsideOneSigma, 2) ?? 0,
    downsideOneSigma: round(downsideOneSigma, 2) ?? 0,
    upsideHalfSigma: round(upsideHalfSigma, 2) ?? 0,
    downsideHalfSigma: round(downsideHalfSigma, 2) ?? 0,
    upperOneSigma: round(currentPrice + upsideOneSigma, 2) ?? currentPrice,
    lowerOneSigma: round(currentPrice - downsideOneSigma, 2) ?? currentPrice,
    upperHalfSigma: round(currentPrice + upsideHalfSigma, 2) ?? currentPrice,
    lowerHalfSigma: round(currentPrice - downsideHalfSigma, 2) ?? currentPrice,
    upsideMovePct: currentPrice > 0 ? (round((upsideOneSigma / currentPrice) * 100, 2) ?? 0) : 0,
    downsideMovePct: currentPrice > 0 ? (round((downsideOneSigma / currentPrice) * 100, 2) ?? 0) : 0,
    expectedMovePct: currentPrice > 0 ? (round((oneSigma / currentPrice) * 100, 2) ?? 0) : 0
  };
}

function classifyTermStructure(frontIv: number | null, backIv: number | null): IVTermStructure {
  if (frontIv == null || backIv == null) return "unknown";
  const spread = frontIv - backIv;
  if (spread >= 0.04) return "front-loaded";
  if (spread <= -0.04) return "compressed";
  return "normal";
}

function classifySkew(putWingIv: number | null, callWingIv: number | null): IVSkewBias {
  if (putWingIv == null || callWingIv == null) return "unknown";
  const spread = putWingIv - callWingIv;
  if (spread >= 0.035) return "bearish";
  if (spread <= -0.025) return "bullish";
  return "neutral";
}

function classifyVolRegime(atmIv: number | null, frontIv: number | null, term: IVTermStructure): IVVolRegime {
  const iv = frontIv ?? atmIv;
  if (iv == null) return "unknown";
  if (term === "front-loaded" && iv >= 0.28) return "event-loaded";
  if (iv >= 0.45) return "event-loaded";
  if (iv >= 0.32) return "elevated";
  if (iv <= 0.16) return "compressed";
  return "normal";
}

function buildHeatmap(points: IVPoint[], currentPrice: number): IVSurfaceHeatmapRow[] {
  if (!points.length || currentPrice <= 0) return [];

  const bands = [
    { label: "-10%", moneyness: 0.9, low: 0.875, high: 0.925 },
    { label: "-5%", moneyness: 0.95, low: 0.925, high: 0.975 },
    { label: "ATM", moneyness: 1, low: 0.975, high: 1.025 },
    { label: "+5%", moneyness: 1.05, low: 1.025, high: 1.075 },
    { label: "+10%", moneyness: 1.1, low: 1.075, high: 1.125 }
  ];

  const expirations = Array.from(new Set(points.map((point) => point.expiration)))
    .map((expiration) => {
      const rows = points.filter((point) => point.expiration === expiration);
      const dte = rows[0]?.dte ?? 0;
      const cells = bands.map((band) => {
        const iv = median(
          rows
            .filter((point) => {
              const m = point.strike / currentPrice;
              return m >= band.low && m < band.high;
            })
            .map((point) => point.iv)
        );
        return { label: band.label, moneyness: band.moneyness, iv: round(iv, 4) };
      });
      const atmIv = cells.find((cell) => cell.label === "ATM")?.iv ?? null;
      return { expiration, dte, atmIv, cells };
    })
    .filter((row) => row.cells.some((cell) => cell.iv != null))
    .sort((a, b) => a.dte - b.dte);

  return expirations.slice(0, 6);
}

function nearestHeatmapRow(heatmap: IVSurfaceHeatmapRow[], horizonDays: number): IVSurfaceHeatmapRow | null {
  if (!heatmap.length) return null;
  return heatmap.slice().sort((a, b) => Math.abs(a.dte - horizonDays) - Math.abs(b.dte - horizonDays))[0] ?? null;
}

function cellIv(row: IVSurfaceHeatmapRow | null, label: string): number | null {
  return row?.cells.find((cell) => cell.label === label)?.iv ?? null;
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return average(clean);
}

function buildNotes(args: {
  atmIv: number | null;
  termStructure: IVTermStructure;
  skewBias: IVSkewBias;
  volRegime: IVVolRegime;
  expectedMove: IVSurfaceExpectedMove;
  fallbackUsed: boolean;
}): string[] {
  const notes: string[] = [];

  if (args.fallbackUsed) {
    notes.push("No usable chain IV was found; expected move is using realized-vol fallback.");
  }

  if (args.termStructure === "front-loaded") {
    notes.push("Front IV is rich versus back IV; treat the path as more event-sensitive and avoid overconfidence in smooth curves.");
  } else if (args.termStructure === "compressed") {
    notes.push("Front IV is cheap versus back IV; breakout follow-through needs price confirmation before chasing convexity.");
  } else if (args.termStructure === "normal") {
    notes.push("Term structure is balanced enough for the OI path to carry more weight.");
  }

  if (args.skewBias === "bearish") {
    notes.push("Downside wing IV is richer than upside wing IV; lower-tail risk should widen the control band.");
  } else if (args.skewBias === "bullish") {
    notes.push("Upside wing IV is relatively firm; bullish unlocks deserve more attention after acceptance.");
  }

  if (args.volRegime === "event-loaded") {
    notes.push("Vol regime is event-loaded; prefer defined-risk trades and reduce naked short premium near rails.");
  } else if (args.volRegime === "compressed") {
    notes.push("Vol is compressed; short premium has less cushion and snap risk matters more at rails.");
  }

  notes.push(`The ${args.expectedMove.horizonDays}D surface band is +${args.expectedMove.upsideOneSigma.toFixed(2)} / -${args.expectedMove.downsideOneSigma.toFixed(2)} from spot.`);
  return notes;
}

export function buildIVSurfaceSummary(args: {
  surface: OptionSurfaceSnapshot | null;
  currentPrice: number;
  horizonDays?: number;
  candles?: CandleRecord[];
}): IVSurfaceSummary | null {
  const surface = args.surface;
  const currentPrice = args.currentPrice;
  const horizonDays = args.horizonDays ?? 14;

  if (!surface || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const points = collectPoints(surface, currentPrice);
  const chainAtmIv = atmIvForDte(points, horizonDays, currentPrice);
  const fallbackIv = realizedVolFallback(args.candles);
  const atmIv = chainAtmIv ?? fallbackIv;
  const fallbackUsed = chainAtmIv == null && fallbackIv != null;

  const frontIv = atmIvForDte(points, Math.min(10, horizonDays), currentPrice);
  const backIv = atmIvForDte(points, Math.max(30, horizonDays * 2), currentPrice);

  const nearHorizon = points.filter((point) => Math.abs(point.dte - horizonDays) <= Math.max(7, horizonDays * 0.6));
  const pool = nearHorizon.length ? nearHorizon : points;

  const putWingIv = median(
    pool
      .filter((point) => {
        const m = point.strike / currentPrice;
        return m >= 0.88 && m <= 0.97;
      })
      .map((point) => point.putIv ?? point.iv)
  );

  const callWingIv = median(
    pool
      .filter((point) => {
        const m = point.strike / currentPrice;
        return m >= 1.03 && m <= 1.12;
      })
      .map((point) => point.callIv ?? point.iv)
  );

  const heatmap = buildHeatmap(points, currentPrice);
  const matchedRow = nearestHeatmapRow(heatmap, horizonDays);
  const matchedDte = matchedRow?.dte ?? null;

  // The IV chart band must come from the option-chain surface, not just a flat ATM IV.
  // Upper band uses upside wing/call IV; lower band uses downside wing/put IV.
  const upperBandIv = averageNullable([cellIv(matchedRow, "+5%"), cellIv(matchedRow, "+10%"), callWingIv, atmIv]);
  const lowerBandIv = averageNullable([cellIv(matchedRow, "-5%"), cellIv(matchedRow, "-10%"), putWingIv, atmIv]);

  const termStructure = classifyTermStructure(frontIv, backIv);
  const skewBias = classifySkew(putWingIv, callWingIv);
  const volRegime = classifyVolRegime(atmIv, frontIv, termStructure);
  const move = expectedMove(currentPrice, atmIv, horizonDays, upperBandIv, lowerBandIv);

  let confidenceAdjustment = 0;
  if (atmIv != null) confidenceAdjustment += 4;
  if (termStructure === "normal") confidenceAdjustment += 3;
  if (termStructure === "front-loaded") confidenceAdjustment -= 8;
  if (volRegime === "event-loaded") confidenceAdjustment -= 10;
  if (skewBias === "bearish" || skewBias === "bullish") confidenceAdjustment -= 3;
  if (points.length < 25 && !fallbackUsed) confidenceAdjustment -= 8;

  const summary: IVSurfaceSummary = {
    ticker: surface.ticker,
    snapshotDate: surface.snapshotDate,
    currentPrice: round(currentPrice, 2) ?? currentPrice,
    horizonDays,
    matchedDte,
    atmIv: round(atmIv, 4),
    upperBandIv: round(upperBandIv, 4),
    lowerBandIv: round(lowerBandIv, 4),
    frontIv: round(frontIv, 4),
    backIv: round(backIv, 4),
    frontBackSpread: frontIv != null && backIv != null ? round(frontIv - backIv, 4) : null,
    putWingIv: round(putWingIv, 4),
    callWingIv: round(callWingIv, 4),
    skewSpread: putWingIv != null && callWingIv != null ? round(putWingIv - callWingIv, 4) : null,
    skewBias,
    termStructure,
    volRegime,
    confidenceAdjustment: clamp(Math.round(confidenceAdjustment), -25, 15),
    expectedMove: move,
    heatmap,
    notes: []
  };

  summary.notes = buildNotes({
    atmIv: summary.atmIv,
    termStructure,
    skewBias,
    volRegime,
    expectedMove: move,
    fallbackUsed
  });

  return summary;
}
