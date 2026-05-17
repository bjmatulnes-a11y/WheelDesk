import { Suspense } from "react";
import Link from "next/link";
import AuthForm from "../../components/auth/AuthForm";

export default function LoginPage() {
  return (
    <main className="wd-auth-shell">
      <section className="wd-auth-card">
        <Link href="/" className="wd-auth-brand" aria-label="WheelDesk home">
          <span className="wd-auth-logo">W</span>
          <span>
            <strong>WheelDesk</strong>
            <small>Options Control System</small>
          </span>
        </Link>

        <div className="wd-auth-heading">
          <p>Secure console access</p>
          <h1>Log in to WheelDesk.</h1>
          <span>Control Center, Validation, Portfolio, Scanner, and Wheel workspace now sit behind account access.</span>
        </div>

        <Suspense fallback={<p className="wd-auth-status">Loading login…</p>}><AuthForm mode="login" /></Suspense>
      </section>
    </main>
  );
}
