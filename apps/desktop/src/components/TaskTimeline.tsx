import React from "react";
import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldAlert } from "lucide-react";
import type { TaskRecord } from "@agentos/shared";
import { RiskBadge } from "@agentos/ui";

export interface TaskTimelineProps {
  steps: TaskRecord["steps"];
  showResults?: boolean;
}

function StepNodeIcon({ status }: { status: string }): React.JSX.Element {
  if (status === "completed") {
    return <CheckCircle2 className="w-4 h-4 text-[var(--success-ink)]" aria-hidden={true} />;
  }
  if (status === "failed" || status === "blocked") {
    return <AlertCircle className="w-4 h-4 text-[var(--danger-ink)]" aria-hidden={true} />;
  }
  if (status === "awaiting_approval") {
    return <ShieldAlert className="w-4 h-4 text-[var(--warning-ink)]" aria-hidden={true} />;
  }
  if (status === "running") {
    return <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" aria-hidden={true} />;
  }
  return <Clock className="w-4 h-4 text-[var(--ink-secondary)]" aria-hidden={true} />;
}

export function TaskTimeline({ steps, showResults = true }: TaskTimelineProps): React.JSX.Element {
  return (
    <ol className="m-0 p-0 list-none relative flex flex-col gap-3">
      {steps.map((step, idx) => {
        const verified = Boolean(step.verification?.verified);
        const isLast = idx === steps.length - 1;
        const isFailed = step.status === "failed" || Boolean(step.error_message);
        const isRunning = step.status === "running";

        return (
          <li key={step.id} className="relative flex gap-3">
            {/* Timeline track */}
            <div className="flex flex-col items-center pt-1 shrink-0">
              <span className="flex items-center justify-center w-6 h-6 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-elevated)]">
                <StepNodeIcon status={step.status} />
              </span>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="w-px flex-1 bg-[var(--border-hairline)] mt-1.5"
                />
              )}
            </div>

            {/* Step card */}
            <div
              className={[
                "flex-1 min-w-0 rounded-[10px] border p-3.5 transition-colors duration-150",
                isFailed
                  ? "bg-[var(--danger-tint)]/40 border-[var(--danger-border)]"
                  : isRunning
                    ? "bg-[var(--surface-elevated)] border-[var(--accent)]"
                    : "bg-[var(--surface-elevated)]/85 border-[var(--border-hairline)]",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11.5px] font-mono text-[var(--ink-secondary)] shrink-0">
                    #{step.step_index + 1}
                  </span>
                  <span className="text-[13.5px] font-semibold text-[var(--ink-primary)] truncate">
                    {step.title}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <RiskBadge level={step.risk_level} />
                  <span className="text-[11.5px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-recessed)] text-[var(--ink-secondary)]">
                    {step.status}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-mono text-[var(--ink-secondary)] mt-1.5">
                <span>{step.tool_id}</span>
                {step.duration_ms !== null && <span>{step.duration_ms} ms</span>}
                <span>approval: {step.approval_status}</span>
              </div>

              {step.description && (
                <p className="text-[12.5px] text-[var(--ink-secondary)] mt-1.5 mb-0 break-words [overflow-wrap:anywhere]">
                  {step.description}
                </p>
              )}

              {step.error_message && (
                <p className="text-[12.5px] text-[var(--danger-ink)] mt-2 mb-0 font-medium break-words [overflow-wrap:anywhere]">
                  {step.error_message}
                </p>
              )}

              {step.verification && !showResults && (
                <p className="text-[12px] text-[var(--ink-secondary)] mt-1.5 mb-0 break-words [overflow-wrap:anywhere]">
                  Verification: {String(step.verification.summary ?? "")}
                </p>
              )}

              {showResults && step.result && (
                <details className="mt-2.5 text-[12px]">
                  <summary className="font-medium text-[var(--ink-primary)] select-none">
                    Result: {String(step.result.summary ?? "Completed")}
                    {verified && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[var(--success-ink)]">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden={true} />
                        Verified
                      </span>
                    )}
                  </summary>
                  <pre className="mt-2 p-2.5 rounded-[8px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)] overflow-x-auto text-[11px] max-h-[220px] m-0">
                    {JSON.stringify(step.result.data ?? step.result, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
