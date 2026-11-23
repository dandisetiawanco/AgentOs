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
        className="inline-flex items-center justify-center rounded-[8px] bg-[var(--accent-tint)] border border-[var(--accent-border)] text-[var(--ink-primary)] shrink-0"
        style={{ width: size + 6, height: size + 6 }}
      >
        <svg
          width={size - 4}
          height={size - 4}
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
          <span className="text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--ink-primary)]">
            AgentOS
          </span>
          {!compact && (
            <span className="text-[10.5px] tracking-[0.04em] text-[var(--ink-secondary)] mt-0.5">
              NGOPREK DIGITAL
            </span>
          )}
        </span>
      )}
    </span>
  );
}
