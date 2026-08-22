import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { supabaseServer } from "../../../../lib/supabase-server";

type LegacyExecutionPremiumSample = {
  timestamp: string;
  spot: number;
  credit: number;
  sellScore: number;
  buybackScore: number;
  springProbability: number;
  opportunityScore: number;
};

type LegacyExecutionPosition = {
  id: string;
  openedAt: string;
  entryCredit: number;
  quantity: number;
  entrySellScore: number;
  entrySpringProbability: number;
  entryOpportunityScore: number;
  side: "upper" | "lower" | "center";
};

type LegacyExecutionClosedTrade = LegacyExecutionPosition & {
  closedAt: string;
  exitDebit: number;
  buybackScore: number;
  pnlDollars: number;
  durationMinutes: number;
};

type LegacyZeroDteExecutionMemory = {
  tradeDate: string;
  tradeDayId: string | null;
  samples: LegacyExecutionPremiumSample[];
  position: LegacyExecutionPosition | null;
  closedTrades: LegacyExecutionClosedTrade[];
  cooldownUntil: string | null;
};

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

async function loadMemory(tradeDate: string): Promise<LegacyZeroDteExecutionMemory> {
  const { data: day, error: dayError } = await supabaseServer
    .from("zero_dte_execution_trade_days")
    .select("id")
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
      .select(
        "sampled_at,spx_price,if_credit,sell_score,buyback_score,spring_probability,opportunity_score",
      )
      .eq("trade_day_id", day.id)
      .order("sampled_at", { ascending: true })
      .limit(240),
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

  const open = openResult.data;
  const position = open
    ? {
        id: open.id,
        openedAt: open.entry_time,
        entryCredit: Number(open.entry_credit),
        quantity: Number(open.contracts),
        entrySellScore: Number(open.entry_sell_score ?? 0),
        entrySpringProbability: Number(open.entry_spring_probability ?? 0),
        entryOpportunityScore: Number(open.entry_opportunity_score ?? 0),
        side: open.setup_side,
      }
    : null;

  const closedTrades = (closedResult.data ?? []).map((row) => ({
    id: row.id,
    openedAt: row.entry_time,
    entryCredit: Number(row.entry_credit),
    quantity: Number(row.contracts),
    entrySellScore: Number(row.entry_sell_score ?? 0),
    entrySpringProbability: Number(row.entry_spring_probability ?? 0),
    entryOpportunityScore: Number(row.entry_opportunity_score ?? 0),
    side: row.setup_side,
    closedAt: row.exit_time,
    exitDebit: Number(row.exit_debit ?? 0),
    buybackScore: Number(row.exit_buyback_score ?? 0),
    pnlDollars: Number(row.realized_pnl ?? 0),
    durationMinutes: Number(row.duration_minutes ?? 0),
  }));

  const cooldownUntil = closedTrades[0]?.closedAt
    ? new Date(Date.parse(closedTrades[0].closedAt) + 15 * 60_000).toISOString()
    : null;

  return {
    tradeDate,
    tradeDayId: day.id,
    samples: (samplesResult.data ?? []).map((row) => ({
      timestamp: row.sampled_at,
      spot: Number(row.spx_price),
      credit: Number(row.if_credit),
      sellScore: Number(row.sell_score),
      buybackScore: Number(row.buyback_score),
      springProbability: Number(row.spring_probability),
      opportunityScore: Number(row.opportunity_score),
    })),
    position: position as LegacyZeroDteExecutionMemory["position"],
    closedTrades: closedTrades as LegacyZeroDteExecutionMemory["closedTrades"],
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
    opening_if_width: 50,
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
            sell_score: sample.sellScore,
            buyback_score: sample.buybackScore,
            spring_probability: sample.springProbability,
            opportunity_score: sample.opportunityScore,
            dealer_pressure: body.recommendation.dealerPressure,
            strike_flow_state: body.flowState,
            premium_efficiency: body.read.currentCredit
              ? Math.min(100, (body.read.currentCredit / 50) * 100)
              : null,
            peak_credit: body.read.peakCredit,
            credit_velocity: body.read.premiumVelocityPerMinute,
            edge: body.read.edge,
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
      const { error } = await supabaseServer
        .from("zero_dte_execution_positions")
        .insert({
                trade_day_id: memory.tradeDayId,
          strategy: "iron_fly",
          state: "open",
          entry_time: body.entryTime,
          entry_credit: numeric(body.entryCredit),
          contracts: Math.max(1, Math.floor(numeric(body.contracts) ?? 1)),
          setup_side: body.side,
          entry_sell_score: body.read.sellScore,
          entry_spring_probability: body.read.springProbability,
          entry_opportunity_score: body.read.opportunityScore,
        });

      if (error) throw error;

      return NextResponse.json({
        ok: true,
        memory: await loadMemory(body.tradeDate),
      });
    }

    if (body.action === "close") {
      if (!memory.position) return err("No open IF position", 409);

      const exitDebit = numeric(body.exitDebit);
      if (exitDebit === null) return err("Invalid exit debit", 400);

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
          exit_buyback_score: numeric(body.buybackScore),
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
            buyback_score: numeric(body.buybackScore),
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
