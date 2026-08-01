"use client";

import { useEffect, useMemo, useState } from "react";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../zeroDteOiIntelligence";
import type { ZeroDteOpeningMap } from "../zeroDteOpeningMap";
import {
  buildLiveMapSnapshot,
  initializeSessionMapManager,
  resetSessionMapManager,
  updateSessionMapManager,
  type SessionMapManagerState,
} from "./mapEngine";

export function useSessionMapManager(args: {
  tradeDate: string | null | undefined;
  generatedAt: string | null | undefined;
  recommendation: ZeroDteRecommendation | null | undefined;
  rows: ZeroDteChainRow[];
  openingMap?: ZeroDteOpeningMap | null;
}) {
  const { tradeDate, generatedAt, recommendation, rows, openingMap = null } = args;
  const [state, setState] = useState<SessionMapManagerState | null>(null);

  const live = useMemo(() => {
    if (!tradeDate || !generatedAt || !recommendation) return null;
    return buildLiveMapSnapshot({
      tradeDate,
      generatedAt,
      recommendation,
      rows,
    });
  }, [generatedAt, recommendation, rows, tradeDate]);

  useEffect(() => {
    if (!live) return;

    setState((current) => {
      const initialized =
        current?.tradeDate === live.tradeDate
          ? current
          : initializeSessionMapManager(live, openingMap);

      return updateSessionMapManager(initialized, live);
    });
    // The live snapshot is the only update clock. Keeping openingMap out of this
    // dependency list prevents one Schwab harvest from counting twice when the
    // persisted opening object is reloaded into React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    if (!live || !openingMap) return;

    setState((current) => {
      const needsInitialization = !current || current.tradeDate !== live.tradeDate;
      const openingWasFallback =
        current?.tradeDate === live.tradeDate &&
        current.opening.source === "first-live-fallback";

      if (!needsInitialization && !openingWasFallback) return current;

      resetSessionMapManager(live.tradeDate);
      return updateSessionMapManager(
        initializeSessionMapManager(live, openingMap),
        live,
      );
    });
  }, [live, openingMap]);

  return {
    state,
    reset() {
      if (!tradeDate) return;
      resetSessionMapManager(tradeDate);
      setState(null);
    },
  };
}
