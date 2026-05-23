"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

const HERO_FRAMES = [
  {
    label: "Chart Room",
    title: "OI Field v2 forecast cone",
    caption: "30D base path, upper/lower field rails, and captured forecast divergence.",
    src: "/marketing/wheeldesk/chart-room.webp",
  },
  {
    label: "Dashboard",
    title: "Central ticker universe",
    caption: "Locked ticker slots, central harvest, forecast readiness, and neural status.",
    src: "/marketing/wheeldesk/dashboard.webp",
  },
  {
    label: "Control Center",
    title: "Daily structure read",
    caption: "OI surfaces, dealer pressure, wall migration, and action-state context.",
    src: "/marketing/wheeldesk/control-center.webp",
  },
  {
    label: "Validation",
    title: "Forecast receipts",
    caption: "Stored reads mature into proof records across forecast horizons.",
    src: "/marketing/wheeldesk/validation.webp",
  },
  {
    label: "Wheel Workspace",
    title: "Premium-seller posture",
    caption: "Connect the OI field to CSP, covered-call, and repair decisions.",
    src: "/marketing/wheeldesk/wheel-workspace.webp",
  },
];

export default function HeroProductFrame() {
  const frames = useMemo(() => HERO_FRAMES, []);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || frames.length <= 1) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % frames.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [paused, frames.length]);

  const frame = frames[active];

  return (
    <section
      className="relative overflow-hidden rounded-[2rem] border border-cyan-400/20 bg-slate-950/70 shadow-2xl shadow-cyan-950/30"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="WheelDesk product preview"
    >
      <div className="flex items-center justify-between border-b border-cyan-400/10 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        </div>
        <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">
          WheelDesk live workspace
        </div>
      </div>

      <div className="relative aspect-[16/9] bg-slate-950">
        {frames.map((item, index) => (
          <Image
            key={item.src}
            src={item.src}
            alt={`${item.label}: ${item.title}`}
            fill
            priority={index === 0}
            sizes="(min-width: 1024px) 720px, 100vw"
            className={`object-cover transition-opacity duration-700 ${
              index === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-5">
          <div className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.22em] text-cyan-200">
            {frame.label}
          </div>
          <h3 className="mt-3 text-2xl font-black text-white">{frame.title}</h3>
          <p className="mt-1 max-w-xl text-sm text-slate-300">{frame.caption}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex gap-2">
          {frames.map((item, index) => (
            <button
              key={item.src}
              type="button"
              aria-label={`Show ${item.label}`}
              onClick={() => setActive(index)}
              className={`h-2.5 rounded-full transition-all ${
                index === active
                  ? "w-8 bg-cyan-300"
                  : "w-2.5 bg-slate-600 hover:bg-slate-400"
              }`}
            />
          ))}
        </div>
        <div className="text-xs font-semibold text-slate-400">
          {paused ? "Paused" : "Auto-refreshing preview"}
        </div>
      </div>
    </section>
  );
}
