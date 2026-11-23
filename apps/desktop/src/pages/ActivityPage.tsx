import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { AuditEvent } from "@agentos/shared";
import { Button, EmptyState, ErrorState, LoadingState, RiskBadge } from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Activity & Audit Log</h1>
          <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
            Secret-redacted chronological record of permissions, tool calls, security blocks, and configuration changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void handleExportDiagnostics()}>
            <Download className="w-3.5 h-3.5" aria-hidden={true} />
            Export diagnostics
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void loadAudit()}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor="aud-cat" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            Category
          </label>
          <select
            id="aud-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-[6px] border border-[var(--border-control)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[13px]"
          >
            <option value="">All categories</option>
            {["task", "tool", "permission", "security", "workspace", "provider", "settings", "memory", "mcp"].map(
              (c) => (
                <option key={c} value={c}>{c}</option>
              ),
            )}
          </select>
        </div>
        <div>
          <label htmlFor="aud-risk" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            Risk level
          </label>
          <select
            id="aud-risk"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            className="rounded-[6px] border border-[var(--border-control)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[13px]"
          >
            <option value="">All levels</option>
            {["READ_ONLY", "LOW", "MEDIUM", "HIGH", "BLOCKED"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <LoadingState label="Loading audit trail..." />}
      {error && <ErrorState message={error} onRetry={() => void loadAudit()} />}

      {!loading && events.length === 0 && (
        <EmptyState
          title="No audit events match this filter"
          description="AgentOS logs every workspace authorization, tool invocation, permission approval, and blocked action here."
        />
      )}

      {!loading && events.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {events.map((ev) => (
            <article
              key={ev.id}
              className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-3.5 text-[13px]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold">{ev.action}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)]">
                    {ev.category}
                  </span>
                  <RiskBadge level={ev.risk_level} />
                  <span className="text-[12px] text-[var(--ink-secondary)]">
                    outcome: <span className="font-mono">{ev.outcome}</span>
                  </span>
                </div>
                <time className="font-mono text-[11px] text-[var(--ink-secondary)]">
                  {ev.timestamp ?? ""}
                </time>
              </div>
              <p className="mt-1.5 mb-0">{ev.summary}</p>
              {Object.keys(ev.details).length > 0 && (
                <details className="mt-2 text-[12px]">
                  <summary className="text-[var(--ink-secondary)]">Redacted details</summary>
                  <pre className="mt-1.5 p-2 rounded bg-[var(--surface-recessed)] overflow-x-auto text-[11px]">
                    {JSON.stringify(ev.details, null, 2)}
                  </pre>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
