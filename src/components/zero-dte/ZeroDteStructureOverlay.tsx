"use client";

import { useEffect } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type {
  StructureAnchor,
  StructureAnchorConfluence,
  ZeroDteStructureSnapshot,
} from "../../lib/zeroDteStructureMap";
import { buildStructureAnchorConfluence } from "../../lib/zeroDteStructureMap";
import type { ZeroDteOverlaySettings } from "./ZeroDteOverlayControls";

const COLORS = {
  bull: "#14D990",
  bear: "#F24968",
  neutral: "#94a3b8",
  text: "#e5eefb",
  fib: "#a78bfa",
};

function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, style);
  if (text != null) el.textContent = text;
  return el;
}

function px(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}

function inBounds(value: number | null, max: number): value is number {
  return value != null && Number.isFinite(value) && value >= -100 && value <= max + 100;
}

export function ZeroDteStructureOverlay(props: {
  container: HTMLElement | null;
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  snapshot: ZeroDteStructureSnapshot | null;
  settings: ZeroDteOverlaySettings;
  anchors?: readonly StructureAnchor[];
  confluenceTolerancePoints?: number;
}) {
  const {
    container,
    chart,
    series,
    snapshot,
    settings,
    anchors = [],
    confluenceTolerancePoints = 1.5,
  } = props;

  useEffect(() => {
    if (!container || !chart || !series || !snapshot || !settings.enabled) return;

    const priorPosition = container.style.position;
    if (!priorPosition || priorPosition === "static") container.style.position = "relative";

    const root = div({
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "6",
      overflow: "hidden",
    });
    root.dataset.wdStructureOverlay = "1";
    container.appendChild(root);

    const ts = chart.timeScale();
    const render = () => {
      root.replaceChildren();
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 10 || height <= 10) return;

      const x = (time: number) => ts.timeToCoordinate(time as UTCTimestamp);
      const y = (price: number) => series.priceToCoordinate(price);
      const rightNowX = snapshot.generatedAt ? x(snapshot.generatedAt) : null;
      const rightEdge = inBounds(rightNowX, width) ? Math.max(rightNowX, width - 62) : width - 62;

      const drawBox = (args: {
        startTime: number;
        endTime?: number | null;
        low: number;
        high: number;
        direction: "BULL" | "BEAR";
        opacity: number;
        label?: string;
        dashed?: boolean;
      }) => {
        const x1 = x(args.startTime);
        const x2 = args.endTime ? x(args.endTime) : rightEdge;
        const yTop = y(args.high);
        const yBottom = y(args.low);
        if (!inBounds(x1, width) || !inBounds(x2, width) || !inBounds(yTop, height) || !inBounds(yBottom, height)) return;
        const left = Math.min(x1, x2);
        const top = Math.min(yTop, yBottom);
        const boxWidth = Math.max(2, Math.abs(x2 - x1));
        const boxHeight = Math.max(2, Math.abs(yBottom - yTop));
        const color = args.direction === "BULL" ? COLORS.bull : COLORS.bear;
        const el = div({
          position: "absolute",
          left: px(left),
          top: px(top),
          width: px(boxWidth),
          height: px(boxHeight),
          background: args.direction === "BULL"
            ? `rgba(20,217,144,${args.opacity})`
            : `rgba(242,73,104,${args.opacity})`,
          border: `1px ${args.dashed ? "dashed" : "solid"} ${color}`,
          borderRadius: "2px",
          boxSizing: "border-box",
        });
        root.appendChild(el);
        if (args.label && boxWidth > 44) {
          const label = div({
            position: "absolute",
            left: px(left + 4),
            top: px(top + 2),
            fontSize: "9px",
            fontWeight: "700",
            letterSpacing: ".03em",
            color,
            textShadow: "0 1px 2px rgba(0,0,0,.9)",
            whiteSpace: "nowrap",
          }, args.label);
          root.appendChild(label);
        }
      };

      if (settings.fvgs) {
        for (const fvg of snapshot.fvgs.filter((item) => !item.mitigated).slice(-8)) {
          drawBox({
            startTime: fvg.startedAt,
            low: fvg.low,
            high: fvg.high,
            direction: fvg.direction,
            opacity: 0.10,
            label: `${fvg.direction === "BULL" ? "BULL" : "BEAR"} FVG`,
            dashed: true,
          });
        }
      }

      if (settings.reactionZones) {
        for (const zone of snapshot.reactionZones.filter((item) => !item.mitigated).slice(-6)) {
          drawBox({
            startTime: zone.startedAt,
            low: zone.low,
            high: zone.high,
            direction: zone.direction,
            opacity: Math.min(0.18, 0.06 + zone.strength / 1000),
            label: `REACTION ${Math.round(zone.strength)}`,
          });
          const yy = y(zone.mid);
          const xx = x(zone.startedAt);
          if (inBounds(yy, height) && inBounds(xx, width)) {
            root.appendChild(div({
              position: "absolute",
              left: px(xx),
              top: px(yy),
              width: px(Math.max(8, rightEdge - xx)),
              borderTop: `1px dotted ${COLORS.neutral}`,
              opacity: ".5",
            }));
          }
        }
      }

      const visibleBreaks = snapshot.breaks.filter((event) =>
        event.scale === "EXTERNAL" ? settings.externalStructure : settings.internalStructure,
      );
      for (const event of visibleBreaks.slice(-12)) {
        const x1 = x(event.swingTime);
        const x2 = x(event.breakTime);
        const yy = y(event.level);
        if (!inBounds(x1, width) || !inBounds(x2, width) || !inBounds(yy, height)) continue;
        const color = event.direction === "BULL" ? COLORS.bull : COLORS.bear;
        const line = div({
          position: "absolute",
          left: px(Math.min(x1, x2)),
          top: px(yy),
          width: px(Math.max(2, Math.abs(x2 - x1))),
          borderTop: `${event.scale === "EXTERNAL" ? 2 : 1}px ${event.kind === "CHOCH" ? "solid" : "dashed"} ${color}`,
          opacity: event.scale === "EXTERNAL" ? ".9" : ".58",
        });
        root.appendChild(line);
        root.appendChild(div({
          position: "absolute",
          left: px(Math.min(width - 62, x2 + 3)),
          top: px(yy - 11),
          color,
          fontSize: event.scale === "EXTERNAL" ? "10px" : "9px",
          fontWeight: "800",
          textShadow: "0 1px 2px rgba(0,0,0,.95)",
          whiteSpace: "nowrap",
        }, `${event.scale === "INTERNAL" ? "I-" : ""}${event.kind === "CHOCH" ? "CHoCH" : "BOS"}`));
      }

      if (settings.swingLabels) {
        const swings = snapshot.swings
          .filter((item) => item.scale === "EXTERNAL" || settings.internalStructure)
          .slice(-18);
        for (const swing of swings) {
          if (swing.scale === "INTERNAL" && !settings.internalStructure) continue;
          const xx = x(swing.time);
          const yy = y(swing.price);
          if (!inBounds(xx, width) || !inBounds(yy, height)) continue;
          const bullishLabel = swing.label === "HH" || swing.label === "HL";
          root.appendChild(div({
            position: "absolute",
            left: px(xx - 9),
            top: px(yy + (swing.kind === "HIGH" ? -17 : 4)),
            color: bullishLabel ? COLORS.bull : COLORS.bear,
            fontSize: swing.scale === "EXTERNAL" ? "9px" : "8px",
            fontWeight: "700",
            opacity: swing.scale === "EXTERNAL" ? ".9" : ".55",
            textShadow: "0 1px 2px rgba(0,0,0,.95)",
          }, swing.label));
        }
      }

      if (settings.reversals) {
        for (const marker of snapshot.reversals.slice(-16)) {
          const xx = x(marker.time);
          const yy = y(marker.price);
          if (!inBounds(xx, width) || !inBounds(yy, height)) continue;
          const color = marker.direction === "BULL" ? COLORS.bull : COLORS.bear;
          root.appendChild(div({
            position: "absolute",
            left: px(xx - 5),
            top: px(yy + (marker.direction === "BULL" ? 5 : -15)),
            width: "10px",
            height: "10px",
            transform: "rotate(45deg)",
            background: marker.enhanced ? color : "transparent",
            border: `1px solid ${color}`,
            boxSizing: "border-box",
            opacity: marker.enhanced ? ".95" : ".7",
          }));
        }
      }

      if (settings.fibs) {
        for (const fib of snapshot.fibLevels) {
          const yy = y(fib.price);
          if (!inBounds(yy, height)) continue;
          root.appendChild(div({
            position: "absolute",
            left: "0px",
            top: px(yy),
            width: px(Math.max(1, width - 60)),
            borderTop: `1px dashed ${COLORS.fib}`,
            opacity: ".35",
          }));
          root.appendChild(div({
            position: "absolute",
            right: "64px",
            top: px(yy - 10),
            color: COLORS.fib,
            fontSize: "8px",
            opacity: ".75",
          }, `FIB ${fib.ratio}`));
        }
      }

      if (settings.confluenceBadges && anchors.length) {
        const confluence: StructureAnchorConfluence[] = buildStructureAnchorConfluence({
          snapshot,
          anchors,
          tolerancePoints: confluenceTolerancePoints,
        });
        const seenPrices = new Set<string>();
        for (const item of confluence.filter((entry) => entry.count >= 2)) {
          const priceKey = item.anchor.price.toFixed(2);
          if (seenPrices.has(priceKey)) continue;
          seenPrices.add(priceKey);
          const yy = y(item.anchor.price);
          if (!inBounds(yy, height)) continue;
          const color = item.anchor.tone === "BULL"
            ? COLORS.bull
            : item.anchor.tone === "BEAR"
              ? COLORS.bear
              : "#fbbf24";
          root.appendChild(div({
            position: "absolute",
            right: "68px",
            top: px(yy - 9),
            padding: "2px 5px",
            borderRadius: "4px",
            border: `1px solid ${color}`,
            background: "rgba(2,6,23,.82)",
            color,
            fontSize: "8px",
            fontWeight: "800",
            whiteSpace: "nowrap",
            boxShadow: "0 1px 4px rgba(0,0,0,.35)",
          }, `STRUCTURE ×${item.count}`));
        }
      }
    };

    let pendingFrame: number | null = null;
    const onScale = () => {
      if (pendingFrame != null) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null;
        render();
      });
    };
    const resize = new ResizeObserver(onScale);
    resize.observe(container);
    ts.subscribeVisibleLogicalRangeChange?.(onScale);
    ts.subscribeVisibleTimeRangeChange?.(onScale);
    // lightweight-charts does not expose a dedicated price-scale drag event.
    // A lightweight 4 Hz coordinate refresh keeps boxes/labels glued to price
    // during manual price-axis zooming without touching network state.
    const priceScaleTimer = window.setInterval(onScale, 250);
    render();

    return () => {
      if (pendingFrame != null) window.cancelAnimationFrame(pendingFrame);
      window.clearInterval(priceScaleTimer);
      resize.disconnect();
      ts.unsubscribeVisibleLogicalRangeChange?.(onScale);
      ts.unsubscribeVisibleTimeRangeChange?.(onScale);
      root.remove();
      if ((!priorPosition || priorPosition === "static") && container.style.position === "relative") {
        container.style.position = priorPosition;
      }
    };
  }, [container, chart, series, snapshot, settings, anchors, confluenceTolerancePoints]);

  return null;
}
