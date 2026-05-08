export const SUPPORTED_TICKERS = ["SOFI", "AAPL", "NVDA", "AMD", "SPY", "QQQ"] as const;
export type SupportedTicker = string;

export const SUPPORTED_TIMEFRAMES = ["weekly", "daily", "4h", "2h", "1h", "30m", "15m", "5m", "1m"] as const;
export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

export type Bias = "bullish" | "neutral" | "bearish";

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type PositionInputs = {
  ticker?: SupportedTicker;
  shares: number;
  costBasis: number;
  currentPrice?: number;
  shortCallStrike: number;
  shortCallDte: number;
  cashAvailable: number;
  marketBias: Bias;
  stockBias: Bias;
  sma20?: number;
  upperBollinger?: number;
  lowerBollinger?: number;
};

export type OIRow = {
  id: string;
  callOi: number;
  strike: number;
  putOi: number;
};

export type OIPriceRelation = "below_oi_center" | "inside_oi_range" | "above_oi_range";

export type OIMetrics = {
  totalCallOi: number;
  totalPutOi: number;
  callWeightedStrike: number;
  putWeightedStrike: number;
  combinedCenter: number;
  lowerRange: number;
  upperRange: number;
  priceRelation: OIPriceRelation;
};

export type ChainRow = {
  strike: number;
  callOi: number;
  putOi: number;
  callVolume?: number;
  putVolume?: number;
  iv?: number;
  delta?: number;
};

export type ExpirationSummary = {
  expiration: string;
  totalCallOi: number;
  totalPutOi: number;
  callWeightedStrike: number;
  putWeightedStrike: number;
  combinedCenter: number;
  lowerRange: number;
  upperRange: number;
  callWall: number;
  putWall: number;
  prevailingScore: number;
};

export type ExpirationChain = {
  expiration: string;
  rows: ChainRow[];
  summary: ExpirationSummary;
};

export type ChainSnapshot = {
  ticker: SupportedTicker;
  snapshotDate: string;
  chains: ExpirationChain[];
  ownerId?: string;
};

export type ChainSnapshotEntry = {
  snapshotKey: string;
  ticker: SupportedTicker;
  snapshotDate: string;
  expiration: string;
  dteAtCapture: number;
  chainKind: "monthly" | "weekly";
  rows: ChainRow[];
  summary: ExpirationSummary;
  prevailingScore: number;
  ownerId?: string;
};

export type PositionRecord = {
  ticker: SupportedTicker;
  position: PositionInputs;
  updatedAt: string;
  ownerId?: string;
};

export type DashboardPreferences = {
  ticker: SupportedTicker;
  selectedTimeframe: Timeframe;
  selectedSnapshotDate: string;
  selectedExpiration: string;
  overlays: OverlayFlags;
  updatedAt: string;
  ownerId?: string;
};

export type OverlayFlags = {
  showSavedOiHistory: boolean;
  showOiCenter: boolean;
  showOiRange: boolean;
  showWalls: boolean;
  showOiZones: boolean;
};

export type EngineMode = "recovery" | "income" | "decision_zone" | "assignment_risk";

export type DecisionOutput = {
  detectedMode: EngineMode;
  primaryAction: string;
  coveredCallZone: string;
  cspZone: string;
  marketStructureReadout: string;
  reasoningBullets: string[];
  riskNotes: string[];
};

export type StructuralDirection = "higher" | "lower" | "neutral";
export type StructuralStrength = "strengthening" | "weakening" | "stable";
export type StructuralState = "compressing" | "expanding" | "stable";
export type OverallBias = "constructive" | "defensive" | "mixed";

export type StructureInterpretation = {
  structuralDirection: StructuralDirection;
  supportState: StructuralStrength;
  resistanceState: StructuralStrength;
  structuralState: StructuralState;
  overallBias: OverallBias;
  narrative: string;
  tacticalImplication: string;
};

export type TacticalDecision = {
  tacticalSummary: string;
  recommendedActions: string[];
  cautionFlags: string[];
};

export type ConfidenceLevel = "low" | "moderate" | "high";

export type ExecutionPlan = {
  cspCandidateRange: { low: number; high: number };
  coveredCallCandidateRange: { low: number; high: number };
  conditionalTriggers: string[];
  timeGuidance: string[];
  executionNotes: string[];
  executionSummary: string;
  confidence: ConfidenceLevel;
};

export type BollingerBands = {
  sma20: number;
  upper: number;
  lower: number;
};

export type SnapshotComparison = {
  ticker: SupportedTicker;
  currentSnapshotDate: string;
  priorSnapshotDate: string;
  selectedExpiration: string;
  currentExpirationUsed: string;
  priorExpirationUsed: string;
  comparisonMatchType: "exact" | "fallback_nearest_expiration";
  comparisonNotes: string;
  totalCallOiDelta: number;
  totalPutOiDelta: number;
  callWeightedStrikeDelta: number;
  putWeightedStrikeDelta: number;
  oiCenterDelta: number;
  lowerRangeDelta: number;
  upperRangeDelta: number;
  callWallDelta: number;
  putWallDelta: number;
  oiRangeWidthDelta: number;
  callOiDeltaByStrike: Array<{ strike: number; delta: number }>;
  putOiDeltaByStrike: Array<{ strike: number; delta: number }>;
  topCallOiIncreases: Array<{ strike: number; delta: number }>;
  topCallOiDecreases: Array<{ strike: number; delta: number }>;
  topPutOiIncreases: Array<{ strike: number; delta: number }>;
  topPutOiDecreases: Array<{ strike: number; delta: number }>;
  interpretation: StructureInterpretation;
  tacticalDecision: TacticalDecision;
  executionPlan: ExecutionPlan;
};

export type SnapshotComparisonResult = {
  comparison: SnapshotComparison | null;
  reason:
    | "ok"
    | "no_prior_snapshots_for_ticker"
    | "only_one_snapshot_exists"
    | "no_matching_expiration_chain"
    | "incomplete_snapshot_data";
  message: string;
};
