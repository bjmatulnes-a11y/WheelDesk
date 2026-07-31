import type { ZeroDteChainRow, ZeroDteRecommendation } from "../zeroDteOiIntelligence";

export type ExecutionAction = "WAIT" | "WATCH" | "SELL" | "MANAGE" | "BUYBACK";
export type ExecutionZone = "avoid" | "watch" | "harvest" | "manage";

export type IronFlyLegs = {
  lowerWing: number;
  shortPut: number;
  shortCall: number;
  upperWing: number;
};

export type PremiumPoint = {
  timestamp: string;
  credit: number;
  velocityPerMinute: number;
};

export type ScoreComponent = {
  key: string;
  label: string;
  score: number;
  max: number;
  reason: string;
};

export type ExecutionRead = {
  generatedAt: string;
  action: ExecutionAction;
  zone: ExecutionZone;
  confidence: number;
  harvestScore: number;
  buybackScore: number;
  currentCredit: number | null;
  peakCredit: number | null;
  premiumVelocityPerMinute: number;
  creditOffPeakPct: number | null;
  centerDistance: number;
  centerDistancePctOfExpectedMove: number;
  legs: IronFlyLegs;
  components: ScoreComponent[];
  reasons: string[];
  warningReasons: string[];
};

export type BuildExecutionReadInput = {
  recommendation: ZeroDteRecommendation;
  rows: ZeroDteChainRow[];
  generatedAt: string;
  premiumHistory: PremiumPoint[];
  position?: {
    open: boolean;
    entryCredit?: number | null;
  } | null;
};
