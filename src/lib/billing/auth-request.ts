import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "../supabase-server";

// High-frequency live panels (ES order flow, execution monitoring, etc.) send
// the same Supabase access token repeatedly. Verifying that token against the
// hosted Auth service on every 1-second poll creates unnecessary Supabase
// traffic. Cache a successful verification briefly in server memory instead.
//
// Security properties:
// - raw bearer tokens are never retained as cache keys (SHA-256 only)
// - failures are never cached
// - the cache expires quickly and is process-local only
// - a new/rotated access token gets a different key immediately
const AUTH_USER_CACHE_MS = 2 * 60_000;
const AUTH_USER_CACHE_MAX = 500;

type CachedUser = {
  user: User;
  expiresAt: number;
};

const globalAuthCache = globalThis as typeof globalThis & {
  __wheelDeskAuthUserCache?: Map<string, CachedUser>;
  __wheelDeskAuthUserLoads?: Map<string, Promise<User>>;
};

function userCache() {
  return (globalAuthCache.__wheelDeskAuthUserCache ??= new Map<string, CachedUser>());
}

function userLoads() {
  return (globalAuthCache.__wheelDeskAuthUserLoads ??= new Map<string, Promise<User>>());
}

function tokenKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function pruneCache(now: number) {
  const cache = userCache();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size <= AUTH_USER_CACHE_MAX) return;
  const overflow = cache.size - AUTH_USER_CACHE_MAX;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function getAuthenticatedUserFromRequest(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new Error("Missing bearer token");
  }

  const key = tokenKey(token);
  const now = Date.now();
  const cached = userCache().get(key);
  if (cached && cached.expiresAt > now) return cached.user;

  const pending = userLoads().get(key);
  if (pending) return pending;

  const load = (async () => {
    const { data, error } = await supabaseServer.auth.getUser(token);
    if (error || !data.user) {
      throw new Error(error?.message || "Invalid session");
    }
    pruneCache(Date.now());
    userCache().set(key, {
      user: data.user,
      expiresAt: Date.now() + AUTH_USER_CACHE_MS,
    });
    return data.user;
  })();

  userLoads().set(key, load);
  try {
    return await load;
  } finally {
    if (userLoads().get(key) === load) userLoads().delete(key);
  }
}
