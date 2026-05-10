"use client";

import type { ReactNode } from "react";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cx(
        "min-h-screen bg-[#050816] text-slate-100",
        "bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_28%),linear-gradient(180deg,#050816_0%,#08111f_45%,#030712_100%)]",
        className
      )}
    >
      <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  right,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl",
        "lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
            {eyebrow}
          </div>
        ) : null}

        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>

        {description ? (
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
            {description}
          </p>
        ) : null}
      </div>

      {right ? <div className="shrink-0">{right}</div> : null}
    </section>
  );
}

export function SectionGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "grid grid-cols-1 gap-4 xl:grid-cols-12",
        className
      )}
    >
      {children}
    </section>
  );
}

export function Panel({
  children,
  title,
  description,
  right,
  className,
  bodyClassName,
}: {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-3xl border border-white/10 bg-slate-950/55 shadow-xl shadow-black/25 backdrop-blur-xl",
        className
      )}
    >
      {(title || description || right) && (
        <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title ? (
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-100">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm leading-5 text-slate-400">
                {description}
              </p>
            ) : null}
          </div>

          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      )}

      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  subvalue,
  tone = "neutral",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  subvalue?: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "info";
  className?: string;
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-400/25 bg-emerald-400/[0.07]"
      : tone === "bad"
      ? "border-rose-400/25 bg-rose-400/[0.07]"
      : tone === "warn"
      ? "border-amber-400/25 bg-amber-400/[0.07]"
      : tone === "info"
      ? "border-cyan-400/25 bg-cyan-400/[0.07]"
      : "border-white/10 bg-white/[0.045]";

  return (
    <div
      className={cx(
        "rounded-2xl border p-4 shadow-lg shadow-black/20",
        toneClass,
        className
      )}
    >
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
        {value}
      </div>
      {subvalue ? (
        <div className="mt-1 text-xs leading-5 text-slate-400">{subvalue}</div>
      ) : null}
    </div>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "info";
  className?: string;
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone === "bad"
      ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
      : tone === "warn"
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : tone === "info"
      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
      : "border-white/10 bg-white/5 text-slate-300";

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClass,
        className
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: ReactNode;
}) {
  const pct =
    max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;

  return (
    <div>
      {label ? (
        <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
      ) : null}
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.45)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center">
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      {description ? (
        <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      {children}
    </div>
  );
}