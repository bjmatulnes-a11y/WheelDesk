import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const tradeDate = request.nextUrl.searchParams.get("tradeDate");
    if (!tradeDate) return jsonError("tradeDate is required", 400);
    const { data, error } = await supabaseServer
      .from("zero_dte_shadow_trades")
      .select("*")
      .eq("user_id", user.id)
      .eq("trade_date", tradeDate)
      .order("signal_time", { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      trades: (data ?? []).map(mapShadowTrade),
    });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const body = await request.json();
    if (body.action === "open") return openShadow(body, user.id);
    if (body.action === "sample-batch") return sampleShadowBatch(body, user.id);
    if (body.action === "close") return closeShadow(body, user.id);
    return jsonError("Unknown shadow action", 400);
  } catch (error) {
    return jsonError(error, 500);
  }
}

async function openShadow(body: any, userId: string) {
  const entryCredit = numeric(body.entrySellableCredit);
  if (!body.tradeDate || !body.signalId || !body.setupKey || entryCredit === null || entryCredit <= 0) {
    return jsonError("Shadow open requires tradeDate, signalId, setupKey, and positive sellable credit.", 400);
  }

  const portfolioDecision = normalizePortfolioDecision(body.portfolioDecision);
  const accepted = portfolioDecision === "TAKE";
  const strategy = normalizeStrategy(body.strategy);
  const legs = Array.isArray(body.legs) ? body.legs : [];
  const entryLegSnapshots = Array.isArray(body.entryLegSnapshots) ? body.entryLegSnapshots : [];
  const structureState = strategy === "iron-fly" ? "IF_CENTER" : "CREDIT_SPREAD";
  const openHistory = accepted
    ? [{
        at: body.signalTime,
        action: "OPEN",
        strike: shortStrikeFromLegs(legs),
        price: entryCredit,
        detail: "Individual shadow lot admitted by the Adaptive Portfolio Governor.",
        netCashPoints: entryCredit,
      }]
    : [];

  const payload = {
    user_id: userId,
    trade_date: body.tradeDate,
    signal_id: body.signalId,
    strategy,
    setup_key: String(body.setupKey),
    strategy_label: String(body.label ?? body.strategy ?? "Shadow Trade"),
    legs,
    state: accepted ? "open" : "skipped",
    signal_time: body.signalTime,
    signal_candle_time: numeric(body.signalCandleTime),
    entry_score: numeric(body.entryScore) ?? 0,
    minimum_entry_score: numeric(body.minimumEntryScore) ?? 0,
    time_regime: String(body.timeRegime ?? "UNKNOWN"),
    short_delta_abs: numeric(body.shortDeltaAbs),
    short_distance_points: numeric(body.shortDistancePoints),
    entry_mark_credit: numeric(body.entryMarkCredit),
    entry_sellable_credit: entryCredit,
    entry_short_legs: Array.isArray(body.entryShortLegs) ? body.entryShortLegs : [],
    signal_peak_credit: numeric(body.signalPeakCredit),
    premium_expansion_pct: numeric(body.premiumExpansionPct),
    premium_rollover_pct: numeric(body.premiumRolloverPct),
    premium_crest_status: body.premiumCrestStatus ? String(body.premiumCrestStatus) : null,
    price_rejection_score: numeric(body.priceRejectionScore),
    remaining_move_points: numeric(body.remainingMovePoints),
    max_risk_dollars: numeric(body.maxRiskDollars),
    width_points: numeric(body.widthPoints),
    entry_event_risk: body.eventRisk === "HIGH" ? "HIGH" : "NORMAL",
    entry_range_consumption_pct: numeric(body.rangeConsumptionPct),
    entry_map_phase:
      body.entryMapPhase === "TRANSITION" || body.entryMapPhase === "ACTIVE"
        ? body.entryMapPhase
        : "OPENING",
    entry_map_center: numeric(body.entryMapCenter) ?? 0,
    entry_rail_breached:
      body.entryRailBreached === "UPPER" || body.entryRailBreached === "LOWER"
        ? body.entryRailBreached
        : "NONE",
    path_direction:
      body.pathDirection === "UP" || body.pathDirection === "DOWN" || body.pathDirection === "NEUTRAL"
        ? body.pathDirection
        : null,
    path_confidence: numeric(body.pathConfidence),
    path_flow_source:
      body.pathFlowSource === "engine" || body.pathFlowSource === "fallback"
        ? body.pathFlowSource
        : null,
    path_terminal_trough: numeric(body.pathTerminalTrough),
    path_terminal_crest: numeric(body.pathTerminalCrest),
    portfolio_decision: portfolioDecision,
    portfolio_role: normalizePortfolioRole(body.portfolioRole),
    portfolio_conviction: normalizeConviction(body.portfolioConviction),
    portfolio_conviction_score: numeric(body.portfolioConvictionScore),
    premium_quality_score: numeric(body.premiumQualityScore),
    premium_quality_label: normalizePremiumQuality(body.premiumQualityLabel),
    effective_risk_before_dollars: numeric(body.effectiveRiskBeforeDollars),
    effective_risk_after_dollars: numeric(body.effectiveRiskAfterDollars),
    incremental_effective_risk_dollars: numeric(body.incrementalEffectiveRiskDollars),
    available_capacity_after_dollars: numeric(body.availableCapacityAfterDollars),
    adaptive_reserve_need_dollars: numeric(body.adaptiveReserveNeedDollars),
    reserve_coverage_x: numeric(body.reserveCoverageX),
    call_release_reserve_dollars: numeric(body.callReleaseReserveDollars),
    put_release_reserve_dollars: numeric(body.putReleaseReserveDollars),
    reserve_dominant_side: normalizeReserveSide(body.reserveDominantSide),
    portfolio_repair_deficit_dollars: numeric(body.portfolioRepairDeficitDollars),
    candidate_offset_credit_dollars: numeric(body.candidateOffsetCreditDollars),
    portfolio_decision_reason: body.portfolioDecisionReason ? String(body.portfolioDecisionReason) : null,
    entry_leg_snapshots: entryLegSnapshots,
    current_leg_snapshots: entryLegSnapshots,
    entry_greeks: body.entryGreeks && typeof body.entryGreeks === "object" ? body.entryGreeks : null,
    current_greeks: body.entryGreeks && typeof body.entryGreeks === "object" ? body.entryGreeks : null,
    adaptive_structure_state: accepted ? structureState : null,
    adaptive_active_legs: accepted ? legs : [],
    adaptive_net_cash_points: accepted ? entryCredit : null,
    adaptive_marked_pnl_dollars: accepted ? 0 : null,
    adaptive_released_short_strike: null,
    adaptive_reinstated_short_strike: null,
    adaptive_structure_history: openHistory,
    max_mark_credit: numeric(body.entryMarkCredit),
    min_buyback_debit: null,
    max_adverse_excursion_dollars: 0,
    max_favorable_excursion_dollars: 0,
    hit_short_strike: false,
    hit_one_point_five_x: false,
    hit_two_x: false,
    ran_to_max_loss: false,
    adaptive_state: accepted ? "open" : null,
    adaptive_management_state: accepted ? "HEALTHY" : null,
    adaptive_action: accepted ? "HOLD" : null,
    adaptive_target_capture_pct: null,
    adaptive_target_debit: null,
    adaptive_target_r: null,
    adaptive_thesis_score: null,
    adaptive_favorable_score: null,
    adaptive_threat_score: null,
    adaptive_invalidation_score: null,
    adaptive_reason: accepted
      ? "Adaptive portfolio manager initialized for an admitted individual lot."
      : "Signal recorded by the opportunity ledger but not admitted to the portfolio.",
    adaptive_max_adverse_excursion_dollars: 0,
    adaptive_max_favorable_excursion_dollars: 0,
    adaptive_profit_giveback_pct: null,
    adaptive_exit_time: null,
    adaptive_exit_reason: null,
    adaptive_exit_buyback_debit: null,
    adaptive_pnl_dollars: null,
    adaptive_last_updated_at: body.signalTime,
    adaptive_auction_state: null,
    adaptive_auction_pressure_pct: null,
    adaptive_auction_efficiency_pct: null,
    adaptive_projected_poc_spx: null,
  };

  // A confirmed signal is immutable. Never let a reload/upsert reopen a shadow
  // trade that the exit engine already closed.
  const { data: existing, error: existingError } = await supabaseServer
    .from("zero_dte_shadow_trades")
    .select("*")
    .eq("user_id", userId)
    .eq("signal_id", String(body.signalId))
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    return NextResponse.json({ ok: true, trade: mapShadowTrade(existing) });
  }

  const { data, error } = await supabaseServer
    .from("zero_dte_shadow_trades")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return NextResponse.json({ ok: true, trade: mapShadowTrade(data) });
}

async function sampleShadowBatch(body: any, userId: string) {
  const items = Array.isArray(body.items) ? body.items : [];
  const generatedAt = String(body.generatedAt ?? "");
  const spot = numeric(body.spot);
  if (!body.tradeDate || !generatedAt || spot === null || !items.length) {
    return NextResponse.json({ ok: true, trades: [] });
  }

  const ids = items
    .map((item: any) => String(item.tradeId ?? ""))
    .filter(Boolean);
  const { data: existing, error: existingError } = await supabaseServer
    .from("zero_dte_shadow_trades")
    .select("*")
    .in("id", ids)
    .eq("user_id", userId)
    .or("state.eq.open,adaptive_state.eq.open");
  if (existingError) throw existingError;
  const byId = new Map<string, any>((existing ?? []).map((row: any) => [String(row.id), row]));

  const sampleRows: any[] = [];
  const updatedTrades: any[] = [];

  for (const item of items) {
    const row = byId.get(String(item.tradeId ?? ""));
    if (!row) continue;
    const markCredit = numeric(item.markCredit);
    const sellableCredit = numeric(item.sellableCredit);
    const buybackDebit = numeric(item.buybackDebit);
    const currentShortBuybackPrice = numeric(item.currentShortBuybackPrice);
    const currentShortLegMultiple = numeric(item.currentShortLegMultiple);
    const currentLegSnapshots = Array.isArray(item.currentLegSnapshots) ? item.currentLegSnapshots : [];
    const entryCredit = numeric(row.entry_sellable_credit) ?? 0;
    const width = numeric(row.width_points);
    const shortStrike = shortStrikeFromLegs(row.legs);
    const strategy = normalizeStrategy(row.strategy);
    const hitShortStrike =
      shortStrike !== null &&
      ((strategy === "put-credit-spread" && spot <= shortStrike) ||
        (strategy === "call-credit-spread" && spot >= shortStrike));
    const adverseDollars =
      buybackDebit === null ? 0 : Math.max(0, buybackDebit - entryCredit) * 100;
    const favorableDollars =
      buybackDebit === null ? 0 : Math.max(0, entryCredit - buybackDebit) * 100;
    const ranToMaxLoss =
      width !== null &&
      buybackDebit !== null &&
      buybackDebit >= Math.max(0, width * 0.95);
    const adaptive = normalizeAdaptiveDecision(item.adaptiveDecision);
    const adaptiveWasOpen = row.adaptive_state === "open";
    const staticWasOpen = row.state === "open";
    const adaptiveCurrentPnl =
      numeric(adaptive?.markedPnlDollars) ??
      (buybackDebit === null ? null : (entryCredit - buybackDebit) * 100);
    const adaptiveAdverse = adaptiveCurrentPnl === null ? 0 : Math.max(0, -adaptiveCurrentPnl);
    const adaptiveFavorable = adaptiveCurrentPnl === null ? 0 : Math.max(0, adaptiveCurrentPnl);
    const adaptiveMae = adaptiveWasOpen
      ? Math.max(numeric(row.adaptive_max_adverse_excursion_dollars) ?? 0, adaptiveAdverse)
      : numeric(row.adaptive_max_adverse_excursion_dollars) ?? 0;
    const adaptiveMfe = adaptiveWasOpen
      ? Math.max(numeric(row.adaptive_max_favorable_excursion_dollars) ?? 0, adaptiveFavorable)
      : numeric(row.adaptive_max_favorable_excursion_dollars) ?? 0;
    const adaptiveGiveback =
      adaptiveCurrentPnl !== null && adaptiveCurrentPnl >= 0 && adaptiveMfe > 0
        ? Math.max(0, Math.min(100, ((adaptiveMfe - adaptiveCurrentPnl) / adaptiveMfe) * 100))
        : null;

    sampleRows.push({
      shadow_trade_id: row.id,
      trade_date: body.tradeDate,
      sampled_at: generatedAt,
      spx_price: spot,
      mark_credit: markCredit,
      sellable_credit: sellableCredit,
      buyback_debit: buybackDebit,
      current_short_buyback_price: currentShortBuybackPrice,
      current_short_leg_multiple: currentShortLegMultiple,
      pnl_conservative_dollars:
        buybackDebit === null ? null : (entryCredit - buybackDebit) * 100,
      short_distance_points: numeric(item.shortDistancePoints),
      lifecycle: String(item.lifecycle ?? "HOLD"),
      exit_score: numeric(item.exitScore) ?? 0,
      emergency_exit: Boolean(item.emergencyExit),
      path_threat: Boolean(item.pathThreat),
      hit_short_strike: hitShortStrike,
      hit_one_point_five_x:
        buybackDebit !== null && entryCredit > 0
          ? buybackDebit >= entryCredit * 1.5
          : false,
      hit_two_x:
        buybackDebit !== null && entryCredit > 0
          ? buybackDebit >= entryCredit * 2
          : false,
      adaptive_management_state: adaptive?.state ?? null,
      adaptive_action: adaptive?.action ?? null,
      adaptive_target_capture_pct: numeric(adaptive?.targetCapturePct),
      adaptive_target_debit: numeric(adaptive?.targetDebit),
      adaptive_target_r: numeric(adaptive?.targetR),
      adaptive_thesis_score: numeric(adaptive?.thesisScore),
      adaptive_favorable_score: numeric(adaptive?.favorableScore),
      adaptive_threat_score: numeric(adaptive?.threatScore),
      adaptive_invalidation_score: numeric(adaptive?.invalidationScore),
      adaptive_reason: adaptive?.reasons?.join(" ") ?? null,
      adaptive_auction_state: adaptive?.auctionState ?? null,
      adaptive_auction_pressure_pct: numeric(adaptive?.auctionPressurePct),
      adaptive_auction_efficiency_pct: numeric(adaptive?.auctionEfficiencyPct),
      adaptive_projected_poc_spx: numeric(adaptive?.projectedPocSpx),
      current_leg_snapshots: currentLegSnapshots,
      current_greeks: adaptive?.currentGreeks ?? null,
      adaptive_structure_state: adaptive?.structureState ?? row.adaptive_structure_state ?? null,
      adaptive_marked_pnl_dollars: adaptiveCurrentPnl,
    });

    const update: Record<string, unknown> = {
      last_sample_at: generatedAt,
      current_mark_credit: markCredit,
      current_buyback_debit: buybackDebit,
      current_short_buyback_price: currentShortBuybackPrice,
      current_short_leg_multiple: currentShortLegMultiple,
      current_leg_snapshots: currentLegSnapshots,
      current_greeks: adaptive?.currentGreeks ?? row.current_greeks ?? null,
    };

    // Preserve the original static manager's statistics at its own exit. If the
    // adaptive path remains open after static TP, later samples must not rewrite
    // static MAE/MFE or the original validation result.
    if (staticWasOpen) {
      Object.assign(update, {
        max_mark_credit:
          markCredit === null
            ? numeric(row.max_mark_credit)
            : Math.max(numeric(row.max_mark_credit) ?? markCredit, markCredit),
        min_buyback_debit:
          buybackDebit === null
            ? numeric(row.min_buyback_debit)
            : Math.min(numeric(row.min_buyback_debit) ?? buybackDebit, buybackDebit),
        max_adverse_excursion_dollars: Math.max(
          numeric(row.max_adverse_excursion_dollars) ?? 0,
          adverseDollars,
        ),
        max_favorable_excursion_dollars: Math.max(
          numeric(row.max_favorable_excursion_dollars) ?? 0,
          favorableDollars,
        ),
        hit_short_strike: Boolean(row.hit_short_strike) || hitShortStrike,
        hit_one_point_five_x:
          Boolean(row.hit_one_point_five_x) ||
          (buybackDebit !== null && entryCredit > 0 && buybackDebit >= entryCredit * 1.5),
        hit_two_x:
          Boolean(row.hit_two_x) ||
          (buybackDebit !== null && entryCredit > 0 && buybackDebit >= entryCredit * 2),
        ran_to_max_loss: Boolean(row.ran_to_max_loss) || ranToMaxLoss,
      });
    }

    if (adaptiveWasOpen && adaptive) {
      Object.assign(update, {
        adaptive_management_state: adaptive.state,
        adaptive_action: adaptive.action,
        adaptive_target_capture_pct: numeric(adaptive.targetCapturePct),
        adaptive_target_debit: numeric(adaptive.targetDebit),
        adaptive_target_r: numeric(adaptive.targetR),
        adaptive_thesis_score: numeric(adaptive.thesisScore),
        adaptive_favorable_score: numeric(adaptive.favorableScore),
        adaptive_threat_score: numeric(adaptive.threatScore),
        adaptive_invalidation_score: numeric(adaptive.invalidationScore),
        adaptive_reason: adaptive.reasons.join(" "),
        adaptive_max_adverse_excursion_dollars: adaptiveMae,
        adaptive_max_favorable_excursion_dollars: adaptiveMfe,
        adaptive_profit_giveback_pct: adaptiveGiveback,
        adaptive_last_updated_at: generatedAt,
        adaptive_auction_state: adaptive.auctionState,
        adaptive_auction_pressure_pct: numeric(adaptive.auctionPressurePct),
        adaptive_auction_efficiency_pct: numeric(adaptive.auctionEfficiencyPct),
        adaptive_projected_poc_spx: numeric(adaptive.projectedPocSpx),
        adaptive_marked_pnl_dollars: adaptiveCurrentPnl,
        adaptive_structure_state: adaptive.structureState ?? row.adaptive_structure_state ?? null,
        current_greeks: adaptive.currentGreeks ?? row.current_greeks ?? null,
      });

      const transition = normalizeStructureTransition(adaptive.structureTransition);
      if (transition) {
        const history = Array.isArray(row.adaptive_structure_history)
          ? [...row.adaptive_structure_history]
          : [];
        history.push({
          at: generatedAt,
          action: transition.type,
          strike: transition.strike,
          price: transition.executionPrice,
          detail: transition.detail,
          netCashPoints: transition.nextNetCashPoints,
        });
        Object.assign(update, {
          adaptive_structure_state: transition.nextStructureState,
          adaptive_active_legs: transition.nextActiveLegs,
          adaptive_net_cash_points: transition.nextNetCashPoints,
          adaptive_structure_history: history,
          adaptive_released_short_strike:
            transition.type === "RELEASE_SHORT"
              ? transition.strike
              : row.adaptive_released_short_strike ?? null,
          adaptive_reinstated_short_strike:
            transition.type === "REINSTATE_SHORT"
              ? transition.strike
              : row.adaptive_reinstated_short_strike ?? null,
        });
      }

      if (adaptive.shouldExit && adaptive.exitReason) {
        Object.assign(update, {
          adaptive_state: "closed",
          adaptive_exit_time: generatedAt,
          adaptive_exit_reason: adaptive.exitReason,
          adaptive_exit_buyback_debit: buybackDebit,
          adaptive_pnl_dollars: adaptiveCurrentPnl,
          adaptive_marked_pnl_dollars: adaptiveCurrentPnl,
          adaptive_structure_state: "CLOSED",
        });
      }
    }

    const { data: updated, error: updateError } = await supabaseServer
      .from("zero_dte_shadow_trades")
      .update({ ...update, updated_at: generatedAt })
      .eq("id", row.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updateError) throw updateError;
    updatedTrades.push(updated);
  }

  if (sampleRows.length) {
    const { error: sampleError } = await supabaseServer
      .from("zero_dte_shadow_trade_samples")
      .upsert(sampleRows, {
        onConflict: "shadow_trade_id,sampled_at",
        ignoreDuplicates: false,
      });
    if (sampleError) throw sampleError;
  }

  return NextResponse.json({
    ok: true,
    trades: updatedTrades.map(mapShadowTrade),
  });
}

async function closeShadow(body: any, userId: string) {
  const exitDebit = numeric(body.exitBuybackDebit);
  const { data: row, error: rowError } = await supabaseServer
    .from("zero_dte_shadow_trades")
    .select("*")
    .eq("id", String(body.tradeId ?? ""))
    .eq("user_id", userId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row) return jsonError("Shadow trade not found", 404);

  const entryCredit = numeric(row.entry_sellable_credit) ?? 0;
  const payload = {
    state: "closed",
    updated_at: body.exitTime,
    exit_time: body.exitTime,
    exit_reason: String(body.exitReason ?? "EXIT_ENGINE"),
    exit_buyback_debit: exitDebit,
    exit_score: numeric(body.exitScore) ?? 0,
    exit_emergency: Boolean(body.emergencyExit),
    pnl_conservative_dollars:
      exitDebit === null ? null : (entryCredit - exitDebit) * 100,
  };
  const { data, error } = await supabaseServer
    .from("zero_dte_shadow_trades")
    .update(payload)
    .eq("id", row.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return NextResponse.json({ ok: true, trade: mapShadowTrade(data) });
}

function mapShadowTrade(row: any) {
  return {
    id: row.id,
    tradeDate: row.trade_date,
    signalId: row.signal_id,
    strategy: normalizeStrategy(row.strategy),
    setupKey: row.setup_key,
    label: row.strategy_label ?? row.strategy,
    legs: Array.isArray(row.legs) ? row.legs : [],
    state: row.state === "closed" ? "closed" : row.state === "skipped" ? "skipped" : "open",
    signalTime: row.signal_time,
    signalCandleTime: Number(row.signal_candle_time ?? 0),
    entryScore: Number(row.entry_score ?? 0),
    minimumEntryScore: Number(row.minimum_entry_score ?? 0),
    timeRegime: row.time_regime ?? "UNKNOWN",
    shortDeltaAbs: numeric(row.short_delta_abs),
    shortDistancePoints: numeric(row.short_distance_points),
    entryMarkCredit: numeric(row.entry_mark_credit),
    entrySellableCredit: Number(row.entry_sellable_credit ?? 0),
    entryShortLegs: Array.isArray(row.entry_short_legs) ? row.entry_short_legs : [],
    signalPeakCredit: numeric(row.signal_peak_credit),
    premiumExpansionPct: numeric(row.premium_expansion_pct),
    premiumRolloverPct: numeric(row.premium_rollover_pct),
    premiumCrestStatus: row.premium_crest_status ?? null,
    priceRejectionScore: numeric(row.price_rejection_score),
    remainingMovePoints: numeric(row.remaining_move_points),
    maxRiskDollars: numeric(row.max_risk_dollars),
    widthPoints: numeric(row.width_points),
    eventRisk: row.entry_event_risk === "HIGH" ? "HIGH" : "NORMAL",
    rangeConsumptionPct: numeric(row.entry_range_consumption_pct),
    entryMapPhase:
      row.entry_map_phase === "TRANSITION" || row.entry_map_phase === "ACTIVE"
        ? row.entry_map_phase
        : "OPENING",
    entryMapCenter: Number(row.entry_map_center ?? 0),
    entryRailBreached:
      row.entry_rail_breached === "UPPER" || row.entry_rail_breached === "LOWER"
        ? row.entry_rail_breached
        : "NONE",
    pathDirection:
      row.path_direction === "UP" || row.path_direction === "DOWN" || row.path_direction === "NEUTRAL"
        ? row.path_direction
        : null,
    pathConfidence: numeric(row.path_confidence),
    pathFlowSource:
      row.path_flow_source === "engine" || row.path_flow_source === "fallback"
        ? row.path_flow_source
        : null,
    pathTerminalTrough: numeric(row.path_terminal_trough),
    pathTerminalCrest: numeric(row.path_terminal_crest),
    portfolioDecision: normalizePortfolioDecision(row.portfolio_decision),
    portfolioRole: normalizePortfolioRole(row.portfolio_role),
    portfolioConviction: normalizeConviction(row.portfolio_conviction),
    portfolioConvictionScore: numeric(row.portfolio_conviction_score),
    premiumQualityScore: numeric(row.premium_quality_score),
    premiumQualityLabel: normalizePremiumQuality(row.premium_quality_label),
    effectiveRiskBeforeDollars: numeric(row.effective_risk_before_dollars),
    effectiveRiskAfterDollars: numeric(row.effective_risk_after_dollars),
    incrementalEffectiveRiskDollars: numeric(row.incremental_effective_risk_dollars),
    availableCapacityAfterDollars: numeric(row.available_capacity_after_dollars),
    adaptiveReserveNeedDollars: numeric(row.adaptive_reserve_need_dollars),
    reserveCoverageX: numeric(row.reserve_coverage_x),
    callReleaseReserveDollars: numeric(row.call_release_reserve_dollars),
    putReleaseReserveDollars: numeric(row.put_release_reserve_dollars),
    reserveDominantSide: normalizeReserveSide(row.reserve_dominant_side),
    portfolioRepairDeficitDollars: numeric(row.portfolio_repair_deficit_dollars),
    candidateOffsetCreditDollars: numeric(row.candidate_offset_credit_dollars),
    portfolioDecisionReason: row.portfolio_decision_reason ? String(row.portfolio_decision_reason) : null,
    entryLegSnapshots: Array.isArray(row.entry_leg_snapshots) ? row.entry_leg_snapshots : [],
    currentLegSnapshots: Array.isArray(row.current_leg_snapshots) ? row.current_leg_snapshots : [],
    entryGreeks: row.entry_greeks && typeof row.entry_greeks === "object" ? row.entry_greeks : null,
    currentGreeks: row.current_greeks && typeof row.current_greeks === "object" ? row.current_greeks : null,
    adaptiveStructureState: normalizeStructureState(row.adaptive_structure_state),
    adaptiveActiveLegs: Array.isArray(row.adaptive_active_legs) ? row.adaptive_active_legs : [],
    adaptiveNetCashPoints: numeric(row.adaptive_net_cash_points),
    adaptiveMarkedPnlDollars: numeric(row.adaptive_marked_pnl_dollars),
    adaptiveReleasedShortStrike: numeric(row.adaptive_released_short_strike),
    adaptiveReinstatedShortStrike: numeric(row.adaptive_reinstated_short_strike),
    adaptiveStructureHistory: Array.isArray(row.adaptive_structure_history) ? row.adaptive_structure_history : [],
    lastSampleAt: row.last_sample_at ?? null,
    currentMarkCredit: numeric(row.current_mark_credit),
    currentBuybackDebit: numeric(row.current_buyback_debit),
    currentShortBuybackPrice: numeric(row.current_short_buyback_price),
    currentShortLegMultiple: numeric(row.current_short_leg_multiple),
    maxMarkCredit: numeric(row.max_mark_credit),
    minBuybackDebit: numeric(row.min_buyback_debit),
    maxAdverseExcursionDollars: Number(row.max_adverse_excursion_dollars ?? 0),
    maxFavorableExcursionDollars: Number(row.max_favorable_excursion_dollars ?? 0),
    hitShortStrike: Boolean(row.hit_short_strike),
    hitOnePointFiveX: Boolean(row.hit_one_point_five_x),
    hitTwoX: Boolean(row.hit_two_x),
    ranToMaxLoss: Boolean(row.ran_to_max_loss),
    exitTime: row.exit_time ?? null,
    exitReason: row.exit_reason ?? null,
    exitBuybackDebit: numeric(row.exit_buyback_debit),
    pnlConservativeDollars: numeric(row.pnl_conservative_dollars),
    adaptiveState:
      row.adaptive_state === "open" || row.adaptive_state === "closed"
        ? row.adaptive_state
        : null,
    adaptiveManagementState: normalizeAdaptiveState(row.adaptive_management_state),
    adaptiveAction: normalizeAdaptiveAction(row.adaptive_action),
    adaptiveTargetCapturePct: numeric(row.adaptive_target_capture_pct),
    adaptiveTargetDebit: numeric(row.adaptive_target_debit),
    adaptiveTargetR: numeric(row.adaptive_target_r),
    adaptiveThesisScore: numeric(row.adaptive_thesis_score),
    adaptiveFavorableScore: numeric(row.adaptive_favorable_score),
    adaptiveThreatScore: numeric(row.adaptive_threat_score),
    adaptiveInvalidationScore: numeric(row.adaptive_invalidation_score),
    adaptiveReason: row.adaptive_reason ? String(row.adaptive_reason) : null,
    adaptiveMaxAdverseExcursionDollars: Number(row.adaptive_max_adverse_excursion_dollars ?? 0),
    adaptiveMaxFavorableExcursionDollars: Number(row.adaptive_max_favorable_excursion_dollars ?? 0),
    adaptiveProfitGivebackPct: numeric(row.adaptive_profit_giveback_pct),
    adaptiveExitTime: row.adaptive_exit_time ?? null,
    adaptiveExitReason: row.adaptive_exit_reason ?? null,
    adaptiveExitBuybackDebit: numeric(row.adaptive_exit_buyback_debit),
    adaptivePnlDollars: numeric(row.adaptive_pnl_dollars),
    adaptiveAuctionState: row.adaptive_auction_state ?? null,
    adaptiveAuctionPressurePct: numeric(row.adaptive_auction_pressure_pct),
    adaptiveAuctionEfficiencyPct: numeric(row.adaptive_auction_efficiency_pct),
    adaptiveProjectedPocSpx: numeric(row.adaptive_projected_poc_spx),
  };
}

function shortStrikeFromLegs(legs: unknown) {
  if (!Array.isArray(legs)) return null;
  const short = legs.find(
    (leg) =>
      leg &&
      typeof leg === "object" &&
      (leg as any).action === "sell" &&
      Number.isFinite(Number((leg as any).strike)),
  ) as any;
  return short ? Number(short.strike) : null;
}

function normalizeStrategy(value: unknown) {
  if (value === "put-credit-spread" || value === "call-credit-spread") {
    return value;
  }
  return "iron-fly";
}

function normalizeAdaptiveDecision(value: any) {
  if (!value || typeof value !== "object") return null;
  const state = normalizeAdaptiveState(value.state);
  const action = normalizeAdaptiveAction(value.action);
  if (!state || !action) return null;
  return {
    ...value,
    state,
    action,
    shouldExit: Boolean(value.shouldExit),
    exitReason: value.exitReason ? String(value.exitReason) : null,
    reasons: Array.isArray(value.reasons) ? value.reasons.map(String) : [],
    auctionState: value.auctionState ? String(value.auctionState) : null,
  };
}

function normalizeAdaptiveState(value: any) {
  return value === "HEALTHY" ||
    value === "FAVORABLE_RELEASE" ||
    value === "RECOVERY" ||
    value === "THREATENED" ||
    value === "INVALIDATED" ||
    value === "HARVEST"
    ? value
    : null;
}

function normalizeAdaptiveAction(value: any) {
  return value === "HOLD" ||
    value === "HOLD_FOR_DEEPER_HARVEST" ||
    value === "WATCH" ||
    value === "RELEASE_SHORT" ||
    value === "REINSTATE_SHORT" ||
    value === "CLOSE_RUNNER" ||
    value === "EXIT"
    ? value
    : null;
}

function normalizePortfolioDecision(value: unknown) {
  return value === "TAKE" || value === "WATCH" || value === "PASS" || value === "BLOCKED_CAPITAL"
    ? value
    : null;
}

function normalizePortfolioRole(value: unknown) {
  return value === "BUILD" || value === "PAIRED_SIDE" || value === "REPAIR_OFFSET" || value === "REPAIR" || value === "DEFENSE" || value === "NEW_RISK" || value === "IF_CENTER"
    ? value
    : null;
}

function normalizeReserveSide(value: unknown) {
  return value === "CALL" || value === "PUT" || value === "BALANCED" || value === "NONE"
    ? value
    : null;
}

function normalizeConviction(value: unknown) {
  return value === "DEFINITIVE" || value === "CONFIRMED" || value === "SUPPORTIVE" || value === "MIXED" || value === "CONFLICT" || value === "INSUFFICIENT"
    ? value
    : null;
}

function normalizePremiumQuality(value: unknown) {
  return value === "EXCELLENT" || value === "STRONG" || value === "ACCEPTABLE" || value === "WEAK"
    ? value
    : null;
}

function normalizeStructureState(value: unknown) {
  return value === "CREDIT_SPREAD" || value === "LONG_RUNNER" || value === "REPAIRED_SPREAD" || value === "IF_CENTER" || value === "CLOSED"
    ? value
    : null;
}

function normalizeStructureTransition(value: any) {
  if (!value || typeof value !== "object") return null;
  const type = value.type;
  if (type !== "RELEASE_SHORT" && type !== "REINSTATE_SHORT" && type !== "CLOSE_RUNNER") return null;
  const executionPrice = numeric(value.executionPrice);
  const nextNetCashPoints = numeric(value.nextNetCashPoints);
  const nextStructureState = normalizeStructureState(value.nextStructureState);
  if (executionPrice === null || executionPrice < 0 || nextNetCashPoints === null || !nextStructureState) return null;
  return {
    type,
    strike: numeric(value.strike),
    executionPrice,
    nextStructureState,
    nextActiveLegs: Array.isArray(value.nextActiveLegs) ? value.nextActiveLegs : [],
    nextNetCashPoints,
    detail: String(value.detail ?? type),
  };
}

function numeric(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [
      typeof value.code === "string" ? `[${value.code}]` : "",
      typeof value.message === "string" ? value.message : "",
      typeof value.details === "string" ? value.details : "",
      typeof value.hint === "string" ? `Hint: ${value.hint}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return String(error);
}

function jsonError(error: unknown, status: number) {
  return NextResponse.json(
    { ok: false, error: errorMessage(error) },
    { status },
  );
}
