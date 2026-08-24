import { supabaseServer } from "../supabase-server";
import type { SchwabTokenRecord } from "./types";

const TOKEN_CACHE_MS = 5 * 60_000;
const MISSING_TOKEN_CACHE_MS = 5_000;

type CachedToken = {
  value: SchwabTokenRecord | null;
  loadedAt: number;
};

const globalTokenStore = globalThis as typeof globalThis & {
  __wheelDeskSchwabTokenCache?: Map<string, CachedToken>;
  __wheelDeskSchwabTokenLoads?: Map<string, Promise<SchwabTokenRecord | null>>;
};

function tokenCache() {
  return (globalTokenStore.__wheelDeskSchwabTokenCache ??= new Map());
}

function tokenLoads() {
  return (globalTokenStore.__wheelDeskSchwabTokenLoads ??= new Map());
}

function rowId(userId: string) {
  return `${userId}:schwab`;
}

export async function loadSchwabTokens(
  userId: string,
  options: { force?: boolean } = {},
): Promise<SchwabTokenRecord | null> {
  if (!userId) throw new Error("Missing WheelDesk user id for Schwab connection.");

  const cache = tokenCache();
  const cached = cache.get(userId);
  if (!options.force && cached) {
    const age = Date.now() - cached.loadedAt;
    const maxAge = cached.value ? TOKEN_CACHE_MS : MISSING_TOKEN_CACHE_MS;
    if (age >= 0 && age < maxAge) return cached.value;
  }

  const loads = tokenLoads();
  const pending = loads.get(userId);
  if (pending) return pending;

  const load = (async () => {
    const { data, error } = await supabaseServer
      .from("broker_connections")
      .select("access_token,refresh_token,token_type,scope,expires_at,refresh_expires_at,updated_at")
      .eq("user_id", userId)
      .eq("provider", "schwab")
      .maybeSingle();

    if (error) {
      if (error.message.toLowerCase().includes("user_id")) {
        throw new Error(
          "Schwab per-user storage is not installed. Run the broker_connections per-user migration before reconnecting Schwab.",
        );
      }
      throw new Error(`Unable to load Schwab tokens: ${error.message}`);
    }

    const value = (data as SchwabTokenRecord | null) ?? null;
    cache.set(userId, { value, loadedAt: Date.now() });
    return value;
  })();

  loads.set(userId, load);
  try {
    return await load;
  } finally {
    if (loads.get(userId) === load) loads.delete(userId);
  }
}

export async function saveSchwabTokens(
  userId: string,
  args: {
    accessToken: string;
    refreshToken: string;
    tokenType?: string;
    scope?: string | null;
    expiresIn: number;
    refreshExpiresIn?: number | null;
  },
) {
  if (!userId) throw new Error("Missing WheelDesk user id for Schwab connection.");

  const now = Date.now();
  const payload = {
    id: rowId(userId),
    user_id: userId,
    provider: "schwab",
    access_token: args.accessToken,
    refresh_token: args.refreshToken,
    token_type: args.tokenType ?? "Bearer",
    scope: args.scope ?? null,
    expires_at: new Date(now + Math.max(30, args.expiresIn - 30) * 1000).toISOString(),
    refresh_expires_at: args.refreshExpiresIn
      ? new Date(now + args.refreshExpiresIn * 1000).toISOString()
      : null,
    updated_at: new Date(now).toISOString(),
  };

  const { error } = await supabaseServer
    .from("broker_connections")
    .upsert(payload, { onConflict: "id" });

  if (error) throw new Error(`Unable to save Schwab tokens: ${error.message}`);

  tokenCache().set(userId, {
    value: {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_type: payload.token_type,
      scope: payload.scope,
      expires_at: payload.expires_at,
      refresh_expires_at: payload.refresh_expires_at,
      updated_at: payload.updated_at,
    },
    loadedAt: now,
  });
}

export async function clearSchwabTokens(userId: string) {
  if (!userId) throw new Error("Missing WheelDesk user id for Schwab connection.");

  const { error } = await supabaseServer
    .from("broker_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "schwab");

  if (error) throw new Error(`Unable to clear Schwab tokens: ${error.message}`);
  tokenCache().delete(userId);
}
