import { type OptionSurfaceSnapshot } from "./wheeldesk-storage";

export type OIChangeSide = "call" | "put";
export type OIChangeDirection = "increase" | "decrease";
export type OIChangeTone = "bullish" | "bearish" | "mixed" | "neutral";

export type OIChangeItem = {
  side: OIChangeSide;
  direction: OIChangeDirection;
  expiration: string;
  strike: number;
  delta: number;
  currentOi: number;
  priorOi: number;
  distancePct: number | null;
  label: string;
};

export type OIChangeRead = {
  ok: boolean;
  reason: "ok" | "no_current_surface" | "no_prior_surface" | "no_comparable_chains" | "no_change";
  ticker: string;
  scopeLabel: string;
  currentSnapshotDate: string;
  priorSnapshotDate: string | null;
  selectedExpiration: string | null;
  comparedChainCount: number;
  maxDte: number;
  headline: string;
  summary: string;
  forecastImpact: string;
  tradeUse: {
    csp: string;
    coveredCall: string;
    longCall: string;
  };
  topCallIncreases: OIChangeItem[];
  topCallDecreases: OIChangeItem[];
  topPutIncreases: OIChangeItem[];
  topPutDecreases: OIChangeItem[];
  totals: {
    callDelta: number;
    putDelta: number;
    netDelta: number;
    supportPutBuild: number;
    overheadCallBuild: number;
    overheadCallThinning: number;
    putSupportUnwind: number;
  };
  notes: string[];
};

type SurfaceChain = {
  expiration: string;
  dte: number | null;
  rows: any[];
};

type RowRecord = {
  expiration: string;
  strike: number;
  callOi: number;
  putOi: number;
};

function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function expirationOf(chain: any): string {
  return String(
    chain?.expiration ?? chain?.expirationDate ?? chain?.expiration_date ?? chain?.expiry ?? "",
  ).slice(0, 10);
}

function dteFromExpiration(expiration: string, snapshotDate: string): number | null {
  if (!expiration || !snapshotDate) return null;
  const exp = new Date(`${expiration.slice(0, 10)}T00:00:00Z`);
  const snap = new Date(`${snapshotDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(exp.getTime()) || Number.isNaN(snap.getTime())) return null;
  return Math.max(0, Math.round((exp.getTime() - snap.getTime()) / 86_400_000));
}

function numeric(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function rowStrike(row: any): number {
  return numeric(row?.strike, row?.Strike, row?.raw?.strike, row?.raw?.Strike);
}

function rowCallOi(row: any): number {
  return numeric(
    row?.callOi,
    row?.callOI,
    row?.call_oi,
    row?.callOpenInterest,
    row?.call_open_interest,
    row?.call?.openInterest,
    row?.call?.oi,
    row?.raw?.callOi,
    row?.raw?.callOI,
  );
}

function rowPutOi(row: any): number {
  return numeric(
    row?.putOi,
    row?.putOI,
    row?.put_oi,
    row?.putOpenInterest,
    row?.put_open_interest,
    row?.put?.openInterest,
    row?.put?.oi,
    row?.raw?.putOi,
    row?.raw?.putOI,
  );
}

function getChains(surface: OptionSurfaceSnapshot | null, maxDte: number): SurfaceChain[] {
  if (!surface?.chains?.length) return [];
  const snapshotDate = dateKey(surface.snapshotDate);

  return ((surface.chains ?? []) as any[])
    .map((chain) => {
      const expiration = expirationOf(chain);
      const dte = numeric(
        chain?.dteAtCapture,
        chain?.dte,
        chain?.summary?.dte,
        dteFromExpiration(expiration, snapshotDate),
      );
      return {
        expiration,
        dte: Number.isFinite(dte) ? dte : null,
        rows: Array.isArray(chain?.rows) ? chain.rows : [],
      };
    })
    .filter(
      (chain) =>
        Boolean(chain.expiration) &&
        Array.isArray(chain.rows) &&
        chain.rows.length > 0 &&
        chain.dte != null &&
        chain.dte >= 0 &&
        chain.dte <= maxDte,
    );
}

function chooseComparableChains(args: {
  currentSurface: OptionSurfaceSnapshot;
  priorSurface: OptionSurfaceSnapshot;
  selectedExpiration?: string | null;
  maxDte: number;
}): { current: SurfaceChain[]; priorByExpiration: Map<string, SurfaceChain>; scopeLabel: string } {
  const selectedExpiration = dateKey(args.selectedExpiration);
  const currentChains = getChains(args.currentSurface, args.maxDte);
  const priorChains = getChains(args.priorSurface, Math.max(args.maxDte + 7, args.maxDte));
  const priorByExpiration = new Map(priorChains.map((chain) => [chain.expiration, chain]));

  // If the user explicitly selected a chain, compare that chain even if its DTE
  // is outside the default 30D tactical window. Otherwise fall back to the 30D
  // multi-chain read.
  if (selectedExpiration) {
    const exactCurrent = getChains(args.currentSurface, 9999).find(
      (chain) => chain.expiration === selectedExpiration,
    );
    const exactPrior = getChains(args.priorSurface, 9999).find(
      (chain) => chain.expiration === selectedExpiration,
    );
    if (exactCurrent && exactPrior) {
      return {
        current: [exactCurrent],
        priorByExpiration: new Map([[selectedExpiration, exactPrior]]),
        scopeLabel: `${selectedExpiration} chain`,
      };
    }
  }

  const comparable = currentChains.filter((chain) => priorByExpiration.has(chain.expiration));
  return {
    current: comparable,
    priorByExpiration,
    scopeLabel: `${args.maxDte}D window`,
  };
}

function mapRows(chain: SurfaceChain): Map<number, RowRecord> {
  const out = new Map<number, RowRecord>();
  for (const row of chain.rows) {
    const strike = rowStrike(row);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    out.set(strike, {
      expiration: chain.expiration,
      strike,
      callOi: rowCallOi(row),
      putOi: rowPutOi(row),
    });
  }
  return out;
}

function itemLabel(item: OIChangeItem): string {
  const side = item.side === "call" ? "call OI" : "put OI";
  const verb = item.delta >= 0 ? "built" : "thinned";
  return `${Math.abs(Math.round(item.delta)).toLocaleString()} ${side} ${verb} at ${formatStrike(item.strike)} (${item.expiration})`;
}

function makeItem(args: {
  side: OIChangeSide;
  expiration: string;
  strike: number;
  delta: number;
  currentOi: number;
  priorOi: number;
  currentPrice: number;
}): OIChangeItem {
  const distancePct =
    args.currentPrice > 0
      ? (args.strike - args.currentPrice) / args.currentPrice
      : null;
  const item: OIChangeItem = {
    side: args.side,
    direction: args.delta >= 0 ? "increase" : "decrease",
    expiration: args.expiration,
    strike: args.strike,
    delta: args.delta,
    currentOi: args.currentOi,
    priorOi: args.priorOi,
    distancePct,
    label: "",
  };
  item.label = itemLabel(item);
  return item;
}

function formatStrike(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  return value < 20 ? value.toFixed(2).replace(/\.00$/, "") : value.toFixed(2).replace(/\.00$/, "");
}

function topIncreases(items: OIChangeItem[]): OIChangeItem[] {
  return items
    .filter((item) => item.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 4);
}

function topDecreases(items: OIChangeItem[]): OIChangeItem[] {
  return items
    .filter((item) => item.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 4);
}

function strongest(items: OIChangeItem[]): OIChangeItem | null {
  return [...items].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] ?? null;
}

function sumAbs(items: OIChangeItem[]): number {
  return items.reduce((sum, item) => sum + Math.abs(item.delta), 0);
}

function buildRead(args: {
  ticker: string;
  scopeLabel: string;
  currentSnapshotDate: string;
  priorSnapshotDate: string;
  selectedExpiration: string | null;
  comparedChainCount: number;
  maxDte: number;
  currentPrice: number;
  callItems: OIChangeItem[];
  putItems: OIChangeItem[];
}): OIChangeRead {
  const topCallIncreases = topIncreases(args.callItems);
  const topCallDecreases = topDecreases(args.callItems);
  const topPutIncreases = topIncreases(args.putItems);
  const topPutDecreases = topDecreases(args.putItems);

  const supportPutBuild = topPutIncreases
    .filter((item) => item.strike <= args.currentPrice * 1.03)
    .reduce((sum, item) => sum + item.delta, 0);
  const overheadCallBuild = topCallIncreases
    .filter((item) => item.strike >= args.currentPrice * 0.97)
    .reduce((sum, item) => sum + item.delta, 0);
  const overheadCallThinning = topCallDecreases
    .filter((item) => item.strike >= args.currentPrice * 0.97)
    .reduce((sum, item) => sum + Math.abs(item.delta), 0);
  const putSupportUnwind = topPutDecreases
    .filter((item) => item.strike <= args.currentPrice * 1.03)
    .reduce((sum, item) => sum + Math.abs(item.delta), 0);

  const callDelta = args.callItems.reduce((sum, item) => sum + item.delta, 0);
  const putDelta = args.putItems.reduce((sum, item) => sum + item.delta, 0);
  const largestPutBuild = strongest(topPutIncreases);
  const largestCallBuild = strongest(topCallIncreases);
  const largestCallThin = strongest(topCallDecreases);
  const largestPutThin = strongest(topPutDecreases);

  const actionMagnitude = Math.max(
    supportPutBuild,
    overheadCallBuild,
    overheadCallThinning,
    putSupportUnwind,
    sumAbs(topCallIncreases) + sumAbs(topPutIncreases),
  );

  let headline = "Positioning change is mixed";
  let forecastImpact = "Treat the official OI path as unchanged until the next snapshot confirms direction.";
  let csp = "No clean put-side build confirmed. Use the official lower field and avoid forcing tight CSP strikes.";
  let coveredCall = "No fresh overhead call read. Use the official call wall / upper field for covered-call placement.";
  let longCall = "No strong call-side expansion confirmed. Long calls still need price/volume confirmation.";
  const notes: string[] = [];

  if (actionMagnitude <= 0) {
    headline = "No material OI change detected";
    forecastImpact = "The prior and current surfaces are effectively unchanged; rely on static OI structure.";
  } else if (supportPutBuild > overheadCallBuild * 1.25 && supportPutBuild > putSupportUnwind) {
    headline = "Put-side support / hedge build under the market";
    forecastImpact = "This supports range/premium logic but does not automatically confirm upside chase.";
    if (largestPutBuild) {
      csp = `CSPs are cleaner below the fresh put build near ${formatStrike(largestPutBuild.strike)}; avoid selling too tight if price loses that shelf.`;
    }
    coveredCall = largestCallThin
      ? `Overhead calls thinned near ${formatStrike(largestCallThin.strike)}; do not cap upside too tightly if price starts accepting above spot.`
      : "Covered calls are still governed by the official call wall; ΔOI did not add a fresh ceiling.";
    longCall = largestCallThin
      ? "Call-side participation thinned while puts built; avoid chasing long calls until call OI expands again."
      : "Long calls need call-side expansion or price confirmation before high conviction.";
  } else if (overheadCallBuild > supportPutBuild * 1.25 && overheadCallBuild > overheadCallThinning) {
    headline = "Call-side build above / near spot";
    forecastImpact = "Upside interest increased, but this can also become a call-wall ceiling. Confirm with price acceptance.";
    csp = "CSPs are acceptable only if the lower field and put-side structure remain stable.";
    if (largestCallBuild) {
      coveredCall = `Fresh call OI built near ${formatStrike(largestCallBuild.strike)}; covered calls there may be attractive, but watch for breakout acceptance.`;
      longCall = `Upside participation improved near ${formatStrike(largestCallBuild.strike)}; long calls still need the call wall to migrate or price to accept above it.`;
    }
  } else if (overheadCallThinning > supportPutBuild && overheadCallThinning > overheadCallBuild) {
    headline = "Overhead call structure thinned";
    forecastImpact = "Upside ceiling may be softening, but thinning can also mean reduced call-side sponsorship.";
    csp = "CSP logic should still be based on put-side support; call thinning alone does not improve put-sale quality.";
    coveredCall = largestCallThin
      ? `Be careful selling covered calls too close to ${formatStrike(largestCallThin.strike)} if price starts pushing higher.`
      : "Avoid capping upside too aggressively until new call resistance forms.";
    longCall = "This removes some overhead OI pressure, but it is not a buy signal without call build or price confirmation.";
  } else if (putSupportUnwind > supportPutBuild && putSupportUnwind > overheadCallBuild) {
    headline = "Put-side support unwound";
    forecastImpact = "Support confirmation weakened. Mute bullish/range forecasts until a new lower shelf forms.";
    csp = largestPutThin
      ? `Avoid tight CSPs around ${formatStrike(largestPutThin.strike)}; that put shelf thinned.`
      : "Avoid tight CSPs until put-side support rebuilds.";
    coveredCall = "Covered-call logic is unchanged, but weakening put support raises downside assignment risk.";
    longCall = "Long calls need stronger upside OI confirmation because downside support thinned.";
  }

  if (overheadCallBuild > 0 && supportPutBuild > 0) {
    notes.push("Both call-side and put-side OI built; this can indicate a tighter battleground rather than clean direction.");
  }

  if (overheadCallBuild > 0 && overheadCallThinning > 0) {
    notes.push("Call OI is rotating by strike. Read the top strikes rather than treating total call delta as directional.");
  }

  if (supportPutBuild > 0 && putSupportUnwind > 0) {
    notes.push("Put OI is rotating by strike. Confirm whether support moved higher/lower before acting.");
  }

  const topLines = [
    largestPutBuild?.label,
    largestCallBuild?.label,
    largestCallThin?.label,
    largestPutThin?.label,
  ].filter(Boolean) as string[];

  const summary = topLines.length
    ? topLines.slice(0, 3).join(" · ")
    : "No ranked strike-level change was large enough to summarize.";

  return {
    ok: true,
    reason: actionMagnitude <= 0 ? "no_change" : "ok",
    ticker: args.ticker,
    scopeLabel: args.scopeLabel,
    currentSnapshotDate: args.currentSnapshotDate,
    priorSnapshotDate: args.priorSnapshotDate,
    selectedExpiration: args.selectedExpiration,
    comparedChainCount: args.comparedChainCount,
    maxDte: args.maxDte,
    headline,
    summary,
    forecastImpact,
    tradeUse: { csp, coveredCall, longCall },
    topCallIncreases,
    topCallDecreases,
    topPutIncreases,
    topPutDecreases,
    totals: {
      callDelta,
      putDelta,
      netDelta: callDelta + putDelta,
      supportPutBuild,
      overheadCallBuild,
      overheadCallThinning,
      putSupportUnwind,
    },
    notes,
  };
}

export function buildOIChangeRead(args: {
  currentSurface: OptionSurfaceSnapshot | null;
  priorSurface: OptionSurfaceSnapshot | null;
  currentPrice: number;
  selectedExpiration?: string | null;
  maxDte?: number;
}): OIChangeRead {
  const currentSurface = args.currentSurface;
  const priorSurface = args.priorSurface;
  const maxDte = Math.max(7, Math.min(90, Math.round(args.maxDte ?? 30)));
  const ticker = normalizeTicker(currentSurface?.ticker ?? priorSurface?.ticker ?? "");

  if (!currentSurface) {
    return emptyRead({
      reason: "no_current_surface",
      ticker,
      headline: "No current OI surface loaded",
      summary: "Run surface harvest before reading positioning changes.",
      maxDte,
    });
  }

  if (!priorSurface) {
    return emptyRead({
      reason: "no_prior_surface",
      ticker: normalizeTicker(currentSurface.ticker),
      headline: "No prior OI surface to compare",
      summary: "Save another surface on a different date to enable the What Changed read.",
      currentSnapshotDate: dateKey(currentSurface.snapshotDate),
      maxDte,
    });
  }

  const comparable = chooseComparableChains({
    currentSurface,
    priorSurface,
    selectedExpiration: args.selectedExpiration,
    maxDte,
  });

  if (!comparable.current.length) {
    return emptyRead({
      reason: "no_comparable_chains",
      ticker: normalizeTicker(currentSurface.ticker),
      headline: "No comparable prior chain found",
      summary: "The current and prior surfaces do not share this expiration inside the selected DTE window.",
      currentSnapshotDate: dateKey(currentSurface.snapshotDate),
      priorSnapshotDate: dateKey(priorSurface.snapshotDate),
      selectedExpiration: dateKey(args.selectedExpiration),
      scopeLabel: comparable.scopeLabel,
      maxDte,
    });
  }

  const callItems: OIChangeItem[] = [];
  const putItems: OIChangeItem[] = [];
  let comparedStrikeCount = 0;
  let ignoredCurrentOnlyCount = 0;
  let ignoredPriorOnlyCount = 0;

  for (const currentChain of comparable.current) {
    const priorChain = comparable.priorByExpiration.get(currentChain.expiration);
    if (!priorChain) continue;

    const currentRows = mapRows(currentChain);
    const priorRows = mapRows(priorChain);
    const currentKeys = [...currentRows.keys()];
    const priorKeys = new Set<number>(priorRows.keys());

    // ΔOI must be an exact row-to-row comparison. Do not treat a missing
    // prior row as zero OI because that creates false "new build" reads when
    // the prior snapshot uses a slightly different chain/strike universe.
    // True new-strike analysis can be added later, but it should be labeled
    // separately from day-over-day ΔOI.
    const matchedStrikes = currentKeys.filter((strike) => priorKeys.has(strike));
    ignoredCurrentOnlyCount += currentKeys.length - matchedStrikes.length;
    ignoredPriorOnlyCount += [...priorRows.keys()].filter((strike) => !currentRows.has(strike)).length;

    for (const strike of matchedStrikes) {
      comparedStrikeCount += 1;
      const currentRow = currentRows.get(strike);
      const priorRow = priorRows.get(strike);
      if (!currentRow || !priorRow) continue;

      const currentCall = currentRow.callOi;
      const priorCall = priorRow.callOi;
      const currentPut = currentRow.putOi;
      const priorPut = priorRow.putOi;
      const callDelta = currentCall - priorCall;
      const putDelta = currentPut - priorPut;

      if (callDelta !== 0) {
        callItems.push(
          makeItem({
            side: "call",
            expiration: currentChain.expiration,
            strike,
            delta: callDelta,
            currentOi: currentCall,
            priorOi: priorCall,
            currentPrice: args.currentPrice,
          }),
        );
      }

      if (putDelta !== 0) {
        putItems.push(
          makeItem({
            side: "put",
            expiration: currentChain.expiration,
            strike,
            delta: putDelta,
            currentOi: currentPut,
            priorOi: priorPut,
            currentPrice: args.currentPrice,
          }),
        );
      }
    }
  }

  const read = buildRead({
    ticker: normalizeTicker(currentSurface.ticker),
    scopeLabel: comparable.scopeLabel,
    currentSnapshotDate: dateKey(currentSurface.snapshotDate),
    priorSnapshotDate: dateKey(priorSurface.snapshotDate),
    selectedExpiration: dateKey(args.selectedExpiration) || null,
    comparedChainCount: comparable.current.length,
    maxDte,
    currentPrice: args.currentPrice,
    callItems,
    putItems,
  });

  if (comparedStrikeCount === 0) {
    return {
      ...read,
      ok: false,
      reason: "no_comparable_chains",
      headline: "No exact comparable strikes found",
      summary: "The current and prior chain shared the expiration, but no strikes matched exactly. ΔOI was not calculated to avoid false build/thin reads.",
      notes: [
        ...read.notes,
        "ΔOI uses exact strike matches only. Missing prior rows are not treated as zero OI.",
      ],
    };
  }

  if (ignoredCurrentOnlyCount > 0 || ignoredPriorOnlyCount > 0) {
    read.notes.push(
      `Ignored ${ignoredCurrentOnlyCount.toLocaleString()} current-only and ${ignoredPriorOnlyCount.toLocaleString()} prior-only strike rows so missing rows do not become false ΔOI.`,
    );
  }

  return read;
}

function emptyRead(args: {
  reason: OIChangeRead["reason"];
  ticker: string;
  headline: string;
  summary: string;
  currentSnapshotDate?: string;
  priorSnapshotDate?: string | null;
  selectedExpiration?: string | null;
  scopeLabel?: string;
  maxDte: number;
}): OIChangeRead {
  return {
    ok: false,
    reason: args.reason,
    ticker: args.ticker,
    scopeLabel: args.scopeLabel ?? `${args.maxDte}D window`,
    currentSnapshotDate: args.currentSnapshotDate ?? "",
    priorSnapshotDate: args.priorSnapshotDate ?? null,
    selectedExpiration: args.selectedExpiration ?? null,
    comparedChainCount: 0,
    maxDte: args.maxDte,
    headline: args.headline,
    summary: args.summary,
    forecastImpact: "No ΔOI adjustment available.",
    tradeUse: {
      csp: "No prior-surface confirmation available.",
      coveredCall: "No prior-surface confirmation available.",
      longCall: "No prior-surface confirmation available.",
    },
    topCallIncreases: [],
    topCallDecreases: [],
    topPutIncreases: [],
    topPutDecreases: [],
    totals: {
      callDelta: 0,
      putDelta: 0,
      netDelta: 0,
      supportPutBuild: 0,
      overheadCallBuild: 0,
      overheadCallThinning: 0,
      putSupportUnwind: 0,
    },
    notes: [],
  };
}
