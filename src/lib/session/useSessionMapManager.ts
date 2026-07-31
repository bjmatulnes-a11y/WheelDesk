"use client";

import { useEffect, useMemo, useState } from "react";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../zeroDteOiIntelligence";
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
}) {
  const { tradeDate, generatedAt, recommendation, rows } = args;
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
          : initializeSessionMapManager(live);

      return updateSessionMapManager(initialized, live);
    });
  }, [live]);

  return {
    state,
    reset() {
      if (!tradeDate) return;
      resetSessionMapManager(tradeDate);
      setState(null);
    },
  };
}
