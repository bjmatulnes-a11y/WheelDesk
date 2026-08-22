"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";
import { isWheelDeskAdmin } from "../../lib/auth/application-role";

export default function AuthStatusPill() {
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseAuthClient();
    let mounted = true;

    async function applyUser(nextUser: User | null) {
      if (!mounted) return;
      setUser(nextUser);
      setAdmin(false);

      if (!nextUser) return;

      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", nextUser.id)
        .maybeSingle();

      if (mounted) setAdmin(isWheelDeskAdmin(roleRow?.role));
    }

    void supabase.auth.getUser().then(({ data }) => applyUser(data.user ?? null));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void applyUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!user) {
    return (
      <Link className="wd-auth-nav-link" href="/login">
        Login
      </Link>
    );
  }

  return (
    <Link className="wd-auth-nav-link" href="/account" title={user.email ?? "WheelDesk account"}>
      {admin ? "Admin" : "Account"}
    </Link>
  );
}
