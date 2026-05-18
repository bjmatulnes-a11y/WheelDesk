"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

type AuthFormMode = "login" | "signup";

type AuthFormProps = {
  mode: AuthFormMode;
};

function cleanNext(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = useMemo(() => searchParams.get("plan") ?? "founder", [searchParams]);
  const next = useMemo(() => {
    const fallback = mode === "signup" ? `/pricing?plan=${encodeURIComponent(plan)}` : "/control-center";
    return cleanNext(searchParams.get("next"), fallback);
  }, [mode, plan, searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(mode === "signup" ? "Creating account…" : "Signing in…");

    try {
      const supabase = getSupabaseAuthClient();

      if (mode === "signup") {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              selected_plan: plan,
              product: "WheelDesk",
            },
          },
        });

        if (error) throw error;

        if (data.session) {
          router.replace(next);
        } else {
          setStatus("Account created. Confirm your email, then choose a plan to unlock WheelDesk.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMagicLink() {
    setBusy(true);
    setStatus("Sending magic link…");

    try {
      const supabase = getSupabaseAuthClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: mode === "signup",
        },
      });

      if (error) throw error;
      setStatus("Magic link sent. Open it on this device to continue to WheelDesk.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not send magic link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="wd-auth-form" onSubmit={handlePasswordSubmit}>
      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
      </label>

      <label>
        Password
        <input
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Minimum 6 characters"
          minLength={6}
          required
        />
      </label>

      <button type="submit" disabled={busy} className="wd-auth-primary">
        {busy ? "Working…" : mode === "signup" ? "Create WheelDesk account" : "Log in"}
      </button>

      <button type="button" disabled={busy || !email} onClick={handleMagicLink} className="wd-auth-secondary">
        Email me a magic link
      </button>

      {status ? <p className="wd-auth-status">{status}</p> : null}

      <div className="wd-auth-switch">
        {mode === "signup" ? (
          <span>
            Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
          </span>
        ) : (
          <span>
            New to WheelDesk? <Link href={`/signup?next=${encodeURIComponent(next)}&plan=${encodeURIComponent(plan)}`}>Create account</Link>
          </span>
        )}
      </div>
    </form>
  );
}
