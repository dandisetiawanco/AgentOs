import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, RotateCcw, Square } from "lucide-react";
import type { TaskRecord, TaskStatus } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  RiskBadge,
  TaskStatusBadge,
} from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All tasks" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Verified complete" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export function TasksPage(): React.JSX.Element {
  const { client, notify, setRoute } = useApp();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.listTasks(statusFilter || undefined);
      setTasks(list);
      if (list.length > 0 && (!selectedId || !list.some((t) => t.id === selectedId))) {
        setSelectedId(list[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, selectedId, statusFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const handleAction = async (
    action: "approve" | "decline" | "retry" | "cancel" | "rollback",
    taskId: string,
  ) => {
    if (!client) return;
    try {
      if (action === "approve") {
        await client.approveTask(taskId, { approve: true });
        notify("Task approved and executed.", "success");
      } else if (action === "decline") {
        await client.approveTask(taskId, { approve: false });
        notify("Task approval declined.", "info");
      } else if (action === "retry") {
        await client.retryTask(taskId);
        notify("Retried failed task steps.", "info");
      } else if (action === "cancel") {
        await client.cancelTask(taskId);
        notify("Task cancelled.", "info");
      } else if (action === "rollback") {
        const res = await client.rollbackTask(taskId);
        notify(`Restored ${res.restored_count} file operation(s).`, "success");
      }
      await loadTasks();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleExport = async (taskId: string) => {
    if (!client) return;
    try {
      const rep = await client.exportTaskReport(taskId);
      const blob = new Blob([rep.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = rep.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Tasks</h1>
          <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
            Persistent execution ledger stored in local SQLite. Inspect tool invocations, permissions, and verification evidence.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadTasks()}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter tasks by status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            aria-pressed={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
            className={[
              "px-3 py-1.5 rounded-[6px] text-[13px] border transition-colors",
              statusFilter === f.value
                ? "bg-[var(--accent-fill)] text-white border-transparent font-medium"
                : "bg-[var(--surface-elevated)] text-[var(--ink-primary)] border-[var(--border-control)] hover:bg-[var(--surface-recessed)]",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <LoadingState label="Loading task history..." />}
      {error && <ErrorState message={error} onRetry={() => void loadTasks()} />}

      {!loading && !error && tasks.length === 0 && (
        <EmptyState
          title="No tasks recorded yet"
          description="Tasks created in the Assistant or via Workflows are persisted here across application restarts."
          actionLabel="Go to Assistant"
          onAction={() => setRoute("assistant")}
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Task list */}
          <div className="lg:col-span-5 flex flex-col gap-2">
            {tasks.map((task) => {
              const active = task.id === selected?.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  className={[
                    "text-left rounded-[8px] border p-3.5 transition-colors",
                    active
                      ? "bg-[var(--surface-elevated)] border-[var(--accent)]"
                      : "bg-[var(--surface-elevated)] border-[var(--border-hairline)] hover:border-[var(--border-control)]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-[var(--ink-secondary)]">
                      {task.id}
                    </span>
                    <TaskStatusBadge status={task.status as TaskStatus} />
                  </div>
                  <p className="text-[14px] font-medium mt-1.5 line-clamp-2">{task.instruction}</p>
                  <p className="text-[12px] text-[var(--ink-secondary)] mt-1 font-mono">
                    {task.steps.length} step(s) | {task.provider_id}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Detail inspector */}
          <div className="lg:col-span-7">
            {selected && (
              <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-hairline)] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-[var(--ink-secondary)]">
                        {selected.id}
                      </span>
                      <TaskStatusBadge status={selected.status} />
                    </div>
                    <h2 className="text-[16px] font-semibold mt-1">{selected.instruction}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.status === "awaiting_approval" && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void handleAction("approve", selected.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleAction("decline", selected.id)}
                        >
                          Decline
                        </Button>
                      </>
                    )}
                    {selected.status === "failed" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleAction("retry", selected.id)}
                      >
                        Retry
                      </Button>
                    )}
                    {!["completed", "failed", "cancelled"].includes(selected.status) && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleAction("cancel", selected.id)}
                      >
                        <Square className="w-3.5 h-3.5" aria-hidden={true} />
                        Cancel
                      </Button>
                    )}
                    {selected.steps.some((s) => Boolean(s.rollback)) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleAction("rollback", selected.id)}
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden={true} />
                        Rollback
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleExport(selected.id)}
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden={true} />
                      Report
                    </Button>
                  </div>
                </div>

                {selected.result_summary && (
                  <p className="text-[13px] whitespace-pre-wrap bg-[var(--canvas)] border border-[var(--border-hairline)] rounded-[6px] p-3 m-0">
                    {selected.result_summary}
                  </p>
                )}

                <div className="flex flex-col gap-2.5">
                  <h3 className="text-[14px] font-semibold">Execution Timeline</h3>
                  {selected.steps.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-[6px] border border-[var(--border-hairline)] bg-[var(--canvas)] p-3 text-[13px]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {step.step_index + 1}. {step.title}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <RiskBadge level={step.risk_level} />
                          <span className="font-mono text-[12px] text-[var(--ink-secondary)]">
                            {step.status}
                          </span>
                        </div>
                      </div>
                      <p className="font-mono text-[12px] text-[var(--ink-secondary)] mt-1">
                        Tool: {step.tool_id} | Approval: {step.approval_status}
                      </p>
                      {step.error_message && (
                        <p className="text-[var(--danger-ink)] mt-1.5 mb-0">{step.error_message}</p>
                      )}
                      {step.verification && (
                        <p className="text-[12px] text-[var(--ink-secondary)] mt-1 mb-0">
                          Verification: {String(step.verification.summary ?? "")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
