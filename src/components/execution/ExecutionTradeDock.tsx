"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  makeExecutionSetupKey,
  type ExecutionCandidate,
  type ExecutionLeg,
  type ExecutionPositionMemory,
  type ExecutionStrategy,
  type ZeroDteExecutionRead,
} from "../../lib/zeroDteExecutionIntelligence";
import type { StableExecutionCandidateTrack } from "../../lib/execution/useStableExecutionCandidates";
import type { ZeroDtePortfolioRead } from "../../lib/zeroDtePortfolioEngine";
import type { ZeroDteRiskPolicy } from "../../lib/zeroDteRiskPolicy";
import { accountRiskBudgetDollars } from "../../lib/zeroDteRiskPolicy";

type Props = {
  read: ZeroDteExecutionRead | null;
  portfolio: ZeroDtePortfolioRead | null;
  positionReads: Record<string, ZeroDteExecutionRead>;
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
  }) => void | Promise<void>;
  onClose: (positionId: string, exitDebit: number) => void | Promise<void>;
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
  candidates,
  tracks,
  riskPolicy,
  selectedStrategy,
  onStrategyChange,
  evaluateCandidate,
  onOpen,
  onClose,
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
  const positions = portfolio?.positions ?? [];

  useEffect(() => {
    if (!positions.length) setShowEntry(true);
  }, [positions.length]);

  useEffect(() => {
    setOverrideEnabled(false);
    setOverrideReason("");
  }, [candidateKey, setupMode, selectedStrategy]);

  useEffect(() => {
    if (setupMode === "manual") return;
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
  }, [candidateKey, setupMode]);

  const parsedEntryCredit = parseNonNegative(entryCredit);
  const parsedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));

  const ticket = useMemo(() => {
    if (!candidate) return { candidate: null, error: "No tracked setup is available." };
    if (setupMode === "recommended") {
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
        spreadMode: candidate.spreadMode ?? null,
        maxRiskDollars: calculateMaxRisk(selectedStrategy, legs, credit),
        mapPhase: candidate.mapPhase,
        mapCenter: candidate.mapCenter,
        railBreached: candidate.railBreached,
        reasons: [
          "Manual execution legs entered in the WheelDesk Portfolio Dock and independently re-evaluated by the execution engine.",
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
  const projectedGrossRiskDollars =
    (portfolio?.grossRiskDollars ?? 0) + ticketRiskDollars;
  const ticketRiskExceedsBudget = Boolean(
    portfolio &&
      ticketRiskDollars > 0 &&
      projectedGrossRiskDollars > portfolio.riskBudgetDollars,
  );
  const remainingRiskBudget = portfolio
    ? Math.max(0, portfolio.riskBudgetDollars - portfolio.grossRiskDollars)
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
  const canOpen =
    !readOnly &&
    !entryLocked &&
    !busy &&
    ticket.candidate !== null &&
    parsedEntryCredit !== null &&
    parsedEntryCredit > 0 &&
    (engineCleared || overrideValid);

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
        <div style={styles.positionStack}>
          {positions.map((item) => (
            <PortfolioPositionCard
              key={item.position.id}
              position={item.position}
              read={positionReads[item.position.id] ?? null}
              busy={busy}
              onClose={onClose}
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
              onClick={() => setSetupMode("manual")}
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
            <div style={styles.empty}>No executable tracked legs for this strategy.</div>
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
              This quantity would raise gross defined risk to {dollars(projectedGrossRiskDollars)},
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

          {!readOnly && !entryLocked && !engineCleared ? (
            <div style={styles.warning}>
              Engine approval requires SELL READY with no hard blocker. To record
              a broker fill anyway, explicitly enable a manual override below.
            </div>
          ) : null}

          {!readOnly && !entryLocked && !engineCleared ? (
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
                engineClearedAtEntry: engineCleared,
                overrideReason: engineCleared ? null : overrideReason.trim(),
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
          label="Gross Risk"
          value={`${dollars(portfolio.grossRiskDollars)} · ${Math.round(portfolio.riskBudgetUsedPct)}%`}
        />
      </div>
      {portfolio.warnings.length ? (
        <div style={styles.warning}>{portfolio.warnings.join(" ")}</div>
      ) : null}
    </div>
  );
}

function PortfolioPositionCard({
  position,
  read,
  busy,
  onClose,
}: {
  position: ExecutionPositionMemory;
  read: ZeroDteExecutionRead | null;
  busy: boolean;
  onClose: (positionId: string, exitDebit: number) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [exitDebit, setExitDebit] = useState("");

  useEffect(() => {
    setExitDebit("");
  }, [position.id]);

  const parsedExitDebit = parseNonNegative(exitDebit);
  const closeLegs = position.legs.map(invertLeg);

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
        <DockMetric label="P/L" value={dollars(read?.livePnlDollars)} />
      </div>

      {expanded ? (
        <div style={styles.expandedPosition}>
          <LegList legs={position.legs} title="Open legs" />
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
            Actual closing debit
            <input
              value={exitDebit}
              onChange={(event) => setExitDebit(event.target.value)}
              type="number"
              min="0"
              step="0.05"
              placeholder="enter actual buyback"
              style={styles.input}
            />
            <button
              type="button"
              disabled={(read?.currentBuybackDebit ?? read?.currentCredit) == null}
              onClick={() => {
                const live = read?.currentBuybackDebit ?? read?.currentCredit;
                if (live == null) return;
                setExitDebit(live.toFixed(2));
              }}
              style={{
                ...styles.useLiveButton,
                opacity: (read?.currentBuybackDebit ?? read?.currentCredit) == null ? 0.45 : 1,
              }}
            >
              Use Buyback {money(read?.currentBuybackDebit ?? read?.currentCredit)}
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
            {busy ? "Saving…" : "Buy Back / Close This Position"}
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

function DockMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
