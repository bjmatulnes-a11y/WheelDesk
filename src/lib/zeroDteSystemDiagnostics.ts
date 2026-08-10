import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import {
  buildOpeningMap,
  isOpeningMapCaptureOnTime,
  isValidOpeningMap,
} from "./zeroDteOpeningMap";
import {
  buildZeroDteStrikeFlowRead,
  type StrikeFlowSnapshot,
} from "./zeroDteStrikeFlow";
import {
  getControllingMarketMap,
  updateSessionMapManager,
  type MarketMapSnapshot,
  type SessionMapManagerState,
} from "./session/mapEngine";
import { buildPremiumCrestRead, type PremiumTapeLike } from "./zeroDtePremiumCrestEngine";
import { classifyZeroDteTimeRegime } from "./zeroDteTimeRegime";

export type ZeroDteDiagnosticCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export function runZeroDteSystemDiagnostics(): ZeroDteDiagnosticCheck[] {
  const recommendation = makeRecommendation();
  const openingMap = buildOpeningMap(
    "2026-07-10",
    "2026-07-10T13:35:00.000Z",
    recommendation,
  );

  const previous = snapshot("2026-07-10T14:00:00.000Z", 7496, 100, 100);
  const defended = snapshot("2026-07-10T14:01:00.000Z", 7494, 500, 120);
  const attacked = snapshot("2026-07-10T14:02:00.000Z", 7505, 900, 140);

  const defendedRead = buildZeroDteStrikeFlowRead(defended, previous, recommendation);
  const attackedRead = buildZeroDteStrikeFlowRead(attacked, defended, recommendation);

  const coveragePrevious: StrikeFlowSnapshot = {
    ...snapshot("2026-07-10T14:03:00.000Z", 7500, 100, 100),
    rows: [
      { strike: 7500, optionType: "call", volume: 100, openInterest: 1000 },
      { strike: 7500, optionType: "put", volume: 100, openInterest: 1000 },
    ],
  };
  const coverageCurrent: StrikeFlowSnapshot = {
    ...snapshot("2026-07-10T14:04:00.000Z", 7501, 120, 115),
    rows: [
      { strike: 7500, optionType: "call", volume: 120, openInterest: 1000 },
      { strike: 7500, optionType: "put", volume: 115, openInterest: 1000 },
      // Newly visible strike already traded 900 contracts earlier in the day.
      // It must baseline first instead of appearing as 900 fresh 1m contracts.
      { strike: 7550, optionType: "call", volume: 900, openInterest: 1200 },
      { strike: 7550, optionType: "put", volume: 300, openInterest: 800 },
    ],
  };
  const coverageRead = buildZeroDteStrikeFlowRead(
    coverageCurrent,
    coveragePrevious,
    recommendation,
  );
  const newStrikeFlow = coverageRead.rows.find((row) => row.strike === 7550);

  const activeB = mapSnapshot({
    capturedAt: "2026-07-10T15:00:00.000Z",
    center: 7560,
    spot: 7560,
    callWall: 7600,
    putWall: 7520,
  });
  const candidateC = mapSnapshot({
    capturedAt: "2026-07-10T15:01:00.000Z",
    center: 7620,
    spot: 7620,
    callWall: 7660,
    putWall: 7580,
  });
  const transitionState = transitionFromActive(activeB, candidateC);
  const controllingDuringTransition = getControllingMarketMap(transitionState);

  const failedCandidateLive = mapSnapshot({
    capturedAt: "2026-07-10T15:02:00.000Z",
    center: 7560,
    spot: 7560,
    callWall: 7600,
    putWall: 7520,
  });
  const failedFlow = {
    ...attackedRead,
    generatedAt: failedCandidateLive.capturedAt,
    officialThrough: failedCandidateLive.capturedAt,
    closedMinuteKey: "2026-07-10T15:01",
  };
  const reverted = updateSessionMapManager(
    transitionState,
    failedCandidateLive,
    failedFlow,
  );

  const structureOnlyLive = mapSnapshot({
    capturedAt: "2026-07-10T15:03:00.000Z",
    center: 7620,
    spot: 7620,
    callWall: 7660,
    putWall: 7580,
  });
  const neutralFreshFlow = {
    ...attackedRead,
    generatedAt: structureOnlyLive.capturedAt,
    officialThrough: structureOnlyLive.capturedAt,
    closedMinuteKey: "2026-07-10T15:02",
    elapsedMinutes: 1,
    currentSpxPrice: structureOnlyLive.spot,
    previousSpxPrice: structureOnlyLive.spot - 1,
    priceChange: 1,
    priceChange1m: 1,
    priceChange5m: null,
    priceChangeConfirmation: null,
    priceChange15m: null,
    confirmationReady: false,
    rows: [],
    mapDirection: "BUILDING" as const,
    mapConfirmationScore: 0,
    mapMessage: "Fresh flow exists, but it does not independently confirm migration.",
  };
  const structureOnlyResult = updateSessionMapManager(
    {
      ...transitionState,
      phase: "ACTIVE",
      candidate: null,
      transitionFrom: null,
      transitionFromPhase: null,
      latest: activeB,
      previousLive: null,
      confirmationCount: 0,
      lastConfirmationMinuteKey: "2026-07-10T15:01",
      railBreached: "NONE",
      railBreachStartedAt: null,
      outsideMinutes: 0,
      migrationScore: 0,
      migrationConfirmationMode: "NONE",
    },
    structureOnlyLive,
    neutralFreshFlow,
  );


  const premiumBase = Date.parse("2026-07-10T15:00:00.000Z");
  const violentPremium: PremiumTapeLike[] = [];
  addPremiumBar(violentPremium, premiumBase, 0, 4.0);
  addPremiumBar(violentPremium, premiumBase, 1, 4.2);
  addPremiumBar(violentPremium, premiumBase, 2, 4.5);
  addPremiumBar(violentPremium, premiumBase, 3, 3.95);
  const violentRollover = buildPremiumCrestRead({
    samples: violentPremium,
    generatedAt: new Date(premiumBase + 4 * 60_000 + 5_000).toISOString(),
    currentCredit: 3.95,
  });

  const livePremium: PremiumTapeLike[] = [];
  addPremiumBar(livePremium, premiumBase, 0, 4.0);
  addPremiumBar(livePremium, premiumBase, 1, 4.2);
  addPremiumBar(livePremium, premiumBase, 2, 4.5);
  livePremium.push(
    { timestamp: new Date(premiumBase + 3 * 60_000 + 5_000).toISOString(), credit: 4.47 },
    { timestamp: new Date(premiumBase + 3 * 60_000 + 15_000).toISOString(), credit: 4.41 },
    { timestamp: new Date(premiumBase + 3 * 60_000 + 25_000).toISOString(), credit: 4.34 },
  );
  const liveRollover = buildPremiumCrestRead({
    samples: livePremium,
    generatedAt: new Date(premiumBase + 3 * 60_000 + 25_000).toISOString(),
    currentCredit: 4.34,
  });

  const noisePremium: PremiumTapeLike[] = [];
  addPremiumBar(noisePremium, premiumBase, 0, 4.0);
  addPremiumBar(noisePremium, premiumBase, 1, 4.2);
  addPremiumBar(noisePremium, premiumBase, 2, 4.5);
  noisePremium.push(
    { timestamp: new Date(premiumBase + 3 * 60_000 + 5_000).toISOString(), credit: 4.49 },
    { timestamp: new Date(premiumBase + 3 * 60_000 + 15_000).toISOString(), credit: 4.48 },
    { timestamp: new Date(premiumBase + 3 * 60_000 + 25_000).toISOString(), credit: 4.49 },
  );
  const noiseRead = buildPremiumCrestRead({
    samples: noisePremium,
    generatedAt: new Date(premiumBase + 3 * 60_000 + 25_000).toISOString(),
    currentCredit: 4.49,
  });

  const openingRegime = classifyZeroDteTimeRegime({
    generatedAt: "2026-07-10T14:30:00.000Z",
    hasEnteredToday: false,
  });
  return [
    {
      id: "opening-map-width",
      label: "Opening map remains fixed at ±50",
      passed:
        openingMap.lowerWing === openingMap.center - 50 &&
        openingMap.upperWing === openingMap.center + 50,
      detail: `${openingMap.lowerWing} / ${openingMap.center} / ${openingMap.upperWing}`,
    },
    {
      id: "opening-map-validation",
      label: "Opening-map schema rejects malformed locks",
      passed:
        isValidOpeningMap(openingMap, "2026-07-10") &&
        !isValidOpeningMap(
          { ...openingMap, upperWing: openingMap.upperWing + 5 },
          "2026-07-10",
        ),
      detail:
        "Trade date, timestamp, finite values and exact 50-point geometry are checked.",
    },
    {
      id: "opening-map-time-window",
      label: "Opening map timing rejects a midday browser lock",
      passed:
        isOpeningMapCaptureOnTime("2026-07-10T13:35:00.000Z") &&
        !isOpeningMapCaptureOnTime("2026-07-10T14:00:05.000Z") &&
        !isOpeningMapCaptureOnTime("2026-07-10T16:15:00.000Z"),
      detail: "08:30–08:59 CT is valid; 09:00:05 and 11:15 CT are not.",
    },
    {
      id: "volume-delta",
      label: "Closed-minute strike-flow delta uses sequential snapshots",
      passed:
        defendedRead.totalCallVolumeDelta === 400 &&
        defendedRead.totalPutVolumeDelta === 20,
      detail: `Call Δ ${defendedRead.totalCallVolumeDelta}; Put Δ ${defendedRead.totalPutVolumeDelta}`,
    },
    {
      id: "coverage-is-not-zero",
      label: "A newly visible strike cannot manufacture cumulative volume as 1m flow",
      passed:
        newStrikeFlow?.callVolumeDelta1m === 0 &&
        newStrikeFlow?.putVolumeDelta1m === 0,
      detail: `New 7550 strike 1m flow: call ${newStrikeFlow?.callVolumeDelta1m ?? "missing"}, put ${newStrikeFlow?.putVolumeDelta1m ?? "missing"}.`,
    },
    {
      id: "call-wall-defense",
      label: "Completed-minute call-wall rejection classifies as defended",
      passed: defendedRead.callWall.state === "defended",
      detail: `State: ${defendedRead.callWall.state}`,
    },
    {
      id: "call-wall-attack",
      label: "Completed-minute call-wall acceptance classifies as attacked",
      passed: attackedRead.callWall.state === "attacked",
      detail: `State: ${attackedRead.callWall.state}`,
    },
    {
      id: "transition-authority",
      label: "Unconfirmed replacement never becomes the controlling map",
      passed:
        controllingDuringTransition.center === activeB.center &&
        controllingDuringTransition.capturedAt === activeB.capturedAt,
      detail: `Confirmed B ${activeB.center}; candidate C ${candidateC.center}; controlling ${controllingDuringTransition.center}.`,
    },
    {
      id: "failed-second-migration",
      label: "Failed second migration returns to the last ACTIVE map, not Opening",
      passed:
        reverted.phase === "ACTIVE" &&
        getControllingMarketMap(reverted).center === activeB.center,
      detail: `Phase ${reverted.phase}; controlling center ${getControllingMarketMap(reverted).center}.`,
    },
    {
      id: "independent-migration-proof",
      label: "Structure/confidence alone cannot authorize a replacement map",
      passed:
        structureOnlyResult.phase === "ACTIVE" &&
        structureOnlyResult.migrationConfirmationMode === "NONE" &&
        getControllingMarketMap(structureOnlyResult).center === activeB.center,
      detail: `Phase ${structureOnlyResult.phase}; proof ${structureOnlyResult.migrationConfirmationMode}; evidence ${structureOnlyResult.migrationScore}/100.`,
    },
    {
      id: "premium-cycle-survives-rollover",
      label: "A decisive rollover cannot erase the expansion cycle that created it",
      passed:
        violentRollover.localTroughCredit === 4 &&
        violentRollover.localPeakCredit === 4.5 &&
        violentRollover.rolloverConfirmed &&
        violentRollover.signalEligible,
      detail: `Cycle ${violentRollover.localTroughCredit} → ${violentRollover.localPeakCredit}; ${violentRollover.status}; source ${violentRollover.rolloverConfirmationSource}.`,
    },
    {
      id: "live-premium-rollover",
      label: "Three sustained live exact-leg observations can confirm rollover before the next premium minute closes",
      passed:
        liveRollover.rolloverConfirmed &&
        liveRollover.signalEligible &&
        liveRollover.rolloverConfirmationSource === "LIVE_TAPE" &&
        liveRollover.liveObservationCount >= 3,
      detail: `${liveRollover.liveObservationCount} obs / ${liveRollover.liveWindowSeconds}s / slope ${liveRollover.liveSlopePerMinute?.toFixed(2) ?? "—"}.`,
    },
    {
      id: "live-premium-noise-rejection",
      label: "Flat/noisy live premium cannot manufacture a rollover signal",
      passed: !noiseRead.rolloverConfirmed && !noiseRead.signalEligible,
      detail: `${noiseRead.liveObservationCount} obs; status ${noiseRead.status}; slope ${noiseRead.liveSlopePerMinute?.toFixed(2) ?? "—"}.`,
    },
    {
      id: "signal-vs-aplus-floor",
      label: "Qualified signal floor is distinct from the A+ conviction tier",
      passed:
        openingRegime.signalEntryScore === 73 &&
        openingRegime.minimumEntryScore === 78 &&
        openingRegime.signalEntryScore < openingRegime.minimumEntryScore,
      detail: `Opening signal ${openingRegime.signalEntryScore}; A+ ${openingRegime.minimumEntryScore}.`,
    },
  ];
}


function addPremiumBar(
  target: PremiumTapeLike[],
  baseMs: number,
  minute: number,
  medianCredit: number,
) {
  target.push(
    {
      timestamp: new Date(baseMs + minute * 60_000 + 5_000).toISOString(),
      credit: medianCredit - 0.005,
    },
    {
      timestamp: new Date(baseMs + minute * 60_000 + 35_000).toISOString(),
      credit: medianCredit + 0.005,
    },
  );
}

function snapshot(
  generatedAt: string,
  spxPrice: number,
  callVolume: number,
  putVolume: number,
): StrikeFlowSnapshot {
  return {
    tradeDate: "2026-07-10",
    generatedAt,
    expiration: "2026-07-10",
    spxPrice,
    rows: [
      {
        strike: 7500,
        optionType: "call",
        volume: callVolume,
        openInterest: 1000,
      },
      {
        strike: 7500,
        optionType: "put",
        volume: putVolume,
        openInterest: 1000,
      },
    ],
  };
}

function mapSnapshot(args: {
  capturedAt: string;
  center: number;
  spot: number;
  callWall: number | null;
  putWall: number | null;
}): MarketMapSnapshot {
  return {
    tradeDate: "2026-07-10",
    capturedAt: args.capturedAt,
    source: "live",
    spot: args.spot,
    center: args.center,
    lowerWing: args.center - 50,
    upperWing: args.center + 50,
    callWall: args.callWall,
    putWall: args.putWall,
    pin: args.center,
    expectedMove: 50,
    confidence: 80,
    dealerPressure: 0,
    spxPressure: 0,
    spyPressure: 0,
    structure: {
      structuralConfidence: 80,
    } as MarketMapSnapshot["structure"],
    strikes: {},
  };
}

function transitionFromActive(
  active: MarketMapSnapshot,
  candidate: MarketMapSnapshot,
): SessionMapManagerState {
  return {
    tradeDate: active.tradeDate,
    phase: "TRANSITION",
    sessionStatus: "OPEN",
    opening: mapSnapshot({
      capturedAt: "2026-07-10T13:35:00.000Z",
      center: 7500,
      spot: 7500,
      callWall: 7540,
      putWall: 7460,
    }),
    candidate,
    active,
    transitionFrom: active,
    transitionFromPhase: "ACTIVE",
    latest: candidate,
    previousLive: active,
    confirmationCount: 1,
    confirmationRequired: 2,
    lastConfirmationMinuteKey: "2026-07-10T15:00",
    railBreached: "UPPER",
    railBreachStartedAt: "2026-07-10T15:00:00.000Z",
    outsideMinutes: 1,
    migrationScore: 70,
    migrationConfirmationMode: "NONE",
    flowConfirmation: "BUILDING",
    flowDirection: "BUILDING",
    flowScore: 50,
    flowMessage: "Diagnostic transition flow",
    reasons: [],
    events: [],
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
