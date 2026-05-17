"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

export default function AuthStatusPill() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = getSupabaseAuthClient();
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
      Account
    </Link>
  );
}
