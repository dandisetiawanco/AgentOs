import React, { useEffect, useState } from "react";
import { FolderLock, Play, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { TaskRecord } from "@agentos/shared";
import { Button, EmptyState, ErrorState, LoadingState, TaskStatusBadge } from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

export function OverviewPage(): React.JSX.Element {
  const {
    client,
    bootstrap,
    providers,
    workspaces,
    loading,
    error,
    refreshAll,
    restartBackend,
    setRoute,
    notify,
  } = useApp();
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [emergencyActive, setEmergencyActive] = useState<boolean>(false);

  useEffect(() => {
    if (!client || !bootstrap) return;
    void Promise.all([client.listTasks(), client.getComputerUseCapabilities()])
      .then(([tasks, caps]) => {
        setRecentTasks(tasks.slice(0, 6));
        setEmergencyActive(caps.emergency_stop_active);
      })
      .catch(() => {
        // Handled cleanly if backend restarts.
      });
  }, [client, bootstrap]);

  if (loading && !bootstrap) {
    return <LoadingState label="Connecting to local AgentOS backend..." />;
  }

  if (error && !bootstrap) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[22px] font-semibold tracking-tight">Overview</h1>
        <ErrorState
          title="Local backend unavailable"
          message={error}
          onRetry={() => void refreshAll()}
        />
        <div>
          <Button variant="secondary" onClick={() => void restartBackend()}>
            <RefreshCw className="w-4 h-4" aria-hidden={true} />
            Restart local backend
          </Button>
        </div>
      </div>
    );
  }

  const readyProviders = providers.filter((p) => p.ready);
  const activeProvider = providers.find((p) => p.id === bootstrap?.settings.default_provider_id);

  const handleToggleEmergencyStop = async () => {
    if (!client) return;
    try {
      const res = await client.triggerEmergencyStop(!emergencyActive);
      setEmergencyActive(res.emergency_stop_active);
      notify(
        res.emergency_stop_active
          ? `Emergency stop activated (${res.cancelled_tasks} active task signal(s) halted).`
          : "Emergency stop cleared. Operations may resume.",
        res.emergency_stop_active ? "error" : "success",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-hairline)] pb-5">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--ink-primary)]">
            AgentOS Workspace
          </h1>
          <p className="text-[14px] text-[var(--ink-secondary)] mt-1">
            Intelligence that takes action. Local-first runtime with explicit permission boundaries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant={emergencyActive ? "primary" : "danger"}
            onClick={() => void handleToggleEmergencyStop()}
          >
            <ShieldAlert className="w-4 h-4" aria-hidden={true} />
            {emergencyActive ? "Clear emergency stop" : "Emergency stop"}
          </Button>
          <Button variant="primary" onClick={() => setRoute("assistant")}>
            <Play className="w-4 h-4" aria-hidden={true} />
            Open Assistant
          </Button>
        </div>
      </div>

      {emergencyActive && (
        <div
          role="alert"
          className="rounded-[8px] border border-[var(--danger-border)] bg-[var(--danger-tint)] text-[var(--danger-ink)] px-4 py-3 text-[13px] font-medium"
        >
          Emergency stop is active. All non-read-only tool executions are blocked until cleared.
        </div>
      )}

      {/* Operational readiness ledger */}
      <section
        aria-labelledby="readiness-heading"
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between">
              <h2 id="readiness-heading" className="text-[14px] font-semibold">
                AI Provider
              </h2>
              <span className="text-[12px] font-mono text-[var(--ink-secondary)]">
                {readyProviders.length} ready
              </span>
            </div>
            <p className="text-[15px] font-medium mt-2">
              {activeProvider?.display_name ?? "Not selected"}
            </p>
            <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5 font-mono">
              {bootstrap?.settings.default_model ?? "No model configured"}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRoute("settings")}>
            Manage API keys & models
          </Button>
        </div>

        <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Authorized Workspaces</h2>
              <FolderLock className="w-4 h-4 text-[var(--ink-secondary)]" aria-hidden={true} />
            </div>
            <p className="text-[15px] font-medium mt-2">
              {workspaces.length === 0
                ? "None authorized yet"
                : `${workspaces.length} authorized ${workspaces.length === 1 ? "directory" : "directories"}`}
            </p>
            <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
              Default-deny file access. Only listed folders can be inspected or modified.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRoute("settings")}>
            Authorize workspace
          </Button>
        </div>

        <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Security Posture</h2>
              <ShieldCheck className="w-4 h-4 text-[var(--ink-secondary)]" aria-hidden={true} />
            </div>
            <p className="text-[15px] font-medium mt-2">
              {bootstrap?.keychain.persistent ? "OS Keychain active" : "Ephemeral session vault"}
            </p>
            <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
              Terminal execution is{" "}
              {bootstrap?.settings.terminal_enabled
                ? "enabled (allowlisted)"
                : "disabled by default"}
              .
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRoute("activity")}>
            Inspect audit log
          </Button>
        </div>
      </section>

      {/* Recent real tasks */}
      <section aria-labelledby="recent-tasks-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-tasks-heading" className="text-[16px] font-semibold">
            Recent Tasks
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setRoute("tasks")}>
            View all tasks
          </Button>
        </div>
        {recentTasks.length === 0 ? (
          <EmptyState
            title="No tasks have been run yet"
            description="Open the Assistant to submit your first natural-language instruction, or trigger a built-in template from Workflows."
            actionLabel="Start first task"
            onAction={() => setRoute("assistant")}
          />
        ) : (
          <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] divide-y divide-[var(--border-hairline)]">
            {recentTasks.map((task) => (
              <div
                key={task.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate m-0">{task.instruction}</p>
                  <p className="font-mono text-[11px] text-[var(--ink-secondary)] mt-0.5 m-0">
                    {task.id} | {task.steps.length} step(s) | {task.provider_id}
                  </p>
                </div>
                <TaskStatusBadge status={task.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Runtime details */}
      {bootstrap && (
        <section
          aria-labelledby="runtime-heading"
          className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5"
        >
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 id="runtime-heading" className="text-[15px] font-semibold">
              Local Runtime Environment
            </h2>
            <Button variant="ghost" size="sm" onClick={() => void refreshAll()}>
              <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
              Refresh
            </Button>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[13px] m-0">
            <div>
              <dt className="text-[var(--ink-secondary)]">Host architecture</dt>
              <dd className="font-mono mt-0.5 m-0">
                {bootstrap.app.platform} ({bootstrap.app.arch})
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ink-secondary)]">Backend runtime</dt>
              <dd className="font-mono mt-0.5 m-0">Python {bootstrap.app.python_version}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-secondary)]">Recorded tasks</dt>
              <dd className="font-mono mt-0.5 m-0">{bootstrap.counts.tasks}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-secondary)]">Credential storage</dt>
              <dd className="font-mono mt-0.5 m-0 truncate">{bootstrap.keychain.backend}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
