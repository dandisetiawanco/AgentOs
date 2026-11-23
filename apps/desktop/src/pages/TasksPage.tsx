import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, RotateCcw, Square } from "lucide-react";
import type { TaskRecord, TaskStatus } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  SectionHeader,
  TaskStatusBadge,
} from "@agentos/ui";
import { TaskTimeline } from "../components/TaskTimeline.js";
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
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        title="Tasks"
        description="Persistent execution ledger stored in local SQLite. Inspect tool invocations, permissions, progress, and verification evidence."
        action={
          <Button variant="secondary" size="sm" onClick={() => void loadTasks()}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
            Refresh
          </Button>
        }
      />

      {/* Segmented status filter bar */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter tasks by status">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(f.value)}
              className={[
                "px-3.5 py-1.5 rounded-full type-secondary font-medium border transition-colors duration-150",
                active
                  ? "bg-[var(--accent-fill)] text-white border-transparent shadow-sm"
                  : "bg-[var(--glass-surface)] text-[var(--ink-secondary)] border-[var(--border-hairline)] hover:text-[var(--ink-primary)] hover:border-[var(--border-control)]",
              ].join(" ")}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading && <LoadingState label="Loading task history..." />}
      {error && <ErrorState message={error} onRetry={() => void loadTasks()} />}

      {!loading && !error && tasks.length === 0 && (
        <EmptyState
          title="No tasks recorded yet"
          description="Tasks created in your sessions or via workflows are persisted here across application restarts."
          actionLabel="Start session"
          onAction={() => setRoute("assistant")}
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Unified grouped task list */}
          <div className="lg:col-span-5">
            <GlassPanel
              variant="surface"
              padding="none"
              className="divide-y divide-[var(--border-hairline)] overflow-hidden"
            >
              {tasks.map((task) => {
                const active = task.id === selected?.id;
                const isFailed = task.status === "failed";
                const totalSteps = task.steps.length;
                const completedSteps = task.steps.filter((s) => s.status === "completed").length;
                const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
                const barColor = isFailed
                  ? "var(--danger-ink)"
                  : task.status === "completed"
                    ? "var(--success-ink)"
                    : "var(--accent)";

                return (
                  <button
                    key={task.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSelectedId(task.id)}
                    className={[
                      "w-full text-left px-5 py-4 transition-colors duration-150",
                      active
                        ? "bg-[var(--accent-tint)]/70 shadow-[inset_3px_0_0_var(--accent)]"
                        : isFailed
                          ? "bg-[var(--danger-tint)]/30 hover:bg-[var(--danger-tint)]/45"
                          : "hover:bg-[var(--surface-elevated)]/85",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono type-meta font-normal text-[var(--ink-secondary)]">
                        {task.id}
                      </span>
                      <TaskStatusBadge status={task.status as TaskStatus} />
                    </div>
                    <p className="type-body font-medium text-[var(--ink-primary)] mt-1.5 mb-0 break-words [overflow-wrap:anywhere]">
                      {task.instruction}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="type-meta font-normal text-[var(--ink-secondary)] flex flex-wrap items-center gap-x-2">
                        <span className="tabular-nums">
                          {completedSteps}/{totalSteps} {totalSteps === 1 ? "step" : "steps"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{task.provider_id}</span>
                      </span>
                      <div
                        className="w-20 h-1.5 rounded-full bg-[var(--surface-recessed)] overflow-hidden shrink-0"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full transition-[width] duration-200"
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </GlassPanel>
          </div>

          {/* Floating Liquid Glass task detail inspector */}
          <div className="lg:col-span-7">
            {selected && (
              <GlassPanel variant="frosted" padding="md" className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono type-meta font-normal text-[var(--ink-secondary)]">
                        {selected.id}
                      </span>
                      <TaskStatusBadge status={selected.status} />
                    </div>
                    <h2 className="type-section-title mt-2 mb-0 text-[var(--ink-primary)] break-words [overflow-wrap:anywhere]">
                      {selected.instruction}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
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
                  <div
                    className={[
                      "type-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-[12px] border p-4",
                      selected.status === "failed"
                        ? "bg-[var(--danger-tint)] border-[var(--danger-border)] text-[var(--danger-ink)]"
                        : "bg-[var(--surface-recessed)] border-[var(--border-hairline)] text-[var(--ink-primary)]",
                    ].join(" ")}
                  >
                    {selected.result_summary}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <h3 className="type-body font-semibold text-[var(--ink-primary)] m-0">
                    Execution Timeline
                  </h3>
                  <TaskTimeline steps={selected.steps} showResults={true} />
                </div>
              </GlassPanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
