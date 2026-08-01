"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
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
};

type PendingExecutionSignal = {
  candleTime: number;
  strategy: ExecutionStrategy;
  kind: ExecutionSignalKind;
  confidence: number;
  label: string;
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

    const latestCandle = candles.at(-1);
    if (!latestCandle) return;

    const generatedTimes = reads
      .map((read) => Date.parse(read.generatedAt))
      .filter(Number.isFinite);
    const nowMs = generatedTimes.length
      ? Math.max(...generatedTimes, Date.now())
      : Date.now();
    const intervalMs = Math.max(1, frequencyMinutes) * 60_000;
    const latestCandleTime = latestCandle.time;
    const latestCandleCloseMs = latestCandleTime * 1000 + intervalMs;
    const latestCandleIsOpen = nowMs < latestCandleCloseMs;
    const desiredByStrategy = desiredSignals(reads);

    setStore((previous) => {
      const next =
        previous.tradeDate === tradeDate &&
        previous.frequencyMinutes === frequencyMinutes
          ? cloneStore(previous)
          : loadStore(tradeDate, frequencyMinutes);
      let changed = false;

      for (const strategy of STRATEGIES) {
        const desired = desiredByStrategy.get(strategy) ?? null;
        let pending = next.pending[strategy];
        const latched = next.latched[strategy];

        if (!desired) {
          if (pending) {
            delete next.pending[strategy];
            pending = undefined;
            changed = true;
          }
          if (latched) {
            delete next.latched[strategy];
            changed = true;
          }
          continue;
        }

        if (latched && latched !== desired.kind) {
          delete next.latched[strategy];
          changed = true;
        }

        if (pending) {
          const pendingClosed =
            nowMs >= pending.candleTime * 1000 + intervalMs ||
            latestCandleTime > pending.candleTime;
          const stillMaintained =
            pending.strategy === desired.strategy &&
            pending.kind === desired.kind;

          if (pendingClosed) {
            if (stillMaintained) {
              const signal = confirmSignal(tradeDate, pending);
              if (!next.confirmed.some((item) => item.id === signal.id)) {
                next.confirmed.push(signal);
                next.confirmed.sort((a, b) => a.candleTime - b.candleTime);
              }
              next.latched[strategy] = desired.kind;
            }
            delete next.pending[strategy];
            pending = undefined;
            changed = true;
          } else if (!stillMaintained) {
            delete next.pending[strategy];
            pending = undefined;
            changed = true;
          } else {
            next.pending[strategy] = {
              ...pending,
              confidence: desired.confidence,
              label: desired.label,
              lastSeenAt: new Date(nowMs).toISOString(),
            };
            changed = true;
          }
        }

        if (
          !next.pending[strategy] &&
          next.latched[strategy] !== desired.kind &&
          latestCandleIsOpen
        ) {
          next.pending[strategy] = {
            candleTime: latestCandleTime,
            strategy,
            kind: desired.kind,
            confidence: desired.confidence,
            label: desired.label,
            startedAt: new Date(nowMs).toISOString(),
            lastSeenAt: new Date(nowMs).toISOString(),
          };
          changed = true;
        }
      }

      if (!changed) return previous;
      saveStore(next);
      return next;
    });
  }, [candles, frequencyMinutes, reads, tradeDate]);

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
    id: `${tradeDate}:${pending.candleTime}:${pending.strategy}:${pending.kind}`,
    tradeDate,
    candleTime: pending.candleTime,
    strategy: pending.strategy,
    kind: pending.kind,
    confidence: pending.confidence,
    label: pending.label,
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
