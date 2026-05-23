"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

const SLIDES = [
  { label: "Chart Room", src: "/marketing/wheeldesk/chart-room.webp" },
  { label: "Dashboard", src: "/marketing/wheeldesk/dashboard.webp" },
  { label: "Control Center", src: "/marketing/wheeldesk/control-center.webp" },
  { label: "Validation", src: "/marketing/wheeldesk/validation.webp" },
  { label: "Wheel Workspace", src: "/marketing/wheeldesk/wheel-workspace.webp" },
];

const frameStyle: CSSProperties = {
  width: "100%",
  maxWidth: 680,
  margin: "0 auto",
  overflow: "hidden",
  borderRadius: 28,
  border: "1px solid rgba(34, 211, 238, 0.22)",
  background: "rgba(6, 19, 31, 0.96)",
  boxShadow: "0 32px 80px rgba(8, 145, 178, 0.12)",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "12px 18px",
  borderBottom: "1px solid rgba(34, 211, 238, 0.12)",
  background: "rgba(3, 10, 18, 0.42)",
};

const dotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  display: "inline-block",
};

const labelStyle: CSSProperties = {
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

const mediaShellStyle: CSSProperties = {
  padding: 14,
};

const mediaStyle: CSSProperties = {
  height: "clamp(250px, 31vw, 355px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  borderRadius: 20,
  border: "1px solid rgba(34, 211, 238, 0.16)",
  background: "#030b14",
};

const imageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  padding: 8,
  opacity: 0.96,
};

const navStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: 8,
  padding: "0 0 12px",
};

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
      style={frameStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="WheelDesk product preview"
    >
      <div style={topBarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} aria-hidden="true">
          <span style={{ ...dotStyle, background: "#22d3ee" }} />
          <span style={{ ...dotStyle, background: "#34d399" }} />
          <span style={{ ...dotStyle, background: "#fb7185" }} />
        </div>
        <div style={labelStyle}>{slide.label}</div>
      </div>

      <div style={mediaShellStyle}>
        <div style={mediaStyle}>
          <img
            key={slide.src}
            src={slide.src}
            alt={`${slide.label} screenshot`}
            style={imageStyle}
            loading="eager"
            draggable={false}
          />
        </div>
      </div>

      <div style={navStyle}>
        {dots.map((label, index) => {
          const isActive = index === active;
          return (
            <button
              key={label}
              type="button"
              aria-label={`Show ${label}`}
              onClick={() => setActive(index)}
              style={{
                width: isActive ? 32 : 10,
                height: 10,
                borderRadius: 999,
                border: 0,
                cursor: "pointer",
                background: isActive ? "#67e8f9" : "#475569",
                transition: "all 180ms ease",
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
