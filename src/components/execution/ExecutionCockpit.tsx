"use client";

import { useEffect, useMemo, useState } from "react";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../../lib/zeroDteOiIntelligence";
import { appendPremiumPoint, estimateIronFlyCredit } from "../../lib/execution/premium";
import { buildExecutionRead } from "../../lib/execution/engine";
import {
  appendExecutionTimeline,
  loadExecutionTimeline,
  loadPremiumHistory,
  savePremiumHistory,
} from "../../lib/execution/storage";
import type { ExecutionRead, PremiumPoint } from "../../lib/execution/types";
import { ExecutionDecisionPanel } from "./ExecutionDecisionPanel";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { PremiumHistoryPanel } from "./PremiumHistoryPanel";
import { ExecutionTimeline } from "./ExecutionTimeline";

export function ExecutionCockpit({
  tradeDate,
  generatedAt,
  recommendation,
  rows,
}: {
  tradeDate: string;
  generatedAt: string;
  recommendation: ZeroDteRecommendation;
  rows: ZeroDteChainRow[];
}) {
  const [history, setHistory] = useState<PremiumPoint[]>([]);
  const [timeline, setTimeline] = useState<ExecutionRead[]>([]);

  useEffect(() => {
    setHistory(loadPremiumHistory(tradeDate));
    setTimeline(loadExecutionTimeline(tradeDate));
  }, [tradeDate]);

  const credit = useMemo(
    () =>
      estimateIronFlyCredit(rows, {
        lowerWing: recommendation.lowerWing,
        shortPut: recommendation.suggestedCenter,
        shortCall: recommendation.suggestedCenter,
        upperWing: recommendation.upperWing,
      }),
    [recommendation, rows],
  );

  useEffect(() => {
    setHistory((current) => {
      const next = appendPremiumPoint(current, generatedAt, credit);
      savePremiumHistory(tradeDate, next);
      return next;
    });
  }, [credit, generatedAt, tradeDate]);

  const read = useMemo(
    () =>
      buildExecutionRead({
        recommendation,
        rows,
        generatedAt,
        premiumHistory: history,
        position: null,
      }),
    [generatedAt, history, recommendation, rows],
  );

  useEffect(() => {
    setTimeline(appendExecutionTimeline(tradeDate, read));
  }, [read, tradeDate]);

  return (
    <div style={styles.shell}>
      <div style={styles.left}>
        <PremiumHistoryPanel history={history} read={read} />
        <ScoreBreakdown read={read} />
      </div>
      <div style={styles.right}>
        <ExecutionDecisionPanel read={read} />
        <ExecutionTimeline timeline={timeline} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 310px",
    gap: 12,
    marginTop: 12,
  },
  left: {
    display: "grid",
    gap: 12,
    minWidth: 0,
  },
  right: {
    display: "grid",
    gap: 12,
    alignContent: "start",
  },
};
