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
    <div className="glass-surface rounded-[14px] p-6 text-left">
      <h3 className="type-section-title text-[var(--ink-primary)] m-0">{title}</h3>
      <p className="type-secondary text-[var(--ink-secondary)] mt-1.5 mb-0 max-w-[54ch]">
        {description}
      </p>
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
    <div className="glass-surface rounded-[14px] p-6 flex flex-col gap-3">
      <p className="type-secondary font-medium text-[var(--ink-secondary)] m-0">{label}</p>
      <progress aria-label={label} className="w-48 h-1.5 rounded-full overflow-hidden" />
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
      className="rounded-[14px] border border-[var(--danger-border)] bg-[var(--danger-tint)] p-5 text-[var(--danger-ink)]"
    >
      <p className="type-body font-semibold m-0">{title}</p>
      <p className="type-secondary mt-1 mb-0">{message}</p>
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
