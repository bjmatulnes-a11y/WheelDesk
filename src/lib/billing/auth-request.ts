import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "../supabase-server";

export async function getAuthenticatedUserFromRequest(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new Error("Missing bearer token");
  }

  const { data, error } = await supabaseServer.auth.getUser(token);

  if (error || !data.user) {
    throw new Error(error?.message || "Invalid session");
  }

  return data.user;
}
