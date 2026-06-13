"use client";

import { useMemo } from "react";
import {
  buildZeroDteAnalytics,
  ZeroDteChainRow,
} from "../../lib/zeroDteEngine";

const mockSpxRows: ZeroDteChainRow[] = [
  {
    symbol: "SPX",
    strike: 6040,
    optionType: "put",
    openInterest: 18500,
    oiChange: 3200,
    volume: 4800,
    gamma: 0.004,
    mid: 4.1,
  },
  {
    symbol: "SPX",
    strike: 6075,
    optionType: "put",
    openInterest: 26000,
    oiChange: 5100,
    volume: 8500,
    gamma: 0.008,
    mid: 11.4,
  },
  {
    symbol: "SPX",
    strike: 6100,
    optionType: "call",
    openInterest: 30000,
    oiChange: 6900,
    volume: 12500,
    gamma: 0.012,
    mid: 34.2,
  },
  {
    symbol: "SPX",
    strike: 6100,
    optionType: "put",
    openInterest: 29000,
    oiChange: 6400,
    volume: 11800,
    gamma: 0.012,
    mid: 31.8,
  },
  {
    symbol: "SPX",
    strike: 6125,
    optionType: "call",
    openInterest: 24000,
    oiChange: 4500,
    volume: 9100,
    gamma: 0.009,
    mid: 15.6,
  },
  {
    symbol: "SPX",
    strike: 6150,
    optionType: "call",
    openInterest: 33500,
    oiChange: 7100,
    volume: 7600,
    gamma: 0.006,
    mid: 6.2,
  },
];

const mockSpyRows: ZeroDteChainRow[] = [
  {
    symbol: "SPY",
    strike: 607,
    optionType: "put",
    openInterest: 94000,
    oiChange: 15000,
    volume: 58000,
    gamma: 0.006,
    mid: 1.1,
  },
  {
    symbol: "SPY",
    strike: 610,
    optionType: "call",
    openInterest: 140000,
    oiChange: 27000,
    volume: 76000,
    gamma: 0.009,
    mid: 3.2,
  },
  {
    symbol: "SPY",
    strike: 610,
    optionType: "put",
    openInterest: 132000,
    oiChange: 24000,
    volume: 72000,
    gamma: 0.009,
    mid: 3.0,
  },
  {
    symbol: "SPY",
    strike: 615,
    optionType: "call",
    openInterest: 160000,
    oiChange: 31000,
    volume: 65000,
    gamma: 0.005,
    mid: 0.9,
  },
];

export default function ZeroDtePage() {
  const spxPrice = 6102;
  const spyPrice = 610.2;

  const analytics = useMemo(() => {
    return buildZeroDteAnalytics({
      spxPrice,
      spyPrice,
      spxRows: mockSpxRows,
      spyRows: mockSpyRows,
    });
  }, []);

  const pinTone =
    analytics.pinScore >= 70
      ? "text-emerald-400"
      : analytics.pinScore <= 40
      ? "text-red-400"
      : "text-yellow-300";

  const pressureTone =
    analytics.dealerPressure > 25
      ? "text-emerald-400"
      : analytics.dealerPressure < -25
      ? "text-red-400"
      : "text-slate-300";

  return (
    <main className="min-h-screen bg-[#070b14] text-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-[0.3em] text-cyan-400">
            WheelDesk
          </div>
          <h1 className="text-3xl font-bold">0DTE Command Center</h1>
          <p className="max-w-3xl text-sm text-slate-400">
            SPX + SPY 0DTE positioning engine for iron fly placement,
            composite walls, pin probability, dealer pressure, and management
            triggers.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard title="SPX" value={fmt(analytics.spxPrice)} />
          <MetricCard title="SPY" value={fmt(analytics.spyPrice)} />
          <MetricCard
            title="Expected Move"
            value={`±${fmt(analytics.expectedMove)}`}
          />
          <MetricCard
            title="SPY Confirmation"
            value={analytics.spyConfirmation.toUpperCase()}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/80 p-5 shadow-lg shadow-cyan-950/20 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Iron Fly Setup</h2>
                <p className="text-sm text-slate-400">
                  Suggested center is adjusted by composite pin and dealer
                  pressure.
                </p>
              </div>
              <div className={`text-3xl font-bold ${pinTone}`}>
                {analytics.pinScore}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <SetupBox
                label="Lower Wing"
                value={fmt(analytics.lowerWing)}
                sub="Long put"
              />
              <SetupBox
                label="Center"
                value={fmt(analytics.suggestedCenter)}
                sub="Short call / short put"
                highlight
              />
              <SetupBox
                label="Upper Wing"
                value={fmt(analytics.upperWing)}
                sub="Long call"
              />
            </div>

            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">
                Structure
              </div>
              <div className="mt-1 text-lg font-semibold text-cyan-300">
                {fmt(analytics.lowerWing)} / {fmt(analytics.suggestedCenter)} /{" "}
                {fmt(analytics.upperWing)}
              </div>
              <div className="mt-2 text-sm text-slate-400">
                Wing width: ±{fmt(analytics.suggestedWingWidth)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
            <h2 className="text-xl font-semibold">Management</h2>
            <p className="mt-2 text-sm text-slate-400">
              Current management read based on distance from center, expected
              move consumed, and pin score.
            </p>
            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm leading-6 text-slate-200">
              {analytics.management}
            </div>
            <div className="mt-4 text-xs text-slate-500">
              Defensive trigger tightens when price consumes 50–75% of the
              expected move.
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard
            title="Composite Pin"
            value={analytics.compositePin ? fmt(analytics.compositePin) : "N/A"}
          />
          <MetricCard
            title="Put Wall"
            value={analytics.putWall ? fmt(analytics.putWall) : "N/A"}
          />
          <MetricCard
            title="Call Wall"
            value={analytics.callWall ? fmt(analytics.callWall) : "N/A"}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
            <h2 className="text-xl font-semibold">Dealer Pressure</h2>
            <div className={`mt-4 text-5xl font-bold ${pressureTone}`}>
              {analytics.dealerPressure > 0 ? "+" : ""}
              {analytics.dealerPressure}
            </div>
            <div className="mt-3 h-3 rounded-full bg-slate-800">
              <div
                className="h-3 rounded-full bg-cyan-400"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, analytics.dealerPressure + 100) / 2
                  )}%`,
                }}
              />
            </div>
            <p className="mt-4 text-sm text-slate-400">
              Negative pressure leans downside. Positive pressure leans upside.
              Near zero is usually better for iron fly pin behavior.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
            <h2 className="text-xl font-semibold">Pin / Trend Read</h2>
            <div className={`mt-4 text-5xl font-bold ${pinTone}`}>
              {analytics.pinScore}
            </div>
            <p className="mt-3 text-sm text-slate-400">
              Trend risk: {analytics.trendRisk}
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm leading-6 text-slate-200">
              {analytics.notes}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Composite SPX / SPY Levels
              </h2>
              <p className="text-sm text-slate-400">
                SPY strikes are converted into SPX-equivalent levels.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-400">
                  <th className="py-3 pr-4">Symbol</th>
                  <th className="py-3 pr-4">Type</th>
                  <th className="py-3 pr-4">Strike</th>
                  <th className="py-3 pr-4">OI</th>
                  <th className="py-3 pr-4">OI Δ</th>
                  <th className="py-3 pr-4">Volume</th>
                  <th className="py-3 pr-4">Gamma</th>
                  <th className="py-3 pr-4">Mid</th>
                </tr>
              </thead>
              <tbody>
                {analytics.combinedRows
                  .sort((a, b) => a.strike - b.strike)
                  .map((row, idx) => (
                    <tr
                      key={`${row.symbol}-${row.optionType}-${row.strike}-${idx}`}
                      className="border-b border-slate-900 text-slate-200"
                    >
                      <td className="py-3 pr-4 text-cyan-300">{row.symbol}</td>
                      <td className="py-3 pr-4 capitalize">{row.optionType}</td>
                      <td className="py-3 pr-4">{fmt(row.strike)}</td>
                      <td className="py-3 pr-4">{fmt(row.openInterest)}</td>
                      <td className="py-3 pr-4">{fmt(row.oiChange)}</td>
                      <td className="py-3 pr-4">{fmt(row.volume)}</td>
                      <td className="py-3 pr-4">{row.gamma ?? "—"}</td>
                      <td className="py-3 pr-4">{fmt(row.mid)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
      <div className="text-xs uppercase tracking-widest text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-100">{value}</div>
    </div>
  );
}

function SetupBox({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string | number;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-xl border border-cyan-400/40 bg-cyan-950/30 p-4"
          : "rounded-xl border border-slate-800 bg-slate-900/70 p-4"
      }
    >
      <div className="text-xs uppercase tracking-widest text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}