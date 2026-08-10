"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExecutionLeg,
  ExecutionStrategy,
  ZeroDteExecutionRead,
} from "../zeroDteExecutionIntelligence";

export type ExecutionSignalKind = "SELL" | "BUY";
export type ExecutionSignalPaintFilter =
  | "off"
  | "all"
  | ExecutionStrategy;

export type ConfirmedExecutionSignal = {
  id: string;
  tradeDate: string;
  candleTime: number;
  strategy: ExecutionStrategy;
  kind: ExecutionSignalKind;
  confidence: number;
  label: string;
  setupKey: string | null;
  legs: ExecutionLeg[];
  markCredit: number | null;
  sellableCredit: number | null;
  maxRiskDollars: number | null;
  shortDeltaAbs: number | null;
  shortDistancePoints: number | null;
  minimumEntryScore: number;
  timeRegime: string;
  eventRisk: "NORMAL" | "HIGH";
  rangeConsumptionPct: number | null;
  mapPhase: "OPENING" | "TRANSITION" | "ACTIVE";
  mapCenter: number;
  railBreached: "UPPER" | "LOWER" | "NONE";
  peakCreditAtSignal: number | null;
  premiumExpansionPct: number | null;
  premiumRolloverPct: number | null;
  premiumCrestStatus: string;
  priceRejectionScore: number;
  remainingMovePoints: number;
  pathDirection: "UP" | "DOWN" | "NEUTRAL" | null;
  pathConfidence: number | null;
  pathFlowSource: "engine" | "fallback" | null;
  pathTerminalTrough: number | null;
  pathTerminalCrest: number | null;
};

type PendingExecutionSignal = {
  candleTime: number;
  strategy: ExecutionStrategy;
  kind: ExecutionSignalKind;
  confidence: number;
  label: string;
  setupKey: string | null;
  legs: ExecutionLeg[];
  markCredit: number | null;
  sellableCredit: number | null;
  maxRiskDollars: number | null;
  shortDeltaAbs: number | null;
  shortDistancePoints: number | null;
  minimumEntryScore: number;
  timeRegime: string;
  eventRisk: "NORMAL" | "HIGH";
  rangeConsumptionPct: number | null;
  mapPhase: "OPENING" | "TRANSITION" | "ACTIVE";
  mapCenter: number;
  railBreached: "UPPER" | "LOWER" | "NONE";
  peakCreditAtSignal: number | null;
  premiumExpansionPct: number | null;
  premiumRolloverPct: number | null;
  premiumCrestStatus: string;
  priceRejectionScore: number;
  remainingMovePoints: number;
  pathDirection: "UP" | "DOWN" | "NEUTRAL" | null;
  pathConfidence: number | null;
  pathFlowSource: "engine" | "fallback" | null;
  pathTerminalTrough: number | null;
  pathTerminalCrest: number | null;
  startedAt: string;
  lastSeenAt: string;
};

type SignalStore = {
  version: 1;
  tradeDate: string;
  frequencyMinutes: number;
  confirmed: ConfirmedExecutionSignal[];
  pending: Partial<Record<ExecutionStrategy, PendingExecutionSignal>>;
  latched: Partial<Record<ExecutionStrategy, ExecutionSignalKind>>;
};

type CandleRef = { time: number };

const PREFIX = "wheeldesk:execution-signal-paint:v1:";
const STRATEGIES: ExecutionStrategy[] = [
  "iron-fly",
  "put-credit-spread",
  "call-credit-spread",
];

export function useExecutionSignalPaint(args: {
  tradeDate: string | null | undefined;
  frequencyMinutes: number;
  candles: CandleRef[];
  reads: ZeroDteExecutionRead[];
}) {
  const { tradeDate, frequencyMinutes, candles, reads } = args;
  const [store, setStore] = useState<SignalStore>(() =>
    emptyStore(tradeDate ?? "", frequencyMinutes),
  );

  useEffect(() => {
    if (!tradeDate) {
      setStore(emptyStore("", frequencyMinutes));
      return;
    }

    cleanupOtherTradeDates(tradeDate);
    setStore(loadStore(tradeDate, frequencyMinutes));
  }, [frequencyMinutes, tradeDate]);

  useEffect(() => {
    if (!tradeDate || !candles.length) return;

    // `candles` is intentionally the completed 1-minute signal series. SELL_READY
    // already contains the completed price-rejection confirmation, so requiring
    // another still-open candle here would both contradict the input contract and
    // add a full minute of unnecessary 0DTE latency. Confirm on the latest
    // completed signal candle as soon as the execution engine reaches SELL_READY.
    const latestCandle = candles.at(-1);
    if (!latestCandle) return;
    const latestCandleTime = latestCandle.time;
    const desiredByStrategy = desiredSignals(reads);

    setStore((previous) => {
      const next =
        previous.tradeDate === tradeDate &&
        previous.frequencyMinutes === frequencyMinutes
          ? cloneStore(previous)
          : loadStore(tradeDate, frequencyMinutes);
      let changed = false;

      // Pending state belonged to the old extra-candle confirmation model. Clear
      // any persisted remnants so a deployment cannot resurrect the obsolete gate.
      if (Object.keys(next.pending).length) {
        next.pending = {};
        changed = true;
      }

      for (const strategy of STRATEGIES) {
        const desired = desiredByStrategy.get(strategy) ?? null;
        const latched = next.latched[strategy];

        if (!desired) {
          // Allow a genuinely new trigger episode later in the day after readiness
          // has first disappeared. Signal IDs still de-duplicate same-candle flicker.
          if (latched) {
            delete next.latched[strategy];
            changed = true;
          }
          continue;
        }

        const lastSameKind = [...next.confirmed]
          .reverse()
          .find(
            (signal) =>
              signal.strategy === strategy && signal.kind === desired.kind,
          );
        if (
          latched === desired.kind &&
          (lastSameKind?.setupKey ?? null) === (desired.setupKey ?? null)
        ) {
          continue;
        }

        const signal = confirmSignal(tradeDate, {
          candleTime: latestCandleTime,
          ...desired,
          startedAt: new Date(latestCandleTime * 1000).toISOString(),
          lastSeenAt: new Date(latestCandleTime * 1000).toISOString(),
        });
        if (!next.confirmed.some((item) => item.id === signal.id)) {
          next.confirmed.push(signal);
          next.confirmed.sort((a, b) => a.candleTime - b.candleTime);
          changed = true;
        }
        next.latched[strategy] = desired.kind;
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [candles, frequencyMinutes, reads, tradeDate]);

  useEffect(() => {
    if (!store.tradeDate) return;
    saveStore(store);
  }, [store]);

  const clearToday = useCallback(() => {
    if (!tradeDate) return;
    if (typeof window !== "undefined") {
      const dayPrefix = `${PREFIX}${tradeDate}:`;
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(dayPrefix)) window.localStorage.removeItem(key);
      }
    }
    setStore(emptyStore(tradeDate, frequencyMinutes));
  }, [frequencyMinutes, tradeDate]);

  return useMemo(
    () => ({
      signals: store.confirmed,
      pendingCount: Object.keys(store.pending).length,
      clearToday,
    }),
    [clearToday, store.confirmed, store.pending],
  );
}

function desiredSignals(reads: ZeroDteExecutionRead[]) {
  const desired = new Map<
    ExecutionStrategy,
    {
      strategy: ExecutionStrategy;
      kind: ExecutionSignalKind;
      confidence: number;
      label: string;
      setupKey: string | null;
      legs: ExecutionLeg[];
      markCredit: number | null;
      sellableCredit: number | null;
      maxRiskDollars: number | null;
      shortDeltaAbs: number | null;
      shortDistancePoints: number | null;
      minimumEntryScore: number;
      timeRegime: string;
      eventRisk: "NORMAL" | "HIGH";
      rangeConsumptionPct: number | null;
      mapPhase: "OPENING" | "TRANSITION" | "ACTIVE";
      mapCenter: number;
      railBreached: "UPPER" | "LOWER" | "NONE";
      peakCreditAtSignal: number | null;
      premiumExpansionPct: number | null;
      premiumRolloverPct: number | null;
      premiumCrestStatus: string;
      priceRejectionScore: number;
      remainingMovePoints: number;
      pathDirection: "UP" | "DOWN" | "NEUTRAL" | null;
      pathConfidence: number | null;
      pathFlowSource: "engine" | "fallback" | null;
      pathTerminalTrough: number | null;
      pathTerminalCrest: number | null;
    }
  >();

  for (const read of reads) {
    const strategy =
      read.position?.strategy ?? read.candidate?.strategy ?? read.strategy;
    if (!strategy) continue;

    if (!read.position && read.lifecycle === "SELL_READY") {
      desired.set(strategy, {
        strategy,
        kind: "SELL",
        confidence: read.entryScore,
        label: read.strategyLabel,
        setupKey: read.setupKey,
        legs: read.candidate?.legs ?? [],
        markCredit: read.currentCredit,
        sellableCredit: read.currentSellableCredit,
        maxRiskDollars: read.maxRiskDollars,
        shortDeltaAbs: read.shortDeltaAbs,
        shortDistancePoints: read.shortDistancePoints,
        minimumEntryScore: read.minimumEntryScore,
        timeRegime: read.timeRegime.regime,
        eventRisk: read.eventRisk,
        rangeConsumptionPct: read.volContext?.rangeConsumptionPct ?? null,
        mapPhase: read.mapPhase,
        mapCenter: read.mapCenter,
        railBreached: read.railBreached,
        peakCreditAtSignal: read.peakCredit,
        premiumExpansionPct: read.premiumExpansionPct,
        premiumRolloverPct: read.premiumCrest.rolloverPct,
        premiumCrestStatus: read.premiumCrest.status,
        priceRejectionScore: read.priceRejectionScore,
        remainingMovePoints: read.remainingMovePoints,
        pathDirection: read.leastResistancePath?.direction ?? null,
        pathConfidence: read.leastResistancePath?.confidence ?? null,
        pathFlowSource: read.leastResistancePath?.flowSource ?? null,
        pathTerminalTrough: read.leastResistancePath?.terminalTrough ?? null,
        pathTerminalCrest: read.leastResistancePath?.terminalCrest ?? null,
      });
      continue;
    }

    if (
      read.position &&
      (read.lifecycle === "BUYBACK_READY" || read.emergencyExit)
    ) {
      desired.set(strategy, {
        strategy,
        kind: "BUY",
        confidence: read.exitScore,
        label: read.strategyLabel,
        setupKey: read.setupKey,
        legs: read.position?.legs ?? [],
        markCredit: read.currentCredit,
        sellableCredit: read.currentSellableCredit,
        maxRiskDollars: read.maxRiskDollars,
        shortDeltaAbs: read.shortDeltaAbs,
        shortDistancePoints: read.shortDistancePoints,
        minimumEntryScore: read.minimumEntryScore,
        timeRegime: read.timeRegime.regime,
        eventRisk: read.eventRisk,
        rangeConsumptionPct: read.volContext?.rangeConsumptionPct ?? null,
        mapPhase: read.mapPhase,
        mapCenter: read.mapCenter,
        railBreached: read.railBreached,
        peakCreditAtSignal: read.peakCredit,
        premiumExpansionPct: read.premiumExpansionPct,
        premiumRolloverPct: read.premiumCrest.rolloverPct,
        premiumCrestStatus: read.premiumCrest.status,
        priceRejectionScore: read.priceRejectionScore,
        remainingMovePoints: read.remainingMovePoints,
        pathDirection: read.leastResistancePath?.direction ?? null,
        pathConfidence: read.leastResistancePath?.confidence ?? null,
        pathFlowSource: read.leastResistancePath?.flowSource ?? null,
        pathTerminalTrough: read.leastResistancePath?.terminalTrough ?? null,
        pathTerminalCrest: read.leastResistancePath?.terminalCrest ?? null,
      });
    }
  }

  return desired;
}

function confirmSignal(
  tradeDate: string,
  pending: PendingExecutionSignal,
): ConfirmedExecutionSignal {
  return {
    id: `${tradeDate}:${pending.candleTime}:${pending.strategy}:${pending.kind}:${pending.setupKey ?? "none"}`,
    tradeDate,
    candleTime: pending.candleTime,
    strategy: pending.strategy,
    kind: pending.kind,
    confidence: pending.confidence,
    label: pending.label,
    setupKey: pending.setupKey,
    legs: pending.legs,
    markCredit: pending.markCredit,
    sellableCredit: pending.sellableCredit,
    maxRiskDollars: pending.maxRiskDollars,
    shortDeltaAbs: pending.shortDeltaAbs,
    shortDistancePoints: pending.shortDistancePoints,
    minimumEntryScore: pending.minimumEntryScore,
    timeRegime: pending.timeRegime,
    eventRisk: pending.eventRisk,
    rangeConsumptionPct: pending.rangeConsumptionPct,
    mapPhase: pending.mapPhase,
    mapCenter: pending.mapCenter,
    railBreached: pending.railBreached,
    peakCreditAtSignal: pending.peakCreditAtSignal,
    premiumExpansionPct: pending.premiumExpansionPct,
    premiumRolloverPct: pending.premiumRolloverPct,
    premiumCrestStatus: pending.premiumCrestStatus,
    priceRejectionScore: pending.priceRejectionScore,
    remainingMovePoints: pending.remainingMovePoints,
    pathDirection: pending.pathDirection,
    pathConfidence: pending.pathConfidence,
    pathFlowSource: pending.pathFlowSource,
    pathTerminalTrough: pending.pathTerminalTrough,
    pathTerminalCrest: pending.pathTerminalCrest,
  };
}

function storageKey(tradeDate: string, frequencyMinutes: number) {
  return `${PREFIX}${tradeDate}:${frequencyMinutes}`;
}

function emptyStore(
  tradeDate: string,
  frequencyMinutes: number,
): SignalStore {
  return {
    version: 1,
    tradeDate,
    frequencyMinutes,
    confirmed: [],
    pending: {},
    latched: {},
  };
}

function loadStore(tradeDate: string, frequencyMinutes: number): SignalStore {
  if (typeof window === "undefined") {
    return emptyStore(tradeDate, frequencyMinutes);
  }

  try {
    const raw = window.localStorage.getItem(
      storageKey(tradeDate, frequencyMinutes),
    );
    if (!raw) return emptyStore(tradeDate, frequencyMinutes);
    const parsed = JSON.parse(raw) as Partial<SignalStore>;
    if (
      parsed.version !== 1 ||
      parsed.tradeDate !== tradeDate ||
      parsed.frequencyMinutes !== frequencyMinutes
    ) {
      return emptyStore(tradeDate, frequencyMinutes);
    }

    return {
      version: 1,
      tradeDate,
      frequencyMinutes,
      confirmed: Array.isArray(parsed.confirmed)
        ? parsed.confirmed.filter(validSignal)
        : [],
      pending:
        parsed.pending && typeof parsed.pending === "object"
          ? parsed.pending
          : {},
      latched:
        parsed.latched && typeof parsed.latched === "object"
          ? parsed.latched
          : {},
    };
  } catch {
    return emptyStore(tradeDate, frequencyMinutes);
  }
}

function saveStore(store: SignalStore) {
  if (typeof window === "undefined" || !store.tradeDate) return;
  try {
    window.localStorage.setItem(
      storageKey(store.tradeDate, store.frequencyMinutes),
      JSON.stringify(store),
    );
  } catch {
    // Signal paint is non-critical; chart operation must continue without storage.
  }
}

function cleanupOtherTradeDates(currentTradeDate: string) {
  if (typeof window === "undefined") return;
  try {
    const currentPrefix = `${PREFIX}${currentTradeDate}:`;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX) && !key.startsWith(currentPrefix)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage restrictions.
  }
}

function cloneStore(store: SignalStore): SignalStore {
  return {
    ...store,
    confirmed: [...store.confirmed],
    pending: { ...store.pending },
    latched: { ...store.latched },
  };
}

function validSignal(value: unknown): value is ConfirmedExecutionSignal {
  if (!value || typeof value !== "object") return false;
  const signal = value as Partial<ConfirmedExecutionSignal>;
  return (
    typeof signal.id === "string" &&
    typeof signal.tradeDate === "string" &&
    typeof signal.candleTime === "number" &&
    STRATEGIES.includes(signal.strategy as ExecutionStrategy) &&
    (signal.kind === "SELL" || signal.kind === "BUY") &&
    typeof signal.confidence === "number" &&
    typeof signal.label === "string"
  );
}
