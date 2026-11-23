import React from "react";
import type { RiskLevel, TaskStatus } from "@agentos/shared";

const RISK_STYLES: Record<RiskLevel, { label: string; className: string }> = {
  READ_ONLY: {
    label: "Read only",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] border-[var(--border-hairline)]",
  },
  LOW: {
    label: "Low risk",
    className: "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]",
  },
  MEDIUM: {
    label: "Medium risk",
    className: "bg-[var(--warning-tint)] text-[var(--warning-ink)] border-[var(--warning-border)]",
  },
  HIGH: {
    label: "High risk",
    className: "bg-[var(--danger-tint)] text-[var(--danger-ink)] border-[var(--danger-border)]",
  },
  BLOCKED: {
    label: "Blocked",
    className:
      "bg-[var(--danger-tint)] text-[var(--danger-ink)] border-[var(--danger-border)] font-semibold",
  },
};

const STATUS_STYLES: Record<TaskStatus, { label: string; dotColor: string; className: string }> = {
  created: {
    label: "Created",
    dotColor: "var(--ink-secondary)",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] border-[var(--border-hairline)]",
  },
  planning: {
    label: "Planning",
    dotColor: "var(--accent)",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-primary)] border-[var(--border-control)]",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    dotColor: "var(--warning-ink)",
    className: "bg-[var(--warning-tint)] text-[var(--warning-ink)] border-[var(--warning-border)]",
  },
  approved: {
    label: "Approved",
    dotColor: "var(--success-ink)",
    className: "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]",
  },
  running: {
    label: "Running",
    dotColor: "var(--accent)",
    className: "bg-[var(--accent-tint)] text-[var(--accent-ink)] border-[var(--accent-border)]",
  },
  paused: {
    label: "Paused",
    dotColor: "var(--warning-ink)",
    className: "bg-[var(--warning-tint)] text-[var(--warning-ink)] border-[var(--warning-border)]",
  },
  verifying: {
    label: "Verifying",
    dotColor: "var(--accent)",
    className: "bg-[var(--accent-tint)] text-[var(--accent-ink)] border-[var(--accent-border)]",
  },
  completed: {
    label: "Verified complete",
    dotColor: "var(--success-ink)",
    className: "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]",
  },
  failed: {
    label: "Failed",
    dotColor: "var(--danger-ink)",
    className: "bg-[var(--danger-tint)] text-[var(--danger-ink)] border-[var(--danger-border)]",
  },
  cancelled: {
    label: "Cancelled",
    dotColor: "var(--ink-secondary)",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] border-[var(--border-hairline)]",
  },
};

export function RiskBadge({ level }: { level: RiskLevel }): React.JSX.Element {
  const cfg = RISK_STYLES[level] ?? RISK_STYLES.READ_ONLY;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap shrink-0 px-2.5 py-0.5 type-meta rounded-full border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }): React.JSX.Element {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.created;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 type-meta rounded-full border ${cfg.className}`}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: cfg.dotColor }}
      />
      {cfg.label}
    </span>
  );
}
