import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import {
  buildMarketStructureRead,
  type MarketStructureRead,
} from "./session/marketStructureEngine";

export type ZeroDteOpeningMap = {
  version: 2;
  tradeDate: string;
  lockedAt: string;
  spot: number;
  center: number;
  lowerWing: number;
  upperWing: number;
  wingWidth: 50;
  gravity: number;
  putWall: number | null;
  callWall: number | null;
  pin: number | null;
  expectedMove: number;
  dealerPressure: number;
  spxPressure: number;
  spyPressure: number;
  confidence: number;
  /** Kept as an alias for older UI/API payloads. */
  pinScore: number;
  structure: MarketStructureRead;
  rows: ZeroDteChainRow[];
};

const PREFIX = "wheeldesk_zero_dte_opening_map_v2_";
const LEGACY_PREFIX = "wheeldesk_zero_dte_opening_map_v1_";
const FIXED_WING_WIDTH = 50 as const;
const memoryCache = new Map<string, ZeroDteOpeningMap>();

export function getNewYorkTradeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day
    ? `${year}-${month}-${day}`
    : now.toISOString().slice(0, 10);
}

export function getOpeningMapKey(tradeDate: string) {
  return `${PREFIX}${tradeDate}`;
}

export function isValidOpeningMap(
  value: unknown,
  expectedTradeDate?: string,
): value is ZeroDteOpeningMap {
  if (!value || typeof value !== "object") return false;
  const map = value as Partial<ZeroDteOpeningMap>;
  const finite = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input);

  if (map.version !== 2) return false;
  if (
    typeof map.tradeDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(map.tradeDate)
  ) {
    return false;
  }
  if (expectedTradeDate && map.tradeDate !== expectedTradeDate) return false;
  if (
    typeof map.lockedAt !== "string" ||
    !Number.isFinite(Date.parse(map.lockedAt))
  ) {
    return false;
  }
  if (
    !finite(map.spot) ||
    !finite(map.center) ||
    !finite(map.lowerWing) ||
    !finite(map.upperWing)
  ) {
    return false;
  }

  const center = map.center as number;
  const lowerWing = map.lowerWing as number;
  const upperWing = map.upperWing as number;

  if (map.wingWidth !== FIXED_WING_WIDTH) return false;
  if (
    lowerWing !== center - FIXED_WING_WIDTH ||
    upperWing !== center + FIXED_WING_WIDTH
  ) {
    return false;
  }
  if (
    !finite(map.gravity) ||
    !finite(map.expectedMove) ||
    !finite(map.dealerPressure) ||
    !finite(map.spxPressure) ||
    !finite(map.spyPressure) ||
    !finite(map.confidence) ||
    !finite(map.pinScore)
  ) {
    return false;
  }
  if (map.putWall !== null && !finite(map.putWall)) return false;
  if (map.callWall !== null && !finite(map.callWall)) return false;
  if (map.pin !== null && !finite(map.pin)) return false;
  if (!Array.isArray(map.rows)) return false;
  if (!map.structure || typeof map.structure !== "object") return false;
  return true;
}

export function loadOpeningMap(tradeDate: string): ZeroDteOpeningMap | null {
  if (typeof window === "undefined") return null;
  const cached = memoryCache.get(tradeDate);
  if (cached && isValidOpeningMap(cached, tradeDate)) return cached;

  try {
    const raw = window.localStorage.getItem(getOpeningMapKey(tradeDate));
    if (!raw) {
      // A v1 lock is incomplete for Layer 3/6. Remove it so the next live
      // Schwab harvest creates one complete immutable opening snapshot.
      window.localStorage.removeItem(`${LEGACY_PREFIX}${tradeDate}`);
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidOpeningMap(parsed, tradeDate)) {
      window.localStorage.removeItem(getOpeningMapKey(tradeDate));
      return null;
    }
    memoryCache.set(tradeDate, parsed);
    return parsed;
  } catch {
    window.localStorage.removeItem(getOpeningMapKey(tradeDate));
    return null;
  }
}

export function buildOpeningMap(
  tradeDate: string,
  lockedAt: string,
  rec: ZeroDteRecommendation,
  rows: ZeroDteChainRow[] = [],
): ZeroDteOpeningMap {
  const center = Math.round(rec.suggestedCenter / 5) * 5;
  const openingRows = rows.map((row) => ({ ...row }));
  const pin = nullable(rec.spx.strongestPin);
  const putWall = nullable(rec.spx.putWall);
  const callWall = nullable(rec.spx.callWall);
  const expectedMove = Math.max(0, finite(rec.expectedMove));
  const confidence = finite(rec.confidenceScore);

  return {
    version: 2,
    tradeDate,
    lockedAt,
    spot: finite(rec.spxPrice),
    center,
    lowerWing: center - FIXED_WING_WIDTH,
    upperWing: center + FIXED_WING_WIDTH,
    wingWidth: FIXED_WING_WIDTH,
    gravity: finite(rec.spx.gravity),
    putWall,
    callWall,
    pin,
    expectedMove,
    dealerPressure: finite(rec.dealerPressure),
    spxPressure: finite(rec.spxDealerPressure),
    spyPressure: finite(rec.spyDealerPressure),
    confidence,
    pinScore: confidence,
    structure: buildMarketStructureRead({
      spot: finite(rec.spxPrice),
      rows: openingRows,
      callWall,
      putWall,
      pin,
      expectedMove,
    }),
    rows: openingRows,
  };
}

export function lockOpeningMap(
  tradeDate: string,
  lockedAt: string,
  rec: ZeroDteRecommendation,
  rows: ZeroDteChainRow[] = [],
): ZeroDteOpeningMap {
  const existing = loadOpeningMap(tradeDate);
  if (existing) return existing;

  const map = buildOpeningMap(tradeDate, lockedAt, rec, rows);
  memoryCache.set(tradeDate, map);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(getOpeningMapKey(tradeDate), JSON.stringify(map));
    } catch {
      // Keep the complete opening snapshot in memory when browser storage is
      // unavailable or full. A storage failure must never crash the command page.
    }
  }
  return map;
}

export function resetOpeningMap(tradeDate: string) {
  memoryCache.delete(tradeDate);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getOpeningMapKey(tradeDate));
    window.localStorage.removeItem(`${LEGACY_PREFIX}${tradeDate}`);
  } catch {
    // The in-memory lock is already cleared.
  }
}

export function getOpeningExecutionRead(map: ZeroDteOpeningMap, spot: number) {
  const distanceFromCenter = spot - map.center;
  const nearCenter = Math.abs(distanceFromCenter) <= 10;
  const nearUpperEdge = spot >= map.upperWing - 12;
  const nearLowerEdge = spot <= map.lowerWing + 12;
  const stronglyBullish = map.dealerPressure >= 40;
  const stronglyBearish = map.dealerPressure <= -40;

  if (nearUpperEdge && stronglyBullish) {
    return {
      mode: "BREAKOUT — DO NOT FADE",
      detail:
        "Upper wing is under bullish pressure. Favor directional put-side premium only after confirmation.",
    };
  }
  if (nearLowerEdge && stronglyBearish) {
    return {
      mode: "BREAKDOWN — DO NOT FADE",
      detail:
        "Lower wing is under bearish pressure. Favor directional call-side premium only after confirmation.",
    };
  }
  if (nearUpperEdge) {
    return {
      mode: "UPPER EDGE WATCH",
      detail:
        "Wait for rejection before considering an edge-loaded fly or call credit spread.",
    };
  }
  if (nearLowerEdge) {
    return {
      mode: "LOWER EDGE WATCH",
      detail:
        "Wait for absorption before considering an edge-loaded fly or put credit spread.",
    };
  }
  if (
    nearCenter &&
    Math.abs(map.dealerPressure) <= 15 &&
    map.pinScore >= 70
  ) {
    return {
      mode: "CENTER PIN WATCH",
      detail:
        "Fly is conditional on actual compression; do not enter merely because price is near center.",
    };
  }
  if (spot > map.center) {
    return {
      mode: "PUT CREDIT SPREAD BIAS",
      detail:
        "Opening map is bullish-side. Credit spread is preferred over an unconfirmed opening fly.",
    };
  }
  if (spot < map.center) {
    return {
      mode: "CALL CREDIT SPREAD BIAS",
      detail:
        "Opening map is bearish-side. Credit spread is preferred over an unconfirmed opening fly.",
    };
  }
  return {
    mode: "WAIT",
    detail: "Opening harvest is the map, not an automatic entry.",
  };
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function nullable(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : null;
}
