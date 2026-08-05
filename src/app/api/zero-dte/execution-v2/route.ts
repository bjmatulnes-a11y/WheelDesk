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
import type { ZeroDteTimeRegime } from "../../../../lib/zeroDteTimeRegime";

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
      .select("*")
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

    if (body.action === "sample" || body.action === "sample-batch") {
      const tradeDayId = await upsertTradeDay(body);
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
        memory: await loadMemory(body.tradeDate),
      });
    }

    const memory = await loadMemory(body.tradeDate);
    if (!memory.tradeDayId) {
      return err("Opening trade day has not been persisted yet", 409);
    }

    if (body.action === "open") {
      if (memory.positions.length >= 8) {
        return err("The 0DTE portfolio already has the maximum of eight open positions", 409);
      }
      const candidate = body.candidate;
      if (!candidate) return err("Missing execution candidate", 400);
      const entryCredit = numeric(body.entryCredit);
      if (entryCredit === null || entryCredit <= 0) {
        return err("Invalid entry credit", 400);
      }
      const legs = normalizeLegs(candidate.legs);
      if (!legs.length) return err("Execution candidate has no valid legs", 400);
      if (
        memory.positions.some(
          (position) => position.setupKey === candidate.setupKey,
        )
      ) {
        return err("This exact strategy and strike set is already open", 409);
      }

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
