import { NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../lib/billing/auth-request";
import { fallbackEntitlement, normalizePlan, normalizeSymbol } from "../../../lib/ticker-entitlements";

export const runtime = "nodejs";

type WatchlistBody = {
  symbol?: string;
  replaceSymbol?: string;
};

async function getUserPlan(userId: string): Promise<string> {
  const { data: subscription } = await supabaseServer
    .from("subscriptions")
    .select("plan,status,current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscription?.plan) return subscription.plan;

  // Profiles have changed during the beta; read all columns and tolerate either name.
  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  return (profile as any)?.selected_plan ?? (profile as any)?.plan ?? "founder";
}

async function getEntitlement(planValue: string) {
  const fallback = fallbackEntitlement(planValue);
  const plan = normalizePlan(planValue);

  const { data } = await supabaseServer
    .from("plan_entitlements")
    .select("plan,max_tickers,max_replacements_per_day,max_validation_history_days")
    .eq("plan", plan)
    .maybeSingle();

  if (!data) return fallback;

  return {
    plan,
    maxTickers: Number(data.max_tickers ?? fallback.maxTickers),
    maxReplacementsPerDay: Number(data.max_replacements_per_day ?? fallback.maxReplacementsPerDay),
    maxValidationHistoryDays: Number(data.max_validation_history_days ?? fallback.maxValidationHistoryDays),
  };
}

async function replacementCountToday(userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await supabaseServer
    .from("watchlist_replacement_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_date", today);

  if (error) return 0;
  return count ?? 0;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const plan = await getUserPlan(user.id);
    const entitlement = await getEntitlement(plan);

    const { data, error } = await supabaseServer
      .from("user_watchlist_tickers")
      .select("id,symbol,slot_index,source,created_at,ticker_universe(name,asset_type,data_priority)")
      .eq("user_id", user.id)
      .order("slot_index", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      plan: entitlement.plan,
      entitlement,
      replacementsUsedToday: await replacementCountToday(user.id),
      tickers: data ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load watchlist.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as WatchlistBody;
    const symbol = normalizeSymbol(body.symbol);
    const replaceSymbol = normalizeSymbol(body.replaceSymbol);

    if (!symbol) {
      return NextResponse.json({ ok: false, error: "Ticker symbol is required." }, { status: 400 });
    }

    const plan = await getUserPlan(user.id);
    const entitlement = await getEntitlement(plan);

    const { data: universeRow, error: universeError } = await supabaseServer
      .from("ticker_universe")
      .select("symbol,is_active")
      .eq("symbol", symbol)
      .eq("is_active", true)
      .maybeSingle();

    if (universeError) {
      return NextResponse.json({ ok: false, error: universeError.message }, { status: 500 });
    }

    if (!universeRow) {
      return NextResponse.json(
        { ok: false, error: `${symbol} is not in the active WheelDesk ticker universe yet.` },
        { status: 404 },
      );
    }

    const { data: currentRows, error: listError } = await supabaseServer
      .from("user_watchlist_tickers")
      .select("id,symbol,slot_index")
      .eq("user_id", user.id)
      .order("slot_index", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (listError) {
      return NextResponse.json({ ok: false, error: listError.message }, { status: 500 });
    }

    const current = currentRows ?? [];
    if (current.some((row) => row.symbol === symbol)) {
      return NextResponse.json({ ok: true, message: `${symbol} is already on your watchlist.`, entitlement });
    }

    let slotIndex = current.length;

    if (replaceSymbol) {
      const replacedRow = current.find((row) => row.symbol === replaceSymbol);
      if (!replacedRow) {
        return NextResponse.json(
          { ok: false, error: `${replaceSymbol} is not currently on your watchlist.` },
          { status: 404 },
        );
      }

      const used = await replacementCountToday(user.id);
      if (used >= entitlement.maxReplacementsPerDay) {
        return NextResponse.json(
          {
            ok: false,
            error: `Daily replacement limit reached for ${entitlement.plan}.`,
            entitlement,
            replacementsUsedToday: used,
          },
          { status: 429 },
        );
      }

      slotIndex = Number(replacedRow.slot_index ?? current.indexOf(replacedRow));

      const { error: deleteError } = await supabaseServer
        .from("user_watchlist_tickers")
        .delete()
        .eq("user_id", user.id)
        .eq("symbol", replaceSymbol);

      if (deleteError) {
        return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
      }

      await supabaseServer.from("watchlist_replacement_events").insert({
        user_id: user.id,
        removed_symbol: replaceSymbol,
        added_symbol: symbol,
      });
    } else if (current.length >= entitlement.maxTickers) {
      return NextResponse.json(
        {
          ok: false,
          error: `Ticker limit reached for ${entitlement.plan}. Remove a ticker or upgrade your plan.`,
          entitlement,
          currentCount: current.length,
        },
        { status: 403 },
      );
    }

    const { error: insertError } = await supabaseServer.from("user_watchlist_tickers").insert({
      user_id: user.id,
      symbol,
      slot_index: slotIndex,
      source: replaceSymbol ? "replacement" : "user",
    });

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, symbol, entitlement });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update watchlist.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const symbol = normalizeSymbol(searchParams.get("symbol"));

    if (!symbol) {
      return NextResponse.json({ ok: false, error: "Ticker symbol is required." }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from("user_watchlist_tickers")
      .delete()
      .eq("user_id", user.id)
      .eq("symbol", symbol);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, symbol });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove watchlist ticker.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}
