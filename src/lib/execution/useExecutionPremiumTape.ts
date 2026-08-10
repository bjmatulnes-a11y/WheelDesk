"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calculateStrategyCredit,
  type ExecutionPositionMemory,
  type ExecutionPremiumTapePoint,
  type ExecutionStrategy,
} from "../zeroDteExecutionIntelligence";
import type { ZeroDteChainRow } from "../zeroDteOiIntelligence";
import { getZeroDteSessionClock } from "../zeroDteSessionClock";
import type { StableExecutionCandidateTrack } from "./useStableExecutionCandidates";

type TapeStore = {
  version: 2;
  tradeDate: string;
  scopeKey: string;
  points: ExecutionPremiumTapePoint[];
};

const PREFIX = "wheeldesk:execution-premium-tape:v2:";
const MAX_POINTS = 15_000;
const HEARTBEAT_MS = 30_000;
const MIN_CREDIT_CHANGE = 0.005;

export function useExecutionPremiumTape(args: {
  tradeDate: string | null | undefined;
  generatedAt: string | null | undefined;
  spot: number | null | undefined;
  rows: ZeroDteChainRow[];
  tracks: Record<ExecutionStrategy, StableExecutionCandidateTrack> | null;
  positions?: ExecutionPositionMemory[];
  scopeKey?: string;
  enabled?: boolean;
}) {
  const {
    tradeDate,
    generatedAt,
    spot,
    rows,
    tracks,
    positions = [],
    scopeKey = "live",
    enabled = true,
  } = args;

  const [store, setStore] = useState<TapeStore>(() => emptyStore(tradeDate ?? "", scopeKey));

  useEffect(() => {
    if (!tradeDate) {
      setStore(emptyStore("", scopeKey));
      return;
    }
    cleanupOtherDays(tradeDate);
    setStore(loadStore(tradeDate, scopeKey));
  }, [scopeKey, tradeDate]);

  const setups = useMemo(() => {
    const byKey = new Map<
      string,
      {
        strategy: ExecutionStrategy;
        setupKey: string;
        legs: ExecutionPositionMemory["legs"];
      }
    >();

    if (tracks) {
      for (const strategy of [
        "iron-fly",
        "put-credit-spread",
        "call-credit-spread",
      ] as ExecutionStrategy[]) {
        const candidate = tracks[strategy]?.candidate ?? null;
        if (!candidate?.setupKey || !candidate.legs.length) continue;
        byKey.set(candidate.setupKey, {
          strategy,
          setupKey: candidate.setupKey,
          legs: candidate.legs,
        });
      }
    }

    for (const position of positions) {
      if (!position.setupKey || !position.legs.length) continue;
      byKey.set(position.setupKey, {
        strategy: position.strategy,
        setupKey: position.setupKey,
        legs: position.legs,
      });
    }

    return [...byKey.values()];
  }, [positions, tracks]);

  useEffect(() => {
    if (
      !enabled ||
      !tradeDate ||
      !generatedAt ||
      !rows.length ||
      !setups.length ||
      !Number.isFinite(spot)
    ) {
      return;
    }

    const clock = getZeroDteSessionClock(generatedAt);
    if (clock.sessionStatus !== "OPEN") return;

    const timestampMs = Date.parse(generatedAt);
    if (!Number.isFinite(timestampMs)) return;

    const incoming = setups.flatMap((setup) => {
      const credit = calculateStrategyCredit(rows, setup.legs);
      if (credit === null || !Number.isFinite(credit)) return [];
      return [
        {
          timestamp: generatedAt,
          spot: Number(spot),
          strategy: setup.strategy,
          setupKey: setup.setupKey,
          credit,
        } satisfies ExecutionPremiumTapePoint,
      ];
    });
    if (!incoming.length) return;

    setStore((previous) => {
      const next =
        previous.tradeDate === tradeDate && previous.scopeKey === scopeKey
          ? cloneStore(previous)
          : loadStore(tradeDate, scopeKey);
      let changed = false;

      for (const point of incoming) {
        const last = findLastSetupPoint(next.points, point.setupKey);
        const lastMs = last ? Date.parse(last.timestamp) : null;
        const creditChanged =
          !last || Math.abs(last.credit - point.credit) >= MIN_CREDIT_CHANGE;
        const heartbeatDue =
          !lastMs || !Number.isFinite(lastMs) || timestampMs - lastMs >= HEARTBEAT_MS;

        if (!creditChanged && !heartbeatDue) continue;
        next.points.push(point);
        changed = true;
      }

      if (!changed) return previous;

      next.points = dedupeAndTrim(next.points);
      return next;
    });
  }, [enabled, generatedAt, rows, scopeKey, setups, spot, tradeDate]);

  useEffect(() => {
    if (!store.tradeDate) return;
    saveStore(store);
  }, [store]);

  return useMemo(
    () => ({
      points: store.points,
      clearToday: () => {
        if (!tradeDate) return;
        try {
          window.localStorage.removeItem(storageKey(tradeDate, scopeKey));
        } catch {
          // In-memory premium tracking remains available when storage is blocked.
        }
        setStore(emptyStore(tradeDate, scopeKey));
      },
    }),
    [scopeKey, store.points, tradeDate],
  );
}

function findLastSetupPoint(
  points: ExecutionPremiumTapePoint[],
  setupKey: string,
) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index]?.setupKey === setupKey) return points[index] ?? null;
  }
  return null;
}

function dedupeAndTrim(points: ExecutionPremiumTapePoint[]) {
  const byKey = new Map<string, ExecutionPremiumTapePoint>();
  for (const point of points) {
    byKey.set(`${point.setupKey}:${point.timestamp}`, point);
  }
  return [...byKey.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-MAX_POINTS);
}

function emptyStore(tradeDate: string, scopeKey: string): TapeStore {
  return { version: 2, tradeDate, scopeKey, points: [] };
}

function cloneStore(store: TapeStore): TapeStore {
  return { ...store, points: [...store.points] };
}

function storageKey(tradeDate: string, scopeKey: string) {
  return `${PREFIX}${tradeDate}:${encodeURIComponent(scopeKey)}`;
}

function loadStore(tradeDate: string, scopeKey: string): TapeStore {
  if (typeof window === "undefined") return emptyStore(tradeDate, scopeKey);
  try {
    const raw = window.localStorage.getItem(storageKey(tradeDate, scopeKey));
    if (!raw) return emptyStore(tradeDate, scopeKey);
    const parsed = JSON.parse(raw) as Partial<TapeStore>;
    if (
      parsed.version !== 2 ||
      parsed.tradeDate !== tradeDate ||
      parsed.scopeKey !== scopeKey ||
      !Array.isArray(parsed.points)
    ) {
      return emptyStore(tradeDate, scopeKey);
    }
    const points = parsed.points.filter(
      (point): point is ExecutionPremiumTapePoint =>
        Boolean(
          point &&
            typeof point.timestamp === "string" &&
            typeof point.setupKey === "string" &&
            typeof point.strategy === "string" &&
            Number.isFinite(point.credit) &&
            Number.isFinite(point.spot),
        ),
    );
    return { version: 2, tradeDate, scopeKey, points: dedupeAndTrim(points) };
  } catch {
    return emptyStore(tradeDate, scopeKey);
  }
}

function saveStore(store: TapeStore) {
  if (typeof window === "undefined" || !store.tradeDate) return;
  try {
    window.localStorage.setItem(storageKey(store.tradeDate, store.scopeKey), JSON.stringify(store));
  } catch {
    // The live tape remains in React state if browser storage is unavailable.
  }
}

function cleanupOtherDays(currentTradeDate: string) {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX) && !key.startsWith(`${PREFIX}${currentTradeDate}:`)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage restrictions.
  }
}
