import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { supabaseServer } from "../../../../lib/supabase-server";
import type {
  ExecutionClosedTrade,
  ExecutionLeg,
  ExecutionPositionMemory,
  ExecutionPremiumSample,
  ExecutionShortLegEntry,
  ExecutionStrategy,
  ZeroDteExecutionMemory,
} from "../../../../lib/zeroDteExecutionIntelligence";
import type { ZeroDteTimeRegime } from "../../../../lib/zeroDteTimeRegime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function executionErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      code: null as string | null,
      details: null as string | null,
      hint: null as string | null,
    };
  }

  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const code = typeof value.code === "string" ? value.code : null;
    const message =
      typeof value.message === "string" && value.message.trim()
        ? value.message
        : "Execution database operation failed";
    const details =
      typeof value.details === "string" && value.details.trim()
        ? value.details
        : null;
    const hint =
      typeof value.hint === "string" && value.hint.trim()
        ? value.hint
        : null;

    return {
      message,
      name: null as string | null,
      code,
      details,
      hint,
    };
  }

  return {
    message: String(error),
    name: null as string | null,
    code: null as string | null,
    details: null as string | null,
    hint: null as string | null,
  };
}

function executionErrorMessage(error: unknown) {
  const details = executionErrorDetails(error);
  return [
    details.code ? `[${details.code}]` : "",
    details.message,
    details.details,
    details.hint ? `Hint: ${details.hint}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const err = (error: unknown, status = 500) => {
  const details = executionErrorDetails(error);
  return NextResponse.json(
    {
      ok: false,
      error: executionErrorMessage(error),
      errorDetails: details,
    },
    { status },
  );
};

const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value != null && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const textArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizeStrategy = (value: unknown): ExecutionStrategy => {
  if (value === "put-credit-spread" || value === "put_credit_spread") {
    return "put-credit-spread";
  }
  if (value === "call-credit-spread" || value === "call_credit_spread") {
    return "call-credit-spread";
  }
  return "iron-fly";
};

const normalizePhase = (value: unknown): "OPENING" | "TRANSITION" | "ACTIVE" =>
  value === "TRANSITION" || value === "ACTIVE" ? value : "OPENING";

const normalizeRail = (value: unknown): "UPPER" | "LOWER" | "NONE" =>
  value === "UPPER" || value === "LOWER" ? value : "NONE";

const normalizeSide = (value: unknown): "upper" | "lower" | "center" =>
  value === "upper" || value === "lower" ? value : "center";

const normalizeTimeRegime = (value: unknown): ZeroDteTimeRegime => {
  if (
    value === "PREMARKET" ||
    value === "OPENING_OPPORTUNITY" ||
    value === "SELECTIVE_CONTINUATION" ||
    value === "EXHAUSTION" ||
    value === "FINAL_ENTRY" ||
    value === "CLOSED"
  ) {
    return value;
  }
  return "OPENING_OPPORTUNITY";
};

const normalizeLegs = (value: unknown): ExecutionLeg[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const leg = item as Partial<ExecutionLeg>;
    const strike = numeric(leg.strike);
    if (
      strike === null ||
      (leg.optionType !== "call" && leg.optionType !== "put") ||
      (leg.action !== "sell" && leg.action !== "buy")
    ) {
      return [];
    }
    return [{ optionType: leg.optionType, action: leg.action, strike }];
  });
};

const normalizeShortLegEntries = (value: unknown): ExecutionShortLegEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const strike = numeric(entry.strike);
    const sellPrice = numeric(entry.sellPrice);
    const optionType = entry.optionType;
    if (
      strike === null ||
      (optionType !== "call" && optionType !== "put")
    ) {
      return [];
    }
    const source =
      entry.source === "actual" || entry.source === "live-bid"
        ? entry.source
        : "unknown";
    return [{
      optionType,
      strike,
      sellPrice: sellPrice !== null && sellPrice > 0 ? sellPrice : null,
      source,
    }];
  });
};

function legacyLegs(strategy: ExecutionStrategy, day: any): ExecutionLeg[] {
  if (strategy === "put-credit-spread") {
    const shortStrike = numeric(day.locked_put_short);
    const longStrike = numeric(day.locked_put_long);
    return shortStrike !== null && longStrike !== null
      ? [
          { optionType: "put", action: "sell", strike: shortStrike },
          { optionType: "put", action: "buy", strike: longStrike },
        ]
      : [];
  }
  if (strategy === "call-credit-spread") {
    const shortStrike = numeric(day.locked_call_short);
    const longStrike = numeric(day.locked_call_long);
    return shortStrike !== null && longStrike !== null
      ? [
          { optionType: "call", action: "sell", strike: shortStrike },
          { optionType: "call", action: "buy", strike: longStrike },
        ]
      : [];
  }

  const center = numeric(day.opening_if_center);
  const lowerWing = numeric(day.lower_wing);
  const upperWing = numeric(day.upper_wing);
  return center !== null && lowerWing !== null && upperWing !== null
    ? [
        { optionType: "put", action: "buy", strike: lowerWing },
        { optionType: "put", action: "sell", strike: center },
        { optionType: "call", action: "sell", strike: center },
        { optionType: "call", action: "buy", strike: upperWing },
      ]
    : [];
}

function makeSetupKey(strategy: ExecutionStrategy, legs: ExecutionLeg[]) {
  return `${strategy}:${legs
    .map((leg) => `${leg.action[0]}${leg.optionType[0]}${leg.strike.toFixed(2)}`)
    .join("-")}`;
}

async function loadScoreHistory(tradeDayId: string) {
  const pageSize = 1000;
  const maxRows = 20_000;
  const rows: any[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabaseServer
      .from("zero_dte_execution_score_history")
      .select(
        "sampled_at,spx_price,strategy,setup_key,strategy_credit,if_credit,sellable_credit,buyback_debit,entry_score,sell_score,exit_score,buyback_score,map_phase,map_center,rail_breached,lifecycle,time_regime,short_distance_points,short_distance_expected_move_pct,candidate_age_candles,tracked_since,dealer_pressure,strike_flow_state"
      )
      .eq("trade_day_id", tradeDayId)
      .order("sampled_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function loadMemory(tradeDate: string): Promise<ZeroDteExecutionMemory> {
  const { data: day, error: dayError } = await supabaseServer
    .from("zero_dte_execution_trade_days")
    .select("*")
    .eq("trade_date", tradeDate)
    .eq("symbol", "SPX")
    .maybeSingle();

  if (dayError) throw dayError;

  if (!day) {
    return {
      tradeDate,
      tradeDayId: null,
      samples: [],
      positions: [],
      position: null,
      closedTrades: [],
      cooldownUntil: null,
    };
  }

  const [sampleRows, openResult, closedResult] = await Promise.all([
    loadScoreHistory(day.id),
    supabaseServer
      .from("zero_dte_execution_positions")
      .select("*")
      .eq("trade_day_id", day.id)
      .eq("state", "open")
      .order("entry_time", { ascending: true })
      .limit(20),
    supabaseServer
      .from("zero_dte_execution_positions")
      .select("*")
      .eq("trade_day_id", day.id)
      .eq("state", "closed")
      .order("exit_time", { ascending: false })
      .limit(100),
  ]);

  if (openResult.error) throw openResult.error;
  if (closedResult.error) throw closedResult.error;

  const mapPosition = (row: any): ExecutionPositionMemory => {
    const strategy = normalizeStrategy(row.strategy);
    const legs = normalizeLegs(row.legs);
    const finalLegs = legs.length ? legs : legacyLegs(strategy, day);
    return {
      id: row.id,
      strategy,
      label: row.strategy_label ?? strategy.replaceAll("-", " "),
      setupKey: row.setup_key ?? makeSetupKey(strategy, finalLegs),
      legs: finalLegs,
      openedAt: row.entry_time,
      entryCredit: Number(row.entry_credit),
      quantity: Number(row.contracts),
      maxRiskDollars: numeric(row.max_risk_dollars),
      entryScore: Number(row.entry_score ?? row.entry_sell_score ?? 0),
      entryMapPhase: normalizePhase(row.entry_map_phase),
      entryMapCenter: Number(row.entry_map_center ?? day.opening_if_center ?? 0),
      entryRailBreached: normalizeRail(row.entry_rail_breached),
      entryReasons: textArray(row.entry_reasons),
      entryTimeRegime: normalizeTimeRegime(row.entry_time_regime),
      side: normalizeSide(row.setup_side),
      setupSource: row.setup_source === "manual" ? "manual" : "engine",
      engineClearedAtEntry: Boolean(row.engine_cleared_at_entry),
      overrideReason: row.override_reason ?? null,
      signalTime: row.signal_time ?? null,
      signalCredit: numeric(row.signal_credit),
      entryMarkCredit: numeric(row.entry_mark_credit),
      entrySellableCredit: numeric(row.entry_sellable_credit),
      entryShortDeltaAbs: numeric(row.entry_short_delta_abs),
      entryTouchRiskProxyPct: numeric(row.entry_touch_risk_proxy_pct),
      entryRangeConsumptionPct: numeric(row.entry_range_consumption_pct),
      entryEventRisk: row.entry_event_risk === "HIGH" ? "HIGH" : row.entry_event_risk === "NORMAL" ? "NORMAL" : null,
      entryShortLegs: normalizeShortLegEntries(row.entry_short_legs),
    };
  };

  const positions = (openResult.data ?? []).map(mapPosition);
  const position = positions[0] ?? null;

  const closedTrades: ExecutionClosedTrade[] = (closedResult.data ?? []).map(
    (row: any) => ({
      ...mapPosition(row),
      closedAt: row.exit_time,
      exitDebit: Number(row.exit_debit ?? 0),
      exitScore: Number(row.exit_score ?? row.exit_buyback_score ?? 0),
      exitReason: row.exit_reason ?? null,
      emergencyExit: Boolean(row.exit_emergency),
      pnlDollars: Number(row.realized_pnl ?? 0),
      durationMinutes: Number(row.duration_minutes ?? 0),
    }),
  );

  const cooldownUntil =
    positions.length === 0 && closedTrades[0]?.closedAt
      ? new Date(Date.parse(closedTrades[0].closedAt) + 15 * 60_000).toISOString()
      : null;

  const samples: ExecutionPremiumSample[] = sampleRows.map(
    (row: any) => {
      const strategy = normalizeStrategy(row.strategy);
      const fallbackLegs = legacyLegs(strategy, day);
      return {
        timestamp: row.sampled_at,
        spot: Number(row.spx_price),
        strategy,
        setupKey: row.setup_key ?? makeSetupKey(strategy, fallbackLegs),
        credit: Number(row.strategy_credit ?? row.if_credit ?? 0),
        sellableCredit: numeric(row.sellable_credit),
        buybackDebit: numeric(row.buyback_debit),
        entryScore: Number(row.entry_score ?? row.sell_score ?? 0),
        exitScore: Number(row.exit_score ?? row.buyback_score ?? 0),
        mapPhase: normalizePhase(row.map_phase),
        mapCenter: Number(row.map_center ?? day.opening_if_center ?? 0),
        railBreached: normalizeRail(row.rail_breached),
        lifecycle: row.lifecycle ?? "WAIT",
        timeRegime: normalizeTimeRegime(row.time_regime),
        shortDistancePoints: numeric(row.short_distance_points),
        shortDistanceExpectedMovePct: numeric(
          row.short_distance_expected_move_pct,
        ),
        candidateAgeCandles: Number(row.candidate_age_candles ?? 0),
        trackedSince: row.tracked_since ?? null,
        dealerPressure: numeric(row.dealer_pressure),
        strikeFlowState: typeof row.strike_flow_state === "string" ? row.strike_flow_state : null,
      } as ExecutionPremiumSample;
    },
  );

  return {
    tradeDate,
    tradeDayId: day.id,
    samples,
    positions,
    position,
    closedTrades,
    cooldownUntil,
  };
}

async function upsertTradeDay(body: any): Promise<string> {
  const openingMap = body.openingMap;
  const openingPlan = body.openingPlan;
  const recommendation = body.recommendation;
  const firstSample = body.items?.[0]?.sample ?? body.sample ?? null;

  const payload = {
    trade_date: body.tradeDate,
    symbol: "SPX",
    expiration_date: body.expirationDate,
    opening_if_center: openingMap.center,
    opening_if_width: openingMap.wingWidth ?? 50,
    lower_wing: openingMap.lowerWing,
    upper_wing: openingMap.upperWing,
    opening_put_wall: openingMap.putWall,
    opening_call_wall: openingMap.callWall,
    opening_gravity: openingMap.gravity,
    locked_put_short: openingPlan?.put?.shortStrike ?? null,
    locked_put_long: openingPlan?.put?.longStrike ?? null,
    locked_call_short: openingPlan?.call?.shortStrike ?? null,
    locked_call_long: openingPlan?.call?.longStrike ?? null,
    opening_if_credit: firstSample?.credit ?? null,
    opening_dealer_pressure: recommendation.dealerPressure,
    opening_pin_score: recommendation.confidenceScore,
    initialization_source: "engine",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseServer
    .from("zero_dte_execution_trade_days")
    .upsert(payload, {
      onConflict: "trade_date,symbol",
      ignoreDuplicates: false,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function ensureManualTradeDay(body: any): Promise<string> {
  const { data: existing, error: existingError } = await supabaseServer
    .from("zero_dte_execution_trade_days")
    .select("id")
    .eq("trade_date", body.tradeDate)
    .eq("symbol", "SPX")
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const payload = {
    trade_date: body.tradeDate,
    symbol: "SPX",
    expiration_date: body.expirationDate ?? body.tradeDate,
    initialization_source: "manual-shell",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseServer
    .from("zero_dte_execution_trade_days")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  try {
    const tradeDate = request.nextUrl.searchParams.get("tradeDate");
    if (!tradeDate) return err("Missing tradeDate", 400);

    return NextResponse.json({
      ok: true,
      memory: await loadMemory(tradeDate),
    });
  } catch (error) {
    return err(error);
  }
}

export async function POST(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  try {
    const body = await request.json();
    if (!body.tradeDate) return err("Missing tradeDate", 400);

    if (body.action === "sample" || body.action === "sample-batch") {
      // Sampling is the hot path (typically every ~30 seconds per setup). Do
      // not reload the entire day's premium history before every insert. The
      // client already hydrated history once; here we only resolve the day id,
      // persist the new rows, and return the small delta.
      let tradeDayId: string | null = null;
      if (body.openingMap && body.recommendation) {
        tradeDayId = await upsertTradeDay(body);
      } else {
        const { data: day, error: dayError } = await supabaseServer
          .from("zero_dte_execution_trade_days")
          .select("id")
          .eq("trade_date", body.tradeDate)
          .eq("symbol", "SPX")
          .maybeSingle();
        if (dayError) throw dayError;
        tradeDayId = day?.id ?? null;
      }
      if (!tradeDayId) {
        return err(
          "Execution day is not initialized and no valid Opening Map was supplied",
          409,
        );
      }
      const items =
        body.action === "sample-batch"
          ? Array.isArray(body.items)
            ? body.items
            : []
          : [{ read: body.read, sample: body.sample, flowState: body.flowState }];
      if (!items.length) return err("No execution samples supplied", 400);

      const { data: openPositions, error: openError } = await supabaseServer
        .from("zero_dte_execution_positions")
        .select("id,setup_key")
        .eq("trade_day_id", tradeDayId)
        .eq("state", "open");
      if (openError) throw openError;
      const positionBySetup = new Map(
        (openPositions ?? []).map((row: any) => [row.setup_key, row.id]),
      );

      const rows = items.flatMap((item: any) => {
        const sample = item.sample;
        const read = item.read;
        if (!sample?.setupKey || !sample?.timestamp) return [];
        return [
          {
            trade_day_id: tradeDayId,
            position_id: positionBySetup.get(sample.setupKey) ?? null,
            sampled_at: sample.timestamp,
            spx_price: sample.spot,
            if_credit: sample.strategy === "iron-fly" ? sample.credit : null,
            strategy_credit: sample.credit,
            strategy: sample.strategy,
            setup_key: sample.setupKey,
            sell_score: sample.entryScore,
            buyback_score: sample.exitScore,
            entry_score: sample.entryScore,
            exit_score: sample.exitScore,
            spring_probability: read.entryScore,
            opportunity_score: read.confidence,
            dealer_pressure: body.recommendation.dealerPressure,
            strike_flow_state: item.flowState,
            premium_efficiency: read.currentCredit
              ? Math.min(100, (read.currentCredit / 50) * 100)
              : null,
            peak_credit: read.peakCredit,
            credit_velocity: read.premiumVelocityPerMinute,
            edge: read.edge,
            map_phase: sample.mapPhase,
            map_center: sample.mapCenter,
            rail_breached: sample.railBreached,
            lifecycle: sample.lifecycle,
            premium_expansion_pct: read.premiumExpansionPct,
            premium_from_peak_pct: read.premiumFromPeakPct,
            emergency_exit: read.emergencyExit,
            time_regime: sample.timeRegime,
            short_distance_points: sample.shortDistancePoints,
            short_distance_expected_move_pct:
              sample.shortDistanceExpectedMovePct,
            candidate_age_candles: sample.candidateAgeCandles,
            tracked_since: sample.trackedSince,
            portfolio_contribution_score: read.portfolioContributionScore,
            sellable_credit: numeric(read.currentSellableCredit),
            buyback_debit: numeric(read.currentBuybackDebit),
            short_delta_abs: numeric(read.shortDeltaAbs),
            touch_risk_proxy_pct: numeric(read.touchRiskProxyPct),
            range_consumption_pct: numeric(read.volContext?.rangeConsumptionPct),
            minimum_entry_score: numeric(read.minimumEntryScore),
            event_risk: read.eventRisk === "HIGH" ? "HIGH" : "NORMAL",
          },
        ];
      });

      if (!rows.length) return err("No valid execution samples supplied", 400);

      const { error } = await supabaseServer
        .from("zero_dte_execution_score_history")
        .upsert(rows, {
          onConflict: "trade_day_id,setup_key,sampled_at",
        });
      if (error) throw error;

      return NextResponse.json({
        ok: true,
        delta: {
          tradeDate: body.tradeDate,
          tradeDayId,
          samples: rows.map((row: any) => ({
            timestamp: row.sampled_at,
            spot: Number(row.spx_price),
            strategy: normalizeStrategy(row.strategy),
            setupKey: row.setup_key,
            credit: Number(row.strategy_credit ?? row.if_credit ?? 0),
            sellableCredit: numeric(row.sellable_credit),
            buybackDebit: numeric(row.buyback_debit),
            entryScore: Number(row.entry_score ?? row.sell_score ?? 0),
            exitScore: Number(row.exit_score ?? row.buyback_score ?? 0),
            mapPhase: normalizePhase(row.map_phase),
            mapCenter: Number(row.map_center ?? 0),
            railBreached: normalizeRail(row.rail_breached),
            lifecycle: row.lifecycle ?? "WAIT",
            timeRegime: normalizeTimeRegime(row.time_regime),
            shortDistancePoints: numeric(row.short_distance_points),
            shortDistanceExpectedMovePct: numeric(row.short_distance_expected_move_pct),
            candidateAgeCandles: Number(row.candidate_age_candles ?? 0),
            trackedSince: row.tracked_since ?? null,
            dealerPressure: numeric(row.dealer_pressure),
            strikeFlowState:
              typeof row.strike_flow_state === "string" ? row.strike_flow_state : null,
          })),
        },
      });
    }

    let memory = await loadMemory(body.tradeDate);
    if (!memory.tradeDayId && body.action === "manual-open") {
      await ensureManualTradeDay(body);
      memory = await loadMemory(body.tradeDate);
    }
    if (!memory.tradeDayId) {
      return err("Opening trade day has not been persisted yet", 409);
    }

    if (body.action === "open" || body.action === "manual-open") {
      const manualOpen = body.action === "manual-open";
      if (memory.positions.length >= 8) {
        return err("The 0DTE portfolio already has the maximum of eight open positions", 409);
      }
      const candidate = body.candidate;
      if (!candidate) return err(manualOpen ? "Missing manual position legs" : "Missing execution candidate", 400);
      const entryCredit = numeric(body.entryCredit);
      if (entryCredit === null || entryCredit <= 0) {
        return err("Invalid entry credit", 400);
      }
      const legs = normalizeLegs(candidate.legs);
      if (!legs.length) return err("Execution candidate has no valid legs", 400);
      const { error } = await supabaseServer
        .from("zero_dte_execution_positions")
        .insert({
          trade_day_id: memory.tradeDayId,
          strategy: candidate.strategy,
          strategy_label: candidate.label,
          setup_key: candidate.setupKey,
          legs,
          state: "open",
          entry_time: body.entryTime,
          entry_credit: entryCredit,
          contracts: Math.max(1, Math.floor(numeric(body.contracts) ?? 1)),
          setup_side: normalizeSide(body.side),
          max_risk_dollars: numeric(candidate.maxRiskDollars),
          entry_score: numeric(body.read?.entryScore),
          entry_sell_score: numeric(body.read?.entryScore),
          entry_spring_probability: numeric(body.read?.entryScore),
          entry_opportunity_score: numeric(body.read?.confidence),
          entry_map_phase: candidate.mapPhase,
          entry_map_center: numeric(candidate.mapCenter),
          entry_rail_breached: candidate.railBreached,
          entry_reasons: candidate.reasons ?? [],
          entry_time_regime: body.read?.timeRegime?.regime ?? null,
          setup_source: manualOpen || body.setupSource === "manual" ? "manual" : "engine",
          engine_cleared_at_entry: manualOpen ? false : Boolean(body.engineClearedAtEntry),
          override_reason:
            manualOpen
              ? body.overrideReason ?? "Manual actual position"
              : body.engineClearedAtEntry
                ? null
                : body.overrideReason ?? null,
          signal_time: body.signalTime ?? null,
          signal_credit: numeric(body.signalCredit),
          entry_mark_credit: numeric(body.entryMarkCredit),
          entry_sellable_credit: numeric(body.entrySellableCredit),
          entry_short_delta_abs: numeric(body.entryShortDeltaAbs),
          entry_touch_risk_proxy_pct: numeric(body.entryTouchRiskProxyPct),
          entry_range_consumption_pct: numeric(body.entryRangeConsumptionPct),
          entry_event_risk:
            body.entryEventRisk === "HIGH" ? "HIGH" : "NORMAL",
          entry_short_legs: normalizeShortLegEntries(body.entryShortLegs),
        });

      if (error) throw error;

      return NextResponse.json({
        ok: true,
        memory: await loadMemory(body.tradeDate),
      });
    }

    if (body.action === "close") {
      const requestedPosition = body.positionId
        ? memory.positions.find((position) => position.id === body.positionId)
        : memory.positions.length === 1
          ? memory.positions[0]
          : null;
      if (!requestedPosition) {
        return err("A valid open positionId is required", 409);
      }

      const exitDebit = numeric(body.exitDebit);
      if (exitDebit === null || exitDebit < 0) {
        return err("Invalid exit debit", 400);
      }

      const pnl =
        (requestedPosition.entryCredit - exitDebit) *
        100 *
        requestedPosition.quantity;
      const durationMinutes = Math.max(
        0,
        (Date.parse(body.exitTime) - Date.parse(requestedPosition.openedAt)) /
          60_000,
      );

      const { error } = await supabaseServer
        .from("zero_dte_execution_positions")
        .update({
          state: "closed",
          exit_time: body.exitTime,
          exit_debit: exitDebit,
          exit_score: numeric(body.exitScore),
          exit_buyback_score: numeric(body.exitScore),
          exit_reason: body.reason ?? null,
          exit_emergency: Boolean(body.emergencyExit),
          realized_pnl: pnl,
          duration_minutes: durationMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestedPosition.id)
        .eq("state", "open");

      if (error) throw error;

      const { error: exitError } = await supabaseServer
        .from("zero_dte_execution_exits")
        .upsert(
          {
            position_id: requestedPosition.id,
            exit_time: body.exitTime,
            exit_debit: exitDebit,
            realized_pnl: pnl,
            buyback_score: numeric(body.exitScore),
            hold_minutes: durationMinutes,
            reason: body.reason ?? null,
          },
          { onConflict: "position_id" },
        );

      if (exitError) throw exitError;

      return NextResponse.json({
        ok: true,
        memory: await loadMemory(body.tradeDate),
      });
    }

    return err("Unknown action", 400);
  } catch (error) {
    return err(error);
  }
}
