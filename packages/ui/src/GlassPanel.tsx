import React from "react";

export type GlassVariant = "surface" | "frosted" | "subtle" | "elevated";
export type GlassPadding = "none" | "sm" | "md" | "lg";

export interface GlassPanelProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article";
  variant?: GlassVariant;
  padding?: GlassPadding;
}

const VARIANT_CLASSES: Record<GlassVariant, string> = {
  surface: "glass-panel",
  frosted: "glass-frosted",
  subtle: "bg-[var(--surface-recessed)]/75 border border-[var(--border-hairline)]",
  elevated:
    "bg-[var(--surface-elevated)] border border-[var(--border-hairline)] shadow-[var(--shadow-sm)]",
};

const PADDING_CLASSES: Record<GlassPadding, string> = {
  none: "",
  sm: "p-3.5",
  md: "p-5",
  lg: "p-6",
};

export function GlassPanel({
  as = "div",
  variant = "surface",
  padding = "md",
  className = "",
  children,
  ...rest
}: GlassPanelProps): React.JSX.Element {
  const Component = as;
  return (
    <Component
      className={[
        "rounded-[12px] transition-[border-color,background-color] duration-150",
        VARIANT_CLASSES[variant],
        PADDING_CLASSES[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Component>
  );
}
