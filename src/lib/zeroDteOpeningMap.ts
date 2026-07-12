import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";

export type ZeroDteOpeningMap = {
  tradeDate: string;
  lockedAt: string;
  center: number;
  lowerWing: number;
  upperWing: number;
  wingWidth: 50;
  gravity: number;
  putWall: number;
  callWall: number;
  dealerPressure: number;
  pinScore: number;
};

const PREFIX = "wheeldesk_zero_dte_opening_map_v1_";

export function getOpeningMapKey(tradeDate: string) {
  return `${PREFIX}${tradeDate}`;
}

export function loadOpeningMap(tradeDate: string): ZeroDteOpeningMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getOpeningMapKey(tradeDate));
    return raw ? (JSON.parse(raw) as ZeroDteOpeningMap) : null;
  } catch {
    return null;
  }
}

export function lockOpeningMap(tradeDate: string, lockedAt: string, rec: ZeroDteRecommendation): ZeroDteOpeningMap {
  const existing = loadOpeningMap(tradeDate);
  if (existing) return existing;

  const center = Math.round(rec.suggestedCenter / 5) * 5;
  const map: ZeroDteOpeningMap = {
    tradeDate,
    lockedAt,
    center,
    lowerWing: center - 50,
    upperWing: center + 50,
    wingWidth: 50,
    gravity: rec.spx.gravity ?? 0,
    putWall: rec.spx.putWall ?? 0,
    callWall: rec.spx.callWall ?? 0,
    dealerPressure: rec.dealerPressure ?? 0,
    pinScore: rec.confidenceScore ?? 0,
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(getOpeningMapKey(tradeDate), JSON.stringify(map));
  }
  return map;
}

export function resetOpeningMap(tradeDate: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getOpeningMapKey(tradeDate));
}

export function getOpeningExecutionRead(map: ZeroDteOpeningMap, spot: number) {
  const distanceFromCenter = spot - map.center;
  const nearCenter = Math.abs(distanceFromCenter) <= 10;
  const nearUpperEdge = spot >= map.upperWing - 12;
  const nearLowerEdge = spot <= map.lowerWing + 12;
  const stronglyBullish = map.dealerPressure >= 40;
  const stronglyBearish = map.dealerPressure <= -40;

  if (nearUpperEdge && stronglyBullish) return { mode: "BREAKOUT — DO NOT FADE", detail: "Upper wing is under bullish pressure. Favor directional put-side premium only after confirmation." };
  if (nearLowerEdge && stronglyBearish) return { mode: "BREAKDOWN — DO NOT FADE", detail: "Lower wing is under bearish pressure. Favor directional call-side premium only after confirmation." };
  if (nearUpperEdge) return { mode: "UPPER EDGE WATCH", detail: "Wait for rejection before considering an edge-loaded fly or call credit spread." };
  if (nearLowerEdge) return { mode: "LOWER EDGE WATCH", detail: "Wait for absorption before considering an edge-loaded fly or put credit spread." };
  if (nearCenter && Math.abs(map.dealerPressure) <= 15 && map.pinScore >= 70) return { mode: "CENTER PIN WATCH", detail: "Fly is conditional on actual compression; do not enter merely because price is near center." };
  if (spot > map.center) return { mode: "PUT CREDIT SPREAD BIAS", detail: "Opening map is bullish-side. Credit spread is preferred over an unconfirmed opening fly." };
  if (spot < map.center) return { mode: "CALL CREDIT SPREAD BIAS", detail: "Opening map is bearish-side. Credit spread is preferred over an unconfirmed opening fly." };
  return { mode: "WAIT", detail: "Opening harvest is the map, not an automatic entry." };
}
