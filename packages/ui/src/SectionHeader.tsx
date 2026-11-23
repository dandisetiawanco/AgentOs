import React from "react";

export interface SectionHeaderProps {
  id?: string;
  title: string;
  description?: string;
  as?: "h1" | "h2" | "h3";
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  id,
  title,
  description,
  as = "h2",
  action,
  className = "",
}: SectionHeaderProps): React.JSX.Element {
  const Heading = as;
  const headingClass =
    as === "h1"
      ? "type-page-title text-[var(--ink-primary)] m-0"
      : as === "h2"
        ? "type-section-title text-[var(--ink-primary)] m-0"
        : "type-body font-semibold text-[var(--ink-primary)] m-0";

  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <Heading id={id} className={headingClass}>
          {title}
        </Heading>
        {description && (
          <p className="type-secondary text-[var(--ink-secondary)] mt-1 mb-0 max-w-[66ch]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}
