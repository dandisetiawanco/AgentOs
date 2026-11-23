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

const STATUS_STYLES: Record<TaskStatus, { label: string; className: string }> = {
  created: {
    label: "Created",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] border-[var(--border-hairline)]",
  },
  planning: {
    label: "Planning",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-primary)] border-[var(--border-control)]",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    className: "bg-[var(--warning-tint)] text-[var(--warning-ink)] border-[var(--warning-border)]",
  },
  approved: {
    label: "Approved",
    className: "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]",
  },
  running: {
    label: "Running",
    className: "bg-[var(--accent-tint)] text-[var(--accent-ink)] border-[var(--accent-border)]",
  },
  paused: {
    label: "Paused",
    className: "bg-[var(--warning-tint)] text-[var(--warning-ink)] border-[var(--warning-border)]",
  },
  verifying: {
    label: "Verifying",
    className: "bg-[var(--accent-tint)] text-[var(--accent-ink)] border-[var(--accent-border)]",
  },
  completed: {
    label: "Verified complete",
    className: "bg-[var(--success-tint)] text-[var(--success-ink)] border-[var(--success-border)]",
  },
  failed: {
    label: "Failed",
    className: "bg-[var(--danger-tint)] text-[var(--danger-ink)] border-[var(--danger-border)]",
  },
  cancelled: {
    label: "Cancelled",
    className:
      "bg-[var(--surface-recessed)] text-[var(--ink-secondary)] border-[var(--border-hairline)]",
  },
};

export function RiskBadge({ level }: { level: RiskLevel }): React.JSX.Element {
  const cfg = RISK_STYLES[level] ?? RISK_STYLES.READ_ONLY;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[12px] leading-tight rounded-[4px] border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }): React.JSX.Element {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.created;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[12px] leading-tight rounded-[4px] border font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
