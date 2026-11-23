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
      <svg
        width={size}
        height={size}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden={showWordmark ? "true" : undefined}
        role={showWordmark ? undefined : "img"}
        aria-label={showWordmark ? undefined : "AgentOS"}
        className="shrink-0"
      >
        <rect x="2" y="2" width="24" height="24" rx="6" stroke="currentColor" strokeWidth="2" />
        <path
          d="M8.5 19.5L13.5 8.5L19.5 19.5"
          stroke="var(--accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M10.5 15.5H17.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-[var(--ink-primary)]">
            AgentOS
          </span>
          {!compact && (
            <span className="text-[11px] text-[var(--ink-secondary)] mt-0.5">NGOPREK DIGITAL</span>
          )}
        </span>
      )}
    </span>
  );
}
