"use client";

import { getSupabaseAuthClient } from "./supabase-auth-client";

export async function authenticatedApiHeaders(
  extra: HeadersInit = {},
): Promise<Headers> {
  const { data } = await getSupabaseAuthClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("WheelDesk login session is not ready. Refresh or sign in again.");
  }

  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
