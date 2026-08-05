import type {
  ExecutionCandidate,
  ExecutionPremiumSample,
  ZeroDteExecutionMemory,
  ZeroDteExecutionRead,
} from "./zeroDteExecutionIntelligence";
import type { ZeroDteOpeningMap } from "./zeroDteOpeningMap";
import type { ZeroDteOpeningTradePlan } from "./zeroDteOpeningTradePlan";
import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";

async function call(body: Record<string, unknown>): Promise<ZeroDteExecutionMemory> {
  const response = await fetch("/api/zero-dte/execution-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Execution persistence failed");
  }
  return json.memory as ZeroDteExecutionMemory;
}

export async function loadExecutionMemoryDb(
  tradeDate: string,
): Promise<ZeroDteExecutionMemory> {
  const response = await fetch(
    `/api/zero-dte/execution-v2?tradeDate=${encodeURIComponent(tradeDate)}`,
    { cache: "no-store" },
  );
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Execution history load failed");
  }
  return json.memory as ZeroDteExecutionMemory;
}

export async function persistExecutionSamples(args: {
  tradeDate: string;
  expirationDate: string | null;
  generatedAt: string;
  openingMap: ZeroDteOpeningMap;
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

  return call({
    action: "sample-batch",
    ...args,
    items,
  });
}

export async function persistExecutionSample(args: {
  tradeDate: string;
  expirationDate: string | null;
  generatedAt: string;
  openingMap: ZeroDteOpeningMap;
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
