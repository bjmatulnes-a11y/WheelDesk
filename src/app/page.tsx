import ProductTourScreenshots from "../components/marketing/ProductTourScreenshots";

const pricingPlans = [
  {
    name: "Founder",
    price: "$49",
    note: "limited early access",
    bullets: ["10 tracked tickers", "OI Field v2", "Chart Room", "Validation beta", "Mobile/PWA access"],
  },
  {
    name: "Core",
    price: "$79",
    note: "daily options control room",
    bullets: ["15 tracked tickers", "Watchlist Command", "Forecast capture", "Wheel Workspace", "Portfolio risk console"],
  },
  {
    name: "Research",
    price: "$129",
    note: "advanced validation and NN path",
    bullets: ["30 tracked tickers", "Forecast divergence", "Multi-horizon receipts", "NN-ready capture", "Priority research features"],
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#020b12] text-white">
      <section className="relative overflow-hidden border-b border-cyan-400/10 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.20),transparent_32%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.18),transparent_38%)]">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3 font-black tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-cyan-300/60 bg-cyan-500/10 text-cyan-200">W</span>
            <span className="text-xl">WheelDesk</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-bold text-slate-300 md:flex">
            <a href="#product-tour" className="hover:text-cyan-200">Product</a>
            <a href="#validation" className="hover:text-cyan-200">Validation</a>
            <a href="#pricing" className="hover:text-cyan-200">Pricing</a>
            <a href="/faq" className="hover:text-cyan-200">FAQ</a>
            <a href="/about" className="hover:text-cyan-200">About</a>
            <a href="/contact" className="hover:text-cyan-200">Contact</a>
          </div>
          <div className="flex items-center gap-3">
            <a href="/login" className="rounded-xl border border-cyan-300/25 px-4 py-2 text-sm font-black text-slate-100 hover:border-cyan-300/60">
              Log in
            </a>
            <a href="/pricing" className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-cyan-200">
              View plans
            </a>
          </div>
        </nav>

        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-28">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.32em] text-emerald-300">
              Built for premium sellers and OI-driven operators
            </p>
            <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.96] tracking-tight sm:text-7xl">
              Turn the options chain into a forecastable market-structure map.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              WheelDesk combines tracked ticker slots, OI surface snapshots, OI Field forecasts, forecast divergence,
              validation receipts, and wheel/portfolio context into one daily trading control room.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/pricing" className="rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-black text-slate-950 shadow-xl shadow-cyan-950/30 hover:bg-cyan-200">
                View plans
              </a>
              <a href="/login" className="rounded-2xl border border-slate-500/60 px-6 py-3 text-sm font-black text-slate-100 hover:border-cyan-300/60">
                Log in
              </a>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Supabase-first", "OI Field v2", "Forecast receipts"].map((item) => (
                <div key={item} className="rounded-2xl border border-cyan-400/15 bg-slate-950/60 p-4">
                  <p className="text-xs text-slate-400">Signal layer</p>
                  <p className="mt-1 font-black text-white">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/75 p-3 shadow-2xl shadow-cyan-950/30">
            <div className="flex items-center gap-2 border-b border-cyan-400/10 px-4 py-3 text-xs font-black uppercase tracking-[0.22em] text-slate-400">
              <span className="h-3 w-3 rounded-full bg-cyan-300" />
              <span className="h-3 w-3 rounded-full bg-emerald-300" />
              <span className="h-3 w-3 rounded-full bg-rose-300" />
              <span className="ml-3">WheelDesk Chart Room</span>
            </div>
            <img
              src="/marketing/wheeldesk/chart-room.webp"
              alt="WheelDesk Chart Room with OI Field v2 forecast cone and forecast divergence overlay"
              className="w-full rounded-b-[1.5rem] border-x border-b border-slate-700/50"
              loading="eager"
            />
          </div>
        </div>
      </section>

      <ProductTourScreenshots />

      <section id="validation" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 rounded-3xl border border-emerald-400/20 bg-emerald-400/5 p-6 lg:grid-cols-[0.9fr_1.1fr] lg:p-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">Validation receipts</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">Most tools show signals. WheelDesk stores receipts.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Forecast capture is designed for a neural-ready dataset: baseline OI Field forecast, feature vector, capture session,
              actual outcomes, divergence, and model status. The goal is to evolve from deterministic OI structure to NN-adjusted forecasts.
            </p>
          </div>
          <img
            src="/marketing/wheeldesk/validation.webp"
            alt="WheelDesk validation proof records showing adjusted proof and no-lookahead checks"
            className="h-auto w-full rounded-2xl border border-slate-700/60"
            loading="lazy"
          />
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mb-10 max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Founder pricing</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">Tracked ticker slots, not unlimited noise.</h2>
          <p className="mt-4 text-slate-300">
            WheelDesk monitors a finite ticker universe so forecasts, receipts, and future neural training stay clean and scalable.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {pricingPlans.map((plan) => (
            <article key={plan.name} className="rounded-3xl border border-cyan-400/20 bg-slate-950/70 p-6">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">{plan.name}</p>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-5xl font-black">{plan.price}</span>
                <span className="pb-2 text-slate-400">/ month</span>
              </div>
              <p className="mt-2 text-sm font-bold text-slate-300">{plan.note}</p>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                {plan.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-3">
                    <span className="text-cyan-300">✓</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <a href="/pricing" className="mt-8 block rounded-2xl border border-cyan-400/30 px-5 py-3 text-center text-sm font-black text-cyan-100 hover:bg-cyan-400/10">
                Choose {plan.name}
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
