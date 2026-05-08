"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readWheelDeskStorage,
  saveCandles,
  readEdgeProofSummaries,
  type EdgeProofSummary,
  type CandleRecord,
  type OptionSurfaceSnapshot,
} from "../../../lib/wheeldesk-storage";
import {
  buildTraderEdgeSummary,
  latestSurfaceByTicker,
  type ActionBucket,
  type TraderEdgeSummary,
} from "../../../lib/trader-edge-engine";
import {
  buildWallMigrationSummary,
  findPriorSurfaceForTicker,
  type WallMigrationSummary,
} from "../../../lib/oi-wall-migration-engine";

const DASHBOARD_CANDLE_CACHE_PREFIX = "tradingOperator.dashboard.candles";
const SCANNER_CANDLE_TIMEFRAMES = ["daily", "1d", "1D"] as const;

function normalizeCandleDate(value: unknown): string {
  if (typeof value === "string" && value.length) {
    return value.slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }

  return "";
}

function normalizeCandleLike(value: unknown): CandleRecord | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  const date = normalizeCandleDate(row.date ?? row.time ?? row.timestamp);
  const open = Number(row.open ?? row.o ?? row.close);
  const high = Number(row.high ?? row.h ?? row.close);
  const low = Number(row.low ?? row.l ?? row.close);
  const close = Number(row.close ?? row.c);
  const volumeRaw = row.volume ?? row.v;
  const volume = volumeRaw == null ? undefined : Number(volumeRaw);

  if (
    !date ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

return {
  date,
  open,
  high,
  low,
  close,
  ...(typeof volume === "number" && Number.isFinite(volume) && volume > 0
    ? { volume }
    : {}),
};
}

function normalizeCandleArray(values: unknown): CandleRecord[] {
  if (!Array.isArray(values)) return [];

  return values
    .map(normalizeCandleLike)
    .filter((candle): candle is CandleRecord => Boolean(candle))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function readDashboardCachedCandles(ticker: string): CandleRecord[] {
  if (typeof window === "undefined" || !window.localStorage) return [];

  const upper = ticker.toUpperCase();

  for (const timeframe of SCANNER_CANDLE_TIMEFRAMES) {
    const raw = window.localStorage.getItem(
      `${DASHBOARD_CANDLE_CACHE_PREFIX}.${upper}.${timeframe}`,
    );
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as { candles?: unknown };
      const candles = normalizeCandleArray(parsed?.candles);
      if (candles.length >= 15) return candles;
    } catch {
      // Ignore malformed dashboard candle cache entries.
    }
  }

  return [];
}

function mergeScannerCandles(args: {
  base: Record<string, CandleRecord[]>;
  tickers: string[];
}): Record<string, CandleRecord[]> {
  const next: Record<string, CandleRecord[]> = { ...args.base };

  for (const ticker of args.tickers) {
    const upper = ticker.toUpperCase();
    const stored = next[upper] ?? next[upper.toLowerCase()] ?? [];
    const cached = readDashboardCachedCandles(upper);

    const shouldUseCached =
      cached.length >= 15 &&
      (stored.length < 15 ||
        cached.length > stored.length ||
        !stored.some((candle) => Number((candle as any).volume ?? 0) > 0));

    if (shouldUseCached) {
      next[upper] = cached;

      try {
        saveCandles(upper, cached);
      } catch {
        // Persistence is helpful but not required for scanner rendering.
      }
    } else if (stored.length) {
      next[upper] = stored;
    }
  }

  return next;
}

type ScannerFilter =
  | "all"
  | "trade-now"
  | "watch"
  | "high-edge"
  | "csp"
  | "covered-call"
  | "wheel"
  | "compression"
  | "conflict"
  | "traps"
  | "stale"
  | "data-issues";

type ScannerSort =
  | "opportunity"
  | "wheel"
  | "csp"
  | "coveredCall"
  | "trap"
  | "freshness"
  | "quality";

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function formatRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(2)}x`;
}

function rateText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function proofGradeLabel(grade: string | undefined): string {
  const map: Record<string, string> = {
    none: "No proof",
    early: "Early",
    developing: "Developing",
    tested: "Tested",
    proven: "Proven",
    institutional: "Institutional",
  };
  return map[grade ?? "none"] ?? String(grade ?? "No proof");
}

function proofConfidenceLabel(confidence: string | undefined): string {
  const map: Record<string, string> = {
    none: "none",
    very_low: "very low",
    low: "low",
    medium: "medium",
    high: "high",
    strong: "strong",
  };
  return map[confidence ?? "none"] ?? String(confidence ?? "none");
}

function migrationColor(summary: WallMigrationSummary | null): {
  border: string;
  background: string;
  color: string;
} {
  if (!summary || !summary.hasPrior)
    return { border: "#d1d5db", background: "#f9fafb", color: "#4b5563" };
  if (summary.migrationBias === "bullish")
    return { border: "#16a34a", background: "#f0fdf4", color: "#166534" };
  if (summary.migrationBias === "bearish")
    return { border: "#dc2626", background: "#fef2f2", color: "#991b1b" };
  if (summary.migrationBias === "compression")
    return { border: "#f59e0b", background: "#fffbeb", color: "#92400e" };
  if (summary.migrationBias === "expansion")
    return { border: "#2563eb", background: "#eff6ff", color: "#1d4ed8" };
  return { border: "#6b7280", background: "#f9fafb", color: "#374151" };
}

function formatSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function MigrationBadge({
  migration,
}: {
  migration: WallMigrationSummary | null;
}) {
  const colors = migrationColor(migration);
  return (
    <span
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: "0.2rem 0.45rem",
        background: colors.background,
        color: colors.color,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {migration?.hasPrior ? migration.label : "No prior wall"}
    </span>
  );
}

function ProofBadge({ proof }: { proof: EdgeProofSummary | null | undefined }) {
  if (!proof || proof.evaluated <= 0) {
    return (
      <span
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 999,
          padding: "0.2rem 0.45rem",
          background: "#f9fafb",
          color: "#6b7280",
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        No proof yet
      </span>
    );
  }

  const adjustedPct =
    proof.adjustedRate == null
      ? "N/A"
      : `${(proof.adjustedRate * 100).toFixed(0)}%`;
  const bg =
    proof.proofGrade === "proven" || proof.proofGrade === "institutional"
      ? "#dcfce7"
      : proof.proofGrade === "tested"
        ? "#e0f2fe"
        : proof.proofGrade === "developing"
          ? "#fef3c7"
          : "#f8fafc";
  const color =
    proof.adjustedRate != null && proof.adjustedRate >= 0.65
      ? "#166534"
      : proof.adjustedRate != null && proof.adjustedRate >= 0.55
        ? "#92400e"
        : "#374151";

  return (
    <span
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 999,
        padding: "0.2rem 0.45rem",
        background: bg,
        color,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
      title={`${proof.validated}/${proof.evaluated} observed · ${proofConfidenceLabel(proof.confidence)} confidence`}
    >
      {proofGradeLabel(proof.proofGrade)} · {adjustedPct}
    </span>
  );
}

type RefreshQueueStatus =
  | "fresh"
  | "acceptable"
  | "stale"
  | "review"
  | "missing";

type RefreshQueueItem = {
  ticker: string;
  status: RefreshQueueStatus;
  label: string;
  reason: string;
  priority: number;
  summary: TraderEdgeSummary | null;
};

function uniqueTickers(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) =>
          String(value ?? "")
            .trim()
            .toUpperCase(),
        )
        .filter((value) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(value)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function extractTickerStrings(value: unknown): string[] {
  if (value == null) return [];

  if (typeof value === "string") {
    return value
      .split(/[\s,;|]+/)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTickerStrings(item));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return [
      ...extractTickerStrings(objectValue.ticker),
      ...extractTickerStrings(objectValue.symbol),
      ...extractTickerStrings(objectValue.tickers),
      ...extractTickerStrings(objectValue.symbols),
      ...extractTickerStrings(objectValue.items),
      ...extractTickerStrings(objectValue.values),
    ];
  }

  return [];
}

function readLocalWatchlistTickers(): string[] {
  if (typeof window === "undefined" || !window.localStorage) return [];

  const keys = ["wheelDesk.dashboardWatchlist", "watchlist"];
  const tickers: string[] = [];

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    try {
      tickers.push(...extractTickerStrings(JSON.parse(raw)));
    } catch {
      tickers.push(...extractTickerStrings(raw));
    }
  }

  return uniqueTickers(tickers);
}

function refreshStatusStyles(status: RefreshQueueStatus): {
  color: string;
  background: string;
  border: string;
} {
  if (status === "fresh")
    return { color: "#166534", background: "#f0fdf4", border: "#16a34a" };
  if (status === "acceptable")
    return { color: "#365314", background: "#f7fee7", border: "#84cc16" };
  if (status === "stale")
    return { color: "#92400e", background: "#fffbeb", border: "#f59e0b" };
  if (status === "review")
    return { color: "#9a3412", background: "#fff7ed", border: "#f97316" };
  return { color: "#991b1b", background: "#fef2f2", border: "#dc2626" };
}

function buildRefreshQueue(args: {
  summaries: TraderEdgeSummary[];
  watchlistTickers: string[];
  surfaceTickers: string[];
}): RefreshQueueItem[] {
  const summaryByTicker = new Map(
    args.summaries.map((summary) => [summary.ticker.toUpperCase(), summary]),
  );
  const universe = uniqueTickers([
    ...args.watchlistTickers,
    ...args.surfaceTickers,
  ]);

  return universe
    .map((ticker) => {
      const summary = summaryByTicker.get(ticker) ?? null;

      if (!summary) {
        return {
          ticker,
          status: "missing" as RefreshQueueStatus,
          label: "Missing surface",
          reason:
            "Ticker is in the watchlist/universe but has no saved OI surface yet.",
          priority: 100,
          summary,
        };
      }

      if (summary.dataQualityScore < 70) {
        return {
          ticker,
          status: "review" as RefreshQueueStatus,
          label: "Review data",
          reason: `Data quality is ${summary.dataQualityScore.toFixed(0)}; refresh or inspect the saved surface before trusting the read.`,
          priority: 90 + Math.max(0, 70 - summary.dataQualityScore),
          summary,
        };
      }

      if ((summary.staleDays ?? 0) > 1) {
        return {
          ticker,
          status: "stale" as RefreshQueueStatus,
          label: "Stale",
          reason: `${summary.freshnessLabel}. Refresh before using this as a live opportunity read.`,
          priority: 80 + Math.min(20, summary.staleDays ?? 0),
          summary,
        };
      }

      if ((summary.staleDays ?? 0) === 1) {
        return {
          ticker,
          status: "acceptable" as RefreshQueueStatus,
          label: "Acceptable",
          reason:
            "One trading day old. Usable for context, but refresh before acting.",
          priority: 35,
          summary,
        };
      }

      return {
        ticker,
        status: "fresh" as RefreshQueueStatus,
        label: "Fresh",
        reason: "Saved surface is current enough for scanner ranking.",
        priority: Math.max(5, summary.edgeScore / 20),
        summary,
      };
    })
    .sort(
      (a, b) => b.priority - a.priority || a.ticker.localeCompare(b.ticker),
    );
}

function scoreBadge(
  score: number,
  invert = false,
): { label: string; color: string; background: string } {
  const effective = invert ? 100 - score : score;
  if (effective >= 75)
    return {
      label: `${score.toFixed(0)}`,
      color: "#166534",
      background: "#dcfce7",
    };
  if (effective >= 55)
    return {
      label: `${score.toFixed(0)}`,
      color: "#92400e",
      background: "#fef3c7",
    };
  return {
    label: `${score.toFixed(0)}`,
    color: "#991b1b",
    background: "#fee2e2",
  };
}

function actionColor(bucket: ActionBucket): {
  border: string;
  background: string;
  color: string;
} {
  if (bucket === "Best CSP setup")
    return { border: "#16a34a", background: "#f0fdf4", color: "#166534" };
  if (bucket === "Best covered-call setup")
    return { border: "#2563eb", background: "#eff6ff", color: "#1d4ed8" };
  if (bucket === "Wheel candidate")
    return { border: "#7c3aed", background: "#f5f3ff", color: "#6d28d9" };
  if (bucket === "Compression coil")
    return { border: "#f59e0b", background: "#fffbeb", color: "#92400e" };
  if (bucket === "Conflict / wait")
    return { border: "#f97316", background: "#fff7ed", color: "#9a3412" };
  if (bucket === "Premium trap / avoid")
    return { border: "#dc2626", background: "#fef2f2", color: "#991b1b" };
  return { border: "#6b7280", background: "#f9fafb", color: "#374151" };
}

function isTradeNow(summary: TraderEdgeSummary): boolean {
  return (
    summary.dataQualityScore >= 70 &&
    summary.edgeScore >= 65 &&
    summary.trapRisk < 65 &&
    ["Best CSP setup", "Best covered-call setup", "Wheel candidate"].includes(
      summary.actionBucket,
    )
  );
}

function isWatchSetup(summary: TraderEdgeSummary): boolean {
  return (
    summary.dataQualityScore >= 60 &&
    (summary.actionBucket === "Compression coil" ||
      summary.actionBucket === "Conflict / wait" ||
      (summary.edgeScore >= 55 && summary.edgeScore < 65))
  );
}

function setupVerdict(summary: TraderEdgeSummary): {
  label: string;
  detail: string;
  color: string;
  background: string;
  border: string;
} {
  if (isTradeNow(summary)) {
    return {
      label: "Actionable candidate",
      detail:
        "Cleaner than average. Still require real premium, liquidity, and event-risk check.",
      color: "#166534",
      background: "#f0fdf4",
      border: "#16a34a",
    };
  }

  if (
    summary.actionBucket === "Premium trap / avoid" ||
    summary.trapRisk >= 75
  ) {
    return {
      label: "Avoid obvious strike",
      detail:
        "Trap risk dominates. The scanner is protecting you from the easy-looking trade.",
      color: "#991b1b",
      background: "#fef2f2",
      border: "#dc2626",
    };
  }

  if (summary.actionBucket === "Compression coil") {
    return {
      label: "Watch for expansion",
      detail:
        "The edge is not selling inside the range. Wait for a wall break or sell outside snapped zones.",
      color: "#92400e",
      background: "#fffbeb",
      border: "#f59e0b",
    };
  }

  if (summary.actionBucket === "Conflict / wait") {
    return {
      label: "Conflict / wait",
      detail:
        "Chart and options positioning disagree. Wait for confirmation before leaning directional.",
      color: "#9a3412",
      background: "#fff7ed",
      border: "#f97316",
    };
  }

  return {
    label: "Low-edge / wait",
    detail:
      "Not enough stacked edge. Better to pass, refresh data, or move strikes farther from spot.",
    color: "#374151",
    background: "#f9fafb",
    border: "#6b7280",
  };
}

function summaryMatchesFilter(
  summary: TraderEdgeSummary,
  filter: ScannerFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "trade-now") return isTradeNow(summary);
  if (filter === "watch") return isWatchSetup(summary);
  if (filter === "high-edge")
    return (
      summary.dataQualityScore >= 60 &&
      (summary.edgeScore >= 65 || summary.wheelScore >= 65)
    );
  if (filter === "csp")
    return (
      summary.dataQualityScore >= 60 &&
      (summary.actionBucket === "Best CSP setup" || summary.cspScore >= 65)
    );
  if (filter === "covered-call")
    return (
      summary.dataQualityScore >= 60 &&
      (summary.actionBucket === "Best covered-call setup" ||
        summary.coveredCallScore >= 65)
    );
  if (filter === "wheel")
    return (
      summary.dataQualityScore >= 60 &&
      (summary.actionBucket === "Wheel candidate" || summary.wheelScore >= 65)
    );
  if (filter === "compression")
    return (
      summary.actionBucket === "Compression coil" ||
      summary.compressionState !== "Open / not compressed"
    );
  if (filter === "conflict")
    return (
      summary.regime === "Conflict regime" ||
      summary.actionBucket === "Conflict / wait"
    );
  if (filter === "traps")
    return (
      summary.trapRisk >= 65 || summary.actionBucket === "Premium trap / avoid"
    );
  if (filter === "stale") return (summary.staleDays ?? 0) > 1;
  if (filter === "data-issues") return summary.dataQualityScore < 70;
  return true;
}

function sortValue(summary: TraderEdgeSummary, sort: ScannerSort): number {
  if (sort === "wheel") return summary.wheelScore;
  if (sort === "csp") return summary.cspScore;
  if (sort === "coveredCall") return summary.coveredCallScore;
  if (sort === "trap") return summary.trapRisk;
  if (sort === "freshness") return -(summary.staleDays ?? 999);
  if (sort === "quality") return summary.dataQualityScore;
  return summary.edgeScore;
}

function ScannerCard({
  title,
  summary,
  caption,
}: {
  title: string;
  summary: TraderEdgeSummary | null;
  caption: string;
}) {
  if (!summary) {
    return (
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: "0.8rem",
          background: "#fff",
          minHeight: 118,
        }}
      >
        <strong>{title}</strong>
        <p style={{ color: "#6b7280", marginBottom: 0 }}>
          No clean candidate above threshold yet.
        </p>
      </div>
    );
  }

  const colors = actionColor(summary.actionBucket);

  return (
    <div
      style={{
        border: `2px solid ${colors.border}`,
        borderRadius: 10,
        padding: "0.8rem",
        background: colors.background,
        minHeight: 118,
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
      >
        <div>
          <strong>{title}</strong>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.color }}>
            {summary.ticker}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong>{summary.edgeScore.toFixed(0)}</strong>
          <div style={{ fontSize: 12, color: "#4b5563" }}>Edge</div>
        </div>
      </div>
      <div style={{ marginTop: 6, fontWeight: 700 }}>
        {summary.actionBucket}
      </div>
      <div style={{ marginTop: 4, color: "#374151", fontSize: 13 }}>
        {caption}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#4b5563" }}>
        {summary.bestAction}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 12,
          color: summary.dataQualityScore >= 70 ? "#166534" : "#92400e",
        }}
      >
        Data quality: <strong>{summary.dataQualityScore.toFixed(0)}</strong>
      </div>
    </div>
  );
}

function BucketButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active ? "2px solid #111827" : "1px solid #d1d5db",
        borderRadius: 999,
        padding: "0.4rem 0.65rem",
        background: active ? "#111827" : "#fff",
        color: active ? "#fff" : "#111827",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label} <span style={{ opacity: 0.75 }}>({count})</span>
    </button>
  );
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "0.6rem",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, color: "#4b5563" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: "#6b7280" }}>{sub}</div> : null}
    </div>
  );
}

function ScorePill({
  score,
  invert = false,
}: {
  score: number;
  invert?: boolean;
}) {
  const badge = scoreBadge(score, invert);
  return (
    <span
      style={{
        borderRadius: 6,
        padding: "0.2rem 0.4rem",
        color: badge.color,
        background: badge.background,
        fontWeight: 800,
      }}
    >
      {badge.label}
    </span>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: "#fff",
        padding: "0.75rem",
      }}
    >
      <strong>{title}</strong>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

function ScannerDetail({
  summary,
  migration,
  proof,
}: {
  summary: TraderEdgeSummary;
  migration: WallMigrationSummary | null;
  proof: EdgeProofSummary | null;
}) {
  const verdict = setupVerdict(summary);

  return (
    <div
      style={{
        padding: "0.9rem",
        background: "#f8fafc",
        borderTop: "1px solid #e5e7eb",
      }}
    >
      <div
        style={{
          border: `2px solid ${verdict.border}`,
          background: verdict.background,
          color: verdict.color,
          borderRadius: 10,
          padding: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>{verdict.label}</div>
        <div style={{ color: "#374151", marginTop: 4 }}>{verdict.detail}</div>
        <div style={{ marginTop: 6, fontWeight: 700 }}>
          {summary.bestAction}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,minmax(0,1fr))",
          gap: "0.6rem",
          marginBottom: "0.75rem",
        }}
      >
        <MetricTile
          label="Dominant Edge"
          value={`${summary.edgeScore.toFixed(0)} / 100`}
          sub={summary.actionBucket}
        />
        <MetricTile
          label="Proof"
          value={
            proof?.adjustedRate == null ? "N/A" : rateText(proof.adjustedRate)
          }
          sub={
            proof && proof.evaluated > 0
              ? `${proofGradeLabel(proof.proofGrade)} · ${proof.validated}/${proof.evaluated} observed`
              : "No matured samples yet"
          }
        />
        <MetricTile
          label="Trap Risk"
          value={`${summary.trapRisk.toFixed(0)} / 100`}
          sub={summary.trapRisk >= 65 ? "respect trap" : "manageable"}
        />
        <MetricTile
          label="Pin / Snap"
          value={`${summary.pinSnapRiskScore.toFixed(0)} / 100`}
          sub={summary.compressionState}
        />
        <MetricTile
          label="Premium Proxy"
          value={`${summary.premiumProxyScore.toFixed(0)} / 100`}
          sub="not a real bid/ask check"
        />
        <MetricTile
          label="Data Quality"
          value={`${summary.dataQualityScore.toFixed(0)} / 100`}
          sub={summary.freshnessLabel}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.15fr 1fr 1fr 1fr",
          gap: "0.75rem",
        }}
      >
        <DetailSection title="Trade Playbook">
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div>
              <strong>CSP zone:</strong> sell only at/below{" "}
              <strong>{formatMoney(summary.executableCspCeiling)}</strong>{" "}
              unless assignment is desired.
            </div>
            <div>
              <strong>Covered-call zone:</strong> sell only at/above{" "}
              <strong>{formatMoney(summary.executableCoveredCallFloor)}</strong>{" "}
              unless call-away is desired.
            </div>
            <div>
              <strong>Support / resistance:</strong>{" "}
              {formatMoney(summary.support)} / {formatMoney(summary.resistance)}
            </div>
            <div>
              <strong>OI magnet:</strong> {formatMoney(summary.magnet)}
            </div>
            <div>
              <strong>Cushion rule:</strong> uses{" "}
              {summary.cushionPct.toFixed(1)}% cushion before snapping to actual
              strikes.
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Wall Migration">
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div>
              <MigrationBadge migration={migration} />
            </div>
            <div>
              {migration?.interpretation ??
                "Save a prior surface to compare OI wall movement."}
            </div>
            <div>
              <strong>Prior date:</strong> {migration?.priorDate ?? "N/A"}
            </div>
            <div>
              <strong>Put wall:</strong> {formatMoney(migration?.priorSupport)}{" "}
              → {formatMoney(migration?.currentSupport)} (
              {formatSigned(migration?.supportChange)})
            </div>
            <div>
              <strong>Call wall:</strong>{" "}
              {formatMoney(migration?.priorResistance)} →{" "}
              {formatMoney(migration?.currentResistance)} (
              {formatSigned(migration?.resistanceChange)})
            </div>
            <div>
              <strong>Magnet:</strong> {formatMoney(migration?.priorMagnet)} →{" "}
              {formatMoney(migration?.currentMagnet)} (
              {formatSigned(migration?.magnetChange)})
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Trap Detector">
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: 13 }}>
            {summary.trapNotes.map((note, index) => (
              <li key={`${summary.ticker}-trap-${index}`}>{note}</li>
            ))}
          </ul>
        </DetailSection>

        <DetailSection title="Trigger Map">
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: 13 }}>
            {summary.triggerNotes.map((note, index) => (
              <li key={`${summary.ticker}-trigger-${index}`}>{note}</li>
            ))}
          </ul>
        </DetailSection>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,minmax(0,1fr))",
          gap: "0.75rem",
          marginTop: "0.75rem",
        }}
      >
        <DetailSection title="Why It Ranked Here">
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <div>
              Support evidence:{" "}
              <strong>{summary.supportEvidenceScore.toFixed(0)}</strong>
            </div>
            <div>
              Resistance evidence:{" "}
              <strong>{summary.resistanceEvidenceScore.toFixed(0)}</strong>
            </div>
            <div>
              Price confluence:{" "}
              <strong>{summary.priceConfluenceScore.toFixed(0)}</strong>
            </div>
            <div>
              Volume / flow thrust:{" "}
              <strong>{formatRatio(summary.volumeThrust)}</strong>
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Volatility Context">
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <div>
              Realized vol: <strong>{formatPct(summary.realizedVolPct)}</strong>
            </div>
            <div>
              ATR: <strong>{formatPct(summary.atrPct)}</strong>
            </div>
            <div>
              Range width: <strong>{formatPct(summary.rangeWidthPct)}</strong>
            </div>
            <div>
              Support cushion:{" "}
              <strong>{formatPct(summary.supportCushionPct)}</strong>
            </div>
            <div>
              Resistance cushion:{" "}
              <strong>{formatPct(summary.resistanceCushionPct)}</strong>
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Bias Conflict">
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <div>
              Chart bias: <strong>{summary.chartBias.toUpperCase()}</strong>
            </div>
            <div>
              Options bias: <strong>{summary.optionsBias.toUpperCase()}</strong>
            </div>
            <div>
              Regime: <strong>{summary.regime}</strong>
            </div>
            <div>
              Interpretation:{" "}
              {summary.regime === "Conflict regime"
                ? "Do not lean directional until the wall breaks."
                : "No major chart/options conflict detected."}
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Historical Proof">
          {proof && proof.evaluated > 0 ? (
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <div>
                <strong>Observed:</strong> {proof.validated} / {proof.evaluated}
              </div>
              <div>
                <strong>Raw follow-through:</strong> {rateText(proof.rawRate)}
              </div>
              <div>
                <strong>Adjusted edge:</strong> {rateText(proof.adjustedRate)}
              </div>
              <div>
                <strong>Proof grade:</strong>{" "}
                {proofGradeLabel(proof.proofGrade)} (
                {proofConfidenceLabel(proof.confidence)} confidence)
              </div>
              <div>
                <strong>Primary outcome:</strong>{" "}
                {proof.primaryOutcome ?? "N/A"}
              </div>
            </div>
          ) : (
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              No matured proof samples for this label yet. Use live edge and
              data quality until the journal matures.
            </div>
          )}
        </DetailSection>

        <DetailSection title="Data Audit">
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: 13 }}>
            {summary.dataQualityNotes.map((note, index) => (
              <li key={`${summary.ticker}-data-${index}`}>{note}</li>
            ))}
          </ul>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Source: <code>{summary.snapshotDate}</code>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

export default function DashboardScannerPage() {
  const [mounted, setMounted] = useState(false);
  const [surfaces, setSurfaces] = useState<OptionSurfaceSnapshot[]>([]);
  const [allSurfaces, setAllSurfaces] = useState<OptionSurfaceSnapshot[]>([]);
  const [candlesByTicker, setCandlesByTicker] = useState<
    Record<string, CandleRecord[]>
  >({});
  const [filter, setFilter] = useState<ScannerFilter>("all");
  const [sort, setSort] = useState<ScannerSort>("opportunity");
  const [query, setQuery] = useState("");
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [watchlistTickers, setWatchlistTickers] = useState<string[]>([]);
  const [proofSummaries, setProofSummaries] = useState<EdgeProofSummary[]>([]);
  const [copiedQueue, setCopiedQueue] = useState(false);

  function reloadScanner() {
    const storage = readWheelDeskStorage();
    const allSavedSurfaces = storage.optionSurfaceSnapshots ?? [];
    const latestSurfaces = latestSurfaceByTicker(allSavedSurfaces);
    const trackedTickers = uniqueTickers([
      ...extractTickerStrings(storage.watchlists ?? []),
      ...readLocalWatchlistTickers(),
      ...latestSurfaces.map((surface) => String(surface.ticker ?? "")),
    ]);
    const scannerCandles = mergeScannerCandles({
      base: storage.candles ?? {},
      tickers: trackedTickers,
    });

    setAllSurfaces(allSavedSurfaces);
    setSurfaces(latestSurfaces);
    setCandlesByTicker(scannerCandles);
    setWatchlistTickers(trackedTickers);
    setProofSummaries(readEdgeProofSummaries());
  }

  useEffect(() => {
    setMounted(true);
    reloadScanner();
  }, []);

  const summaries = useMemo(() => {
    return surfaces
      .map((surface) => {
        const ticker = String(surface.ticker ?? "").toUpperCase();
        const candles =
          candlesByTicker[ticker] ??
          candlesByTicker[ticker.toLowerCase()] ??
          [];
        return buildTraderEdgeSummary({ ticker, surface, candles });
      })
      .filter((summary) => summary.ticker);
  }, [surfaces, candlesByTicker]);

  const proofByKey = useMemo(() => {
    const map = new Map<string, EdgeProofSummary>();
    for (const proof of proofSummaries) {
      const tickerKey = String(proof.ticker ?? "").toUpperCase();
      const key = `${tickerKey}|${proof.label}`;
      const existing = map.get(key);
      if (
        !existing ||
        Number(proof.horizonDays ?? 0) < Number(existing.horizonDays ?? 999)
      ) {
        map.set(key, proof);
      }
    }
    return map;
  }, [proofSummaries]);

  function getProofForSummary(
    summary: TraderEdgeSummary,
  ): EdgeProofSummary | null {
    return (
      proofByKey.get(
        `${summary.ticker.toUpperCase()}|${summary.actionBucket}`,
      ) ??
      proofByKey.get(`|${summary.actionBucket}`) ??
      null
    );
  }

  const migrationsByTicker = useMemo(() => {
    const map = new Map<string, WallMigrationSummary | null>();

    for (const surface of surfaces) {
      const ticker = String(surface.ticker ?? "").toUpperCase();
      const priorSurface = findPriorSurfaceForTicker(
        allSurfaces,
        ticker,
        surface.snapshotDate,
      );
      map.set(
        ticker,
        buildWallMigrationSummary({ currentSurface: surface, priorSurface }),
      );
    }

    return map;
  }, [surfaces, allSurfaces]);

  const surfaceTickers = useMemo(
    () =>
      surfaces
        .map((surface) => String(surface.ticker ?? "").toUpperCase())
        .filter(Boolean),
    [surfaces],
  );

  const refreshQueue = useMemo(() => {
    return buildRefreshQueue({ summaries, watchlistTickers, surfaceTickers });
  }, [summaries, watchlistTickers, surfaceTickers]);

  const refreshTickers = useMemo(() => {
    return refreshQueue
      .filter(
        (item) =>
          item.status === "missing" ||
          item.status === "review" ||
          item.status === "stale",
      )
      .map((item) => item.ticker);
  }, [refreshQueue]);

  async function copyRefreshQueue() {
    const text = refreshTickers.length
      ? refreshTickers.join(", ")
      : refreshQueue.map((item) => item.ticker).join(", ");
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedQueue(true);
      window.setTimeout(() => setCopiedQueue(false), 1500);
    } catch {
      setCopiedQueue(false);
    }
  }

  const bucketCounts = useMemo(() => {
    return {
      all: summaries.length,
      tradeNow: summaries.filter(isTradeNow).length,
      watch: summaries.filter(isWatchSetup).length,
      compression: summaries.filter(
        (s) =>
          s.actionBucket === "Compression coil" ||
          s.compressionState !== "Open / not compressed",
      ).length,
      traps: summaries.filter(
        (s) => s.trapRisk >= 65 || s.actionBucket === "Premium trap / avoid",
      ).length,
      stale: summaries.filter((s) => (s.staleDays ?? 0) > 1).length,
      dataIssues: summaries.filter((s) => s.dataQualityScore < 70).length,
    };
  }, [summaries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();

    return summaries
      .filter((summary) => !needle || summary.ticker.includes(needle))
      .filter((summary) => summaryMatchesFilter(summary, filter))
      .sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
  }, [summaries, filter, sort, query]);

  const cleanSummaries = useMemo(
    () => summaries.filter((summary) => summary.dataQualityScore >= 60),
    [summaries],
  );
  const bestCsp = useMemo(
    () =>
      cleanSummaries
        .filter((summary) => summary.cspScore >= 65)
        .sort((a, b) => b.cspScore - a.cspScore)[0] ?? null,
    [cleanSummaries],
  );
  const bestCall = useMemo(
    () =>
      cleanSummaries
        .filter((summary) => summary.coveredCallScore >= 60)
        .sort((a, b) => b.coveredCallScore - a.coveredCallScore)[0] ?? null,
    [cleanSummaries],
  );
  const bestWheel = useMemo(
    () =>
      cleanSummaries
        .filter((summary) => summary.wheelScore >= 65)
        .sort((a, b) => b.wheelScore - a.wheelScore)[0] ?? null,
    [cleanSummaries],
  );
  const biggestTrap = useMemo(
    () =>
      cleanSummaries
        .filter((summary) => summary.trapRisk >= 65)
        .sort((a, b) => b.trapRisk - a.trapRisk)[0] ?? null,
    [cleanSummaries],
  );
  const bestMigration = useMemo(() => {
    return (
      cleanSummaries
        .filter((summary) => {
          const migration = migrationsByTicker.get(summary.ticker);
          return Boolean(migration?.hasPrior && migration.migrationScore >= 55);
        })
        .sort(
          (a, b) =>
            (migrationsByTicker.get(b.ticker)?.migrationScore ?? 0) -
            (migrationsByTicker.get(a.ticker)?.migrationScore ?? 0),
        )[0] ?? null
    );
  }, [cleanSummaries, migrationsByTicker]);

  return (
    <main
      style={{
        maxWidth: 1380,
        margin: "0 auto",
        padding: "1rem",
        display: "grid",
        gap: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ marginBottom: 4 }}>WheelDesk Scanner</h1>
          <p style={{ marginTop: 0, color: "#4b5563" }}>
            Storage-first opportunity radar. Reads latest saved surfaces from{" "}
            <code>wheeldesk_storage_v2</code>, ranks tickers, and builds a
            refresh queue for stale or missing OI surfaces.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href="/dashboard"
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "0.55rem 0.75rem",
              textDecoration: "none",
              color: "#111827",
              background: "#fff",
            }}
          >
            Back to Dashboard
          </a>
          <button type="button" onClick={reloadScanner}>
            Reload saved surfaces
          </button>
          <button
            type="button"
            onClick={copyRefreshQueue}
            disabled={refreshQueue.length === 0}
          >
            {copiedQueue ? "Copied queue" : "Copy refresh queue"}
          </button>
        </div>
      </div>

      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 10,
          background: "#fff",
          padding: "0.75rem",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <BucketButton
            label="All"
            count={bucketCounts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <BucketButton
            label="Trade Now"
            count={bucketCounts.tradeNow}
            active={filter === "trade-now"}
            onClick={() => setFilter("trade-now")}
          />
          <BucketButton
            label="Wait / Watch"
            count={bucketCounts.watch}
            active={filter === "watch"}
            onClick={() => setFilter("watch")}
          />
          <BucketButton
            label="Compression"
            count={bucketCounts.compression}
            active={filter === "compression"}
            onClick={() => setFilter("compression")}
          />
          <BucketButton
            label="Traps"
            count={bucketCounts.traps}
            active={filter === "traps"}
            onClick={() => setFilter("traps")}
          />
          <BucketButton
            label="Stale"
            count={bucketCounts.stale}
            active={filter === "stale"}
            onClick={() => setFilter("stale")}
          />
          <BucketButton
            label="Data Issues"
            count={bucketCounts.dataIssues}
            active={filter === "data-issues"}
            onClick={() => setFilter("data-issues")}
          />
        </div>
      </section>

      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 10,
          background: "#fff",
          padding: "0.9rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Refresh Command Center</h3>
            <p
              style={{ margin: "0.35rem 0 0", color: "#4b5563", fontSize: 13 }}
            >
              This is the operational path: refresh missing/stale surfaces
              first, then trust the scanner ranking. Actual OI fetching still
              happens from the main Dashboard fetch/save workflow.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,minmax(80px,1fr))",
              gap: 8,
              minWidth: 420,
            }}
          >
            <MetricTile
              label="Tracked"
              value={refreshQueue.length}
              sub="watchlist + saved"
            />
            <MetricTile
              label="Fresh"
              value={
                refreshQueue.filter((item) => item.status === "fresh").length
              }
              sub="ready"
            />
            <MetricTile
              label="Refresh"
              value={refreshTickers.length}
              sub="missing/stale/review"
            />
            <MetricTile
              label="Missing"
              value={
                refreshQueue.filter((item) => item.status === "missing").length
              }
              sub="no OI surface"
            />
          </div>
        </div>

        {refreshQueue.length === 0 ? (
          <p style={{ color: "#6b7280", marginBottom: 0 }}>
            No watchlist or saved-surface tickers found yet.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              marginTop: "0.75rem",
            }}
          >
            {refreshQueue.slice(0, 14).map((item) => {
              const styles = refreshStatusStyles(item.status);
              return (
                <a
                  key={`${item.ticker}-${item.status}`}
                  href={`/dashboard?ticker=${encodeURIComponent(item.ticker)}`}
                  title={item.reason}
                  style={{
                    border: `1px solid ${styles.border}`,
                    background: styles.background,
                    color: styles.color,
                    borderRadius: 999,
                    padding: "0.35rem 0.55rem",
                    textDecoration: "none",
                    fontWeight: 800,
                    fontSize: 12,
                  }}
                >
                  {item.ticker} · {item.label}
                </a>
              );
            })}
          </div>
        )}

        {refreshTickers.length ? (
          <div style={{ marginTop: "0.75rem", color: "#4b5563", fontSize: 13 }}>
            Refresh queue: <strong>{refreshTickers.join(", ")}</strong>. Open
            each ticker on the Dashboard, fetch the option chain, save the daily
            OI surface, then return and reload this scanner.
          </div>
        ) : (
          <div style={{ marginTop: "0.75rem", color: "#166534", fontSize: 13 }}>
            All tracked tickers have usable fresh surfaces. Scanner ranking is
            ready for decision review.
          </div>
        )}
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,minmax(0,1fr))",
          gap: "0.75rem",
        }}
      >
        <ScannerCard
          title="Best CSP"
          summary={bestCsp}
          caption="Highest put-selling score after support, premium proxy, pin risk, and freshness."
        />
        <ScannerCard
          title="Best Covered Call"
          summary={bestCall}
          caption="Highest call-selling score after resistance, upside trap risk, and premium proxy."
        />
        <ScannerCard
          title="Best Wheel Candidate"
          summary={bestWheel}
          caption="Best balanced setup for wheel-style premium management."
        />
        <ScannerCard
          title="Best Migration"
          summary={bestMigration}
          caption={
            bestMigration
              ? (migrationsByTicker.get(bestMigration.ticker)?.interpretation ??
                "Strongest OI wall migration read.")
              : "Strongest current wall migration read."
          }
        />
        <ScannerCard
          title="Biggest Trap"
          summary={biggestTrap}
          caption="Highest trap risk. This is where the obvious strike may be dangerous."
        />
      </section>

      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 10,
          background: "#fff",
          padding: "0.9rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1fr auto",
            gap: "0.75rem",
            alignItems: "end",
          }}
        >
          <label>
            Search ticker
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="SOFI, AAPL, NVDA..."
              style={{ width: "100%" }}
            />
          </label>

          <label>
            Filter
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as ScannerFilter)
              }
              style={{ width: "100%" }}
            >
              <option value="all">All saved surfaces</option>
              <option value="trade-now">Trade now</option>
              <option value="watch">Wait / watch</option>
              <option value="high-edge">High edge</option>
              <option value="csp">CSP candidates</option>
              <option value="covered-call">Covered-call candidates</option>
              <option value="wheel">Wheel candidates</option>
              <option value="compression">Compression coils</option>
              <option value="conflict">Conflict regimes</option>
              <option value="traps">Trap risk</option>
              <option value="stale">Stale surfaces</option>
              <option value="data-issues">Data quality issues</option>
            </select>
          </label>

          <label>
            Sort by
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as ScannerSort)}
              style={{ width: "100%" }}
            >
              <option value="opportunity">Dominant edge</option>
              <option value="wheel">Wheel score</option>
              <option value="csp">CSP score</option>
              <option value="coveredCall">Covered-call score</option>
              <option value="trap">Trap risk</option>
              <option value="freshness">Freshness</option>
              <option value="quality">Data quality</option>
            </select>
          </label>

          <div style={{ fontSize: 13, color: "#4b5563" }}>
            Showing <strong>{filtered.length}</strong> of{" "}
            <strong>{summaries.length}</strong>
          </div>
        </div>
      </section>

      {!mounted ? null : summaries.length === 0 ? (
        <section
          style={{
            border: "1px solid #f59e0b",
            borderRadius: 10,
            background: "#fffbeb",
            padding: "1rem",
          }}
        >
          <h3 style={{ marginTop: 0 }}>No saved OI surfaces found</h3>
          <p>
            The scanner is intentionally storage-first. Save daily OI surfaces
            on the main dashboard first. Once{" "}
            <code>wheeldesk_storage_v2.optionSurfaceSnapshots</code> has
            tickers, this page ranks them automatically.
          </p>
          <a href="/dashboard">Open Dashboard</a>
        </section>
      ) : (
        <section
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 10,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "0.8rem", borderBottom: "1px solid #e5e7eb" }}>
            <h3 style={{ margin: 0 }}>Opportunity Radar</h3>
            <p
              style={{ margin: "0.35rem 0 0", color: "#4b5563", fontSize: 13 }}
            >
              Click a row to open the decision drilldown: playbook, traps,
              triggers, strike zones, and data audit.
            </p>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  {[
                    "",
                    "Ticker",
                    "Action",
                    "Migration",
                    "Proof",
                    "Edge",
                    "Wheel",
                    "CSP",
                    "CC",
                    "Trap",
                    "Regime",
                    "Bias",
                    "Support",
                    "Resistance",
                    "CSP Zone",
                    "CC Zone",
                    "Magnet",
                    "Freshness",
                    "Data",
                    "Open",
                    "Wheel",
                  ].map((header) => (
                    <th
                      key={header || "expand"}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((summary) => {
                  const colors = actionColor(summary.actionBucket);
                  const isExpanded = expandedTicker === summary.ticker;

                  return (
                    <>
                      <tr
                        key={`${summary.ticker}-${summary.snapshotDate}`}
                        onClick={() =>
                          setExpandedTicker(isExpanded ? null : summary.ticker)
                        }
                        style={{
                          borderBottom: isExpanded
                            ? "none"
                            : "1px solid #f3f4f6",
                          cursor: "pointer",
                          background: isExpanded ? "#f8fafc" : "#fff",
                        }}
                      >
                        <td style={{ padding: 8, fontWeight: 800 }}>
                          {isExpanded ? "−" : "+"}
                        </td>
                        <td
                          style={{ padding: 8, fontWeight: 800, fontSize: 14 }}
                        >
                          {summary.ticker}
                        </td>
                        <td style={{ padding: 8, minWidth: 220 }}>
                          <span
                            style={{
                              border: `1px solid ${colors.border}`,
                              borderRadius: 999,
                              padding: "0.2rem 0.45rem",
                              background: colors.background,
                              color: colors.color,
                              fontWeight: 700,
                            }}
                          >
                            {summary.actionBucket}
                          </span>
                          <div
                            style={{
                              marginTop: 4,
                              color: "#4b5563",
                              maxWidth: 380,
                            }}
                          >
                            {summary.bestAction}
                          </div>
                        </td>
                        <td style={{ padding: 8, minWidth: 170 }}>
                          <MigrationBadge
                            migration={
                              migrationsByTicker.get(summary.ticker) ?? null
                            }
                          />
                          <div style={{ marginTop: 4, color: "#6b7280" }}>
                            Score{" "}
                            {(
                              migrationsByTicker.get(summary.ticker)
                                ?.migrationScore ?? 0
                            ).toFixed(0)}
                          </div>
                        </td>
                        <td style={{ padding: 8, minWidth: 150 }}>
                          <ProofBadge proof={getProofForSummary(summary)} />
                        </td>
                        <td style={{ padding: 8 }}>
                          <ScorePill score={summary.edgeScore} />
                        </td>
                        <td style={{ padding: 8 }}>
                          {summary.wheelScore.toFixed(0)}
                        </td>
                        <td style={{ padding: 8 }}>
                          {summary.cspScore.toFixed(0)}
                        </td>
                        <td style={{ padding: 8 }}>
                          {summary.coveredCallScore.toFixed(0)}
                        </td>
                        <td style={{ padding: 8 }}>
                          <ScorePill score={summary.trapRisk} invert />
                        </td>
                        <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                          {summary.compressionState}
                          <br />
                          <span style={{ color: "#6b7280" }}>
                            {summary.regime}
                          </span>
                        </td>
                        <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                          Chart: {summary.chartBias.toUpperCase()}
                          <br />
                          Options: {summary.optionsBias.toUpperCase()}
                        </td>
                        <td style={{ padding: 8 }}>
                          {formatMoney(summary.support)}
                          <br />
                          <span style={{ color: "#6b7280" }}>
                            {formatPct(summary.supportCushionPct)}
                          </span>
                        </td>
                        <td style={{ padding: 8 }}>
                          {formatMoney(summary.resistance)}
                          <br />
                          <span style={{ color: "#6b7280" }}>
                            {formatPct(summary.resistanceCushionPct)}
                          </span>
                        </td>
                        <td style={{ padding: 8, fontWeight: 700 }}>
                          {formatMoney(summary.executableCspCeiling)}
                        </td>
                        <td style={{ padding: 8, fontWeight: 700 }}>
                          {formatMoney(summary.executableCoveredCallFloor)}
                        </td>
                        <td style={{ padding: 8 }}>
                          {formatMoney(summary.magnet)}
                        </td>
                        <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                          {summary.freshnessLabel}
                          <br />
                          <span style={{ color: "#6b7280" }}>
                            {summary.snapshotDate}
                          </span>
                        </td>
                        <td
                          style={{ padding: 8, whiteSpace: "nowrap" }}
                          title={summary.dataQualityNotes.join(" ")}
                        >
                          <strong
                            style={{
                              color:
                                summary.dataQualityScore >= 70
                                  ? "#166534"
                                  : summary.dataQualityScore >= 50
                                    ? "#92400e"
                                    : "#991b1b",
                            }}
                          >
                            {summary.dataQualityScore.toFixed(0)}
                          </strong>
                          <br />
                          <span style={{ color: "#6b7280" }}>
                            {summary.dataQualityScore >= 70
                              ? "usable"
                              : "review"}
                          </span>
                        </td>
                        <td
                          style={{ padding: 8 }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <a
                            href={`/dashboard?ticker=${encodeURIComponent(summary.ticker)}`}
                          >
                            Dashboard
                          </a>
                        </td>
                        <td
                          style={{ padding: 8 }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <a
                            href={`/dashboard/wheel?ticker=${encodeURIComponent(summary.ticker)}`}
                          >
                            Wheel
                          </a>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr
                          key={`${summary.ticker}-${summary.snapshotDate}-detail`}
                        >
                          <td colSpan={21} style={{ padding: 0 }}>
                            <ScannerDetail
                              summary={summary}
                              migration={
                                migrationsByTicker.get(summary.ticker) ?? null
                              }
                              proof={getProofForSummary(summary) ?? null}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
