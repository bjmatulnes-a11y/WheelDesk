"use client";

import { useEffect, type ReactNode } from "react";

export type ExpandedChartModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export default function ExpandedChartModal({
  open,
  title,
  subtitle,
  meta,
  children,
  onClose,
}: ExpandedChartModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        background:
          "radial-gradient(circle at top left, rgba(34, 211, 238, 0.18), transparent 34%), rgba(1, 8, 16, 0.96)",
        backdropFilter: "blur(16px)",
        color: "#e5f6ff",
        padding: "max(0.8rem, env(safe-area-inset-top)) 0.8rem max(0.8rem, env(safe-area-inset-bottom))",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "0.35rem 0.25rem 0.8rem",
          maxWidth: 1500,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: "#22d3ee",
              fontSize: 12,
              fontWeight: 950,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Expanded Chart View
          </div>
          <h2 style={{ margin: 0, fontSize: "clamp(1.25rem, 3vw, 2rem)", lineHeight: 1.08 }}>
            {title}
          </h2>
          {subtitle ? (
            <p style={{ margin: "0.35rem 0 0", color: "#9fb2c8", lineHeight: 1.35, maxWidth: 900 }}>
              {subtitle}
            </p>
          ) : null}
          {meta ? <div style={{ marginTop: "0.55rem" }}>{meta}</div> : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close expanded chart"
          style={{
            border: "1px solid rgba(148, 163, 184, 0.28)",
            background: "rgba(15, 23, 42, 0.82)",
            color: "#e5f6ff",
            borderRadius: 999,
            padding: "0.62rem 0.9rem",
            fontWeight: 950,
            cursor: "pointer",
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
          }}
        >
          Close ×
        </button>
      </header>

      <div
        style={{
          minHeight: 0,
          overflow: "auto",
          width: "100%",
        }}
      >
        <div
          style={{
            maxWidth: 1500,
            width: "100%",
            margin: "0 auto",
            minHeight: 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
