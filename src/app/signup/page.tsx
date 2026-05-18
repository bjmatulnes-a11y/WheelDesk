import { Suspense } from "react";
import Link from "next/link";
import AuthForm from "../../components/auth/AuthForm";

export default function SignupPage() {
  return (
    <main className="wd-auth-shell">
      <section className="wd-auth-card">
        <Link href="/" className="wd-auth-brand" aria-label="WheelDesk home">
          <span className="wd-auth-logo">W</span>
          <span>
            <strong>WheelDesk</strong>
            <small>Account Setup</small>
          </span>
        </Link>

        <div className="wd-auth-heading">
          <p>Account + plan access</p>
          <h1>Create your WheelDesk account.</h1>
          <span>After signup, choose a plan. The trading console unlocks after Stripe confirms an active subscription.</span>
        </div>

        <Suspense fallback={<p className="wd-auth-status">Loading signup…</p>}><AuthForm mode="signup" /></Suspense>
      </section>
    </main>
  );
}
