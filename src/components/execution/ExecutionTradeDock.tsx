"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  makeExecutionSetupKey,
  type ExecutionCandidate,
  type ExecutionLeg,
  type ExecutionLegProfileRead,
  type ExecutionPositionMemory,
  type ExecutionShortLegEntry,
  type ExecutionSideProfileRead,
  type ExecutionStrategy,
  type ZeroDteExecutionRead,
} from "../../lib/zeroDteExecutionIntelligence";
import type { StableExecutionCandidateTrack } from "../../lib/execution/useStableExecutionCandidates";
import type { ZeroDtePortfolioRead } from "../../lib/zeroDtePortfolioEngine";
import type { ZeroDteRiskPolicy } from "../../lib/zeroDteRiskPolicy";
import { accountRiskBudgetDollars } from "../../lib/zeroDteRiskPolicy";
import type { AdaptiveManagementDecision } from "../../lib/zeroDteAdaptiveManagement";

type Props = {
  read: ZeroDteExecutionRead | null;
  portfolio: ZeroDtePortfolioRead | null;
  positionReads: Record<string, ZeroDteExecutionRead>;
  executionPositions?: ExecutionPositionMemory[];
  positionAdaptiveDecisions?: Record<string, AdaptiveManagementDecision>;
  candidates: Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>;
  tracks: Record<ExecutionStrategy, StableExecutionCandidateTrack> | null;
  riskPolicy: ZeroDteRiskPolicy;
  selectedStrategy: ExecutionStrategy;
  onStrategyChange: (strategy: ExecutionStrategy) => void;
  evaluateCandidate?: (candidate: ExecutionCandidate) => ZeroDteExecutionRead | null;
  onOpen: (args: {
    candidate: ExecutionCandidate;
    entryCredit: number;
    quantity: number;
    setupSource: "engine" | "manual";
    engineClearedAtEntry: boolean;
    overrideReason: string | null;
    entryShortLegs: ExecutionShortLegEntry[];
  }) => void | Promise<void>;
  onClose: (positionId: string, exitDebit: number) => void | Promise<void>;
  onConfirmAdaptive?: (positionId: string, actualPrice: number) => void | Promise<void>;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  /** Non-overridable live-data safety lock for NEW entries; closes remain available. */
  entryLocked?: boolean;
  entryLockedReason?: string | null;
  busy?: boolean;
  error?: string | null;
};

type SetupMode = "recommended" | "manual";
type DraftLeg = Omit<ExecutionLeg, "strike"> & { strike: string };

const STRATEGIES: Array<{ strategy: ExecutionStrategy; label: string }> = [
  { strategy: "put-credit-spread", label: "Put Credit" },
  { strategy: "call-credit-spread", label: "Call Credit" },
  { strategy: "iron-fly", label: "Iron Fly" },
];

export function ExecutionTradeDock({
  read,
  portfolio,
  positionReads,
  executionPositions,
  positionAdaptiveDecisions = {},
  candidates,
  tracks,
  riskPolicy,
  selectedStrategy,
  onStrategyChange,
  evaluateCandidate,
  onOpen,
  onClose,
  onConfirmAdaptive,
  readOnly = false,
  readOnlyReason = null,
  entryLocked = false,
  entryLockedReason = null,
  busy = false,
  error = null,
}: Props) {
  const [setupMode, setSetupMode] = useState<SetupMode>("recommended");
  const [draftLegs, setDraftLegs] = useState<DraftLeg[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [entryCredit, setEntryCredit] = useState("");
  const [showEntry, setShowEntry] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const candidate = candidates[selectedStrategy] ?? null;
  const candidateKey = candidate?.setupKey ?? `${selectedStrategy}:none`;
  const positions =
    executionPositions ?? (portfolio?.positions ?? []).map((item) => item.position);

  useEffect(() => {
    if (!positions.length) setShowEntry(true);
  }, [positions.length]);

  useEffect(() => {
    setOverrideEnabled(false);
    setOverrideReason("");
  }, [candidateKey, setupMode, selectedStrategy]);

  useEffect(() => {
    if (setupMode === "manual") {
      // Manual entry must remain available even when the engine has no tracked
      // candidate/center for the selected strategy. Preserve anything the user
      // has already typed; otherwise seed the editor from the tracked legs when
      // available, or from a blank strategy template.
      setDraftLegs((current) =>
        current.length
          ? current
          : candidate
            ? candidate.legs.map((leg) => ({ ...leg, strike: leg.strike.toFixed(0) }))
            : defaultDraftLegs(selectedStrategy),
      );
      return;
    }
    if (!candidate) {
      setDraftLegs([]);
      setEntryCredit("");
      return;
    }
    setDraftLegs(
      candidate.legs.map((leg) => ({ ...leg, strike: leg.strike.toFixed(0) })),
    );
    // Actual fill is user-entered execution data. Never pin a scanner snapshot
    // into this field and make it look like a live market quote.
    setEntryCredit("");
  }, [candidateKey, setupMode, selectedStrategy]);

  const parsedEntryCredit = parseNonNegative(entryCredit);
  const parsedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));

  const ticket = useMemo(() => {
    if (setupMode === "recommended") {
      if (!candidate) return { candidate: null, error: "No tracked setup is available." };
      const credit =
        parsedEntryCredit ??
        read?.currentSellableCredit ??
        read?.currentCredit ??
        candidate.sellableCredit ??
        candidate.estimatedCredit;
      return {
        candidate: {
          ...candidate,
          estimatedCredit: credit,
          maxRiskDollars: calculateMaxRisk(
            selectedStrategy,
            candidate.legs,
            credit,
          ),
        },
        error: null,
      };
    }

    // Manual mode is intentionally independent of the tracked-candidate book.
    // This lets the user record an actual IF/spread at a center the scanner did
    // not track, while still re-evaluating those exact live legs through the
    // execution engine and requiring an explicit override when it is not cleared.
    const legs = draftLegs.map((leg) => ({
      optionType: leg.optionType,
      action: leg.action,
      strike: Number(leg.strike),
    }));
    const validation = validateLegs(selectedStrategy, legs);
    if (validation) return { candidate: null, error: validation };

    const credit =
      parsedEntryCredit ??
      read?.currentSellableCredit ??
      read?.currentCredit ??
      null;
    return {
      candidate: {
        strategy: selectedStrategy,
        label: `Manual ${strategyName(selectedStrategy)}`,
        legs,
        setupKey: makeExecutionSetupKey(selectedStrategy, legs),
        score: 0,
        eligible: false,
        estimatedCredit: credit,
        sellableCredit: null,
        buybackDebit: null,
        shortDeltaAbs: null,
        spreadMode: candidate?.spreadMode ?? null,
        maxRiskDollars: calculateMaxRisk(selectedStrategy, legs, credit),
        mapPhase: candidate?.mapPhase ?? read?.mapPhase ?? "OPENING",
        mapCenter:
          candidate?.mapCenter ??
          read?.mapCenter ??
          legs.find((leg) => leg.action === "sell")?.strike ??
          legs[0]?.strike ??
          0,
        railBreached: candidate?.railBreached ?? read?.railBreached ?? "NONE",
        reasons: [
          candidate
            ? "Manual execution legs entered in the WheelDesk Portfolio Dock and independently re-evaluated by the execution engine."
            : "Manual execution legs entered without a tracked engine center; exact live legs are independently re-evaluated by the execution engine.",
        ],
        blockers: [],
      },
      error: null,
    };
  }, [
    candidate,
    draftLegs,
    parsedEntryCredit,
    read?.currentCredit,
    read?.currentSellableCredit,
    selectedStrategy,
    setupMode,
  ]);

  if (!read) {
    return (
      <div style={styles.card}>
        <div style={styles.eyebrow}>Portfolio Dock</div>
        <div style={styles.empty}>Waiting for live execution intelligence.</div>
      </div>
    );
  }

  const activeRead =
    setupMode === "manual" && ticket.candidate && evaluateCandidate
      ? evaluateCandidate(ticket.candidate) ?? read
      : read;
  const signalCleared =
    activeRead.lifecycle === "SELL_READY" && !activeRead.entryHardBlocked;
  const ticketRiskDollars =
    (ticket.candidate?.maxRiskDollars ?? 0) * parsedQuantity;
  const projectedEffectiveRiskDollars = (() => {
    if (!portfolio || !ticket.candidate || ticketRiskDollars <= 0) {
      return portfolio?.effectiveRiskDollars ?? ticketRiskDollars;
    }
    const strategy = ticket.candidate.strategy;
    const projectedUpside =
      portfolio.upsideMaxLossDollars +
      (strategy === "call-credit-spread" || strategy === "iron-fly" ? ticketRiskDollars : 0);
    const projectedDownside =
      portfolio.downsideMaxLossDollars +
      (strategy === "put-credit-spread" || strategy === "iron-fly" ? ticketRiskDollars : 0);
    return Math.max(projectedUpside, projectedDownside);
  })();
  const ticketRiskExceedsBudget = Boolean(
    portfolio &&
      ticketRiskDollars > 0 &&
      projectedEffectiveRiskDollars > portfolio.riskBudgetDollars,
  );
  const remainingRiskBudget = portfolio
    ? portfolio.availableRiskCapacityDollars
    : null;
  const oneLotRisk = ticket.candidate?.maxRiskDollars ?? null;
  const accountRiskBudget = accountRiskBudgetDollars(riskPolicy);
  const regimeAdjustedAccountRiskBudget =
    accountRiskBudget === null
      ? null
      : accountRiskBudget * activeRead.recommendedSizeMultiplier;
  const regimeAdjustedPortfolioRoom =
    remainingRiskBudget === null
      ? null
      : remainingRiskBudget * activeRead.recommendedSizeMultiplier;
  const effectiveTicketRiskBudget =
    regimeAdjustedAccountRiskBudget === null
      ? regimeAdjustedPortfolioRoom
      : regimeAdjustedPortfolioRoom === null
        ? regimeAdjustedAccountRiskBudget
        : Math.min(
            regimeAdjustedAccountRiskBudget,
            regimeAdjustedPortfolioRoom,
          );
  const recommendedMaxQuantity =
    effectiveTicketRiskBudget !== null && oneLotRisk !== null && oneLotRisk > 0
      ? Math.max(0, Math.floor(effectiveTicketRiskBudget / oneLotRisk))
      : null;
  const ticketSizeExceedsRecommendation = Boolean(
    recommendedMaxQuantity !== null && parsedQuantity > recommendedMaxQuantity,
  );
  const engineCleared =
    signalCleared &&
    !ticketRiskExceedsBudget &&
    !ticketSizeExceedsRecommendation;
  const contribution =
    setupMode === "recommended"
      ? portfolio?.candidateContribution[selectedStrategy] ?? null
      : null;
  const overrideValid =
    overrideEnabled && overrideReason.trim().length >= 4;
  const isManualActualPosition = setupMode === "manual";
  const canOpen =
    !readOnly &&
    !entryLocked &&
    !busy &&
    ticket.candidate !== null &&
    parsedEntryCredit !== null &&
    parsedEntryCredit > 0 &&
    (isManualActualPosition || engineCleared || overrideValid);

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div style={styles.headerTitleBlock}>
          <div style={styles.eyebrow}>Portfolio Dock</div>
          <div style={styles.title}>
            {readOnly
              ? "Research Chain"
              : positions.length
                ? "Manage 0DTE Profile"
                : "Enter Actual Position"}
          </div>
        </div>
        <div style={styles.headerActions}>
          <div
            style={{
              ...styles.enginePill,
              color: engineCleared ? "#71e0b4" : "#f5c542",
              borderColor: engineCleared
                ? "rgba(113,224,180,.45)"
                : "rgba(245,197,66,.42)",
            }}
          >
            {activeRead.lifecycle.replaceAll("_", " ")}
          </div>
          <button type="button" onClick={() => setCollapsed((current) => !current)} style={styles.collapseButton}>
            {collapsed ? "+" : "−"}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <>
          {readOnly ? (
            <div style={styles.readOnlyBanner}>
              <strong>RESEARCH ONLY</strong>
              <span>{readOnlyReason ?? "Live position entry is disabled for this chain."}</span>
            </div>
          ) : null}

          {entryLocked && !readOnly ? (
            <div style={styles.error}>
              <strong>NEW ENTRY LOCKED</strong>
              <span> {entryLockedReason ?? "Live execution data failed a freshness or integrity gate."}</span>
              <div>Existing positions remain manageable; this lock cannot be bypassed with a manual override.</div>
            </div>
          ) : null}

          {portfolio ? <PortfolioSummary portfolio={portfolio} /> : null}

      {positions.length ? (
        <PositionManagementWorkbench
          positions={positions}
          positionReads={positionReads}
          adaptiveDecisions={positionAdaptiveDecisions}
        />
      ) : null}

      {positions.length ? (
        <div style={styles.positionStack}>
          {positions.map((position) => (
            <PortfolioPositionCard
              key={position.id}
              position={position}
              read={positionReads[position.id] ?? null}
              adaptiveDecision={positionAdaptiveDecisions[position.id] ?? null}
              busy={busy}
              onClose={onClose}
              onConfirmAdaptive={onConfirmAdaptive}
            />
          ))}
        </div>
      ) : null}

      {positions.length ? (
        <button
          type="button"
          onClick={() => setShowEntry((current) => !current)}
          style={styles.addButton}
        >
          {showEntry ? "Hide Additional Entry" : "Add Another Position"}
        </button>
      ) : null}

      {showEntry ? (
        <>
          <div style={styles.regimeBar}>
            <span>{activeRead.timeRegime.label}</span>
            <strong>{activeRead.timeRegime.centralTime} CT</strong>
            <em>{Math.round(activeRead.recommendedSizeMultiplier * 100)}% size</em>
          </div>

          <div style={styles.strategyGrid}>
            {STRATEGIES.map(({ strategy, label }) => {
              const option = candidates[strategy];
              const track = tracks?.[strategy] ?? null;
              const active = selectedStrategy === strategy;
              const scannerScore = track?.scannerCandidate?.score ?? null;
              return (
                <button
                  type="button"
                  key={strategy}
                  onClick={() => {
                    setSetupMode("recommended");
                    onStrategyChange(strategy);
                  }}
                  style={{
                    ...styles.strategyButton,
                    ...(active ? styles.strategyButtonActive : {}),
                    opacity: option ? 1 : 0.5,
                  }}
                >
                  <span>{label}</span>
                  <strong>{option ? Math.round(option.score) : "—"}</strong>
                  <small>
                    {track?.status.replaceAll("_", " ") ?? (readOnly && option ? "SCANNER" : "NO TRACK")}
                    {scannerScore !== null && scannerScore !== option?.score
                      ? ` · scan ${Math.round(scannerScore)}`
                      : ""}
                  </small>
                </button>
              );
            })}
          </div>

          <div style={styles.trackingStrip}>
            <div style={styles.trackingSetup}>
              <span>
                {setupMode === "manual"
                  ? "Manual Setup"
                  : readOnly
                    ? "Research Setup"
                    : "Tracked"}
              </span>
              <strong style={styles.trackingValue}>{formatLegs(ticket.candidate?.legs ?? candidate?.legs ?? [])}</strong>
            </div>
            <div style={styles.trackingCell}><span>Age</span><strong style={styles.trackingValue}>{activeRead.candidateAgeCandles} candles</strong></div>
            <div style={styles.trackingCell}><span>Lock Credit</span><strong style={styles.trackingValue}>{money(tracks?.[selectedStrategy]?.lockedCredit)}</strong></div>
            <div style={styles.trackingCell}><span>Mark</span><strong style={styles.trackingValue}>{money(activeRead.currentCredit)}</strong></div>
            <div style={styles.trackingCell}><span>Sellable</span><strong style={styles.trackingValue}>{money(activeRead.currentSellableCredit)}</strong></div>
            <div style={styles.trackingCell}><span>Buyback</span><strong style={styles.trackingValue}>{money(activeRead.currentBuybackDebit)}</strong></div>
            <div style={styles.trackingCell}><span>Peak</span><strong style={styles.trackingValue}>{money(activeRead.peakCredit)}</strong></div>
            <div style={styles.trackingCell}><span>Tape</span><strong style={styles.trackingValue}>{activeRead.premiumSampleCount} pts</strong></div>
          </div>

          <div style={styles.modeRow}>
            <button
              type="button"
              onClick={() => setSetupMode("recommended")}
              style={{
                ...styles.modeButton,
                ...(setupMode === "recommended" ? styles.modeButtonActive : {}),
              }}
            >
              Tracked Setup
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftLegs(
                  candidate
                    ? candidate.legs.map((leg) => ({ ...leg, strike: leg.strike.toFixed(0) }))
                    : defaultDraftLegs(selectedStrategy),
                );
                setSetupMode("manual");
              }}
              style={{
                ...styles.modeButton,
                ...(setupMode === "manual" ? styles.modeButtonActive : {}),
              }}
            >
              Manual Legs
            </button>
          </div>

          {draftLegs.length ? (
            <div style={styles.legEditor}>
              {draftLegs.map((leg, index) => (
                <label
                  key={`${leg.action}-${leg.optionType}-${index}`}
                  style={styles.legField}
                >
                  <span>
                    {leg.action.toUpperCase()} {leg.optionType.toUpperCase()}
                  </span>
                  <input
                    value={leg.strike}
                    disabled={setupMode === "recommended"}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraftLegs((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, strike: value } : item,
                        ),
                      );
                    }}
                    type="number"
                    step="5"
                    style={{
                      ...styles.legInput,
                      opacity: setupMode === "recommended" ? 0.72 : 1,
                    }}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div style={styles.empty}>
              {setupMode === "manual"
                ? "Enter the exact broker legs. A tracked engine center is not required."
                : "No executable tracked legs for this strategy. Manual Legs remains available."}
            </div>
          )}

          <div style={styles.twoColumn}>
            <label style={styles.fieldLabel}>
              Quantity
              <input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                type="number"
                min="1"
                step="1"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Actual fill credit
              <input
                value={entryCredit}
                onChange={(event) => setEntryCredit(event.target.value)}
                type="number"
                min="0"
                step="0.05"
                placeholder="enter actual fill"
                style={styles.input}
              />
              <button
                type="button"
                disabled={(activeRead.currentSellableCredit ?? activeRead.currentCredit) == null}
                onClick={() => {
                  const live = activeRead.currentSellableCredit ?? activeRead.currentCredit;
                  if (live == null) return;
                  setEntryCredit(live.toFixed(2));
                }}
                style={{
                  ...styles.useLiveButton,
                  opacity: (activeRead.currentSellableCredit ?? activeRead.currentCredit) == null ? 0.45 : 1,
                }}
              >
                Use Sellable {money(activeRead.currentSellableCredit ?? activeRead.currentCredit)}
              </button>
            </label>
          </div>

          <div style={styles.metricGrid}>
            <DockMetric label="Tape Open" value={money(activeRead.openingCredit)} />
            <DockMetric
              label="Velocity"
              value={
                activeRead.premiumVelocityPerMinute == null
                  ? "—"
                  : `${activeRead.premiumVelocityPerMinute >= 0 ? "+" : ""}${activeRead.premiumVelocityPerMinute.toFixed(3)}/m`
              }
            />
            <DockMetric
              label="Max Risk / 1×"
              value={dollars(
                ticket.candidate?.maxRiskDollars ?? candidate?.maxRiskDollars,
              )}
            />
            <DockMetric
              label="Ticket Risk"
              value={dollars(ticketRiskDollars)}
            />
            <DockMetric
              label="Engine Max Qty"
              value={recommendedMaxQuantity == null ? "—" : String(recommendedMaxQuantity)}
            />
            <DockMetric
              label="Account Risk Cap"
              value={accountRiskBudget == null ? "OFF" : dollars(accountRiskBudget)}
            />
            <DockMetric
              label="Short Distance"
              value={
                activeRead.shortDistancePoints == null
                  ? "—"
                  : `${activeRead.shortDistancePoints.toFixed(1)} pts`
              }
            />
            <DockMetric
              label="Delta / Touch Proxy"
              value={
                activeRead.shortDeltaAbs == null
                  ? "—"
                  : `${activeRead.shortDeltaAbs.toFixed(2)} / ~${Math.round(activeRead.touchRiskProxyPct ?? 0)}%`
              }
            />
            <DockMetric
              label="Signal Gate"
              value={`${Math.round(activeRead.entryScore)} / ${activeRead.minimumEntryScore}`}
            />
            <DockMetric
              label="Signal Grade"
              value={`${activeRead.signalGrade} · A+ ${activeRead.aPlusEntryScore}`}
            />
          </div>

          {ticketRiskExceedsBudget ? (
            <div style={styles.error}>
              This quantity would raise effective worst-side defined risk to {dollars(projectedEffectiveRiskDollars)},
              above the {dollars(portfolio?.riskBudgetDollars ?? 0)} policy budget.
              Recording it requires an explicit override.
            </div>
          ) : null}
          {ticketSizeExceedsRecommendation ? (
            <div style={styles.error}>
              This quantity exceeds the engine's {Math.round(activeRead.recommendedSizeMultiplier * 100)}%
              regime/event-risk size recommendation
              {recommendedMaxQuantity !== null ? ` (max ${recommendedMaxQuantity} contract${recommendedMaxQuantity === 1 ? "" : "s"})` : ""}.
              Recording it requires an explicit override.
            </div>
          ) : null}
          {contribution?.blockers.length ? (
            <div style={styles.error}>{contribution.blockers.join(" ")}</div>
          ) : null}

          {!readOnly && !entryLocked && !engineCleared && !isManualActualPosition ? (
            <div style={styles.warning}>
              Engine approval requires SELL READY with no hard blocker. To record
              a broker fill anyway, explicitly enable a manual override below.
            </div>
          ) : null}

          {isManualActualPosition ? (
            <div style={styles.warning}>
              Manual Actual Position: WheelDesk will record and manage these exact legs
              even when the scanner has no tracked candidate. Engine entry approval is informational only.
            </div>
          ) : null}

          {!readOnly && !entryLocked && !engineCleared && !isManualActualPosition ? (
            <div style={styles.overrideBox}>
              <label style={styles.overrideCheck}>
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={(event) => setOverrideEnabled(event.target.checked)}
                />
                Record as manual override
              </label>
              {overrideEnabled ? (
                <input
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Override reason (required)"
                  style={styles.input}
                />
              ) : null}
              {activeRead.entryHardBlocked ? (
                <div style={styles.error}>
                  Hard block: {activeRead.warnings.join(" ") || "Execution safety gate failed."}
                </div>
              ) : null}
            </div>
          ) : null}

          {ticket.error ? <div style={styles.error}>{ticket.error}</div> : null}
          {error ? <div style={styles.error}>{error}</div> : null}

          <button
            type="button"
            disabled={!canOpen}
            onClick={() => {
              if (!ticket.candidate || parsedEntryCredit == null) return;
              void onOpen({
                candidate: ticket.candidate,
                entryCredit: parsedEntryCredit,
                quantity: parsedQuantity,
                setupSource: setupMode === "manual" ? "manual" : "engine",
                engineClearedAtEntry: isManualActualPosition ? false : engineCleared,
                overrideReason: isManualActualPosition
                  ? "Manual actual position"
                  : engineCleared
                    ? null
                    : overrideReason.trim(),
                entryShortLegs: ticket.candidate.legs.flatMap<ExecutionShortLegEntry>((leg) =>
                  leg.action === "sell"
                    ? [{
                        optionType: leg.optionType,
                        strike: leg.strike,
                        sellPrice: null,
                        source: "unknown",
                      }]
                    : [],
                ),
              });
            }}
            style={{ ...styles.openButton, opacity: canOpen ? 1 : 0.45 }}
          >
            {readOnly
              ? "Research Only · Entry Disabled"
              : entryLocked
                ? "New Entry Locked · Waiting for Fresh Data"
                : busy
                ? "Saving…"
                : `Add / Track ${strategyName(selectedStrategy)}`}
          </button>
        </>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

function PortfolioSummary({ portfolio }: { portfolio: ZeroDtePortfolioRead }) {
  return (
    <div style={styles.portfolioSummary}>
      <div style={styles.storyRow}>
        <span>{portfolio.storyLabel}</span>
        <strong>{portfolio.recommendedActionLabel}</strong>
      </div>
      <div style={styles.metricGrid}>
        <DockMetric label="Net Delta" value={signed(portfolio.netDelta)} />
        <DockMetric
          label="Target Band"
          value={`${signed(portfolio.targetDeltaMin)} to ${signed(portfolio.targetDeltaMax)}`}
        />
        <DockMetric label="Open P/L" value={dollars(portfolio.openPnlDollars)} />
        <DockMetric
          label="Effective Risk"
          value={`${dollars(portfolio.effectiveRiskDollars)} · ${Math.round(portfolio.effectiveRiskBudgetUsedPct)}%`}
        />
        <DockMetric
          label="Nominal Gross"
          value={dollars(portfolio.grossRiskDollars)}
        />
        <DockMetric
          label="Adaptive Capacity"
          value={dollars(portfolio.availableRiskCapacityDollars)}
        />
      </div>
      {portfolio.warnings.length ? (
        <div style={styles.warning}>{portfolio.warnings.join(" ")}</div>
      ) : null}
    </div>
  );
}

type ManagedLegRow = ExecutionLegProfileRead & {
  positionId: string;
  positionLabel: string;
  strategy: ExecutionStrategy;
};

function PositionManagementWorkbench({
  positions,
  positionReads,
  adaptiveDecisions,
}: {
  positions: ExecutionPositionMemory[];
  positionReads: Record<string, ZeroDteExecutionRead>;
  adaptiveDecisions: Record<string, AdaptiveManagementDecision>;
}) {
  const ironFlyPositions = positions.filter((position) => position.strategy === "iron-fly");
  const putPositions = positions.filter((position) => position.strategy === "put-credit-spread");
  const callPositions = positions.filter((position) => position.strategy === "call-credit-spread");
  const condorPositions = putPositions.length && callPositions.length
    ? [...putPositions, ...callPositions]
    : [];

  const ironFlyRows = buildManagedRows(ironFlyPositions, positionReads);
  const condorRows = buildManagedRows(condorPositions, positionReads);
  const ironFlySides = aggregateSideProfiles(ironFlyPositions, positionReads);
  const condorSides = aggregateSideProfiles(condorPositions, positionReads);

  return (
    <div style={styles.workbench}>
      <div style={styles.workbenchHeader}>
        <div>
          <div style={styles.smallCaps}>Actual Position Management Workbench</div>
          <strong>Every live leg · Greeks · side profiles · adaptive state</strong>
        </div>
        <span>Same ledger feeds background management</span>
      </div>

      <StructureLegTable
        title="Iron Fly 0DTE"
        subtitle={
          ironFlyPositions.length
            ? `${ironFlyPositions.length} open fly${ironFlyPositions.length === 1 ? "" : "ies"}; put and call center shorts remain independently visible.`
            : "No actual iron-fly position is open."
        }
        rows={ironFlyRows}
        sideProfiles={ironFlySides}
        decisions={ironFlyPositions.map((position) => adaptiveDecisions[position.id]).filter(Boolean)}
      />

      <StructureLegTable
        title="Iron Condor 0DTE"
        subtitle={
          condorPositions.length
            ? "Paired actual put-credit and call-credit positions are shown as one two-sided risk book; each source position remains independently managed."
            : putPositions.length || callPositions.length
              ? "Only one credit-spread side is open; WheelDesk will form this table when the opposite side is added."
              : "No paired actual put/call credit positions are open."
        }
        rows={condorRows}
        sideProfiles={condorSides}
        decisions={condorPositions.map((position) => adaptiveDecisions[position.id]).filter(Boolean)}
      />
    </div>
  );
}

function StructureLegTable({
  title,
  subtitle,
  rows,
  sideProfiles,
  decisions,
}: {
  title: string;
  subtitle: string;
  rows: ManagedLegRow[];
  sideProfiles: ExecutionSideProfileRead[];
  decisions: AdaptiveManagementDecision[];
}) {
  const totals = rows.reduce(
    (acc, row) => ({
      delta: acc.delta + row.exposureDelta,
      gamma: acc.gamma + row.exposureGamma,
      theta: acc.theta + row.exposureTheta,
      vega: acc.vega + row.exposureVega,
    }),
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );
  const actionable = decisions.find((decision) =>
    decision.action === "RELEASE_SHORT" ||
    decision.action === "REINSTATE_SHORT" ||
    decision.action === "CLOSE_RUNNER",
  ) ?? null;

  return (
    <section style={styles.structureTableCard}>
      <div style={styles.structureTableHeader}>
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        {rows.length ? (
          <div style={styles.greekStrip}>
            <MiniGreek label="Net Δ" value={totals.delta} />
            <MiniGreek label="Net Γ" value={totals.gamma} />
            <MiniGreek label="Net Θ" value={totals.theta} />
            <MiniGreek label="Net Vega" value={totals.vega} />
          </div>
        ) : null}
      </div>

      {actionable ? (
        <div style={styles.workbenchActionAlert}>
          <strong>{actionable.action.replaceAll("_", " ")}</strong>
          <span>{actionable.structureTransition?.detail ?? actionable.reasons[0]}</span>
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div style={styles.legTableScroll}>
            <table style={styles.legTable}>
              <thead>
                <tr>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Position</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Role</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Side</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Qty</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Strike</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Entry*</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Bid</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Ask</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Mid</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>IV</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Δ</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Γ</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Θ</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Vega</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Close</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Short ×</th>
                  <th style={{ ...styles.tableCell, ...styles.tableHeaderCell }}>Dist</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType))
                  .map((row, index) => (
                    <tr key={`${row.positionId}-${row.optionType}-${row.strike}-${row.action}-${index}`}>
                      <td title={row.positionLabel} style={styles.tableCell}>{shortPositionLabel(row.positionLabel)}</td>
                      <td style={styles.tableCell}><span style={rolePillStyle(row.role)}>{row.role.replaceAll("_", " ")}</span></td>
                      <td style={styles.tableCell}>{row.optionType.toUpperCase()} {row.action === "sell" ? "SHORT" : "LONG"}</td>
                      <td style={styles.tableCell}>{row.quantity}</td>
                      <td style={styles.tableCell}><strong>{row.strike.toFixed(0)}</strong></td>
                      <td style={styles.tableCell}>{money(row.shortEntryPrice)}</td>
                      <td style={styles.tableCell}>{money(row.bid)}</td>
                      <td style={styles.tableCell}>{money(row.ask)}</td>
                      <td style={styles.tableCell}>{money(row.mid)}</td>
                      <td style={styles.tableCell}>{formatIv(row.iv)}</td>
                      <td style={styles.tableCell}>{greek(row.delta)}</td>
                      <td style={styles.tableCell}>{greek(row.gamma, 4)}</td>
                      <td style={styles.tableCell}>{greek(row.theta)}</td>
                      <td style={styles.tableCell}>{greek(row.vega)}</td>
                      <td style={styles.tableCell}>{money(row.closePrice)}</td>
                      <td style={{ ...styles.tableCell, ...shortMultipleStyle(row.shortPremiumMultiple) }}>{multiple(row.shortPremiumMultiple)}</td>
                      <td style={styles.tableCell}>{signedPoints(row.distanceFromSpot)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div style={styles.tableFootnote}>* Entry is the recorded short-leg sale price when available; package entry credit remains authoritative for total-position P/L.</div>
          <div style={styles.sideProfileGrid}>
            {sideProfiles.map((side) => <SideProfileCard key={side.side} profile={side} />)}
          </div>
        </>
      ) : (
        <div style={styles.structureEmpty}>Waiting for an actual structure to populate this ledger.</div>
      )}
    </section>
  );
}

function SideProfileCard({ profile }: { profile: ExecutionSideProfileRead }) {
  return (
    <div style={{ ...styles.sideProfileCard, borderColor: sideStateColor(profile.state) }}>
      <div style={styles.sideProfileHeader}>
        <strong>{profile.side.toUpperCase()} SIDE</strong>
        <span style={{ color: sideStateColor(profile.state) }}>{profile.state.replaceAll("_", " ")}</span>
      </div>
      <div style={styles.sideProfileMetrics}>
        <DockMetric label="Short / Wing" value={`${profile.shortStrike?.toFixed(0) ?? "—"} / ${profile.wingStrike?.toFixed(0) ?? "—"}`} />
        <DockMetric label="Width" value={profile.widthPoints == null ? "—" : `${profile.widthPoints.toFixed(0)} pt`} />
        <DockMetric label="Short ×" value={multiple(profile.shortPremiumMultiple)} />
        <DockMetric label="Short Dist" value={profile.shortDistancePoints == null ? "—" : signedPoints(profile.shortDistancePoints)} />
        <DockMetric label="Close Value" value={money(profile.closeValuePoints)} />
        <DockMetric label="Net Δ" value={signedGreek(profile.netDelta)} />
        <DockMetric label="Net Γ" value={signedGreek(profile.netGamma, 4)} />
        <DockMetric label="Net Θ" value={signedGreek(profile.netTheta)} />
        <DockMetric label="Net Vega" value={signedGreek(profile.netVega)} />
      </div>
    </div>
  );
}

function MiniGreek({ label, value }: { label: string; value: number }) {
  return <span><small>{label}</small><strong>{signedGreek(value, label === "Net Γ" ? 4 : 2)}</strong></span>;
}

function buildManagedRows(
  positions: ExecutionPositionMemory[],
  positionReads: Record<string, ZeroDteExecutionRead>,
): ManagedLegRow[] {
  return positions.flatMap((position) => {
    const read = positionReads[position.id];
    return (read?.legProfiles ?? []).map((row) => ({
      ...row,
      positionId: position.id,
      positionLabel: position.label,
      strategy: position.strategy,
    }));
  });
}

function aggregateSideProfiles(
  positions: ExecutionPositionMemory[],
  positionReads: Record<string, ZeroDteExecutionRead>,
): ExecutionSideProfileRead[] {
  return (["put", "call"] as const).flatMap((side) => {
    const profiles = positions.flatMap((position) =>
      (positionReads[position.id]?.sideProfiles ?? []).filter((profile) => profile.side === side),
    );
    if (!profiles.length) return [];
    const shortProfiles = profiles.filter((profile) => profile.shortCount > 0);
    const worst = shortProfiles
      .slice()
      .sort((a, b) => (b.shortPremiumMultiple ?? -1) - (a.shortPremiumMultiple ?? -1))[0] ?? null;
    const state = profiles
      .map((profile) => profile.state)
      .sort((a, b) => sideStateRank(b) - sideStateRank(a))[0] ?? "HEALTHY";
    const finiteClose = profiles.every((profile) => profile.closeValuePoints !== null);
    const representative = worst ?? profiles[0];
    return [{
      side,
      legCount: profiles.reduce((sum, profile) => sum + profile.legCount, 0),
      shortCount: profiles.reduce((sum, profile) => sum + profile.shortCount, 0),
      longCount: profiles.reduce((sum, profile) => sum + profile.longCount, 0),
      shortStrike: representative.shortStrike,
      wingStrike: representative.wingStrike,
      widthPoints: representative.widthPoints,
      shortPremiumMultiple: worst?.shortPremiumMultiple ?? null,
      shortDistancePoints: worst?.shortDistancePoints ?? null,
      closeValuePoints: finiteClose ? profiles.reduce((sum, profile) => sum + Number(profile.closeValuePoints), 0) : null,
      netDelta: profiles.reduce((sum, profile) => sum + profile.netDelta, 0),
      netGamma: profiles.reduce((sum, profile) => sum + profile.netGamma, 0),
      netTheta: profiles.reduce((sum, profile) => sum + profile.netTheta, 0),
      netVega: profiles.reduce((sum, profile) => sum + profile.netVega, 0),
      state,
    }];
  });
}

function sideStateRank(state: ExecutionSideProfileRead["state"]) {
  if (state === "RELEASE") return 5;
  if (state === "PRESSURED") return 4;
  if (state === "WATCH") return 3;
  if (state === "LONG_RUNNER") return 2;
  return 1;
}

function sideStateColor(state: ExecutionSideProfileRead["state"]) {
  if (state === "RELEASE") return "rgba(251,113,133,.78)";
  if (state === "PRESSURED") return "rgba(251,146,60,.72)";
  if (state === "WATCH") return "rgba(245,197,66,.68)";
  if (state === "LONG_RUNNER") return "rgba(96,165,250,.66)";
  return "rgba(113,224,180,.52)";
}

function rolePillStyle(role: ExecutionLegProfileRead["role"]): React.CSSProperties {
  const threatened = role === "PUT_SHORT" || role === "CALL_SHORT" || role === "SHORT";
  return {
    display: "inline-block",
    padding: "2px 6px",
    borderRadius: 999,
    border: `1px solid ${threatened ? "rgba(245,197,66,.42)" : "rgba(96,165,250,.30)"}`,
    color: threatened ? "#f5c542" : "#9ecbff",
    whiteSpace: "nowrap",
  };
}

function shortMultipleStyle(value: number | null): React.CSSProperties {
  if (value == null) return {};
  if (value >= 3) return { color: "#fb7185", fontWeight: 800 };
  if (value >= 2) return { color: "#fb923c", fontWeight: 800 };
  if (value >= 1.5) return { color: "#f5c542", fontWeight: 700 };
  return { color: "#71e0b4" };
}

function shortPositionLabel(label: string) {
  return label.length <= 22 ? label : `${label.slice(0, 19)}…`;
}

function multiple(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}×`;
}

function formatIv(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = Math.abs(value) <= 3 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

function greek(value: number | null | undefined, digits = 3) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function signedGreek(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function signedPoints(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function PortfolioPositionCard({
  position,
  read,
  adaptiveDecision,
  busy,
  onClose,
  onConfirmAdaptive,
}: {
  position: ExecutionPositionMemory;
  read: ZeroDteExecutionRead | null;
  adaptiveDecision: AdaptiveManagementDecision | null;
  busy: boolean;
  onClose: (positionId: string, exitDebit: number) => void | Promise<void>;
  onConfirmAdaptive?: (positionId: string, actualPrice: number) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [exitDebit, setExitDebit] = useState("");
  const [adaptiveFill, setAdaptiveFill] = useState("");

  useEffect(() => {
    setExitDebit("");
    setAdaptiveFill("");
  }, [position.id, adaptiveDecision?.structureTransition?.type, adaptiveDecision?.structureTransition?.strike]);

  const parsedExitDebit = parseNonNegative(exitDebit);
  const parsedAdaptiveFill = parseNonNegative(adaptiveFill);
  const activeLegs = position.adaptiveActiveLegs?.length ? position.adaptiveActiveLegs : position.legs;
  const closeLegs = activeLegs.map(invertLeg);
  const longRunnerOnly = activeLegs.length > 0 && activeLegs.every((leg) => leg.action === "buy");
  const liveRunnerExitCredit =
    longRunnerOnly && adaptiveDecision?.markedPnlDollars != null
      ? Math.max(
          0,
          adaptiveDecision.markedPnlDollars / (100 * Math.max(1, position.quantity)) -
            (position.adaptiveNetCashPoints ?? position.entryCredit),
        )
      : null;
  const liveCloseValue = longRunnerOnly
    ? liveRunnerExitCredit
    : read?.currentBuybackDebit ?? read?.currentCredit ?? null;
  const transition = adaptiveDecision?.structureTransition ?? position.adaptiveLastRecommendedTransition ?? null;
  // Confirm only after the recommendation has been persisted into the actual
  // position ledger; this prevents a race between a live recommendation and
  // the broker-fill confirmation request.
  const actionable = Boolean(position.adaptiveLastRecommendedTransition && transition && onConfirmAdaptive);

  return (
    <div
      style={{
        ...styles.positionCard,
        borderColor: read?.emergencyExit
          ? "rgba(251,113,133,.72)"
          : read?.lifecycle === "BUYBACK_READY"
            ? "rgba(251,113,133,.5)"
            : "#1d3b53",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        style={styles.positionHeaderButton}
      >
        <span>
          <strong>{position.label}</strong>
          <small>{formatLegs(position.legs)} · {position.quantity}×</small>
        </span>
        <em>{read?.lifecycle.replaceAll("_", " ") ?? "TRACKING"}</em>
      </button>

      <div style={styles.positionQuickGrid}>
        <DockMetric label="Entry" value={money(position.entryCredit)} />
        <DockMetric label="Buyback" value={money(read?.currentBuybackDebit ?? read?.currentCredit)} />
        <DockMetric label="Captured" value={percent(read?.capturedPremiumPct)} />
        <DockMetric label="P/L" value={dollars(adaptiveDecision?.markedPnlDollars ?? read?.livePnlDollars)} />
        <DockMetric label="Adaptive" value={adaptiveDecision?.action ?? position.adaptiveAction ?? "WARMING"} />
        <DockMetric label="Structure" value={position.adaptiveStructureState ?? (position.strategy === "iron-fly" ? "IF_CENTER" : "CREDIT_SPREAD")} />
        <DockMetric label="Short" value={read?.worstShortLegMultiple == null ? "—" : `${read.worstShortLegMultiple.toFixed(2)}×`} />
        <DockMetric label="MAE" value={dollars(adaptiveDecision?.maxAdverseExcursionDollars ?? position.adaptiveMaxAdverseExcursionDollars ?? 0)} />
      </div>

      {adaptiveDecision ? (
        <div style={adaptiveDecision.action === "RELEASE_SHORT" || adaptiveDecision.action === "REINSTATE_SHORT" || adaptiveDecision.action === "CLOSE_RUNNER" ? styles.adaptiveAlert : styles.adaptiveStatus}>
          <strong>{`ADAPTIVE ${adaptiveDecision.state} · ${adaptiveDecision.action}`}</strong>
          <span>{adaptiveDecision.reasons[0] ?? "Live adaptive position manager is evaluating this actual position."}</span>
          {transition ? (
            <span>
              {transition.detail} · model {money(transition.executionPrice)}
            </span>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div style={styles.expandedPosition}>
          <LegList legs={activeLegs} title={position.adaptiveStructureState && position.adaptiveStructureState !== "CREDIT_SPREAD" ? "Current adaptive legs" : "Open legs"} />
          {position.adaptiveStructureState && position.adaptiveStructureState !== "CREDIT_SPREAD" && position.adaptiveStructureState !== "IF_CENTER" ? (
            <div style={styles.ledgerStrip}>Original {formatLegs(position.legs)} · net cash {money(position.adaptiveNetCashPoints ?? position.entryCredit)}</div>
          ) : null}

          {actionable && transition ? (
            <div style={styles.adaptiveConfirmBox}>
              <div style={styles.smallCaps}>Adaptive Leg Action</div>
              <strong>{adaptiveActionLabel(transition.type, transition.strike)}</strong>
              <span>{transition.detail}</span>
              <label style={styles.fieldLabel}>
                Actual broker fill
                <input
                  value={adaptiveFill}
                  onChange={(event) => setAdaptiveFill(event.target.value)}
                  type="number"
                  min="0"
                  step="0.05"
                  placeholder={transition.executionPrice.toFixed(2)}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => setAdaptiveFill(transition.executionPrice.toFixed(2))}
                  style={styles.useLiveButton}
                >
                  Use Model {money(transition.executionPrice)}
                </button>
              </label>
              <button
                type="button"
                disabled={busy || parsedAdaptiveFill == null}
                onClick={() => {
                  if (parsedAdaptiveFill == null || !onConfirmAdaptive) return;
                  void onConfirmAdaptive(position.id, parsedAdaptiveFill);
                }}
                style={{ ...styles.adaptiveConfirmButton, opacity: busy || parsedAdaptiveFill == null ? 0.45 : 1 }}
              >
                {busy ? "Saving…" : "Confirm Broker Leg Fill"}
              </button>
            </div>
          ) : null}

          {(position.adaptiveManagementHistory ?? []).length ? (
            <div style={styles.ledgerBox}>
              <div style={styles.smallCaps}>Position Management Ledger</div>
              {[...(position.adaptiveManagementHistory ?? [])].slice(-8).reverse().map((item, index) => (
                <div key={`${item.at}-${item.action}-${index}`} style={styles.ledgerRow}>
                  <strong>{item.kind} · {item.action}</strong>
                  <span>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
          ) : null}

          <div style={styles.closePreview}>
            <div style={styles.smallCaps}>Closing Order</div>
            {closeLegs.map((leg, index) => (
              <div
                key={`${leg.action}-${leg.optionType}-${leg.strike}-${index}`}
                style={styles.closeLeg}
              >
                <strong>{leg.action.toUpperCase()}</strong>
                <span>
                  {position.quantity} × {leg.strike.toFixed(0)} {leg.optionType.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          <label style={styles.fieldLabel}>
            {longRunnerOnly ? "Actual closing credit" : "Actual closing debit"}
            <input
              value={exitDebit}
              onChange={(event) => setExitDebit(event.target.value)}
              type="number"
              min="0"
              step="0.05"
              placeholder={longRunnerOnly ? "enter actual long sale credit" : "enter actual buyback"}
              style={styles.input}
            />
            <button
              type="button"
              disabled={liveCloseValue == null}
              onClick={() => {
                if (liveCloseValue == null) return;
                setExitDebit(liveCloseValue.toFixed(2));
              }}
              style={{
                ...styles.useLiveButton,
                opacity: liveCloseValue == null ? 0.45 : 1,
              }}
            >
              {longRunnerOnly ? "Use Long Bid" : "Use Buyback"} {money(liveCloseValue)}
            </button>
          </label>
          <button
            type="button"
            disabled={busy || parsedExitDebit == null}
            onClick={() => {
              if (parsedExitDebit == null) return;
              void onClose(position.id, parsedExitDebit);
            }}
            style={{
              ...styles.closeButton,
              opacity: busy || parsedExitDebit == null ? 0.45 : 1,
            }}
          >
            {busy ? "Saving…" : longRunnerOnly ? "Sell Long Runner / Close Position" : "Buy Back / Close This Position"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LegList({ legs, title }: { legs: ExecutionLeg[]; title: string }) {
  return (
    <div style={styles.legList}>
      <div style={styles.smallCaps}>{title}</div>
      {legs.map((leg, index) => (
        <div
          key={`${leg.action}-${leg.optionType}-${leg.strike}-${index}`}
          style={styles.legRow}
        >
          <strong>{leg.action.toUpperCase()}</strong>
          <span>
            {leg.strike.toFixed(0)} {leg.optionType.toUpperCase()}
          </span>
        </div>
      ))}
    </div>
  );
}

function adaptiveActionLabel(
  type: "RELEASE_SHORT" | "REINSTATE_SHORT" | "CLOSE_RUNNER",
  strike: number | null,
) {
  const strikeText = strike == null ? "" : ` ${strike.toFixed(0)}`;
  if (type === "RELEASE_SHORT") return `BUY TO CLOSE SHORT${strikeText}`;
  if (type === "REINSTATE_SHORT") return `SELL TO OPEN REPAIR SHORT${strikeText}`;
  return `SELL TO CLOSE LONG RUNNER${strikeText}`;
}

function DockMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function defaultDraftLegs(strategy: ExecutionStrategy): DraftLeg[] {
  if (strategy === "put-credit-spread") {
    return [
      { action: "sell", optionType: "put", strike: "" },
      { action: "buy", optionType: "put", strike: "" },
    ];
  }
  if (strategy === "call-credit-spread") {
    return [
      { action: "sell", optionType: "call", strike: "" },
      { action: "buy", optionType: "call", strike: "" },
    ];
  }
  return [
    { action: "buy", optionType: "put", strike: "" },
    { action: "sell", optionType: "put", strike: "" },
    { action: "sell", optionType: "call", strike: "" },
    { action: "buy", optionType: "call", strike: "" },
  ];
}

function validateLegs(strategy: ExecutionStrategy, legs: ExecutionLeg[]) {
  if (legs.some((leg) => !Number.isFinite(leg.strike) || leg.strike <= 0)) {
    return "Every leg requires a valid strike.";
  }

  if (strategy === "put-credit-spread") {
    const short = legs.find(
      (leg) => leg.action === "sell" && leg.optionType === "put",
    );
    const long = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "put",
    );
    if (!short || !long) return "Put spread requires one short put and one long put.";
    if (short.strike <= long.strike) {
      return "Put credit spread short strike must be above the long strike.";
    }
  }

  if (strategy === "call-credit-spread") {
    const short = legs.find(
      (leg) => leg.action === "sell" && leg.optionType === "call",
    );
    const long = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "call",
    );
    if (!short || !long) return "Call spread requires one short call and one long call.";
    if (short.strike >= long.strike) {
      return "Call credit spread short strike must be below the long strike.";
    }
  }

  if (strategy === "iron-fly") {
    const longPut = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "put",
    );
    const shortPut = legs.find(
      (leg) => leg.action === "sell" && leg.optionType === "put",
    );
    const shortCall = legs.find(
      (leg) => leg.action === "sell" && leg.optionType === "call",
    );
    const longCall = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "call",
    );
    if (!longPut || !shortPut || !shortCall || !longCall) {
      return "Iron Fly requires four complete put/call legs.";
    }
    if (shortPut.strike !== shortCall.strike) {
      return "Iron Fly short put and short call must share the center strike.";
    }
    if (
      !(longPut.strike < shortPut.strike && shortCall.strike < longCall.strike)
    ) {
      return "Iron Fly wings must remain outside the short center.";
    }
  }

  return null;
}

function calculateMaxRisk(
  strategy: ExecutionStrategy,
  legs: ExecutionLeg[],
  credit: number | null,
) {
  if (credit == null) return null;
  if (strategy === "iron-fly") {
    const short = legs.find((leg) => leg.action === "sell")?.strike;
    const longPut = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "put",
    )?.strike;
    const longCall = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "call",
    )?.strike;
    if (short == null || longPut == null || longCall == null) return null;
    const width = Math.max(short - longPut, longCall - short);
    return Math.max(0, width - credit) * 100;
  }

  const short = legs.find((leg) => leg.action === "sell")?.strike;
  const long = legs.find((leg) => leg.action === "buy")?.strike;
  if (short == null || long == null) return null;
  return Math.max(0, Math.abs(short - long) - credit) * 100;
}

function invertLeg(leg: ExecutionLeg): ExecutionLeg {
  return { ...leg, action: leg.action === "sell" ? "buy" : "sell" };
}

function strategyName(strategy: ExecutionStrategy) {
  if (strategy === "put-credit-spread") return "Put Credit Spread";
  if (strategy === "call-credit-spread") return "Call Credit Spread";
  return "Iron Fly";
}

function formatLegs(legs: ExecutionLeg[]) {
  if (!legs.length) return "—";
  return legs
    .map((leg) => `${leg.action === "sell" ? "S" : "B"}${leg.strike.toFixed(0)}${leg.optionType[0].toUpperCase()}`)
    .join(" · ");
}

function parseNonNegative(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function dollars(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : ""}$${absolute}`;
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

const styles: Record<string, React.CSSProperties> = {
  workbench: {
    display: "grid",
    gap: 10,
    padding: "10px 0 2px",
  },
  workbenchHeader: {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: 12,
    color: "#d7e8f6",
    fontSize: 12,
  },
  structureTableCard: {
    border: "1px solid #1d3b53",
    borderRadius: 12,
    background: "rgba(5,19,29,.68)",
    overflow: "hidden",
  },
  structureTableHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderBottom: "1px solid rgba(40,77,103,.68)",
  },
  greekStrip: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  legTableScroll: {
    overflowX: "auto",
    width: "100%",
  },
  legTable: {
    width: "100%",
    minWidth: 1260,
    borderCollapse: "collapse",
    fontSize: 10,
    color: "#cfe0ed",
  },
  tableFootnote: {
    padding: "5px 10px 7px",
    color: "#6f94ad",
    fontSize: 9,
  },
  sideProfileGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 8,
    padding: "0 10px 10px",
  },
  sideProfileCard: {
    border: "1px solid rgba(113,224,180,.4)",
    borderRadius: 10,
    background: "rgba(7,24,35,.8)",
    padding: 8,
  },
  sideProfileHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    fontSize: 10,
    marginBottom: 7,
  },
  sideProfileMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(82px, 1fr))",
    gap: 6,
  },
  workbenchActionAlert: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderBottom: "1px solid rgba(251,113,133,.34)",
    background: "rgba(72,18,30,.34)",
    color: "#ffd4dc",
    fontSize: 10,
  },
  structureEmpty: {
    padding: "14px 12px",
    color: "#6f94ad",
    fontSize: 10,
  },
  tableCell: {
    padding: "6px 7px",
    borderBottom: "1px solid rgba(34,61,80,.52)",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  tableHeaderCell: {
    position: "sticky",
    top: 0,
    background: "#071722",
    color: "#7ea7c2",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".04em",
  },
  adaptiveStatus: {
    display: "grid",
    gap: 4,
    padding: "8px 10px",
    border: "1px solid rgba(113,224,180,.24)",
    borderRadius: 10,
    background: "rgba(10,30,42,.72)",
    fontSize: 11,
  },
  adaptiveAlert: {
    display: "grid",
    gap: 4,
    padding: "8px 10px",
    border: "1px solid rgba(245,197,66,.58)",
    borderRadius: 10,
    background: "rgba(58,42,8,.48)",
    fontSize: 11,
  },
  adaptiveConfirmBox: {
    display: "grid",
    gap: 8,
    padding: 10,
    border: "1px solid rgba(245,197,66,.46)",
    borderRadius: 10,
    background: "rgba(35,28,8,.52)",
  },
  adaptiveConfirmButton: {
    border: "1px solid rgba(245,197,66,.65)",
    borderRadius: 9,
    background: "rgba(245,197,66,.14)",
    color: "#f7d86f",
    padding: "9px 10px",
    fontWeight: 800,
    cursor: "pointer",
  },
  ledgerStrip: {
    fontSize: 11,
    color: "#8eb3ca",
    padding: "6px 8px",
    borderRadius: 8,
    background: "rgba(8,25,36,.8)",
  },
  ledgerBox: {
    display: "grid",
    gap: 6,
    padding: 9,
    border: "1px solid #17364d",
    borderRadius: 9,
    background: "rgba(5,17,25,.72)",
  },
  ledgerRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "2px 8px",
    fontSize: 10,
    color: "#a9c4d8",
  },
  card: {
    flex: "0 0 auto",
    minWidth: 0,
    minHeight: "max-content",
    maxWidth: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
    overflowY: "visible",
    background: "#0a141d",
    border: "1px solid #1d3b53",
    borderRadius: 13,
    padding: 13,
    display: "grid",
    gap: 11,
  },
  headerTitleBlock: { minWidth: 0 },
  headerActions: {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  collapseButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: "1px solid #31506a",
    background: "#07131d",
    color: "#7dd3fc",
    fontSize: 17,
    fontWeight: 900,
    lineHeight: "20px",
    cursor: "pointer",
    padding: 0,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "flex-start",
  },
  eyebrow: {
    color: "#55d6ff",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: { marginTop: 3, fontSize: 14, fontWeight: 900 },
  smallCaps: {
    color: "#708399",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  enginePill: {
    border: "1px solid",
    borderRadius: 999,
    padding: "4px 7px",
    fontSize: 8,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  readOnlyBanner: {
    display: "grid",
    gap: 4,
    border: "1px solid rgba(192,132,252,.38)",
    borderRadius: 8,
    padding: 8,
    background: "rgba(76,29,149,.12)",
    color: "#c4b5fd",
    fontSize: 9,
    lineHeight: 1.45,
  },
  portfolioSummary: {
    display: "grid",
    gap: 7,
    padding: 8,
    border: "1px solid #21445d",
    borderRadius: 9,
    background: "#08111a",
  },
  storyRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
    color: "#8ea3b6",
    fontSize: 9,
  },
  positionStack: { display: "grid", gap: 7 },
  positionCard: {
    display: "grid",
    gap: 7,
    border: "1px solid #1d3b53",
    borderRadius: 9,
    padding: 8,
    background: "#08111a",
  },
  positionHeaderButton: {
    border: 0,
    padding: 0,
    background: "transparent",
    color: "#eaf2f8",
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    textAlign: "left",
    cursor: "pointer",
  },
  positionQuickGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 5,
  },
  expandedPosition: { display: "grid", gap: 8 },
  addButton: {
    border: "1px solid #2d709e",
    borderRadius: 8,
    background: "#10283a",
    color: "#dff4ff",
    padding: 8,
    fontSize: 9,
    fontWeight: 850,
    cursor: "pointer",
  },
  regimeBar: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: 7,
    alignItems: "center",
    border: "1px solid #213b50",
    borderRadius: 8,
    padding: 7,
    color: "#8ea3b6",
    fontSize: 8,
  },
  strategyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 5,
  },
  strategyButton: {
    display: "grid",
    gap: 3,
    border: "1px solid #223b4e",
    borderRadius: 8,
    background: "#08111a",
    color: "#8295aa",
    padding: "7px 5px",
    fontSize: 8,
    cursor: "pointer",
  },
  strategyButtonActive: {
    background: "#12324a",
    color: "#eaf7ff",
    borderColor: "#2d709e",
  },
  trackingStrip: { minWidth: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5 },
  trackingSetup: { minWidth: 0, gridColumn: "1 / -1", display: "grid", gap: 2, paddingBottom: 3 },
  trackingCell: { minWidth: 0, display: "grid", gap: 2 },
  trackingValue: { minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.25 },
  modeRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 },
  modeButton: {
    border: "1px solid #26394b",
    borderRadius: 8,
    background: "#08111a",
    color: "#8295aa",
    padding: "7px",
    fontSize: 9,
    cursor: "pointer",
  },
  modeButtonActive: {
    color: "#eaf7ff",
    borderColor: "#2d709e",
    background: "#10283a",
  },
  legEditor: { display: "grid", gap: 6 },
  legField: {
    display: "grid",
    gridTemplateColumns: "1fr 86px",
    alignItems: "center",
    gap: 8,
    color: "#9aabbb",
    fontSize: 9,
    fontWeight: 850,
  },
  legInput: {
    width: "100%",
    boxSizing: "border-box",
    background: "#071018",
    color: "#eef5fb",
    border: "1px solid #26394b",
    borderRadius: 7,
    padding: "7px 8px",
    textAlign: "right",
  },
  twoColumn: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 },
  fieldLabel: {
    display: "grid",
    gap: 5,
    color: "#8194a7",
    fontSize: 9,
    fontWeight: 800,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#071018",
    color: "#eef5fb",
    border: "1px solid #26394b",
    borderRadius: 8,
    padding: "8px",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 6,
  },
  metric: {
    display: "grid",
    gap: 3,
    background: "#071018",
    border: "1px solid #172a3b",
    borderRadius: 8,
    padding: 7,
    color: "#708399",
    fontSize: 8,
  },
  useLiveButton: {
    marginTop: 6,
    border: "1px solid #2d5873",
    borderRadius: 7,
    background: "#0b1a25",
    color: "#8ddcf5",
    padding: "5px 7px",
    fontSize: 8,
    fontWeight: 800,
    cursor: "pointer",
  },
  openButton: {
    border: 0,
    borderRadius: 9,
    background: "linear-gradient(135deg,#167b55,#16c784)",
    color: "#04120c",
    padding: "10px 9px",
    fontWeight: 950,
    cursor: "pointer",
  },
  closeButton: {
    border: 0,
    borderRadius: 9,
    background: "linear-gradient(135deg,#a92836,#ea3943)",
    color: "white",
    padding: "10px 9px",
    fontWeight: 950,
    cursor: "pointer",
  },
  warning: {
    color: "#f5d77d",
    background: "rgba(245,197,66,.08)",
    border: "1px solid rgba(245,197,66,.26)",
    borderRadius: 8,
    padding: 8,
    fontSize: 9,
    lineHeight: 1.4,
  },
  error: {
    color: "#ff9aa1",
    background: "rgba(234,57,67,.08)",
    border: "1px solid rgba(234,57,67,.28)",
    borderRadius: 8,
    padding: 8,
    fontSize: 9,
  },
  empty: { color: "#708399", fontSize: 10, lineHeight: 1.4 },
  legList: {
    display: "grid",
    gap: 5,
    background: "#071018",
    border: "1px solid #172a3b",
    borderRadius: 8,
    padding: 8,
  },
  legRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#b8c6d3",
    fontSize: 10,
  },
  overrideBox: {
    display: "grid",
    gap: 8,
    marginTop: 10,
    padding: 10,
    border: "1px solid rgba(245,197,66,.28)",
    borderRadius: 9,
    background: "rgba(245,197,66,.06)",
  },
  overrideCheck: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#f3d77c",
    fontSize: 11,
    fontWeight: 800,
  },
  closePreview: {
    display: "grid",
    gap: 5,
    background: "rgba(234,57,67,.06)",
    border: "1px solid rgba(234,57,67,.2)",
    borderRadius: 8,
    padding: 8,
  },
  closeLeg: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#d8e1e9",
    fontSize: 9,
  },
};
