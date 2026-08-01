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
        <LegacyPremiumSummary history={history} read={read} />
        <ScoreBreakdown read={read} />
      </div>
      <div style={styles.right}>
        <ExecutionDecisionPanel read={read} />
        <ExecutionTimeline timeline={timeline} />
      </div>
    </div>
  );
}


function LegacyPremiumSummary({
  history,
  read,
}: {
  history: PremiumPoint[];
  read: ExecutionRead | null;
}) {
  const latestCredit =
    history.length > 0
      ? history[history.length - 1]?.credit ?? null
      : read?.currentCredit ?? null;

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Legacy Iron Fly Premium</div>
          <div style={styles.subTitle}>
            Compatibility view for the retired pre-Layer 6 cockpit
          </div>
        </div>
        <div style={styles.metrics}>
          <LegacyMetric label="Current" value={formatMetric(latestCredit)} />
          <LegacyMetric label="Peak" value={formatMetric(read?.peakCredit)} />
          <LegacyMetric
            label="Velocity"
            value={
              read
                ? `${read.premiumVelocityPerMinute >= 0 ? "+" : ""}${read.premiumVelocityPerMinute.toFixed(3)}/m`
                : "—"
            }
          />
          <LegacyMetric
            label="Off Peak"
            value={
              read?.creditOffPeakPct == null
                ? "—"
                : `${read.creditOffPeakPct.toFixed(1)}%`
            }
          />
        </div>
      </div>
    </section>
  );
}

function LegacyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMetric(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

const styles: Record<string, React.CSSProperties> = {

  card: {
    background: "#08131d",
    border: "1px solid #1d3447",
    borderRadius: 14,
    padding: 14,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 13,
    fontWeight: 850,
  },
  subTitle: {
    color: "#6f8295",
    fontSize: 10,
    marginTop: 3,
  },
  metrics: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  metric: {
    display: "grid",
    gap: 2,
    minWidth: 70,
    padding: "6px 8px",
    background: "#0c1a25",
    border: "1px solid #1b3144",
    borderRadius: 8,
    fontSize: 9,
    color: "#6f8397",
  },
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
