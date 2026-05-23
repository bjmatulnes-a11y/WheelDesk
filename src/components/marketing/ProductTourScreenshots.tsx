import Image from "next/image";

const productTourScreens = [
  {
    title: "Dashboard Command Hub",
    eyebrow: "Central ticker universe",
    description:
      "Manage tracked ticker slots, harvest surfaces, capture forecasts, and monitor neural-readiness from one command hub.",
    image: "/marketing/wheeldesk/dashboard.webp",
  },
  {
    title: "Control Center",
    eyebrow: "OI structure read",
    description:
      "Convert the selected surface and expiration chain into support, magnet, resistance, dealer pressure, and Trader Edge context.",
    image: "/marketing/wheeldesk/control-center.webp",
  },
  {
    title: "Chart Room",
    eyebrow: "Forecast cone",
    description:
      "Visualize the OI Field v2 forecast cone, field rails, captured forecast path, and divergence overlay on a full-size chart.",
    image: "/marketing/wheeldesk/chart-room.webp",
  },
  {
    title: "Validation",
    eyebrow: "Receipts layer",
    description:
      "Track saved OI surfaces and proof records so the edge can be measured instead of merely claimed.",
    image: "/marketing/wheeldesk/validation.webp",
  },
  {
    title: "Full Watchlist",
    eyebrow: "Daily triage",
    description:
      "Rank tracked tickers by action, watch, avoid, trap risk, OI field coverage, and forecast readiness.",
    image: "/marketing/wheeldesk/watchlist.webp",
  },
  {
    title: "Wheel Workspace",
    eyebrow: "Premium posture",
    description:
      "Align wheel and covered-call decisions with selected Supabase surfaces, expiration context, and portfolio exposure.",
    image: "/marketing/wheeldesk/wheel-workspace.webp",
  },
  {
    title: "Portfolio Risk Console",
    eyebrow: "Position context",
    description:
      "Track position inventory, greeks, basis, cash capacity, expiration ladder, and risk posture alongside the structure read.",
    image: "/marketing/wheeldesk/portfolio.webp",
  },
];

export default function ProductTourScreenshots() {
  return (
    <section className="mx-auto w-full max-w-7xl px-6 py-20 sm:px-8 lg:px-10">
      <div className="mb-10 max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
          Product tour
        </p>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-50 sm:text-5xl">
          From option surface to forecast receipt.
        </h2>
        <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
          WheelDesk connects the daily trading workflow: tracked ticker slots,
          OI Field forecasts, chart-room structure, forecast capture, validation,
          and portfolio-aware wheel management.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {productTourScreens.map((screen, index) => (
          <article
            key={screen.title}
            className="overflow-hidden rounded-3xl border border-cyan-400/15 bg-slate-950/70 shadow-2xl shadow-cyan-950/20"
          >
            <div className="border-b border-cyan-400/10 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-300">
                    {String(index + 1).padStart(2, "0")} · {screen.eyebrow}
                  </p>
                  <h3 className="mt-1 text-xl font-black text-slate-50">
                    {screen.title}
                  </h3>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {screen.description}
              </p>
            </div>

            <div className="relative aspect-[16/9] w-full bg-slate-950">
              <Image
                src={screen.image}
                alt={`${screen.title} screenshot`}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover object-top"
                priority={index < 2}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
