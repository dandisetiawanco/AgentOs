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
  AgentOSLogo,
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
      <div className="flex flex-col gap-6">
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
      {/* Floating Liquid Glass Hero */}
      <GlassPanel variant="frosted" padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex items-start gap-4">
            <div className="hidden sm:block pt-0.5 shrink-0">
              <AgentOSLogo size={32} showWordmark={false} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <StatusIndicator
                  tone={emergencyActive ? "error" : "ready"}
                  label={emergencyActive ? "Emergency stop active" : "Local runtime active"}
                />
                {bootstrap && (
                  <span className="type-meta font-normal text-[var(--ink-secondary)]">
                    {bootstrap.app.platform} {bootstrap.app.arch} · Python{" "}
                    {bootstrap.app.python_version}
                  </span>
                )}
              </div>
              <h1 className="type-display text-[var(--ink-primary)] m-0">AgentOS Workspace</h1>
              <p className="type-body text-[var(--ink-secondary)] mt-2 mb-0 max-w-[58ch]">
                Intelligence that takes action. Local-first autonomous workspace with explicit
                permission boundaries and verifiable execution.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-center">
            <Button
              variant={emergencyActive ? "primary" : "danger"}
              size="sm"
              onClick={() => void handleToggleEmergencyStop()}
            >
              <ShieldAlert className="w-4 h-4" aria-hidden={true} />
              {emergencyActive ? "Clear emergency stop" : "Emergency stop"}
            </Button>
            <Button variant="primary" size="md" onClick={() => setRoute("assistant")}>
              <Play className="w-4 h-4" aria-hidden={true} />
              Start session
            </Button>
          </div>
        </div>
      </GlassPanel>

      {emergencyActive && (
        <div
          role="alert"
          className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-tint)] text-[var(--danger-ink)] px-5 py-3.5 type-secondary font-medium"
        >
          Emergency stop is active. All non-read-only tool executions are blocked until cleared.
        </div>
      )}

      {/* Primary Two-Column Layout: Recent Work (8 cols) + Quiet Status Inspector (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 flex flex-col gap-6">
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
                description="Start a session to submit your first natural-language instruction, or launch a reusable template below."
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
                    className="w-full text-left px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[var(--surface-elevated)]/85 transition-colors duration-150"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="type-body font-medium text-[var(--ink-primary)] break-words [overflow-wrap:anywhere] m-0">
                        {task.instruction}
                      </p>
                      <p className="type-meta font-normal text-[var(--ink-secondary)] mt-1 mb-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono">{task.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {task.steps.length} {task.steps.length === 1 ? "step" : "steps"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{task.provider_id}</span>
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
                <p className="type-secondary text-[var(--ink-secondary)] m-0">
                  No workflows configured yet. Create reusable instruction templates in the workflow
                  library.
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
                    className="px-5 py-4 flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="type-body font-medium text-[var(--ink-primary)] m-0">
                        {wf.name}
                      </p>
                      <p className="type-secondary text-[var(--ink-secondary)] mt-1 mb-0 break-words [overflow-wrap:anywhere]">
                        {wf.description}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 type-meta text-[var(--ink-secondary)] shrink-0 pt-0.5">
                      <Clock className="w-3.5 h-3.5" aria-hidden={true} />
                      {wf.schedule_enabled ? `Every ${wf.schedule_interval_minutes}m` : "Manual"}
                    </span>
                  </div>
                ))}
              </GlassPanel>
            )}
          </section>
        </div>

        {/* Right Column: Unified Quiet Secondary Inspector */}
        <div className="lg:col-span-4">
          <GlassPanel
            as="section"
            aria-label="Workspace readiness and system status"
            variant="surface"
            padding="none"
            className="divide-y divide-[var(--border-hairline)] overflow-hidden"
          >
            {/* AI Provider Connection */}
            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h2
                  id="readiness-heading"
                  className="type-section-title text-[var(--ink-primary)] m-0"
                >
                  AI Provider
                </h2>
                <StatusIndicator
                  tone={activeProvider?.ready ? "ready" : "warning"}
                  label={`${readyProviders.length} ready`}
                />
              </div>
              <p className="type-body font-semibold text-[var(--ink-primary)] mt-3 mb-0">
                {activeProvider?.display_name ?? "Not selected"}
              </p>
              <p className="type-meta font-mono font-normal text-[var(--ink-secondary)] mt-0.5 mb-0 break-words [overflow-wrap:anywhere]">
                {bootstrap?.settings.default_model ?? "No model configured"}
              </p>
              <div className="mt-4">
                <Button variant="secondary" size="sm" onClick={() => setRoute("settings")}>
                  Manage API keys & models
                </Button>
              </div>
            </div>

            {/* Permissions & Security */}
            <div className="p-5 flex flex-col gap-4">
              <h2 id="posture-heading" className="type-section-title text-[var(--ink-primary)] m-0">
                Permissions & Security
              </h2>

              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <FolderLock
                    className="w-4 h-4 text-[var(--ink-secondary)] mt-1 shrink-0"
                    aria-hidden={true}
                  />
                  <div className="min-w-0">
                    <p className="type-secondary font-medium text-[var(--ink-primary)] m-0">
                      {workspaces.length === 0
                        ? "No workspaces authorized"
                        : `${workspaces.length} authorized ${workspaces.length === 1 ? "directory" : "directories"}`}
                    </p>
                    <p className="type-meta font-normal text-[var(--ink-secondary)] mt-0.5 mb-0">
                      Default-deny filesystem boundaries enforced.
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRoute("settings")}>
                  Configure
                </Button>
              </div>

              <div className="flex items-start justify-between gap-3 pt-3 border-t border-[var(--border-hairline)]">
                <div className="flex items-start gap-2.5 min-w-0">
                  <ShieldCheck
                    className="w-4 h-4 text-[var(--success-ink)] mt-1 shrink-0"
                    aria-hidden={true}
                  />
                  <div className="min-w-0">
                    <p className="type-secondary font-medium text-[var(--ink-primary)] m-0">
                      {bootstrap?.keychain.persistent
                        ? "OS Keychain vault active"
                        : "Ephemeral session vault"}
                    </p>
                    <p className="type-meta font-normal text-[var(--ink-secondary)] mt-0.5 mb-0">
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

            {/* Quiet Technical System Status Footer */}
            {bootstrap && (
              <div className="p-5 bg-[var(--surface-recessed)]/55">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="inline-flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[var(--ink-secondary)]" aria-hidden={true} />
                    <h2
                      id="runtime-heading"
                      className="type-section-title text-[var(--ink-secondary)] m-0"
                    >
                      System Status
                    </h2>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void refreshAll()}>
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden={true} />
                    Refresh
                  </Button>
                </div>
                <dl className="grid grid-cols-2 gap-3 type-meta m-0">
                  <div>
                    <dt className="font-normal text-[var(--ink-secondary)]">Recorded tasks</dt>
                    <dd className="type-secondary font-semibold tabular-nums text-[var(--ink-primary)] mt-0.5 m-0">
                      {Math.max(bootstrap.counts.tasks, totalTaskCount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-normal text-[var(--ink-secondary)]">Architecture</dt>
                    <dd className="font-mono font-normal text-[var(--ink-primary)] mt-0.5 m-0">
                      {bootstrap.app.arch}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-normal text-[var(--ink-secondary)]">Credential storage</dt>
                    <dd className="font-mono font-normal text-[var(--ink-primary)] mt-0.5 m-0 break-words [overflow-wrap:anywhere]">
                      {bootstrap.keychain.backend}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
