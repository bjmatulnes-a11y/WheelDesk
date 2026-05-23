"use client";

import { useEffect, useMemo, useState } from "react";

const SLIDES = [
  {
    label: "Chart Room",
    caption: "OI Field v2 forecast cone, captured path, and structure rails.",
    src: "/marketing/wheeldesk/chart-room.webp",
  },
  {
    label: "Dashboard",
    caption: "Central ticker universe, forecast harvest, and neural status.",
    src: "/marketing/wheeldesk/dashboard.webp",
  },
  {
    label: "Control Center",
    caption: "Surface date, expiration chain, OI walls, and trader edge context.",
    src: "/marketing/wheeldesk/control-center.webp",
  },
  {
    label: "Validation",
    caption: "Proof records, matured setups, and adjusted validation receipts.",
    src: "/marketing/wheeldesk/validation.webp",
  },
  {
    label: "Wheel Workspace",
    caption: "Premium-seller posture from OI, portfolio, and wheel context.",
    src: "/marketing/wheeldesk/wheel-workspace.webp",
  },
];

export default function HeroProductFrame() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const slide = SLIDES[active] ?? SLIDES[0];

  const dots = useMemo(() => SLIDES.map((item) => item.label), []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % SLIDES.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <section
      className="relative mx-auto w-full max-w-[680px] overflow-hidden rounded-[28px] border border-cyan-400/20 bg-[#06131f]/95 shadow-2xl shadow-cyan-950/40"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="WheelDesk product preview"
    >
      <div className="flex items-center justify-between border-b border-cyan-400/10 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        </div>
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-300">
          WheelDesk Operator Console
        </div>
      </div>

      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
              Control State
            </div>
            <div className="mt-2 text-sm font-black text-white sm:text-base">Forecast Ready</div>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
              OI Field
            </div>
            <div className="mt-2 text-sm font-black text-white sm:text-base">30D Cone</div>
          </div>
          <div className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">
              Validation
            </div>
            <div className="mt-2 text-sm font-black text-white sm:text-base">Receipts</div>
          </div>
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
              Risk Mode
            </div>
            <div className="mt-2 text-sm font-black text-white sm:text-base">Manage</div>
          </div>
        </div>

        {/* Keep this media well close to the original cartoon chart footprint. */}
        <div className="relative overflow-hidden rounded-2xl border border-cyan-400/15 bg-[#030b14]">
          <div className="absolute left-4 top-4 z-10 rounded-xl border border-cyan-400/20 bg-[#041321]/90 px-3 py-2 backdrop-blur">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
              {slide.label}
            </div>
            <div className="mt-1 max-w-[320px] text-xs leading-snug text-slate-300">{slide.caption}</div>
          </div>

          <div className="flex h-[250px] items-center justify-center sm:h-[310px] lg:h-[355px]">
            <img
              key={slide.src}
              src={slide.src}
              alt={`${slide.label} screenshot`}
              className="h-full w-full object-contain p-2 opacity-95 transition-opacity duration-500"
              loading="eager"
              draggable={false}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 pb-1">
          {dots.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-label={`Show ${label}`}
              onClick={() => setActive(index)}
              className={`h-2.5 rounded-full transition-all ${
                index === active ? "w-8 bg-cyan-300" : "w-2.5 bg-slate-600 hover:bg-slate-400"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
