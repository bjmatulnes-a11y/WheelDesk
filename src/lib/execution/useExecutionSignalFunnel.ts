"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ExecutionStrategy,
  ZeroDteExecutionRead,
} from "../zeroDteExecutionIntelligence";
import type { ConfirmedExecutionSignal } from "./useExecutionSignalPaint";
import type { ZeroDteShadowTrade } from "../zeroDteShadowTrade";

export type ExecutionSignalFunnelStage =
  | "OBSERVED"
  | "BASELINE"
  | "EXPANDED"
  | "ROLLOVER"
  | "REJECTION"
  | "SCORE"
  | "SELL"
  | "SHADOW";

export type ExecutionSignalFunnelRead = {
  counts: Record<ExecutionSignalFunnelStage, number>;
  losses: {
    baseline: number;
    expansion: number;
    rollover: number;
    rejection: number;
    score: number;
    finalGate: number;
    shadowOpen: number;
  };
};

type FunnelSetup = {
  setupKey: string;
  strategy: ExecutionStrategy;
  stage: ExecutionSignalFunnelStage;
  updatedAt: string;
};

type FunnelStore = {
  version: 1;
  tradeDate: string;
  setups: Record<string, FunnelSetup>;
};

const PREFIX = "wheeldesk:execution-signal-funnel:v1:";
const STAGES: ExecutionSignalFunnelStage[] = [
  "OBSERVED",
  "BASELINE",
  "EXPANDED",
  "ROLLOVER",
  "REJECTION",
  "SCORE",
  "SELL",
  "SHADOW",
];

export function useExecutionSignalFunnel(args: {
  tradeDate: string | null | undefined;
  reads: ZeroDteExecutionRead[];
  signals: ConfirmedExecutionSignal[];
  shadowTrades: ZeroDteShadowTrade[];
}): ExecutionSignalFunnelRead {
  const { tradeDate, reads, signals, shadowTrades } = args;
  const [store, setStore] = useState<FunnelStore>(() => emptyStore(tradeDate ?? ""));

  useEffect(() => {
    if (!tradeDate) {
      setStore(emptyStore(""));
      return;
    }
    cleanupOtherTradeDates(tradeDate);
    setStore(loadStore(tradeDate));
  }, [tradeDate]);

  useEffect(() => {
    if (!tradeDate) return;

    setStore((previous) => {
      const next = previous.tradeDate === tradeDate
        ? { ...previous, setups: { ...previous.setups } }
        : loadStore(tradeDate);
      let changed = false;
      const now = new Date().toISOString();

      // The funnel is intentionally entry-only. Position-management reads are
      // excluded so a later BUY/HOLD lifecycle cannot rewrite entry history.
      for (const read of reads) {
        if (!read.candidate || read.entryCredit !== null || !read.setupKey || !read.strategy) {
          continue;
        }
        const stage = stageFromRead(read);
        changed = promote(next, {
          setupKey: read.setupKey,
          strategy: read.strategy,
          stage,
          updatedAt: now,
        }) || changed;
      }

      for (const signal of signals) {
        if (signal.kind !== "SELL" || !signal.setupKey) continue;
        changed = promote(next, {
          setupKey: signal.setupKey,
          strategy: signal.strategy,
          stage: "SELL",
          updatedAt: now,
        }) || changed;
      }

      for (const trade of shadowTrades) {
        if (!trade.setupKey) continue;
        changed = promote(next, {
          setupKey: trade.setupKey,
          strategy: trade.strategy,
          stage: "SHADOW",
          updatedAt: now,
        }) || changed;
      }

      return changed ? next : previous;
    });
  }, [reads, shadowTrades, signals, tradeDate]);

  useEffect(() => {
    if (!store.tradeDate || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(`${PREFIX}${store.tradeDate}`, JSON.stringify(store));
    } catch {
      // Instrumentation must never disturb the execution engine.
    }
  }, [store]);

  return useMemo(() => summarize(store), [store]);
}

function stageFromRead(read: ZeroDteExecutionRead): ExecutionSignalFunnelStage {
  const baseline = read.premiumCrest.completedMinuteCount >= 3;
  if (!baseline) return "OBSERVED";
  if (!read.premiumCrest.cycleExpanded) return "BASELINE";
  if (!read.premiumCrest.rolloverConfirmed) return "EXPANDED";
  if (!read.priceRejectionReady) return "ROLLOVER";
  if (read.entryScore < read.minimumEntryScore) return "REJECTION";
  if (read.lifecycle !== "SELL_READY") return "SCORE";
  return "SELL";
}

function promote(store: FunnelStore, incoming: FunnelSetup) {
  const current = store.setups[incoming.setupKey];
  if (current && stageRank(current.stage) >= stageRank(incoming.stage)) return false;
  store.setups[incoming.setupKey] = incoming;
  return true;
}

function summarize(store: FunnelStore): ExecutionSignalFunnelRead {
  const setups = Object.values(store.setups);
  const counts = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      setups.filter((setup) => stageRank(setup.stage) >= stageRank(stage)).length,
    ]),
  ) as Record<ExecutionSignalFunnelStage, number>;
  return {
    counts,
    losses: {
      baseline: Math.max(0, counts.OBSERVED - counts.BASELINE),
      expansion: Math.max(0, counts.BASELINE - counts.EXPANDED),
      rollover: Math.max(0, counts.EXPANDED - counts.ROLLOVER),
      rejection: Math.max(0, counts.ROLLOVER - counts.REJECTION),
      score: Math.max(0, counts.REJECTION - counts.SCORE),
      finalGate: Math.max(0, counts.SCORE - counts.SELL),
      shadowOpen: Math.max(0, counts.SELL - counts.SHADOW),
    },
  };
}

function stageRank(stage: ExecutionSignalFunnelStage) {
  return STAGES.indexOf(stage);
}

function emptyStore(tradeDate: string): FunnelStore {
  return { version: 1, tradeDate, setups: {} };
}

function loadStore(tradeDate: string): FunnelStore {
  if (!tradeDate || typeof window === "undefined") return emptyStore(tradeDate);
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${tradeDate}`);
    if (!raw) return emptyStore(tradeDate);
    const parsed = JSON.parse(raw) as FunnelStore;
    if (parsed?.version !== 1 || parsed.tradeDate !== tradeDate || !parsed.setups) {
      return emptyStore(tradeDate);
    }
    return parsed;
  } catch {
    return emptyStore(tradeDate);
  }
}

function cleanupOtherTradeDates(tradeDate: string) {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX) && key !== `${PREFIX}${tradeDate}`) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Diagnostics cleanup is best effort only.
  }
}
