import React from "react";
import { Button } from "./Button.js";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-6 text-left">
      <h3 className="text-[15px] font-semibold text-[var(--ink-primary)]">{title}</h3>
      <p className="text-[13px] text-[var(--ink-secondary)] mt-1 max-w-[54ch]">{description}</p>
      {actionLabel && onAction && (
        <div className="mt-4">
          <Button variant="primary" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export function LoadingState({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 flex flex-col gap-2">
      <p className="text-[13px] text-[var(--ink-secondary)]">{label}</p>
      <progress aria-label={label} className="w-48 h-1.5 rounded overflow-hidden" />
    </div>
  );
}

export function ErrorState({
  title = "Action could not be completed",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-[8px] border border-[var(--danger-border)] bg-[var(--danger-tint)] p-4 text-[var(--danger-ink)]"
    >
      <p className="text-[14px] font-semibold">{title}</p>
      <p className="text-[13px] mt-1">{message}</p>
      {onRetry && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
