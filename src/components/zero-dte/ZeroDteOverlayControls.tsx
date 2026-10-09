"use client";

import React from "react";

export interface ZeroDteOverlaySettings {
  enabled: boolean;
  decisionArrow: boolean;
  externalStructure: boolean;
  internalStructure: boolean;
  swingLabels: boolean;
  fvgs: boolean;
  reactionZones: boolean;
  reversals: boolean;
  fibs: boolean;
  confluenceBadges: boolean;
}

/** Default trading view: the engine does the interpretation and the chart stays quiet. */
export const SIGNAL_STRUCTURE_OVERLAY: ZeroDteOverlaySettings = {
  enabled: true,
  decisionArrow: true,
  externalStructure: false,
  internalStructure: false,
  swingLabels: false,
  fvgs: false,
  reactionZones: false,
  reversals: false,
  fibs: false,
  confluenceBadges: false,
};

export const CLEAN_STRUCTURE_OVERLAY: ZeroDteOverlaySettings = {
  enabled: true,
  decisionArrow: true,
  externalStructure: true,
  internalStructure: false,
  swingLabels: true,
  fvgs: true,
  reactionZones: false,
  reversals: true,
  fibs: false,
  confluenceBadges: true,
};

export const FULL_STRUCTURE_OVERLAY: ZeroDteOverlaySettings = {
  enabled: true,
  decisionArrow: true,
  externalStructure: true,
  internalStructure: true,
  swingLabels: true,
  fvgs: true,
  reactionZones: true,
  reversals: true,
  fibs: true,
  confluenceBadges: true,
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.28)",
  borderRadius: 7,
  padding: "4px 8px",
  fontSize: 11,
  lineHeight: 1.2,
  background: "rgba(15,23,42,.78)",
  color: "#dbeafe",
  cursor: "pointer",
};

export function ZeroDteOverlayControls(props: {
  value: ZeroDteOverlaySettings;
  onChange: (next: ZeroDteOverlaySettings) => void;
}) {
  const { value, onChange } = props;
  const toggle = (key: keyof ZeroDteOverlaySettings) => {
    onChange({ ...value, [key]: !value[key] });
  };

  const items: Array<[keyof ZeroDteOverlaySettings, string]> = [
    ["decisionArrow", "Arrow"],
    ["externalStructure", "Structure"],
    ["internalStructure", "Internal"],
    ["swingLabels", "Swings"],
    ["fvgs", "FVG"],
    ["reactionZones", "Reaction*"],
    ["reversals", "3BR"],
    ["fibs", "Fibs"],
    ["confluenceBadges", "Confluence"],
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        flexWrap: "wrap",
        marginBottom: 8,
      }}
    >
      <button
        type="button"
        style={{ ...buttonStyle, opacity: value.enabled ? 1 : 0.55 }}
        onClick={() => toggle("enabled")}
        title="Toggle WheelDesk market-structure overlays"
      >
        STRUCTURE {value.enabled ? "ON" : "OFF"}
      </button>
      <button type="button" style={buttonStyle} onClick={() => onChange(SIGNAL_STRUCTURE_OVERLAY)}>
        Signal
      </button>
      <button type="button" style={buttonStyle} onClick={() => onChange(CLEAN_STRUCTURE_OVERLAY)}>
        Clean
      </button>
      <button type="button" style={buttonStyle} onClick={() => onChange(FULL_STRUCTURE_OVERLAY)}>
        Full
      </button>
      {items.map(([key, label]) => (
        <button
          key={key}
          type="button"
          style={{ ...buttonStyle, opacity: value[key] ? 1 : 0.4 }}
          disabled={!value.enabled}
          title={
            key === "reactionZones"
              ? "Reaction Zones require aligned ES/SPY proxy volume. SPX volume is intentionally ignored."
              : key === "decisionArrow"
                ? "Show only confirmed WheelDesk BUY/SELL directional decisions; WAIT intentionally draws no arrow."
                : undefined
          }
          onClick={() => toggle(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
