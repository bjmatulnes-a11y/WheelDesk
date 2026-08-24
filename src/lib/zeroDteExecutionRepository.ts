import { authenticatedApiHeaders } from "./auth/authenticated-api";
import {
  emptyExecutionMemory,
  type ExecutionCandidate,
  type ExecutionPremiumSample,
  type ExecutionShortLegEntry,
  type ZeroDteExecutionMemory,
  type ZeroDteExecutionRead,
} from "./zeroDteExecutionIntelligence";
import type { ZeroDteOpeningMap } from "./zeroDteOpeningMap";
import type { ZeroDteOpeningTradePlan } from "./zeroDteOpeningTradePlan";
import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";

const memoryCache = new Map<string, ZeroDteExecutionMemory>();

function remember(memory: ZeroDteExecutionMemory) {
  memoryCache.set(memory.tradeDate, memory);
  return memory;
}

async function call(body: Record<string, unknown>): Promise<ZeroDteExecutionMemory> {
  const response = await fetch("/api/zero-dte/execution-v2", {
    method: "POST",
    headers: await authenticatedApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Execution persistence failed");
  }
  if (!json.memory) {
    throw new Error("Execution persistence returned no memory state.");
  }
  return remember(json.memory as ZeroDteExecutionMemory);
}

export async function loadExecutionMemoryDb(
  tradeDate: string,
): Promise<ZeroDteExecutionMemory> {
  const response = await fetch(
    `/api/zero-dte/execution-v2?tradeDate=${encodeURIComponent(tradeDate)}`,
    { headers: await authenticatedApiHeaders(), cache: "no-store" },
  );
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Execution history load failed");
  }
  return remember(json.memory as ZeroDteExecutionMemory);
}

function mergeSampleDelta(
  tradeDate: string,
  tradeDayId: string | null,
  samples: ExecutionPremiumSample[],
) {
  const current = memoryCache.get(tradeDate) ?? emptyExecutionMemory(tradeDate);
  const byKey = new Map<string, ExecutionPremiumSample>();
  for (const sample of current.samples ?? []) {
    byKey.set(`${sample.timestamp}|${sample.setupKey}`, sample);
  }
  for (const sample of samples) {
    byKey.set(`${sample.timestamp}|${sample.setupKey}`, sample);
  }
  const mergedSamples = [...byKey.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-20_000);

  return remember({
    ...current,
    tradeDate,
    tradeDayId: tradeDayId ?? current.tradeDayId,
    samples: mergedSamples,
  });
}

export async function persistExecutionSamples(args: {
  tradeDate: string;
  expirationDate: string | null;
  generatedAt: string;
  openingMap: ZeroDteOpeningMap | null;
  openingPlan: ZeroDteOpeningTradePlan | null;
  recommendation: ZeroDteRecommendation;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  items: Array<{ read: ZeroDteExecutionRead; sample: ExecutionPremiumSample }>;
}): Promise<ZeroDteExecutionMemory> {
  const items = args.items.map(({ read, sample }) => ({
    read,
    sample,
    flowState: flowStateForRead(read, args.strikeFlow),
  }));

  const response = await fetch("/api/zero-dte/execution-v2", {
    method: "POST",
    headers: await authenticatedApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      action: "sample-batch",
      ...args,
      items,
    }),
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Execution sample persistence failed");
  }

  // New optimized route returns only the inserted sample delta. Keep a
  // compatibility fallback for a server that still returns full memory during
  // a rolling deployment.
  if (json.memory) {
    return remember(json.memory as ZeroDteExecutionMemory);
  }

  const delta = json.delta as
    | {
        tradeDayId?: string | null;
        samples?: ExecutionPremiumSample[];
      }
    | undefined;
  return mergeSampleDelta(
    args.tradeDate,
    delta?.tradeDayId ?? null,
    Array.isArray(delta?.samples) ? delta.samples : args.items.map((item) => item.sample),
  );
}

export async function persistExecutionSample(args: {
  tradeDate: string;
  expirationDate: string | null;
  generatedAt: string;
  openingMap: ZeroDteOpeningMap | null;
  openingPlan: ZeroDteOpeningTradePlan | null;
  recommendation: ZeroDteRecommendation;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  read: ZeroDteExecutionRead;
  sample: ExecutionPremiumSample;
}): Promise<ZeroDteExecutionMemory> {
  return persistExecutionSamples({
    ...args,
    items: [{ read: args.read, sample: args.sample }],
  });
}

export async function openExecutionPositionDb(args: {
  tradeDate: string;
  entryTime: string;
  entryCredit: number;
  contracts: number;
  read: ZeroDteExecutionRead;
  candidate?: ExecutionCandidate;
  setupSource?: "engine" | "manual";
  engineClearedAtEntry?: boolean;
  overrideReason?: string | null;
  signalTime?: string | null;
  signalCredit?: number | null;
  entryMarkCredit?: number | null;
  entrySellableCredit?: number | null;
  entryShortDeltaAbs?: number | null;
  entryTouchRiskProxyPct?: number | null;
  entryRangeConsumptionPct?: number | null;
  entryEventRisk?: "NORMAL" | "HIGH" | null;
  entryShortLegs?: ExecutionShortLegEntry[];
}): Promise<ZeroDteExecutionMemory> {
  const candidate = args.candidate ?? args.read.candidate;
  if (!candidate) {
    throw new Error("No executable strategy candidate is available to open.");
  }

  return call({
    action: "open",
    ...args,
    candidate,
    side: args.read.edge,
  });
}

export async function openManualExecutionPositionDb(args: {
  tradeDate: string;
  entryTime: string;
  entryCredit: number;
  contracts: number;
  candidate: ExecutionCandidate;
  overrideReason?: string | null;
  entryMarkCredit?: number | null;
  entrySellableCredit?: number | null;
  entryShortDeltaAbs?: number | null;
  entryTouchRiskProxyPct?: number | null;
  entryRangeConsumptionPct?: number | null;
  entryEventRisk?: "NORMAL" | "HIGH" | null;
  entryShortLegs?: ExecutionShortLegEntry[];
  expirationDate?: string | null;
}): Promise<ZeroDteExecutionMemory> {
  return call({
    action: "manual-open",
    ...args,
    setupSource: "manual",
    engineClearedAtEntry: false,
  });
}

export async function closeExecutionPositionDb(args: {
  tradeDate: string;
  positionId: string;
  exitTime: string;
  exitDebit: number;
  exitScore: number;
  reason?: string;
  emergencyExit?: boolean;
}): Promise<ZeroDteExecutionMemory> {
  return call({
    action: "close",
    ...args,
  });
}

function flowStateForRead(
  read: ZeroDteExecutionRead,
  strikeFlow: ZeroDteStrikeFlowRead | null,
) {
  return read.strategy === "put-credit-spread"
    ? strikeFlow?.putWall.state
    : read.strategy === "call-credit-spread"
      ? strikeFlow?.callWall.state
      : read.edge === "upper"
        ? strikeFlow?.callWall.state
        : read.edge === "lower"
          ? strikeFlow?.putWall.state
          : "center";
}
