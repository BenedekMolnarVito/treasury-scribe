/**
 * ToggleSwitch.tsx
 *
 * Reusable iOS-style sliding toggle switch.
 * Pure CSS implementation — no external dependencies.
 * Dark-themed to match the rest of the application.
 */

import React from "react";

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  testId?: string;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 24;
const KNOB_SIZE = 20;
const KNOB_OFFSET = 2;

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  ariaLabel,
  testId,
}) => {
  const trackStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-block",
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    background: checked ? "#1565C0" : "#555",
    transition: "background 0.2s ease",
    cursor: "pointer",
    flexShrink: 0,
  };

  const knobStyle: React.CSSProperties = {
    position: "absolute",
    top: KNOB_OFFSET,
    left: checked ? TRACK_WIDTH - KNOB_SIZE - KNOB_OFFSET : KNOB_OFFSET,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: "50%",
    background: "#FFFFFF",
    transition: "left 0.2s ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  };

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        color: "#E0E0E0",
      }}
    >
      <span
        style={trackStyle}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        data-testid={testId}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
      >
        <span style={knobStyle} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
};

export default ToggleSwitch;
