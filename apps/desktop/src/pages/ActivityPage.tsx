import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import type { AuditEvent } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  RiskBadge,
  SectionHeader,
  StatusIndicator,
} from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

function AuditNodeIcon({
  category,
  outcome,
}: {
  category: string;
  outcome: string;
}): React.JSX.Element {
  if (outcome === "denied" || outcome === "failed" || outcome === "blocked") {
    return <ShieldAlert className="w-3.5 h-3.5 text-[var(--danger-ink)]" aria-hidden={true} />;
  }
  if (category === "permission" || category === "security" || category === "workspace") {
    return <ShieldCheck className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden={true} />;
  }
  return <Wrench className="w-3.5 h-3.5 text-[var(--ink-secondary)]" aria-hidden={true} />;
}

export function ActivityPage(): React.JSX.Element {
  const { client, notify } = useApp();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [category, setCategory] = useState<string>("");
  const [risk, setRisk] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.listAuditLogs({
        category: category || undefined,
        risk_level: risk || undefined,
        limit: 150,
      });
      setEvents(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, category, risk]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const handleExportDiagnostics = async () => {
    if (!client) return;
    try {
      const diag = await client.exportDiagnostics();
      const blob = new Blob([JSON.stringify(diag, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "agentos-diagnostics-redacted.json";
      a.click();
      URL.revokeObjectURL(url);
      notify("Exported redacted diagnostics report.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        as="h1"
        title="Activity & Audit Log"
        description="Secret-redacted chronological record of permissions, tool invocations, security blocks, and configuration changes."
        action={
          <>
            <Button variant="secondary" size="sm" onClick={() => void handleExportDiagnostics()}>
              <Download className="w-3.5 h-3.5" aria-hidden={true} />
              Export diagnostics
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void loadAudit()}>
              <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
              Refresh
            </Button>
          </>
        }
      />

      <GlassPanel variant="surface" padding="sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label
              htmlFor="aud-cat"
              className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
            >
              Category
            </label>
            <select
              id="aud-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="glass-input px-3 py-1.5 text-[13px]"
            >
              <option value="">All categories</option>
              {[
                "task",
                "tool",
                "permission",
                "security",
                "workspace",
                "provider",
                "settings",
                "memory",
                "mcp",
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="aud-risk"
              className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
            >
              Risk level
            </label>
            <select
              id="aud-risk"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="glass-input px-3 py-1.5 text-[13px]"
            >
              <option value="">All levels</option>
              {["READ_ONLY", "LOW", "MEDIUM", "HIGH", "BLOCKED"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      </GlassPanel>

      {loading && <LoadingState label="Loading audit trail..." />}
      {error && <ErrorState message={error} onRetry={() => void loadAudit()} />}

      {!loading && events.length === 0 && (
        <EmptyState
          title="No audit events match this filter"
          description="AgentOS logs every workspace authorization, tool invocation, permission approval, and blocked action here."
        />
      )}

      {!loading && events.length > 0 && (
        <ol className="m-0 p-0 list-none flex flex-col gap-3">
          {events.map((ev, idx) => {
            const isLast = idx === events.length - 1;
            const isAlert =
              ev.outcome === "denied" || ev.outcome === "failed" || ev.risk_level === "BLOCKED";
            return (
              <li key={ev.id} className="flex gap-3">
                <div className="flex flex-col items-center pt-1.5 shrink-0">
                  <span className="w-7 h-7 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-elevated)] flex items-center justify-center">
                    <AuditNodeIcon category={ev.category} outcome={ev.outcome} />
                  </span>
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="w-px flex-1 bg-[var(--border-hairline)] mt-1.5"
                    />
                  )}
                </div>

                <GlassPanel
                  as="article"
                  variant="surface"
                  padding="sm"
                  className={[
                    "flex-1 min-w-0 text-[13px]",
                    isAlert ? "border-[var(--danger-border)] bg-[var(--danger-tint)]/30" : "",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[12px] font-semibold text-[var(--ink-primary)] break-all">
                        {ev.action}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-recessed)] border border-[var(--border-hairline)] text-[var(--ink-secondary)]">
                        {ev.category}
                      </span>
                      <RiskBadge level={ev.risk_level} />
                      <StatusIndicator
                        tone={
                          isAlert
                            ? "error"
                            : ev.outcome === "ok" ||
                                ev.outcome === "allowed" ||
                                ev.outcome === "completed"
                              ? "ready"
                              : "idle"
                        }
                        label={ev.outcome}
                        mono
                      />
                    </div>
                    <time className="font-mono text-[11px] text-[var(--ink-secondary)] shrink-0">
                      {ev.timestamp ?? ""}
                    </time>
                  </div>
                  <p className="mt-2 mb-0 text-[var(--ink-primary)] break-words [overflow-wrap:anywhere]">
                    {ev.summary}
                  </p>
                  {Object.keys(ev.details).length > 0 && (
                    <details className="mt-2 text-[12px]">
                      <summary className="text-[var(--ink-secondary)] select-none">
                        Redacted details
                      </summary>
                      <pre className="mt-1.5 p-2.5 rounded-[8px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)] overflow-x-auto text-[11px] m-0">
                        {JSON.stringify(ev.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </GlassPanel>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
