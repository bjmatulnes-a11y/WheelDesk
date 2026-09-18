import type {
  LiquidityZoneRead,
  LiquidityZoneState,
  ProjectedLiquidityZone,
} from "./zeroDteLiquidityZones";

const STORAGE_PREFIX = "wheeldesk:zero-dte:liquidity-zone-memory:v4:";
const LEGACY_STORAGE_PREFIX = "wheeldesk:zero-dte:liquidity-zone-memory:v3:";
const MAX_MEMORY_ZONES = 40;
const MAX_SESSION_AGE_MS = 4 * 60 * 60_000;
const RETAINED_STRENGTH_FLOOR = 15;
const RENDER_STRENGTH_THRESHOLD = 28;
const DECAY_HOURS = 1.5;
const BREAK_BUFFER_POINTS = 1.25;
const REVISIT_RESET_MS = 8 * 60_000;

export function liquidityZoneSessionKey(timestamp?: string | null) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function loadLiquidityZoneMemory(sessionKey: string): ProjectedLiquidityZone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${sessionKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      sessionKey?: string;
      savedAt?: string;
      zones?: ProjectedLiquidityZone[];
    };
    if (parsed.sessionKey !== sessionKey || !Array.isArray(parsed.zones)) return [];
    return parsed.zones
      .filter(validStoredZone)
      .slice(0, MAX_MEMORY_ZONES)
      .map((zone) => ({ ...zone, memoryStatus: "RETAINED" as const }));
  } catch {
    return [];
  }
}

export function saveLiquidityZoneMemory(
  sessionKey: string,
  zones: ProjectedLiquidityZone[],
) {
  if (typeof window === "undefined") return;
  try {
    const compact = zones
      .filter(validStoredZone)
      .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
      .slice(0, MAX_MEMORY_ZONES);
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${sessionKey}`,
      JSON.stringify({
        version: 4,
        sessionKey,
        savedAt: new Date().toISOString(),
        zones: compact,
      }),
    );

    // Keep storage bounded to the current market date. This is browser-local
    // housekeeping only and never touches Supabase.
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (
        key?.startsWith(LEGACY_STORAGE_PREFIX) ||
        (key?.startsWith(STORAGE_PREFIX) && key !== `${STORAGE_PREFIX}${sessionKey}`)
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be disabled/private-mode constrained. The live in-memory
    // registry still works for the current mounted session.
  }
}

export function mergeLiquidityZoneMemory(args: {
  live: LiquidityZoneRead;
  retained: ProjectedLiquidityZone[];
  now?: string | null;
}): LiquidityZoneRead {
  const nowIso = args.now ?? args.live.generatedAt ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const basis = args.live.basisEsMinusSpx;
  const registry = new Map<string, ProjectedLiquidityZone>();

  for (const oldZone of args.retained) {
    const ageMs = safeAge(nowMs, Date.parse(oldZone.lastAt));
    if (ageMs > MAX_SESSION_AGE_MS) continue;
    registry.set(oldZone.id, reprojectRetained(oldZone, basis, ageMs, args.live.currentEs));
  }

  for (const liveZone of args.live.registry) {
    // The live builder has already deconflicted this ES bucket. Remove stale
    // retained identities at the same bucket so BALANCED truly replaces the
    // old SUPPLY/DEMAND pair (and a later directional zone replaces BALANCED).
    purgeCompetingBucketEntries(registry, liveZone);
    const oldZone = registry.get(liveZone.id);

    // A broken polarity does not silently resurrect just because the old side
    // appears again in top-of-book samples. It must first flip back through a
    // decisive break of the opposite-side zone.
    if (oldZone?.state === "BROKEN" && !liveZone.flippedFrom) continue;

    const revisitGap = oldZone
      ? Date.parse(liveZone.firstAt) - Date.parse(oldZone.lastAt)
      : 0;
    const resetPeak = oldZone != null && revisitGap > REVISIT_RESET_MS;

    const oldPeakStrength = oldZone?.peakStrength ?? oldZone?.strength ?? 0;
    const liveSetsPeak = resetPeak || liveZone.strength >= oldPeakStrength;
    registry.set(liveZone.id, {
      ...liveZone,
      firstAt: olderTimestamp(oldZone?.firstAt, liveZone.firstAt),
      peakStrength: liveSetsPeak
        ? liveZone.strength
        : oldPeakStrength,
      peakConfidencePct: resetPeak
        ? liveZone.confidencePct
        : Math.max(
            liveZone.confidencePct,
            oldZone?.peakConfidencePct ?? oldZone?.confidencePct ?? 0,
          ),
      peakState: liveSetsPeak
        ? liveZone.state
        : oldZone?.peakState ?? oldZone?.state ?? liveZone.state,
      flippedFrom: oldZone?.flippedFrom ?? liveZone.flippedFrom ?? null,
      brokenAt: null,
      memoryStatus: "LIVE",
    });
  }

  applyBreaksAndPolarityFlips(registry, args.live.currentEs, nowIso, basis);

  const retainedRegistry = [...registry.values()]
    .sort(memoryRank)
    .slice(0, MAX_MEMORY_ZONES);

  const relevantSupply = relevantRemembered(
    retainedRegistry.filter((zone) => zone.side === "SUPPLY"),
    args.live.currentEs,
  );
  const relevantDemand = relevantRemembered(
    retainedRegistry.filter((zone) => zone.side === "DEMAND"),
    args.live.currentEs,
  );
  const relevantBalanced = relevantRemembered(
    retainedRegistry.filter((zone) => zone.side === "BALANCED"),
    args.live.currentEs,
  );

  return {
    ...args.live,
    supply: relevantSupply.slice(0, 8),
    demand: relevantDemand.slice(0, 8),
    balanced: relevantBalanced.slice(0, 4),
    registry: retainedRegistry,
    retainedCount: retainedRegistry.filter((zone) => zone.memoryStatus === "RETAINED").length,
  };
}

function applyBreaksAndPolarityFlips(
  registry: Map<string, ProjectedLiquidityZone>,
  currentEs: number | null,
  nowIso: string,
  basis: number | null,
) {
  if (currentEs == null) return;

  for (const [id, zone] of [...registry.entries()]) {
    if (zone.side === "BALANCED" || zone.state === "BROKEN") continue;
    const broken = zone.side === "SUPPLY"
      ? currentEs > zone.highEs + BREAK_BUFFER_POINTS
      : currentEs < zone.lowEs - BREAK_BUFFER_POINTS;
    if (!broken) continue;

    const brokenZone: ProjectedLiquidityZone = {
      ...zone,
      state: "BROKEN",
      peakState: zone.peakState ?? zone.state,
      brokenAt: nowIso,
      memoryStatus: zone.memoryStatus,
    };
    registry.set(id, brokenZone);

    const nextSide = zone.side === "SUPPLY" ? "DEMAND" : "SUPPLY";
    const bucketCenter = Math.round(zone.centerEs / 2) * 2;
    const flipId = `${nextSide}:${bucketCenter.toFixed(2)}`;
    const existing = registry.get(flipId);

    if (existing && existing.state !== "BROKEN") {
      registry.set(flipId, {
        ...existing,
        flippedFrom: existing.flippedFrom ?? zone.side,
        brokenAt: existing.brokenAt ?? nowIso,
      });
      continue;
    }

    const flipStrength = round(Math.max(24, zone.strength * 0.58));
    const flipConfidence = round(Math.max(20, zone.confidencePct * 0.62));
    registry.set(flipId, {
      ...zone,
      id: flipId,
      side: nextSide,
      state: "FORMING",
      lowSpx: basis == null ? zone.lowSpx : zone.lowEs - basis,
      highSpx: basis == null ? zone.highSpx : zone.highEs - basis,
      centerSpx: basis == null ? zone.centerSpx : zone.centerEs - basis,
      basisEsMinusSpx: basis ?? zone.basisEsMinusSpx,
      strength: flipStrength,
      confidencePct: flipConfidence,
      memoryStatus: "RETAINED",
      firstAt: nowIso,
      lastAt: nowIso,
      peakStrength: flipStrength,
      peakConfidencePct: flipConfidence,
      peakState: "FORMING",
      flippedFrom: zone.side,
      brokenAt: null,
    });
  }
}

function reprojectRetained(
  zone: ProjectedLiquidityZone,
  basis: number | null,
  ageMs: number,
  currentEs: number | null,
): ProjectedLiquidityZone {
  const peakStrength = zone.peakStrength ?? zone.strength;
  const peakConfidencePct = zone.peakConfidencePct ?? zone.confidencePct;
  const peakState = normalizePeakState(zone.peakState ?? zone.state);
  const ageHours = ageMs / 3_600_000;
  const decayedStrength = Math.max(
    RETAINED_STRENGTH_FLOOR,
    peakStrength * Math.exp(-ageHours / DECAY_HOURS),
  );
  const decayedConfidence = Math.max(16, peakConfidencePct * Math.exp(-ageHours / 2.25));
  const testing = currentEs != null && currentEs >= zone.lowEs && currentEs <= zone.highEs;

  let retainedState: LiquidityZoneState;
  if (zone.state === "BROKEN") {
    retainedState = "BROKEN";
  } else if (testing) {
    retainedState = "TESTING";
  } else if (ageMs < 10 * 60_000) {
    retainedState = peakState;
  } else if (ageMs <= 30 * 60_000) {
    retainedState = "WEAKENING";
  } else {
    retainedState = "DORMANT";
  }

  // Retained projections are always re-derived from ES geometry + the current
  // basis. If basis is unavailable, return null SPX geometry rather than stale
  // coordinates from an earlier basis snapshot.
  const lowSpx = basis == null ? null : zone.lowEs - basis;
  const highSpx = basis == null ? null : zone.highEs - basis;
  const centerSpx = basis == null ? null : zone.centerEs - basis;
  assertRetainedProjectionWidth(zone, lowSpx, highSpx);

  return {
    ...zone,
    state: retainedState,
    lowSpx,
    highSpx,
    centerSpx,
    basisEsMinusSpx: basis,
    strength: round(decayedStrength),
    confidencePct: round(decayedConfidence),
    recencyPct: round(Math.max(5, 100 * Math.exp(-ageMs / (45 * 60_000)))),
    memoryStatus: "RETAINED",
    peakStrength: round(peakStrength),
    peakConfidencePct: round(peakConfidencePct),
    peakState,
  };
}

function normalizePeakState(state: LiquidityZoneState): LiquidityZoneState {
  if (state === "DORMANT" || state === "WEAKENING") return "ACTIVE";
  if (state === "BROKEN") return "ACTIVE";
  return state;
}

function assertRetainedProjectionWidth(
  zone: ProjectedLiquidityZone,
  lowSpx: number | null,
  highSpx: number | null,
) {
  if (lowSpx == null || highSpx == null) return;
  const esWidth = zone.highEs - zone.lowEs;
  const spxWidth = highSpx - lowSpx;
  if (Math.abs(spxWidth - esWidth) > 0.001) {
    console.warn(`[WheelDesk] Retained liquidity-zone projection width invariant failed for ${zone.id}: ${spxWidth.toFixed(4)} vs ES ${esWidth.toFixed(4)}`);
  }
}

function purgeCompetingBucketEntries(
  registry: Map<string, ProjectedLiquidityZone>,
  liveZone: ProjectedLiquidityZone,
) {
  const liveBucket = canonicalBucketCenter(liveZone.centerEs);
  for (const [id, zone] of registry.entries()) {
    if (id === liveZone.id) continue;
    if (Math.abs(canonicalBucketCenter(zone.centerEs) - liveBucket) > 0.001) continue;
    registry.delete(id);
  }
}

function canonicalBucketCenter(centerEs: number) {
  return Math.round(centerEs / 2) * 2;
}

function relevantRemembered(
  zones: ProjectedLiquidityZone[],
  currentEs: number | null,
) {
  return zones
    .filter((zone) => {
      if (zone.state === "BROKEN") return false;
      if (zone.strength < RENDER_STRENGTH_THRESHOLD) return false;
      if (currentEs == null) return true;
      if (zone.side === "BALANCED") {
        return distanceToZone(currentEs, zone.lowEs, zone.highEs) <= 60;
      }
      return zone.side === "SUPPLY"
        ? zone.highEs >= currentEs - 1.5
        : zone.lowEs <= currentEs + 1.5;
    })
    .sort((a, b) => {
      if (currentEs == null) return b.strength - a.strength;
      const da = distanceToZone(currentEs, a.lowEs, a.highEs);
      const db = distanceToZone(currentEs, b.lowEs, b.highEs);
      if (Math.abs(da - db) > 3) return da - db;
      if (a.memoryStatus !== b.memoryStatus) return a.memoryStatus === "LIVE" ? -1 : 1;
      return b.strength - a.strength;
    });
}

function memoryRank(a: ProjectedLiquidityZone, b: ProjectedLiquidityZone) {
  if (a.state === "BROKEN" && b.state !== "BROKEN") return 1;
  if (b.state === "BROKEN" && a.state !== "BROKEN") return -1;
  const aPeak = a.peakStrength ?? a.strength;
  const bPeak = b.peakStrength ?? b.strength;
  if (Math.abs(bPeak - aPeak) > 5) return bPeak - aPeak;
  return Date.parse(b.lastAt) - Date.parse(a.lastAt);
}

function validStoredZone(zone: ProjectedLiquidityZone) {
  return Boolean(
    zone &&
      typeof zone.id === "string" &&
      (zone.side === "SUPPLY" || zone.side === "DEMAND" || zone.side === "BALANCED") &&
      Number.isFinite(zone.lowEs) &&
      Number.isFinite(zone.highEs) &&
      Number.isFinite(zone.centerEs) &&
      typeof zone.lastAt === "string",
  );
}

function olderTimestamp(a: string | undefined, b: string) {
  if (!a) return b;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function safeAge(nowMs: number, thenMs: number) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return 0;
  return Math.max(0, nowMs - thenMs);
}

function distanceToZone(price: number, low: number, high: number) {
  if (price < low) return low - price;
  if (price > high) return price - high;
  return 0;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
