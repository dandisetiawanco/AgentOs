import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock,
  Cpu,
  FolderLock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { TaskRecord, WorkflowRecord } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  SectionHeader,
  StatusIndicator,
  TaskStatusBadge,
} from "@agentos/ui";
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
  const [totalTaskCount, setTotalTaskCount] = useState<number>(0);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [emergencyActive, setEmergencyActive] = useState<boolean>(false);

  useEffect(() => {
    if (!client || !bootstrap) return;
    void Promise.all([
      client.listTasks(),
      client.listWorkflows(),
      client.getComputerUseCapabilities(),
    ])
      .then(([tasks, wfList, caps]) => {
        setTotalTaskCount(tasks.length);
        setRecentTasks(tasks.slice(0, 6));
        setWorkflows(wfList.slice(0, 4));
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
        <SectionHeader as="h1" title="Overview" />
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
  const scheduledCount = workflows.filter((w) => w.schedule_enabled).length;

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
      {/* Frosted command banner */}
      <GlassPanel variant="frosted" padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <StatusIndicator
                tone={emergencyActive ? "error" : "ready"}
                label={emergencyActive ? "Emergency stop active" : "Local runtime active"}
              />
              {bootstrap && (
                <span className="font-mono text-[11.5px] text-[var(--ink-secondary)]">
                  {bootstrap.app.platform} {bootstrap.app.arch} · Python{" "}
                  {bootstrap.app.python_version}
                </span>
              )}
            </div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[var(--ink-primary)] m-0">
              AgentOS Workspace
            </h1>
            <p className="text-[13.5px] text-[var(--ink-secondary)] mt-1.5 mb-0 max-w-[60ch]">
              Intelligence that takes action. Local-first autonomous workspace with explicit
              permission boundaries and deterministic verification.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant={emergencyActive ? "primary" : "danger"}
              size="sm"
              onClick={() => void handleToggleEmergencyStop()}
            >
              <ShieldAlert className="w-3.5 h-3.5" aria-hidden={true} />
              {emergencyActive ? "Clear emergency stop" : "Emergency stop"}
            </Button>
            <Button variant="primary" size="md" onClick={() => setRoute("assistant")}>
              <Play className="w-3.5 h-3.5" aria-hidden={true} />
              Start session
            </Button>
          </div>
        </div>
      </GlassPanel>

      {emergencyActive && (
        <div
          role="alert"
          className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-tint)] text-[var(--danger-ink)] px-4 py-3 text-[13px] font-medium"
        >
          Emergency stop is active. All non-read-only tool executions are blocked until cleared.
        </div>
      )}

      {/* Primary two-column command center */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Recent Tasks + Active Workflows */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          <section aria-labelledby="recent-tasks-heading" className="flex flex-col gap-3">
            <SectionHeader
              id="recent-tasks-heading"
              title="Recent Tasks"
              description="Latest executions persisted in local SQLite."
              action={
                <Button variant="ghost" size="sm" onClick={() => setRoute("tasks")}>
                  View all
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden={true} />
                </Button>
              }
            />
            {recentTasks.length === 0 ? (
              <EmptyState
                title="No tasks have been run yet"
                description="Open the Assistant to submit your first natural-language instruction, or run a reusable template from Workflows."
                actionLabel="Start first task"
                onAction={() => setRoute("assistant")}
              />
            ) : (
              <GlassPanel
                variant="surface"
                padding="none"
                className="divide-y divide-[var(--border-hairline)] overflow-hidden"
              >
                {recentTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setRoute("tasks")}
                    className="w-full text-left px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-[var(--surface-elevated)]/80 transition-colors duration-150"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-[var(--ink-primary)] truncate m-0">
                        {task.instruction}
                      </p>
                      <p className="font-mono text-[11px] text-[var(--ink-secondary)] mt-0.5 mb-0">
                        {task.id} · {task.steps.length} step(s) · {task.provider_id}
                      </p>
                    </div>
                    <TaskStatusBadge status={task.status} />
                  </button>
                ))}
              </GlassPanel>
            )}
          </section>

          <section aria-labelledby="active-workflows-heading" className="flex flex-col gap-3">
            <SectionHeader
              id="active-workflows-heading"
              title="Workflow Templates"
              description={
                scheduledCount > 0
                  ? `${scheduledCount} in-app schedule(s) active while AgentOS is open.`
                  : "Reusable task templates ready to run on demand."
              }
              action={
                <Button variant="ghost" size="sm" onClick={() => setRoute("workflows")}>
                  Manage
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden={true} />
                </Button>
              }
            />
            {workflows.length === 0 ? (
              <GlassPanel variant="surface" padding="md">
                <p className="text-[13px] text-[var(--ink-secondary)] m-0">
                  No workflows configured yet. Create reusable instruction templates in Workflows.
                </p>
              </GlassPanel>
            ) : (
              <GlassPanel
                variant="surface"
                padding="none"
                className="divide-y divide-[var(--border-hairline)] overflow-hidden"
              >
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-[var(--ink-primary)] truncate m-0">
                        {wf.name}
                      </p>
                      <p className="text-[12px] text-[var(--ink-secondary)] truncate mt-0.5 mb-0">
                        {wf.description}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-mono text-[var(--ink-secondary)] shrink-0">
                      <Clock className="w-3 h-3" aria-hidden={true} />
                      {wf.schedule_enabled ? `Every ${wf.schedule_interval_minutes}m` : "Manual"}
                    </span>
                  </div>
                ))}
              </GlassPanel>
            )}
          </section>
        </div>

        {/* Right column: Provider Status, Workspaces & Security, System Runtime */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <GlassPanel
            as="section"
            aria-labelledby="readiness-heading"
            variant="surface"
            padding="md"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="readiness-heading" className="text-[14px] font-semibold m-0">
                AI Provider Connection
              </h2>
              <StatusIndicator
                tone={activeProvider?.ready ? "ready" : "warning"}
                label={`${readyProviders.length} ready`}
              />
            </div>
            <p className="text-[15px] font-semibold text-[var(--ink-primary)] mt-3 mb-0">
              {activeProvider?.display_name ?? "Not selected"}
            </p>
            <p className="text-[12px] font-mono text-[var(--ink-secondary)] mt-0.5 mb-0">
              {bootstrap?.settings.default_model ?? "No model configured"}
            </p>
            <div className="mt-4 pt-3 border-t border-[var(--border-hairline)]">
              <Button variant="secondary" size="sm" onClick={() => setRoute("settings")}>
                Manage API keys & models
              </Button>
            </div>
          </GlassPanel>

          <GlassPanel as="section" aria-labelledby="posture-heading" variant="surface" padding="md">
            <h2 id="posture-heading" className="text-[14px] font-semibold m-0">
              Permissions & Security
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-[13px]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <FolderLock
                    className="w-4 h-4 text-[var(--ink-secondary)] mt-0.5 shrink-0"
                    aria-hidden={true}
                  />
                  <div>
                    <p className="font-medium text-[var(--ink-primary)] m-0">
                      {workspaces.length === 0
                        ? "No workspaces authorized"
                        : `${workspaces.length} authorized ${workspaces.length === 1 ? "directory" : "directories"}`}
                    </p>
                    <p className="text-[12px] text-[var(--ink-secondary)] mt-0.5 mb-0">
                      Default-deny filesystem boundaries enforced.
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRoute("settings")}>
                  Configure
                </Button>
              </div>

              <div className="pt-3 border-t border-[var(--border-hairline)] flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <ShieldCheck
                    className="w-4 h-4 text-[var(--success-ink)] mt-0.5 shrink-0"
                    aria-hidden={true}
                  />
                  <div>
                    <p className="font-medium text-[var(--ink-primary)] m-0">
                      {bootstrap?.keychain.persistent
                        ? "OS Keychain vault active"
                        : "Ephemeral session vault"}
                    </p>
                    <p className="text-[12px] text-[var(--ink-secondary)] mt-0.5 mb-0">
                      Terminal execution{" "}
                      {bootstrap?.settings.terminal_enabled
                        ? "enabled (allowlisted)"
                        : "disabled by default"}
                      .
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRoute("activity")}>
                  Audit log
                </Button>
              </div>
            </div>
          </GlassPanel>

          {bootstrap && (
            <GlassPanel
              as="section"
              aria-labelledby="runtime-heading"
              variant="subtle"
              padding="md"
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-[var(--ink-secondary)]" aria-hidden={true} />
                  <h2 id="runtime-heading" className="text-[13.5px] font-semibold m-0">
                    System Status
                  </h2>
                </span>
                <Button variant="ghost" size="sm" onClick={() => void refreshAll()}>
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
                  Refresh
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-[12px] m-0">
                <div>
                  <dt className="text-[var(--ink-secondary)]">Recorded tasks</dt>
                  <dd className="font-mono font-semibold text-[var(--ink-primary)] mt-0.5 m-0">
                    {Math.max(bootstrap.counts.tasks, totalTaskCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-secondary)]">Architecture</dt>
                  <dd className="font-mono text-[var(--ink-primary)] mt-0.5 m-0">
                    {bootstrap.app.arch}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[var(--ink-secondary)]">Credential storage</dt>
                  <dd className="font-mono text-[var(--ink-primary)] mt-0.5 m-0 truncate">
                    {bootstrap.keychain.backend}
                  </dd>
                </div>
              </dl>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}
