"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../zeroDteOiIntelligence";
import type { ZeroDteOpeningMap } from "../zeroDteOpeningMap";
import type { ZeroDteStrikeFlowRead } from "../zeroDteStrikeFlow";
import {
  buildLiveMapSnapshot,
  initializeSessionMapManager,
  resetSessionMapManager,
  saveSessionMapManager,
  updateSessionMapManager,
  type SessionMapManagerState,
} from "./mapEngine";

export function useSessionMapManager(args: {
  tradeDate: string | null | undefined;
  generatedAt: string | null | undefined;
  recommendation: ZeroDteRecommendation | null | undefined;
  rows: ZeroDteChainRow[];
  openingMap?: ZeroDteOpeningMap | null;
  strikeFlow?: ZeroDteStrikeFlowRead | null;
  /** Separates live 0DTE state from future-expiration research state. */
  scopeKey?: string;
  /** Research scopes may use the state machine in-memory but must never touch live persistence. */
  persist?: boolean;
}) {
  const {
    tradeDate,
    generatedAt,
    recommendation,
    rows,
    openingMap = null,
    strikeFlow = null,
    scopeKey = "live",
    persist = true,
  } = args;
  const [state, setState] = useState<SessionMapManagerState | null>(null);
  const appliedScopeRef = useRef(scopeKey);

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
      const scopeChanged = appliedScopeRef.current !== scopeKey;
      if (scopeChanged) appliedScopeRef.current = scopeKey;
      const initialized =
        !scopeChanged && current?.tradeDate === live.tradeDate
          ? current
          : initializeSessionMapManager(live, openingMap, { loadStored: persist });

      return updateSessionMapManager(initialized, live, strikeFlow);
    });
    // The live snapshot is the only update clock. Keeping openingMap out of this
    // dependency list prevents one Schwab harvest from counting twice when the
    // persisted opening object is reloaded into React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, persist, scopeKey, strikeFlow]);

  useEffect(() => {
    if (!live || !openingMap) return;

    const needsInitialization = !state || state.tradeDate !== live.tradeDate;
    const openingWasFallback =
      state?.tradeDate === live.tradeDate &&
      state.opening.source === "first-live-fallback";

    if (!needsInitialization && !openingWasFallback) return;

    // Rebuild against the verified opening map outside a React state updater.
    // This keeps persistence/state-machine I/O out of updater callbacks, which
    // React StrictMode is allowed to invoke more than once in development.
    if (persist) resetSessionMapManager(live.tradeDate);
    setState(
      updateSessionMapManager(
        initializeSessionMapManager(live, openingMap, { loadStored: persist }),
        live,
        strikeFlow,
      ),
    );
  }, [live, openingMap, persist, state, strikeFlow]);

  useEffect(() => {
    if (!state || !persist) return;
    saveSessionMapManager(state);
  }, [persist, state]);

  return {
    state,
    reset() {
      if (!tradeDate) return;
      if (persist) resetSessionMapManager(tradeDate);
      setState(null);
    },
  };
}
