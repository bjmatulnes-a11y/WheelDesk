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
  version: 3;
  tradeDate: string;
  tracks: Record<ExecutionStrategy, StableExecutionCandidateTrack>;
};

type CandleLike = { time: number };

const PREFIX = "wheeldesk:execution-candidate-tracker:v3:";
const STRATEGIES: ExecutionStrategy[] = [
  "iron-fly",
  "put-credit-spread",
  "call-credit-spread",
];
// Premium exhaustion needs three completed minute bars before its baseline is
// trusted. Do not routinely rotate an unfilled spread before that diagnostic
// window has had time to exist. Structural invalidation still replaces at once.
const MIN_ROUTINE_SIGNAL_DEVELOPMENT_CANDLES = 3;

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
            if (
              track.lockedCredit === null &&
              currentVersion.estimatedCredit !== null
            ) {
              track.lockedCredit = currentVersion.estimatedCredit;
            }
            track.candidate = {
              ...currentVersion,
              // Keep the discovery thesis frozen for a tracked credit spread.
              // A later price move cannot silently turn a trend setup into a
              // fade setup and waive distance/delta gates mid-lifecycle.
              spreadMode:
                strategy === "iron-fly"
                  ? null
                  : track.candidate.spreadMode ?? currentVersion.spreadMode ?? "trend",
              mapPhase: mapState.phase,
              mapCenter:
                strategy === "iron-fly"
                  ? mapState.opening.center
                  : controlling.center,
              railBreached: mapState.railBreached,
            };
          } else {
            track.candidate = {
              ...track.candidate,
              mapPhase: mapState.phase,
              mapCenter:
                strategy === "iron-fly"
                  ? mapState.opening.center
                  : controlling.center,
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
          track.status = track.candidate
            ? track.candidate.eligible
              ? "LOCKED"
              : "WATCH_LOCKED"
            : "NO_CANDIDATE";
          track.challengerSetupKey = null;
          track.challengerStartedCandleTime = null;
          continue;
        }

        if (!track.candidate) {
          if (scanner) {
            lockCandidate(track, scanner, generatedAt, latestCandle.time, null);
            track.status = scanner.eligible ? "LOCKED" : "WATCH_LOCKED";
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
            scanner &&
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
          scanner.setupKey === track.candidate.setupKey
        ) {
          track.status = track.candidate.eligible ? "LOCKED" : "WATCH_LOCKED";
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

        const challengerAgeSeconds =
          track.challengerStartedCandleTime === null
            ? 0
            : latestCandle.time - track.challengerStartedCandleTime;
        // A live exhaustion track should not be discarded because one scanner
        // refresh briefly ranks another spread higher. Distinct second-position
        // discovery may rotate after one close; an unfilled active track needs
        // two completed candles of sustained superiority.
        const requiredSurvivalSeconds =
          Math.max(1, frequencyMinutes) * 60 * (trackedSetupIsOpen ? 1 : 2);
        const survivedClosedCandle =
          track.challengerStartedCandleTime !== null &&
          (challengerAgeSeconds >= requiredSurvivalSeconds ||
            (trackedSetupIsOpen &&
              challengerAgeSeconds === 0 &&
              candleIsClosed));
        const signalDevelopmentReady =
          trackedSetupIsOpen ||
          track.ageCandles >= MIN_ROUTINE_SIGNAL_DEVELOPMENT_CANDLES;

        if (survivedClosedCandle && signalDevelopmentReady) {
          lockCandidate(
            track,
            scanner,
            generatedAt,
            latestCandle.time,
            trackedSetupIsOpen
              ? "The prior tracked spread is already open; the highest-ranked distinct spread remained competitive through a candle close."
              : `The scanner remained ${Math.round(superiority)} points stronger through two completed candles.`,
          );
          track.status = "REPLACED";
        } else {
          track.status = "CHALLENGER_BUILDING";
          if (!signalDevelopmentReady) {
            track.lastReplacementReason =
              `The locked setup is being given ${MIN_ROUTINE_SIGNAL_DEVELOPMENT_CANDLES} completed candles to establish its premium-exhaustion tape before routine scanner rotation.`;
          }
        }
      }

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

  useEffect(() => {
    if (!store.tradeDate) return;
    saveStore(store);
  }, [store]);

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
  if (book.length) {
    return book.filter((candidate) => isWatchableCandidate(strategy, candidate));
  }
  const single = singles[strategy] ?? null;
  return single && isWatchableCandidate(strategy, single) ? [single] : [];
}

function isWatchableCandidate(
  strategy: ExecutionStrategy,
  candidate: ExecutionCandidate,
) {
  if (!candidate.legs.length) return false;
  // The opening IF is always worth taping even when its execution score is poor.
  // Its premium path is diagnostic evidence for whether/when the opening thesis revives.
  if (strategy === "iron-fly") return true;
  if (candidate.score < 25) return false;
  if (candidate.estimatedCredit === null || candidate.estimatedCredit <= 0) {
    return false;
  }
  return !candidate.blockers.some((blocker) =>
    blocker.includes("short strike sits inside the controlling wall"),
  );
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
    const distinct = book.filter(
      (candidate) =>
        candidate.setupKey !== track.candidate?.setupKey &&
        !openSetupKeySet.has(candidate.setupKey),
    );
    return distinct.find((candidate) => candidate.eligible) ?? distinct[0] ?? null;
  }

  return book.find((candidate) => candidate.eligible) ?? book[0] ?? null;
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
  track.lockedCredit = candidate.estimatedCredit;
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
    lockedCredit: null,
    ageCandles: 0,
    status: "NO_CANDIDATE",
    challengerSetupKey: null,
    challengerStartedCandleTime: null,
    lastReplacementReason: null,
  };
}

function emptyStore(tradeDate: string): TrackStore {
  return {
    version: 3,
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
    if (parsed.version !== 3 || parsed.tradeDate !== tradeDate || !parsed.tracks) {
      return emptyStore(tradeDate);
    }
    const fallback = emptyStore(tradeDate);
    return {
      version: 3,
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
