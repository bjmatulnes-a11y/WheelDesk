import { supabaseServer } from "../supabase-server";
import type { SchwabTokenRecord } from "./types";

const ROW_ID = "primary";

export async function loadSchwabTokens(): Promise<SchwabTokenRecord | null> {
  const { data, error } = await supabaseServer
    .from("broker_connections")
    .select("access_token,refresh_token,token_type,scope,expires_at,refresh_expires_at,updated_at")
    .eq("id", ROW_ID)
    .eq("provider", "schwab")
    .maybeSingle();

  if (error) throw new Error(`Unable to load Schwab tokens: ${error.message}`);
  return data as SchwabTokenRecord | null;
}

export async function saveSchwabTokens(args: {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  scope?: string | null;
  expiresIn: number;
  refreshExpiresIn?: number | null;
}) {
  const now = Date.now();
  const payload = {
    id: ROW_ID,
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
}

export async function clearSchwabTokens() {
  const { error } = await supabaseServer
    .from("broker_connections")
    .delete()
    .eq("id", ROW_ID)
    .eq("provider", "schwab");

  if (error) throw new Error(`Unable to clear Schwab tokens: ${error.message}`);
}
