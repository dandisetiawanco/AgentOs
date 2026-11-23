import React from "react";

export type StatusTone = "ready" | "running" | "warning" | "error" | "idle";

export interface StatusIndicatorProps {
  tone: StatusTone;
  label: string;
  mono?: boolean;
  className?: string;
}

const DOT_COLORS: Record<StatusTone, string> = {
  ready: "var(--success-ink)",
  running: "var(--accent)",
  warning: "var(--warning-ink)",
  error: "var(--danger-ink)",
  idle: "var(--ink-secondary)",
};

const PILL_CLASSES: Record<StatusTone, string> = {
  ready: "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]",
  running: "bg-[var(--accent-tint)] text-[var(--accent-ink)] border-[var(--accent-border)]",
  warning: "bg-[var(--warning-tint)] text-[var(--warning-ink)] border-[var(--warning-border)]",
  error: "bg-[var(--danger-tint)] text-[var(--danger-ink)] border-[var(--danger-border)]",
  idle: "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] border-[var(--border-hairline)]",
};

export function StatusIndicator({
  tone,
  label,
  mono = false,
  className = "",
}: StatusIndicatorProps): React.JSX.Element {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full border type-meta",
        PILL_CLASSES[tone],
        mono ? "font-mono" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: DOT_COLORS[tone] }}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
