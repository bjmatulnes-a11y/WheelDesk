import {
  type ChainSnapshot,
  type ChainRow,
  type ExpirationChain,
} from "./types";

/**
 * Predictability Surface engine.
 *
 * Turns each expiration chain's open interest + implied vol into the market's own
 * risk-neutral probability density (Breeden-Litzenberger), bends that density with a
 * gamma-weighted open-interest "pinning" field, and stitches the result across time
 * into a price x time probability surface. Everything is expressed in probability /
 * sigma units, so the same engine scores a $7 stock and a $900 stock identically.
 *
 * This is additive: it consumes the same ChainSnapshot you already build and produces
 * a result object that the predictive matrix can anchor to (see predictive-matrix-engine).
 */

export type SurfaceBias = "bullish" | "bearish" | "neutral";

export type SurfaceColumn = {
  dte: number;
  date: string;
  magnet: number;
  /** pinning strength 0..1 for this column (gamma-OI concentration based) */
  pinAlpha: number;
  /** standard deviation of the (interpolated) distribution in price terms */
  sd: number;
  /** blend-0 ("pure market") normalized density over priceLevels; sums ~1 */
  pure: number[];
};

export type ProbabilityRow = {
  key: string;
  label: string;
  probability: number;
  reference: number | null;
};

export type PredictabilitySurfaceResult = {
  version: "predictability-surface-v1";
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  /** the official forecast blend used for the score + probability rows (0..1) */
  structureBlend: number;
  /** ascending price levels (the y axis of the surface) */
  priceLevels: number[];
  /** ascending-by-dte columns (the x axis of the surface) */
  columns: SurfaceColumn[];

  magnet: number | null;
  callWall: number | null;
  putWall: number | null;

  primaryDte: number | null;
  probabilityRows: ProbabilityRow[];
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  bias: SurfaceBias;

  predictabilityScore: number;
  scoreParts: {
    rndConcentration: number;
    oiAgreement: number;
    pinStability: number;
  };
  confidence: "low" | "medium" | "high";

  /** DTE cap used by the engine. null means full surface. */
  maxDte: number | null;
  availableMaxDte: number | null;
  includedChainCount: number;
  omittedLongDteCount: number;

  notes: string[];
  warnings: string[];
};

const R = 0.045;
const ACTIVE_LOW = 0.5;
const ACTIVE_HIGH = 1.75;
const PRICE_LEVELS = 70;
const DTE_STEP = 2;

function npdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function ncdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d =
    0.319381530 * t -
    0.356563782 * t * t +
    1.781477937 * t * t * t -
    1.821255978 * Math.pow(t, 4) +
    1.330274429 * Math.pow(t, 5);
  const p = 1 - npdf(x) * d;
  return x >= 0 ? p : 1 - p;
}

function bsCall(S: number, K: number, T: number, sig: number): number {
  if (T <= 0 || sig <= 0) return Math.max(0, S - K);
  const d1 = (Math.log(S / K) + (R + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return S * ncdf(d1) - K * Math.exp(-R * T) * ncdf(d2);
}

function bsGamma(S: number, K: number, T: number, sig: number): number {
  if (T <= 0 || sig <= 0) return 0;
  const d1 = (Math.log(S / K) + (R + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  return npdf(d1) / (S * sig * Math.sqrt(T));
}

function safeNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** IV may arrive as a decimal (0.25) or as a percent (25). Normalize to a decimal. */
function normalizeIv(iv: unknown, fallback: number): number {
  const n = Number(iv);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const dec = n > 3 ? n / 100 : n;
  return Math.max(0.05, Math.min(4, dec));
}

function dteOf(snapshotDate: string, expiration: string): number {
  const a = new Date(`${String(snapshotDate).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${String(expiration).slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function addDays(start: string, days: number): string {
  const d = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Density = { K: number; d: number }[];

function moments(f: Density): { mean: number; sd: number } {
  const total = f.reduce((s, p) => s + p.d, 0);
  if (!total) return { mean: 0, sd: 0 };
  const mean = f.reduce((s, p) => s + p.K * p.d, 0) / total;
  const variance =
    f.reduce((s, p) => s + p.d * Math.pow(p.K - mean, 2), 0) / total;
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

function normalizedEntropy(f: Density): number {
  const nz = f.filter((p) => p.d > 1e-9);
  if (nz.length < 2) return 1;
  const total = nz.reduce((s, p) => s + p.d, 0) || 1;
  let h = 0;
  for (const p of nz) {
    const q = p.d / total;
    h -= q * Math.log(q);
  }
  return h / Math.log(nz.length);
}

type ExpiryModel = {
  dte: number;
  T: number;
  rnd: Density;
  mean: number;
  sd: number;
  entropy: number;
  magnet: number;
  conc: number;
  callWall: number;
  putWall: number;
};

/** Breeden-Litzenberger risk-neutral density from the chain's strikes + IV. */
function buildRnd(
  rows: { strike: number; iv: number }[],
  spot: number,
  T: number,
): Density {
  if (rows.length < 3) return [];
  const ks = rows.map((r) => r.strike);
  const cs = rows.map((r) => bsCall(spot, r.strike, T, r.iv));
  const f: Density = [];
  for (let i = 0; i < ks.length; i += 1) {
    if (i === 0 || i === ks.length - 1) {
      f.push({ K: ks[i], d: 0 });
      continue;
    }
    const hL = ks[i] - ks[i - 1];
    const hR = ks[i + 1] - ks[i];
    const h = (hL + hR) / 2 || 1;
    const second = (cs[i + 1] - 2 * cs[i] + cs[i - 1]) / (h * h);
    f.push({ K: ks[i], d: Math.max(0, Math.exp(R * T) * second) });
  }
  const total = f.reduce((s, p) => s + p.d, 0);
  if (!total) return [];
  return f.map((p) => ({ K: p.K, d: p.d / total }));
}

/** Lognormal fallback when IV is missing or the RND degenerates. */
function lognormalFallback(
  strikes: number[],
  spot: number,
  sigmaT: number,
): Density {
  const f: Density = strikes.map((K) => {
    const z = (Math.log(K / spot) + 0.5 * sigmaT * sigmaT) / sigmaT;
    return { K, d: npdf(z) / (K * sigmaT) };
  });
  const total = f.reduce((s, p) => s + p.d, 0) || 1;
  return f.map((p) => ({ K: p.K, d: p.d / total }));
}

function gammaField(
  rows: { strike: number; iv: number; callOi: number; putOi: number }[],
  spot: number,
  T: number,
): { magnet: number; conc: number; callWall: number; putWall: number } {
  const weights = rows.map((r) => ({
    K: r.strike,
    w: (r.callOi + r.putOi) * bsGamma(spot, r.strike, T, r.iv),
  }));
  const total = weights.reduce((s, p) => s + p.w, 0);
  if (!total) {
    return { magnet: spot, conc: 0, callWall: spot, putWall: spot };
  }
  const norm = weights.map((p) => ({ K: p.K, w: p.w / total }));
  const magnet = norm.reduce((s, p) => s + p.K * p.w, 0);
  const conc = norm.reduce((s, p) => s + p.w * p.w, 0); // Herfindahl: tight cluster -> high
  const callWall =
    [...rows].sort((a, b) => b.callOi - a.callOi)[0]?.strike ?? spot;
  const putWall =
    [...rows].sort((a, b) => b.putOi - a.putOi)[0]?.strike ?? spot;
  return { magnet, conc, callWall, putWall };
}

function activeRows(chain: ExpirationChain, spot: number) {
  const lo = spot * ACTIVE_LOW;
  const hi = spot * ACTIVE_HIGH;
  const atmIv = atmIvOf(chain.rows, spot);
  return (chain.rows ?? [])
    .filter((r) => r.strike >= lo && r.strike <= hi && safeNum(r.strike) > 0)
    .map((r) => ({
      strike: r.strike,
      iv: normalizeIv(r.iv, atmIv),
      callOi: safeNum(r.callOi),
      putOi: safeNum(r.putOi),
    }))
    .sort((a, b) => a.strike - b.strike);
}

function atmIvOf(rows: ChainRow[], spot: number): number {
  const sorted = [...(rows ?? [])]
    .filter((r) => safeNum(r.strike) > 0)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  for (const r of sorted) {
    const iv = normalizeIv(r.iv, 0);
    if (iv > 0) return iv;
  }
  return 0.35;
}

function deltaOiBias(
  current: ExpirationChain[],
  prior: ExpirationChain[] | null,
  spot: number,
): { bias: SurfaceBias; note: string | null } {
  if (!prior?.length) return { bias: "neutral", note: null };
  const priorByKey = new Map<string, ChainRow>();
  for (const c of prior) {
    for (const r of c.rows ?? []) priorByKey.set(`${c.expiration}|${r.strike}`, r);
  }
  let callGrowthAbove = 0;
  let putGrowthBelow = 0;
  for (const c of current) {
    for (const r of c.rows ?? []) {
      const p = priorByKey.get(`${c.expiration}|${r.strike}`);
      const dCall = safeNum(r.callOi) - safeNum(p?.callOi);
      const dPut = safeNum(r.putOi) - safeNum(p?.putOi);
      if (r.strike > spot) callGrowthAbove += dCall;
      if (r.strike < spot) putGrowthBelow += dPut;
    }
  }
  // Growing call OI above spot = resistance building (capping); growing put OI below = support building.
  // Net "floor building minus ceiling building" leans bullish.
  const net = putGrowthBelow - callGrowthAbove;
  const mag = Math.abs(net);
  if (mag < 1) return { bias: "neutral", note: null };
  if (net > 0)
    return {
      bias: "bullish",
      note: "OI migration is building put support below spot faster than call resistance above it.",
    };
  return {
    bias: "bearish",
    note: "OI migration is building call resistance above spot faster than put support below it.",
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function buildPredictabilitySurface(args: {
  snapshot: ChainSnapshot | null;
  currentPrice: number | null;
  priorSnapshot?: ChainSnapshot | null;
  /** 0..1; how strongly the gamma-OI field bends the market distribution. Default 0.65. */
  structureBlend?: number;
  maxDte?: number | null;
}): PredictabilitySurfaceResult | null {
  const snapshot = args.snapshot;
  const spot = safeNum(args.currentPrice);
  if (!snapshot || !snapshot.chains?.length || spot <= 0) return null;

  const blend = clamp01(args.structureBlend ?? 0.65);
  const notes: string[] = [];
  const warnings: string[] = [];

  const allDtes = snapshot.chains
    .map((chain) => dteOf(snapshot.snapshotDate, chain.expiration))
    .filter((dte) => dte > 0);
  const availableMaxDte = allDtes.length ? Math.max(...allDtes) : null;
  const omittedLongDteCount =
    args.maxDte != null ? allDtes.filter((dte) => dte > args.maxDte!).length : 0;

  const models: ExpiryModel[] = [];
  for (const chain of snapshot.chains) {
    const dte = dteOf(snapshot.snapshotDate, chain.expiration);
    if (dte <= 0) continue;
    if (args.maxDte != null && dte > args.maxDte) continue;
    const rows = activeRows(chain, spot);
    if (rows.length < 3) continue;
    const T = dte / 365;

    const hasUsableIv = (chain.rows ?? []).some((r) => normalizeIv(r.iv, 0) > 0);
    if (!hasUsableIv)
      warnings.push(
        `Expiration ${chain.expiration}: no usable implied vol on the chain, running on a default vol assumption.`,
      );

    let rnd = buildRnd(rows, spot, T);
    if (!rnd.length || moments(rnd).sd <= 0) {
      const atm = atmIvOf(chain.rows, spot);
      rnd = lognormalFallback(
        rows.map((r) => r.strike),
        spot,
        Math.max(0.02, atm * Math.sqrt(T)),
      );
      warnings.push(
        `Expiration ${chain.expiration}: usable IV was missing, used a lognormal fallback.`,
      );
    }
    const m = moments(rnd);
    if (!(m.sd > 0)) continue;
    const gf = gammaField(rows, spot, T);
    models.push({
      dte,
      T,
      rnd,
      mean: m.mean,
      sd: m.sd,
      entropy: normalizedEntropy(rnd),
      magnet: gf.magnet,
      conc: gf.conc,
      callWall: gf.callWall,
      putWall: gf.putWall,
    });
  }

  if (models.length < 1) return null;
  models.sort((a, b) => a.dte - b.dte);
  const primary = models[0];
  const far = models[models.length - 1];

  const lo = Math.max(0.01, spot - 3.2 * far.sd);
  const hi = spot + 3.2 * far.sd;
  const priceLevels: number[] = [];
  for (let i = 0; i < PRICE_LEVELS; i += 1) {
    priceLevels.push(lo + ((hi - lo) * i) / (PRICE_LEVELS - 1));
  }

  function interp(dte: number): {
    mean: number;
    sd: number;
    magnet: number;
    conc: number;
  } {
    if (dte <= models[0].dte) {
      const a = models[0];
      return { mean: a.mean, sd: a.sd, magnet: a.magnet, conc: a.conc };
    }
    if (dte >= far.dte) {
      return { mean: far.mean, sd: far.sd, magnet: far.magnet, conc: far.conc };
    }
    let a = models[0];
    let b = far;
    for (let i = 0; i < models.length - 1; i += 1) {
      if (dte >= models[i].dte && dte <= models[i + 1].dte) {
        a = models[i];
        b = models[i + 1];
        break;
      }
    }
    const t = b.dte === a.dte ? 0 : (dte - a.dte) / (b.dte - a.dte);
    return {
      mean: a.mean + (b.mean - a.mean) * t,
      sd: Math.max(1e-6, a.sd + (b.sd - a.sd) * t),
      magnet: a.magnet + (b.magnet - a.magnet) * t,
      conc: a.conc + (b.conc - a.conc) * t,
    };
  }

  function pureColumn(mean: number, sd: number): number[] {
    const col = priceLevels.map((K) => npdf((K - mean) / sd));
    const total = col.reduce((s, v) => s + v, 0) || 1;
    return col.map((v) => v / total);
  }

  /** Apply the gamma-OI bend to a pure column. Exported shape mirrors the panel math. */
  function bend(
    pure: number[],
    magnet: number,
    pinAlpha: number,
    sd: number,
    b: number,
  ): number[] {
    const alpha = b * pinAlpha;
    if (alpha <= 0) return pure;
    const bent = pure.map((d, i) => {
      const pull = Math.exp(-Math.abs(priceLevels[i] - magnet) / (sd * 0.9));
      return d * (1 - alpha) + d * pull * alpha * 2.2;
    });
    const total = bent.reduce((s, v) => s + v, 0) || 1;
    return bent.map((v) => v / total);
  }

  const columns: SurfaceColumn[] = [];
  for (let dte = DTE_STEP; dte <= far.dte; dte += DTE_STEP) {
    const it = interp(dte);
    const pinAlpha = clamp01(it.conc * 4.5);
    columns.push({
      dte,
      date: addDays(snapshot.snapshotDate, dte),
      magnet: it.magnet,
      pinAlpha,
      sd: it.sd,
      pure: pureColumn(it.mean, it.sd),
    });
  }
  if (!columns.length) return null;

  // Probability rows + score read off the structure-adjusted PRIMARY (nearest) expiry.
  const primAlpha = clamp01(primary.conc * 4.5);
  const primPure = pureColumn(primary.mean, primary.sd);
  const primCol = bend(primPure, primary.magnet, primAlpha, primary.sd, blend);

  const massAbove = (level: number) =>
    priceLevels.reduce((s, K, i) => (K > level ? s + primCol[i] : s), 0);
  const massWithin = (center: number, pct: number) =>
    priceLevels.reduce(
      (s, K, i) => (Math.abs(K - center) <= center * pct ? s + primCol[i] : s),
      0,
    );

  const pAboveCall = massAbove(primary.callWall);
  const pBelowPut = 1 - massAbove(primary.putWall);
  const pPin = massWithin(primary.magnet, 0.02);

  // 68% central interval from the adjusted primary column.
  const sorted = priceLevels
    .map((K, i) => ({ K, d: primCol[i] }))
    .sort((a, b) => a.K - b.K);
  let acc = 0;
  let p16 = sorted[0].K;
  for (const p of sorted) {
    acc += p.d;
    if (acc >= 0.16) {
      p16 = p.K;
      break;
    }
  }
  acc = 0;
  let p84 = sorted[sorted.length - 1].K;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    acc += sorted[i].d;
    if (acc >= 0.16) {
      p84 = sorted[i].K;
      break;
    }
  }

  const probabilityRows: ProbabilityRow[] = [
    {
      key: "above_call_wall",
      label: `Close above call wall ${primary.callWall.toFixed(2)}`,
      probability: pAboveCall,
      reference: primary.callWall,
    },
    {
      key: "below_put_wall",
      label: `Close below put wall ${primary.putWall.toFixed(2)}`,
      probability: pBelowPut,
      reference: primary.putWall,
    },
    {
      key: "pin_magnet",
      label: `Pin within +/-2% of magnet ${primary.magnet.toFixed(2)}`,
      probability: pPin,
      reference: primary.magnet,
    },
  ];

  // Predictability score: unit-free, transfers across any stock.
  const rndConcentration = clamp01(1 - primary.entropy);
  const modeIdx = primCol.indexOf(Math.max(...primCol));
  const modeK = priceLevels[modeIdx] ?? primary.mean;
  const oiAgreement = clamp01(
    1 - Math.abs(primary.magnet - modeK) / (2 * primary.sd),
  );
  const pinStability = clamp01(primary.conc * 5);
  const predictabilityScore = Math.round(
    100 * (0.45 * rndConcentration + 0.3 * oiAgreement + 0.25 * pinStability),
  );
  const confidence =
    predictabilityScore >= 70
      ? "high"
      : predictabilityScore >= 50
        ? "medium"
        : "low";

  // Bias: weighted OI center vs spot, refined by OI migration.
  const centerOffset = (primary.magnet - spot) / spot;
  let bias: SurfaceBias =
    centerOffset > 0.01 ? "bullish" : centerOffset < -0.01 ? "bearish" : "neutral";
  const migration = deltaOiBias(
    snapshot.chains,
    args.priorSnapshot?.chains ?? null,
    spot,
  );
  if (migration.bias !== "neutral") bias = migration.bias;
  if (migration.note) notes.push(migration.note);

  notes.push(
    `Surface built from ${models.length} expiration chain(s) out to ${far.dte}d${args.maxDte != null ? ` inside a ${args.maxDte}D cap` : " using the full available surface"}; densities are risk-neutral (Breeden-Litzenberger) bent by the gamma-OI field at ${Math.round(blend * 100)}% strength.`,
  );
  if (omittedLongDteCount > 0)
    notes.push(
      `${omittedLongDteCount} longer-dated expiration chain(s) are muted by the active DTE cap to reduce LEAP/far-chain noise.`,
    );
  if (models.length < 2)
    warnings.push(
      "Only one expiration produced a usable density; the term surface is interpolated from a single anchor.",
    );
  if (predictabilityScore < 50)
    warnings.push(
      "Predictability is low: the implied distribution is wide and/or OI does not agree with the market mode. Treat targets as a probability cloud, not a forecast.",
    );

  return {
    version: "predictability-surface-v1",
    ticker: snapshot.ticker,
    snapshotDate: snapshot.snapshotDate,
    currentPrice: spot,
    structureBlend: blend,
    priceLevels,
    columns,
    magnet: primary.magnet,
    callWall: primary.callWall,
    putWall: primary.putWall,
    primaryDte: primary.dte,
    probabilityRows,
    expectedRangeLow: Math.round(p16 * 100) / 100,
    expectedRangeHigh: Math.round(p84 * 100) / 100,
    bias,
    predictabilityScore,
    scoreParts: { rndConcentration, oiAgreement, pinStability },
    confidence,
    maxDte: args.maxDte ?? null,
    availableMaxDte,
    includedChainCount: models.length,
    omittedLongDteCount,
    notes,
    warnings,
  };
}
