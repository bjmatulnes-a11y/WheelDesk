import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import { buildOpeningMap, isValidOpeningMap } from "./zeroDteOpeningMap";
import { buildZeroDteStrikeFlowRead, type StrikeFlowSnapshot } from "./zeroDteStrikeFlow";

export type ZeroDteDiagnosticCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export function runZeroDteSystemDiagnostics(): ZeroDteDiagnosticCheck[] {
  const recommendation = makeRecommendation();
  const openingMap = buildOpeningMap("2026-07-10", "2026-07-10T13:35:00.000Z", recommendation);

  const previous = snapshot("2026-07-10T14:00:00.000Z", 7496, 100, 100);
  const defended = snapshot("2026-07-10T14:05:00.000Z", 7494, 500, 120);
  const attacked = snapshot("2026-07-10T14:10:00.000Z", 7505, 900, 140);

  const defendedRead = buildZeroDteStrikeFlowRead(defended, previous, recommendation);
  const attackedRead = buildZeroDteStrikeFlowRead(attacked, defended, recommendation);

  return [
    {
      id: "opening-map-width",
      label: "Opening map remains fixed at ±50",
      passed: openingMap.lowerWing === openingMap.center - 50 && openingMap.upperWing === openingMap.center + 50,
      detail: `${openingMap.lowerWing} / ${openingMap.center} / ${openingMap.upperWing}`,
    },
    {
      id: "opening-map-validation",
      label: "Opening-map schema rejects malformed locks",
      passed: isValidOpeningMap(openingMap, "2026-07-10") && !isValidOpeningMap({ ...openingMap, upperWing: openingMap.upperWing + 5 }, "2026-07-10"),
      detail: "Trade date, timestamp, finite values and exact 50-point geometry are checked.",
    },
    {
      id: "volume-delta",
      label: "Strike-flow delta uses sequential harvests",
      passed: defendedRead.totalCallVolumeDelta === 400 && defendedRead.totalPutVolumeDelta === 20,
      detail: `Call Δ ${defendedRead.totalCallVolumeDelta}; Put Δ ${defendedRead.totalPutVolumeDelta}`,
    },
    {
      id: "call-wall-defense",
      label: "Call-wall rejection can classify as defended",
      passed: defendedRead.callWall.state === "defended",
      detail: `State: ${defendedRead.callWall.state}`,
    },
    {
      id: "call-wall-attack",
      label: "Call-wall acceptance can classify as attacked",
      passed: attackedRead.callWall.state === "attacked",
      detail: `State: ${attackedRead.callWall.state}`,
    },
  ];
}

function snapshot(generatedAt: string, spxPrice: number, callVolume: number, putVolume: number): StrikeFlowSnapshot {
  return {
    tradeDate: "2026-07-10",
    generatedAt,
    expiration: "2026-07-10",
    spxPrice,
    rows: [
      { strike: 7500, optionType: "call", volume: callVolume, openInterest: 1000 },
      { strike: 7500, optionType: "put", volume: putVolume, openInterest: 1000 },
    ],
  };
}

function makeRecommendation(): ZeroDteRecommendation {
  return {
    spxPrice: 7494,
    spyPrice: 749.4,
    spyToSpxRatio: 10,
    expectedMove: 50,
    suggestedCenter: 7500,
    suggestedWingWidth: 50,
    lowerWing: 7450,
    upperWing: 7550,
    confidenceScore: 80,
    alignmentScore: 80,
    dealerPressure: 0,
    dealerPressureLabel: "neutral",
    spx: {
      gravity: 7500,
      strongestPin: 7500,
      putWall: 7450,
      callWall: 7500,
      totalOi: 2000,
      totalNotional: 0,
      clusters: [],
    },
    spy: {
      gravity: 750,
      strongestPin: 750,
      putWall: 745,
      callWall: 755,
      totalOi: 0,
      totalNotional: 0,
      clusters: [],
    },
    spxChainMap: [],
    spyAlignmentMap: [],
    reasons: [],
    warnings: [],
  } as unknown as ZeroDteRecommendation;
}
