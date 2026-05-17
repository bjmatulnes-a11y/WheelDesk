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
            <small>Founding Access</small>
          </span>
        </Link>

        <div className="wd-auth-heading">
          <p>Founder cohort</p>
          <h1>Create your WheelDesk account.</h1>
          <span>Start with auth now. Billing gates and subscription entitlements are the next layer.</span>
        </div>

        <Suspense fallback={<p className="wd-auth-status">Loading signup…</p>}><AuthForm mode="signup" /></Suspense>
      </section>
    </main>
  );
}
