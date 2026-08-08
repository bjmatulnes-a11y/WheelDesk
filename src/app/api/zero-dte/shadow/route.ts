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

  const payload = {
    user_id: userId,
    trade_date: body.tradeDate,
    signal_id: body.signalId,
    strategy: normalizeStrategy(body.strategy),
    setup_key: String(body.setupKey),
    strategy_label: String(body.label ?? body.strategy ?? "Shadow Trade"),
    legs: Array.isArray(body.legs) ? body.legs : [],
    state: "open",
    signal_time: body.signalTime,
    signal_candle_time: numeric(body.signalCandleTime),
    entry_score: numeric(body.entryScore) ?? 0,
    minimum_entry_score: numeric(body.minimumEntryScore) ?? 0,
    time_regime: String(body.timeRegime ?? "UNKNOWN"),
    short_delta_abs: numeric(body.shortDeltaAbs),
    short_distance_points: numeric(body.shortDistancePoints),
    entry_mark_credit: numeric(body.entryMarkCredit),
    entry_sellable_credit: entryCredit,
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
    max_mark_credit: numeric(body.entryMarkCredit),
    min_buyback_debit: null,
    max_adverse_excursion_dollars: 0,
    max_favorable_excursion_dollars: 0,
    hit_short_strike: false,
    hit_one_point_five_x: false,
    hit_two_x: false,
    ran_to_max_loss: false,
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
    .eq("state", "open");
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

    sampleRows.push({
      shadow_trade_id: row.id,
      trade_date: body.tradeDate,
      sampled_at: generatedAt,
      spx_price: spot,
      mark_credit: markCredit,
      sellable_credit: sellableCredit,
      buyback_debit: buybackDebit,
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
    });

    const update = {
      last_sample_at: generatedAt,
      current_mark_credit: markCredit,
      current_buyback_debit: buybackDebit,
      max_mark_credit:
        markCredit === null
          ? numeric(row.max_mark_credit)
          : Math.max(numeric(row.max_mark_credit) ?? markCredit, markCredit),
      min_buyback_debit:
        buybackDebit === null
          ? numeric(row.min_buyback_debit)
          : Math.min(
              numeric(row.min_buyback_debit) ?? buybackDebit,
              buybackDebit,
            ),
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
        (buybackDebit !== null &&
          entryCredit > 0 &&
          buybackDebit >= entryCredit * 1.5),
      hit_two_x:
        Boolean(row.hit_two_x) ||
        (buybackDebit !== null &&
          entryCredit > 0 &&
          buybackDebit >= entryCredit * 2),
      ran_to_max_loss: Boolean(row.ran_to_max_loss) || ranToMaxLoss,
    };
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
    state: row.state === "closed" ? "closed" : "open",
    signalTime: row.signal_time,
    signalCandleTime: Number(row.signal_candle_time ?? 0),
    entryScore: Number(row.entry_score ?? 0),
    minimumEntryScore: Number(row.minimum_entry_score ?? 0),
    timeRegime: row.time_regime ?? "UNKNOWN",
    shortDeltaAbs: numeric(row.short_delta_abs),
    shortDistancePoints: numeric(row.short_distance_points),
    entryMarkCredit: numeric(row.entry_mark_credit),
    entrySellableCredit: Number(row.entry_sellable_credit ?? 0),
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
    lastSampleAt: row.last_sample_at ?? null,
    currentMarkCredit: numeric(row.current_mark_credit),
    currentBuybackDebit: numeric(row.current_buyback_debit),
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
