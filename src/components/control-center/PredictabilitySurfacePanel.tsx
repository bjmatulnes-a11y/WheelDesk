"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type PredictabilitySurfaceResult } from "../../lib/predictability-surface-engine";
import { colors, cardStyle } from "./styles";

type Props = {
  surface: PredictabilitySurfaceResult | null;
  maxDte: number;
  availableMaxDte: number;
  fullSurface: boolean;
  onMaxDteChange: (value: number) => void;
  onFullSurfaceChange: (value: boolean) => void;
};

const HEAT_STOPS: [number, number, number][] = [
  [11, 22, 34],
  [13, 70, 90],
  [34, 211, 238],
  [245, 158, 11],
  [251, 113, 133],
];

function heat(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (HEAT_STOPS.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = HEAT_STOPS[i];
  const b = HEAT_STOPS[Math.min(HEAT_STOPS.length - 1, i + 1)];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(
    a[1] + (b[1] - a[1]) * f,
  )},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

function bendColumn(
  pure: number[],
  priceLevels: number[],
  magnet: number,
  pinAlpha: number,
  sd: number,
  blend: number,
): number[] {
  const alpha = blend * pinAlpha;
  if (alpha <= 0) return pure;
  const safeSd = Math.max(sd, 1e-6);
  const bent = pure.map((d, i) => {
    const pull = Math.exp(-Math.abs(priceLevels[i] - magnet) / (safeSd * 0.9));
    return d * (1 - alpha) + d * pull * alpha * 2.2;
  });
  const total = bent.reduce((sum, value) => sum + value, 0) || 1;
  return bent.map((value) => value / total);
}

function money(v?: number | null, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return v.toFixed(v < 10 ? Math.max(dp, 2) : dp === 2 ? 2 : 0);
}

function ScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? colors.teal : colors.border}`,
        background: active ? "rgba(34, 211, 238, 0.16)" : colors.panel,
        color: active ? colors.teal : colors.muted,
        borderRadius: 999,
        padding: "0.35rem 0.62rem",
        fontSize: 11,
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export default function PredictabilitySurfacePanel({
  surface,
  maxDte,
  availableMaxDte,
  fullSurface,
  onMaxDteChange,
  onFullSurfaceChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [blendPct, setBlendPct] = useState<number>(
    Math.round((surface?.structureBlend ?? 0.65) * 100),
  );

  useEffect(() => {
    setBlendPct(Math.round((surface?.structureBlend ?? 0.65) * 100));
  }, [surface?.structureBlend]);

  const sliderMax = Math.max(30, Math.round(availableMaxDte || 30));
  const sliderValue = Math.max(7, Math.min(sliderMax, Math.round(maxDte || 30)));
  const blend = blendPct / 100;

  const live = useMemo(() => {
    if (!surface) return null;
    const { priceLevels, columns } = surface;
    const bentCols = columns.map((c) =>
      bendColumn(c.pure, priceLevels, c.magnet, c.pinAlpha, c.sd, blend),
    );
    const primary = columns[0];
    const primCol = bentCols[0] ?? [];
    if (!primary || !primCol.length) return null;

    const massAbove = (level: number) =>
      priceLevels.reduce((sum, K, i) => (K > level ? sum + primCol[i] : sum), 0);
    const massWithin = (center: number, pct: number) =>
      priceLevels.reduce(
        (sum, K, i) =>
          Math.abs(K - center) <= center * pct ? sum + primCol[i] : sum,
        0,
      );

    const callWall = surface.callWall ?? primary.magnet;
    const putWall = surface.putWall ?? primary.magnet;
    const rows = [
      {
        key: "above",
        label: `Close above call wall ${money(callWall)}`,
        prob: massAbove(callWall),
        color: colors.red,
      },
      {
        key: "below",
        label: `Close below put wall ${money(putWall)}`,
        prob: 1 - massAbove(putWall),
        color: colors.green,
      },
      {
        key: "pin",
        label: `Pin +/-2% of magnet ${money(primary.magnet)}`,
        prob: massWithin(primary.magnet, 0.02),
        color: colors.amber,
      },
    ];

    const sorted = priceLevels
      .map((K, i) => ({ K, d: primCol[i] }))
      .sort((a, b) => a.K - b.K);
    let acc = 0;
    let p16 = sorted[0]?.K ?? 0;
    for (const p of sorted) {
      acc += p.d;
      if (acc >= 0.16) {
        p16 = p.K;
        break;
      }
    }
    acc = 0;
    let p84 = sorted[sorted.length - 1]?.K ?? 0;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      acc += sorted[i].d;
      if (acc >= 0.16) {
        p84 = sorted[i].K;
        break;
      }
    }

    const modeIdx = primCol.indexOf(Math.max(...primCol));
    const modeK = priceLevels[modeIdx] ?? primary.magnet;
    const sd = primary.sd || 1;
    const agreement = Math.max(
      0,
      Math.min(1, 1 - Math.abs(primary.magnet - modeK) / (2 * sd)),
    );
    const score = Math.round(
      100 *
        (0.45 * surface.scoreParts.rndConcentration +
          0.3 * agreement +
          0.25 * surface.scoreParts.pinStability),
    );

    return { bentCols, rows, p16, p84, score };
  }, [surface, blend]);

  useEffect(() => {
    if (!surface || !live) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const W = Math.max(360, parent.getBoundingClientRect().width);
    const H = 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padL = 48;
    const padR = 12;
    const padT = 8;
    const padB = 24;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const { priceLevels, columns } = surface;
    const lo = priceLevels[0];
    const hi = priceLevels[priceLevels.length - 1];

    let maxD = 0;
    for (const col of live.bentCols) {
      for (const value of col) if (value > maxD) maxD = value;
    }
    maxD = maxD || 1;

    const cw = pw / Math.max(1, columns.length);
    const chh = ph / Math.max(1, priceLevels.length);
    for (let x = 0; x < live.bentCols.length; x += 1) {
      const col = live.bentCols[x];
      for (let y = 0; y < priceLevels.length; y += 1) {
        const yy = priceLevels.length - 1 - y;
        ctx.fillStyle = heat(Math.pow(col[y] / maxD, 0.6));
        ctx.fillRect(padL + x * cw, padT + yy * chh, cw + 0.6, chh + 0.6);
      }
    }

    const yOf = (K: number) => padT + ((hi - K) / (hi - lo)) * ph;
    const hline = (
      K: number | null,
      color: string,
      dash: number[],
      label: string,
    ) => {
      if (K == null || K < lo || K > hi) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(padL, yOf(K));
      ctx.lineTo(W - padR, yOf(K));
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = color;
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, padL + 4, yOf(K) - 3);
    };
    hline(surface.callWall, colors.red, [4, 3], "call wall");
    hline(surface.putWall, colors.green, [4, 3], "put wall");
    hline(surface.magnet, colors.amber, [], "magnet");
    hline(surface.currentPrice, colors.text, [2, 2], "spot");

    ctx.fillStyle = colors.muted;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    [hi, (hi + lo) / 2, lo].forEach((K) =>
      ctx.fillText(money(K, K < 10 ? 2 : 0), padL - 4, yOf(K) + 3),
    );
    ctx.textAlign = "center";
    columns.forEach((c, i) => {
      if (i % 4 === 0) ctx.fillText(`${c.dte}d`, padL + i * cw + cw / 2, H - 8);
    });
  }, [surface, live, blendPct]);

  const score = live?.score ?? surface?.predictabilityScore ?? 0;
  const scoreColor =
    score >= 70 ? colors.green : score >= 50 ? colors.amber : colors.red;
  const scoreLabel =
    score >= 70
      ? "High predictability"
      : score >= 50
        ? "Moderate"
        : "Low / structure unstable";

  const scopeLabel = fullSurface
    ? `Full surface${availableMaxDte ? ` / ${availableMaxDte}D max` : ""}`
    : `${sliderValue}D cap`;

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: colors.teal }}>Predictability Surface</h3>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            Research layer · default muted to 30D so LEAP/far-chain OI does not dominate.
          </div>
        </div>
        <div style={{ color: colors.muted, fontSize: 12 }}>
          Scope <strong style={{ color: colors.text }}>{scopeLabel}</strong>
          {surface ? (
            <>
              {" "}· built from {surface.includedChainCount} chain(s)
              {surface.omittedLongDteCount > 0 ? ` · muted ${surface.omittedLongDteCount}` : ""}
            </>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 12,
          alignItems: "center",
          margin: "0.85rem 0",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 6,
              color: colors.muted,
              fontSize: 12,
            }}
          >
            <span>DTE scope</span>
            <strong style={{ color: colors.text }}>{scopeLabel}</strong>
          </div>
          <input
            type="range"
            min={7}
            max={sliderMax}
            step={1}
            value={sliderValue}
            disabled={fullSurface}
            onChange={(event) => onMaxDteChange(Number(event.target.value))}
            style={{ width: "100%", opacity: fullSurface ? 0.45 : 1 }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: colors.muted,
              fontSize: 10,
              marginTop: 4,
            }}
          >
            <span>near chains</span>
            <span>full scale</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ScopeButton
            active={!fullSurface && sliderValue === 30}
            label="30D"
            onClick={() => {
              onFullSurfaceChange(false);
              onMaxDteChange(30);
            }}
          />
          <ScopeButton
            active={!fullSurface && sliderValue === 60}
            label="60D"
            onClick={() => {
              onFullSurfaceChange(false);
              onMaxDteChange(60);
            }}
          />
          <ScopeButton
            active={fullSurface}
            label="Full"
            onClick={() => onFullSurfaceChange(!fullSurface)}
          />
        </div>
      </div>

      {!surface ? (
        <div
          style={{
            border: `1px dashed ${colors.border}`,
            borderRadius: 12,
            padding: "1rem",
            color: colors.muted,
            background: colors.panel,
          }}
        >
          No usable predictability surface in the current DTE scope. Expand the DTE slider or
          use Full to inspect whether the signal only exists farther out.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "center",
              flexWrap: "wrap",
              margin: "0.75rem 0",
            }}
          >
            <div style={{ color: colors.muted, fontSize: 12 }}>
              68% range{" "}
              <strong style={{ color: colors.text }}>
                {money(live?.p16 ?? surface.expectedRangeLow)}–
                {money(live?.p84 ?? surface.expectedRangeHigh)}
              </strong>{" "}
              by {surface.primaryDte}d · bias{" "}
              <strong
                style={{
                  color:
                    surface.bias === "bullish"
                      ? colors.green
                      : surface.bias === "bearish"
                        ? colors.red
                        : colors.muted,
                }}
              >
                {surface.bias}
              </strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 260 }}>
              <label style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap" }}>
                Structure blend
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={blendPct}
                onChange={(e) => setBlendPct(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  minWidth: 36,
                  textAlign: "right",
                  color: colors.text,
                }}
              >
                {blendPct}%
              </span>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.55fr) minmax(0, 1fr)",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div>
              <div style={{ position: "relative", width: "100%", height: 320 }}>
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label="Probability heatmap of price over time, derived from the option chain risk-neutral density and gamma-OI pinning field"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginTop: 8,
                  fontSize: 11,
                  color: colors.muted,
                  flexWrap: "wrap",
                }}
              >
                <span>probability density</span>
                <span
                  style={{
                    display: "inline-flex",
                    height: 9,
                    width: 110,
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                    <span key={t} style={{ flex: 1, background: heat(t) }} />
                  ))}
                </span>
                <span>low → high</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  background: colors.panel2,
                  borderRadius: 12,
                  padding: 14,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <div style={{ fontSize: 12, color: colors.muted }}>
                  Predictability score
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 32, fontWeight: 900, color: colors.text }}>
                    {score}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>
                    {scoreLabel}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: colors.border,
                    borderRadius: 3,
                    marginTop: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${score}%`,
                      background: scoreColor,
                      borderRadius: 3,
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: colors.muted,
                    marginTop: 8,
                    lineHeight: 1.6,
                  }}
                >
                  RND concentration {Math.round(surface.scoreParts.rndConcentration * 100)}% · OI–market
                  agreement {Math.round(surface.scoreParts.oiAgreement * 100)}% · gamma pin stability{" "}
                  {Math.round(surface.scoreParts.pinStability * 100)}%
                </div>
              </div>

              {(live?.rows ?? []).map((row) => (
                <div
                  key={row.key}
                  style={{
                    background: colors.panel,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 12,
                      color: colors.muted,
                    }}
                  >
                    <span>{row.label}</span>
                    <span style={{ fontWeight: 900, color: row.color, fontSize: 14 }}>
                      {Math.round(row.prob * 100)}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      background: colors.border,
                      borderRadius: 3,
                      marginTop: 5,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round(row.prob * 100)}%`,
                        background: row.color,
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p style={{ margin: "0.85rem 0 0", color: colors.muted, fontSize: 12 }}>
            {surface.notes[surface.notes.length - 1]}
          </p>
        </>
      )}
    </section>
  );
}
