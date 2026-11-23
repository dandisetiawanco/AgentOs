import React from "react";

interface AgentOSLogoProps {
  size?: number;
  showWordmark?: boolean;
  compact?: boolean;
}

export function AgentOSLogo({
  size = 24,
  showWordmark = true,
  compact = false,
}: AgentOSLogoProps): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <span
        className="inline-flex items-center justify-center rounded-[10px] bg-[var(--accent-tint)] border border-[var(--accent-border)] text-[var(--ink-primary)] shadow-[inset_0_1px_0_var(--glass-highlight)] shrink-0"
        style={{ width: size + 8, height: size + 8 }}
      >
        <svg
          width={size - 2}
          height={size - 2}
          viewBox="0 0 28 28"
          fill="none"
          aria-hidden={showWordmark ? "true" : undefined}
          role={showWordmark ? undefined : "img"}
          aria-label={showWordmark ? undefined : "AgentOS"}
        >
          <path
            d="M6.5 21.5L14 5.5L21.5 21.5"
            stroke="var(--accent)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M9.6 16.5H18.4" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        </svg>
      </span>
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span className="type-body font-semibold tracking-[-0.015em] text-[var(--ink-primary)]">
            AgentOS
          </span>
          {!compact && (
            <span className="type-meta font-normal text-[var(--ink-secondary)]">
              NGOPREK DIGITAL
            </span>
          )}
        </span>
      )}
    </span>
  );
}
