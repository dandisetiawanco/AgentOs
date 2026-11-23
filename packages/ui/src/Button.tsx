import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent-fill)] text-white border border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(15,23,42,0.14)] hover:bg-[var(--accent-fill-hover)] active:translate-y-[0.5px]",
  secondary:
    "bg-[var(--glass-panel)] text-[var(--ink-primary)] border border-[var(--border-control)] shadow-[inset_0_1px_0_var(--glass-highlight)] hover:bg-[var(--surface-elevated)] active:translate-y-[0.5px]",
  ghost:
    "bg-transparent text-[var(--ink-secondary)] border border-transparent hover:bg-[var(--surface-recessed)]/80 hover:text-[var(--ink-primary)]",
  danger:
    "bg-[var(--danger-tint)] text-[var(--danger-ink)] border border-[var(--danger-border)] hover:opacity-90 active:translate-y-[0.5px]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[12.5px] min-h-[32px] rounded-[8px]",
  md: "px-3.5 py-2 text-[13.5px] min-h-[36px] rounded-[9px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const isDisabled = Boolean(disabled || loading);
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-1.5 font-medium transition-[background-color,border-color,opacity,transform] duration-150",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
