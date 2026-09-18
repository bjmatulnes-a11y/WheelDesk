import type {
  LiquidityZoneRead,
  ProjectedLiquidityZone,
} from "./zeroDteLiquidityZones";

const STORAGE_PREFIX = "wheeldesk:zero-dte:liquidity-zone-memory:v2:";
const MAX_MEMORY_ZONES = 40;
const MAX_SESSION_AGE_MS = 10 * 60 * 60_000;
const RETAINED_STRENGTH_FLOOR = 28;

export function liquidityZoneSessionKey(timestamp?: string | null) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
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
        version: 2,
        sessionKey,
        savedAt: new Date().toISOString(),
        zones: compact,
      }),
    );

    // Keep storage bounded to the current market date. This is browser-local
    // housekeeping only and never touches Supabase.
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX) && key !== `${STORAGE_PREFIX}${sessionKey}`) {
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
    registry.set(oldZone.id, reprojectRetained(oldZone, basis, ageMs));
  }

  for (const liveZone of args.live.registry) {
    const oldZone = registry.get(liveZone.id);
    registry.set(liveZone.id, {
      ...liveZone,
      firstAt: olderTimestamp(oldZone?.firstAt, liveZone.firstAt),
      peakStrength: Math.max(liveZone.strength, oldZone?.peakStrength ?? oldZone?.strength ?? 0),
      peakConfidencePct: Math.max(
        liveZone.confidencePct,
        oldZone?.peakConfidencePct ?? oldZone?.confidencePct ?? 0,
      ),
      memoryStatus: "LIVE",
    });
  }

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

  return {
    ...args.live,
    supply: relevantSupply.slice(0, 8),
    demand: relevantDemand.slice(0, 8),
    registry: retainedRegistry,
    retainedCount: retainedRegistry.filter((zone) => zone.memoryStatus === "RETAINED").length,
  };
}

function reprojectRetained(
  zone: ProjectedLiquidityZone,
  basis: number | null,
  ageMs: number,
): ProjectedLiquidityZone {
  const peakStrength = zone.peakStrength ?? zone.strength;
  const peakConfidencePct = zone.peakConfidencePct ?? zone.confidencePct;
  const ageHours = ageMs / 3_600_000;
  const decayedStrength = Math.max(
    RETAINED_STRENGTH_FLOOR,
    peakStrength * Math.exp(-ageHours / 7),
  );
  const decayedConfidence = Math.max(20, peakConfidencePct * Math.exp(-ageHours / 8));
  const basisChanged = basis != null;

  return {
    ...zone,
    state: zone.state === "BROKEN" ? "BROKEN" : "WEAKENING",
    lowSpx: basisChanged ? zone.lowEs - basis : zone.lowSpx,
    highSpx: basisChanged ? zone.highEs - basis : zone.highSpx,
    centerSpx: basisChanged ? zone.centerEs - basis : zone.centerSpx,
    basisEsMinusSpx: basisChanged ? basis : zone.basisEsMinusSpx,
    strength: round(decayedStrength),
    confidencePct: round(decayedConfidence),
    recencyPct: round(Math.max(8, 100 * Math.exp(-ageMs / (75 * 60_000)))),
    memoryStatus: "RETAINED",
    peakStrength: round(peakStrength),
    peakConfidencePct: round(peakConfidencePct),
  };
}

function relevantRemembered(
  zones: ProjectedLiquidityZone[],
  currentEs: number | null,
) {
  return zones
    .filter((zone) => {
      if (zone.state === "BROKEN") return false;
      if (zone.strength < RETAINED_STRENGTH_FLOOR) return false;
      if (currentEs == null) return true;
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
      (zone.side === "SUPPLY" || zone.side === "DEMAND") &&
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
