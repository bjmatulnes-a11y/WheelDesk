import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import type {
  ExecutionClosedTrade,
  ExecutionLeg,
  ExecutionPositionMemory,
  ExecutionPremiumSample,
  ExecutionStrategy,
  ZeroDteExecutionMemory,
} from "../../../../lib/zeroDteExecutionIntelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (error: unknown, status = 500) =>
  NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : String(error) },
    { status },
  );

const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value != null && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const textArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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
      position: null,
      closedTrades: [],
      cooldownUntil: null,
    };
  }

  const [samplesResult, openResult, closedResult] = await Promise.all([
    supabaseServer
      .from("zero_dte_execution_score_history")
      .select("*")
      .eq("trade_day_id", day.id)
      .order("sampled_at", { ascending: true })
      .limit(720),
    supabaseServer
      .from("zero_dte_execution_positions")
      .select("*")
      .eq("trade_day_id", day.id)
      .eq("state", "open")
      .maybeSingle(),
    supabaseServer
      .from("zero_dte_execution_positions")
      .select("*")
      .eq("trade_day_id", day.id)
      .eq("state", "closed")
      .order("exit_time", { ascending: false })
      .limit(100),
  ]);

  if (samplesResult.error) throw samplesResult.error;
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
      side: normalizeSide(row.setup_side),
    };
  };

  const position = openResult.data ? mapPosition(openResult.data) : null;

  const closedTrades: ExecutionClosedTrade[] = (closedResult.data ?? []).map((row: any) => ({
    ...mapPosition(row),
    closedAt: row.exit_time,
    exitDebit: Number(row.exit_debit ?? 0),
    exitScore: Number(row.exit_score ?? row.exit_buyback_score ?? 0),
    exitReason: row.exit_reason ?? null,
    emergencyExit: Boolean(row.exit_emergency),
    pnlDollars: Number(row.realized_pnl ?? 0),
    durationMinutes: Number(row.duration_minutes ?? 0),
  }));

  const cooldownUntil = closedTrades[0]?.closedAt
    ? new Date(Date.parse(closedTrades[0].closedAt) + 15 * 60_000).toISOString()
    : null;

  const samples: ExecutionPremiumSample[] = (samplesResult.data ?? []).map((row: any) => {
    const strategy = normalizeStrategy(row.strategy);
    const fallbackLegs = legacyLegs(strategy, day);
    return {
      timestamp: row.sampled_at,
      spot: Number(row.spx_price),
      strategy,
      setupKey: row.setup_key ?? makeSetupKey(strategy, fallbackLegs),
      credit: Number(row.strategy_credit ?? row.if_credit ?? 0),
      entryScore: Number(row.entry_score ?? row.sell_score ?? 0),
      exitScore: Number(row.exit_score ?? row.buyback_score ?? 0),
      mapPhase: normalizePhase(row.map_phase),
      mapCenter: Number(row.map_center ?? day.opening_if_center ?? 0),
      railBreached: normalizeRail(row.rail_breached),
      lifecycle: row.lifecycle ?? "WAIT",
    } as ExecutionPremiumSample;
  });

  return {
    tradeDate,
    tradeDayId: day.id,
    samples,
    position,
    closedTrades,
    cooldownUntil,
  };
}

async function upsertTradeDay(body: any): Promise<string> {
  const openingMap = body.openingMap;
  const openingPlan = body.openingPlan;
  const recommendation = body.recommendation;

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
    opening_if_credit: body.sample?.credit ?? null,
    opening_dealer_pressure: recommendation.dealerPressure,
    opening_pin_score: recommendation.confidenceScore,
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

export async function GET(request: NextRequest) {
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
  try {
    const body = await request.json();
    if (!body.tradeDate) return err("Missing tradeDate", 400);

    if (body.action === "sample") {
      const tradeDayId = await upsertTradeDay(body);
      const { data: openPosition, error: openError } = await supabaseServer
        .from("zero_dte_execution_positions")
        .select("id")
        .eq("trade_day_id", tradeDayId)
        .eq("state", "open")
        .maybeSingle();

      if (openError) throw openError;

      const sample = body.sample;
      const { error } = await supabaseServer
        .from("zero_dte_execution_score_history")
        .upsert(
          {
            trade_day_id: tradeDayId,
            position_id: openPosition?.id ?? null,
            sampled_at: sample.timestamp,
            spx_price: sample.spot,
            if_credit: sample.credit,
            strategy_credit: sample.credit,
            strategy: sample.strategy,
            setup_key: sample.setupKey,
            sell_score: sample.entryScore,
            buyback_score: sample.exitScore,
            entry_score: sample.entryScore,
            exit_score: sample.exitScore,
            spring_probability: body.read.entryScore,
            opportunity_score: body.read.confidence,
            dealer_pressure: body.recommendation.dealerPressure,
            strike_flow_state: body.flowState,
            premium_efficiency: body.read.currentCredit
              ? Math.min(100, (body.read.currentCredit / 50) * 100)
              : null,
            peak_credit: body.read.peakCredit,
            credit_velocity: body.read.premiumVelocityPerMinute,
            edge: body.read.edge,
            map_phase: sample.mapPhase,
            map_center: sample.mapCenter,
            rail_breached: sample.railBreached,
            lifecycle: sample.lifecycle,
            premium_expansion_pct: body.read.premiumExpansionPct,
            premium_from_peak_pct: body.read.premiumFromPeakPct,
            emergency_exit: body.read.emergencyExit,
          },
          { onConflict: "trade_day_id,sampled_at" },
        );

      if (error) throw error;

      return NextResponse.json({
        ok: true,
        memory: await loadMemory(body.tradeDate),
      });
    }

    const memory = await loadMemory(body.tradeDate);
    if (!memory.tradeDayId) {
      return err("Opening trade day has not been persisted yet", 409);
    }

    if (body.action === "open") {
      if (memory.position) return err("An execution position is already open", 409);
      const candidate = body.candidate;
      if (!candidate) return err("Missing execution candidate", 400);
      const entryCredit = numeric(body.entryCredit);
      if (entryCredit === null || entryCredit <= 0) return err("Invalid entry credit", 400);
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
        });

      if (error) throw error;

      return NextResponse.json({
        ok: true,
        memory: await loadMemory(body.tradeDate),
      });
    }

    if (body.action === "close") {
      if (!memory.position) return err("No open execution position", 409);

      const exitDebit = numeric(body.exitDebit);
      if (exitDebit === null || exitDebit < 0) return err("Invalid exit debit", 400);

      const pnl =
        (memory.position.entryCredit - exitDebit) *
        100 *
        memory.position.quantity;
      const durationMinutes = Math.max(
        0,
        (Date.parse(body.exitTime) - Date.parse(memory.position.openedAt)) / 60_000,
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
        .eq("id", memory.position.id);

      if (error) throw error;

      const { error: exitError } = await supabaseServer
        .from("zero_dte_execution_exits")
        .upsert(
          {
            position_id: memory.position.id,
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
