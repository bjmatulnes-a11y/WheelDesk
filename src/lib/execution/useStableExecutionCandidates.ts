"use client";

import { useEffect, useMemo, useState } from "react";
import { getControllingMarketMap } from "../session/mapEngine";
import type { SessionMapManagerState } from "../session/mapEngine";
import { getZeroDteSessionClock } from "../zeroDteSessionClock";
import type {
  ExecutionCandidate,
  ExecutionCandidateBook,
  ExecutionCandidateTracking,
  ExecutionStrategy,
} from "../zeroDteExecutionIntelligence";

export type StableCandidateStatus = ExecutionCandidateTracking["status"];
export type StableExecutionCandidateTrack = ExecutionCandidateTracking;

type TrackStore = {
  version: 2;
  tradeDate: string;
  tracks: Record<ExecutionStrategy, StableExecutionCandidateTrack>;
};

type CandleLike = { time: number };

const PREFIX = "wheeldesk:execution-candidate-tracker:v2:";
const STRATEGIES: ExecutionStrategy[] = [
  "iron-fly",
  "put-credit-spread",
  "call-credit-spread",
];

export function useStableExecutionCandidates(args: {
  tradeDate: string | null | undefined;
  generatedAt: string | null | undefined;
  frequencyMinutes: number;
  candles: CandleLike[];
  mapState: SessionMapManagerState | null;
  scannerCandidates?: Partial<
    Record<ExecutionStrategy, ExecutionCandidate | null>
  >;
  scannerCandidateBooks?: Partial<ExecutionCandidateBook>;
  openSetupKeys?: string[];
}) {
  const {
    tradeDate,
    generatedAt,
    frequencyMinutes,
    candles,
    mapState,
    scannerCandidates = {},
    scannerCandidateBooks = {},
    openSetupKeys = [],
  } = args;
  const openSetupKeySignature = [...openSetupKeys].sort().join("|");
  const openSetupKeySet = useMemo(
    () => new Set(openSetupKeySignature ? openSetupKeySignature.split("|") : []),
    [openSetupKeySignature],
  );
  const [store, setStore] = useState<TrackStore>(() =>
    emptyStore(tradeDate ?? ""),
  );

  useEffect(() => {
    if (!tradeDate) {
      setStore(emptyStore(""));
      return;
    }
    cleanupOtherDays(tradeDate);
    setStore(loadStore(tradeDate));
  }, [tradeDate]);

  useEffect(() => {
    if (!tradeDate || !generatedAt || !mapState || !candles.length) return;
    const clock = getZeroDteSessionClock(generatedAt);
    const latestCandle = candles.at(-1)!;
    const now = Date.parse(generatedAt);
    const candleClose = latestCandle.time * 1000 + frequencyMinutes * 60_000;
    const candleIsClosed = now >= candleClose;
    const controlling = getControllingMarketMap(mapState);

    setStore((previous) => {
      const next = cloneStore(
        previous.tradeDate === tradeDate ? previous : loadStore(tradeDate),
      );

      for (const strategy of STRATEGIES) {
        const track = next.tracks[strategy];
        const book = candidateBookForStrategy(
          strategy,
          scannerCandidateBooks,
          scannerCandidates,
        );

        // Refresh the locked candidate's live score, reasons, credit and map metadata
        // without changing its identity or lock age.
        if (track.candidate) {
          const currentVersion = book.find(
            (candidate) => candidate.setupKey === track.candidate?.setupKey,
          );
          if (currentVersion) {
            track.candidate = {
              ...currentVersion,
              mapPhase: mapState.phase,
              mapCenter: controlling.center,
              railBreached: mapState.railBreached,
            };
          } else {
            track.candidate = {
              ...track.candidate,
              mapPhase: mapState.phase,
              mapCenter: controlling.center,
              railBreached: mapState.railBreached,
            };
          }
        }

        const scanner = selectScannerCandidate({
          strategy,
          book,
          track,
          openSetupKeySet,
        });
        track.scannerCandidate = scanner;

        if (track.candidate) {
          track.ageCandles = countClosedAgeCandles(
            candles,
            track.lockedCandleTime,
            frequencyMinutes,
            now,
          );
        }

        // Candidate identity is frozen outside the SPX cash session. This prevents
        // stale after-hours quotes or repeated refreshes from manufacturing a new setup.
        if (clock.sessionStatus !== "OPEN") {
          track.status = track.candidate ? "LOCKED" : "NO_CANDIDATE";
          track.challengerSetupKey = null;
          track.challengerStartedCandleTime = null;
          continue;
        }

        if (!track.candidate) {
          if (scanner?.eligible) {
            lockCandidate(track, scanner, generatedAt, latestCandle.time, null);
          } else {
            track.status = "NO_CANDIDATE";
          }
          continue;
        }

        const invalidReason = structuralInvalidation(
          strategy,
          track.candidate,
          mapState,
        );
        if (invalidReason) {
          track.status = "STRUCTURE_INVALID";
          track.lastReplacementReason = invalidReason;
          track.challengerSetupKey = null;
          track.challengerStartedCandleTime = null;

          if (
            strategy !== "iron-fly" &&
            scanner?.eligible &&
            scanner.setupKey !== track.candidate.setupKey
          ) {
            lockCandidate(
              track,
              scanner,
              generatedAt,
              latestCandle.time,
              invalidReason,
            );
          }
          continue;
        }

        if (
          strategy === "iron-fly" ||
          !scanner ||
          !scanner.eligible ||
          scanner.setupKey === track.candidate.setupKey
        ) {
          track.status = "LOCKED";
          track.challengerSetupKey = null;
          track.challengerStartedCandleTime = null;
          continue;
        }

        const trackedSetupIsOpen = openSetupKeySet.has(
          track.candidate.setupKey,
        );
        const superiority = scanner.score - track.candidate.score;
        const requiredSuperiority = trackedSetupIsOpen ? -3 : 10;
        if (superiority < requiredSuperiority) {
          track.status = "LOCKED";
          track.challengerSetupKey = null;
          track.challengerStartedCandleTime = null;
          continue;
        }

        if (track.challengerSetupKey !== scanner.setupKey) {
          track.status = "CHALLENGER_BUILDING";
          track.challengerSetupKey = scanner.setupKey;
          track.challengerStartedCandleTime = latestCandle.time;
          continue;
        }

        const survivedClosedCandle =
          track.challengerStartedCandleTime !== null &&
          (latestCandle.time > track.challengerStartedCandleTime ||
            (latestCandle.time === track.challengerStartedCandleTime &&
              candleIsClosed));

        if (survivedClosedCandle) {
          lockCandidate(
            track,
            scanner,
            generatedAt,
            latestCandle.time,
            trackedSetupIsOpen
              ? "The prior tracked spread is already open; the highest-ranked distinct spread remained competitive through a candle close."
              : `The scanner remained ${Math.round(superiority)} points stronger through a candle close.`,
          );
          track.status = "REPLACED";
        } else {
          track.status = "CHALLENGER_BUILDING";
        }
      }

      saveStore(next);
      return next;
    });
  }, [
    candles,
    frequencyMinutes,
    generatedAt,
    mapState,
    openSetupKeySet,
    scannerCandidateBooks,
    scannerCandidates,
    tradeDate,
  ]);

  return useMemo(() => {
    const candidates: Partial<
      Record<ExecutionStrategy, ExecutionCandidate | null>
    > = {};
    for (const strategy of STRATEGIES) {
      candidates[strategy] = store.tracks[strategy].candidate;
    }
    return {
      candidates,
      tracks: store.tracks,
      clearToday: () => {
        if (!tradeDate) return;
        try {
          window.localStorage.removeItem(storageKey(tradeDate));
        } catch {
          // Candidate tracking remains available in memory when storage is blocked.
        }
        setStore(emptyStore(tradeDate));
      },
    };
  }, [store, tradeDate]);
}

function candidateBookForStrategy(
  strategy: ExecutionStrategy,
  books: Partial<ExecutionCandidateBook>,
  singles: Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>,
) {
  const book = books[strategy] ?? [];
  if (book.length) return book.filter((candidate) => candidate.eligible);
  const single = singles[strategy] ?? null;
  return single?.eligible ? [single] : [];
}

function selectScannerCandidate(args: {
  strategy: ExecutionStrategy;
  book: ExecutionCandidate[];
  track: StableExecutionCandidateTrack;
  openSetupKeySet: Set<string>;
}) {
  const { strategy, book, track, openSetupKeySet } = args;
  if (!book.length) return null;
  if (strategy === "iron-fly") return book[0] ?? null;

  const trackedSetupIsOpen = Boolean(
    track.candidate && openSetupKeySet.has(track.candidate.setupKey),
  );
  if (trackedSetupIsOpen) {
    return (
      book.find(
        (candidate) =>
          candidate.setupKey !== track.candidate?.setupKey &&
          !openSetupKeySet.has(candidate.setupKey),
      ) ?? null
    );
  }

  return book[0] ?? null;
}

function structuralInvalidation(
  strategy: ExecutionStrategy,
  candidate: ExecutionCandidate,
  mapState: SessionMapManagerState,
): string | null {
  const controlling = getControllingMarketMap(mapState);
  if (strategy === "iron-fly") return null;
  const short = candidate.legs.find((leg) => leg.action === "sell")?.strike;
  if (short == null) return "The tracked spread no longer has a valid short strike.";

  if (strategy === "put-credit-spread") {
    if (mapState.railBreached === "LOWER") {
      return "The lower controlling rail was breached against the tracked put spread.";
    }
    if (controlling.putWall != null && short > controlling.putWall) {
      return "The tracked put short moved inside the controlling put wall.";
    }
  }

  if (strategy === "call-credit-spread") {
    if (mapState.railBreached === "UPPER") {
      return "The upper controlling rail was breached against the tracked call spread.";
    }
    if (controlling.callWall != null && short < controlling.callWall) {
      return "The tracked call short moved inside the controlling call wall.";
    }
  }

  return null;
}

function lockCandidate(
  track: StableExecutionCandidateTrack,
  candidate: ExecutionCandidate,
  generatedAt: string,
  candleTime: number,
  reason: string | null,
) {
  track.candidate = candidate;
  track.lockedAt = generatedAt;
  track.lockedCandleTime = candleTime;
  track.ageCandles = 0;
  track.status = "LOCKED";
  track.challengerSetupKey = null;
  track.challengerStartedCandleTime = null;
  track.lastReplacementReason = reason;
}

function countClosedAgeCandles(
  candles: CandleLike[],
  lockedCandleTime: number | null,
  frequencyMinutes: number,
  nowMs: number,
) {
  if (lockedCandleTime == null) return 0;
  const intervalMs = Math.max(1, frequencyMinutes) * 60_000;
  return candles.filter(
    (candle) =>
      candle.time >= lockedCandleTime &&
      candle.time * 1000 + intervalMs <= nowMs,
  ).length;
}

function emptyTrack(strategy: ExecutionStrategy): StableExecutionCandidateTrack {
  return {
    strategy,
    candidate: null,
    scannerCandidate: null,
    lockedAt: null,
    lockedCandleTime: null,
    ageCandles: 0,
    status: "NO_CANDIDATE",
    challengerSetupKey: null,
    challengerStartedCandleTime: null,
    lastReplacementReason: null,
  };
}

function emptyStore(tradeDate: string): TrackStore {
  return {
    version: 2,
    tradeDate,
    tracks: {
      "iron-fly": emptyTrack("iron-fly"),
      "put-credit-spread": emptyTrack("put-credit-spread"),
      "call-credit-spread": emptyTrack("call-credit-spread"),
    },
  };
}

function cloneStore(store: TrackStore): TrackStore {
  return {
    ...store,
    tracks: {
      "iron-fly": { ...store.tracks["iron-fly"] },
      "put-credit-spread": { ...store.tracks["put-credit-spread"] },
      "call-credit-spread": { ...store.tracks["call-credit-spread"] },
    },
  };
}

function storageKey(tradeDate: string) {
  return `${PREFIX}${tradeDate}`;
}

function loadStore(tradeDate: string): TrackStore {
  if (typeof window === "undefined") return emptyStore(tradeDate);
  try {
    const raw = window.localStorage.getItem(storageKey(tradeDate));
    if (!raw) return emptyStore(tradeDate);
    const parsed = JSON.parse(raw) as Partial<TrackStore>;
    if (parsed.version !== 2 || parsed.tradeDate !== tradeDate || !parsed.tracks) {
      return emptyStore(tradeDate);
    }
    const fallback = emptyStore(tradeDate);
    return {
      version: 2,
      tradeDate,
      tracks: {
        "iron-fly": {
          ...fallback.tracks["iron-fly"],
          ...parsed.tracks["iron-fly"],
        },
        "put-credit-spread": {
          ...fallback.tracks["put-credit-spread"],
          ...parsed.tracks["put-credit-spread"],
        },
        "call-credit-spread": {
          ...fallback.tracks["call-credit-spread"],
          ...parsed.tracks["call-credit-spread"],
        },
      },
    };
  } catch {
    return emptyStore(tradeDate);
  }
}

function saveStore(store: TrackStore) {
  if (typeof window === "undefined" || !store.tradeDate) return;
  try {
    window.localStorage.setItem(storageKey(store.tradeDate), JSON.stringify(store));
  } catch {
    // Tracking is non-critical to chart rendering.
  }
}

function cleanupOtherDays(currentTradeDate: string) {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX) && key !== storageKey(currentTradeDate)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage restrictions.
  }
}
