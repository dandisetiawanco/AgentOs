import React, { useCallback, useEffect, useState } from "react";
import { Download, Plus, RotateCcw, ShieldAlert, Sparkles, Square } from "lucide-react";
import type { ConversationRecord, TaskRecord } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  ModalDialog,
  RiskBadge,
  SectionHeader,
  TaskStatusBadge,
} from "@agentos/ui";
import { AgentComposer, type ComposerAttachment } from "../components/AgentComposer.js";
import { TaskTimeline } from "../components/TaskTimeline.js";
import { useApp } from "../stores/AppContext.js";

function downloadTextFile(filename: string, content: string, mime = "text/markdown"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const STARTER_PROMPTS = [
  "Inspect system health diagnostics",
  "List files and detect duplicate files in workspace",
  "Suggest folder organization for this workspace",
  "Create folder reports in workspace",
];

export function AssistantPage(): React.JSX.Element {
  const { client, settings, providers, workspaces, notify, setRoute } = useApp();

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConv, setActiveConv] = useState<ConversationRecord | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [instruction, setInstruction] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState<string>(
    settings?.default_provider_id ?? "mock",
  );
  const [selectedModel, setSelectedModel] = useState<string>(
    settings?.default_model ?? "mock-deterministic-v1",
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(workspaces[0]?.id ?? "");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadingInit, setLoadingInit] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState<boolean>(false);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  const [emergencyActive, setEmergencyActive] = useState<boolean>(false);

  useEffect(() => {
    if (settings) {
      setSelectedProvider((prev) => prev || settings.default_provider_id);
      setSelectedModel((prev) => prev || settings.default_model);
    }
  }, [settings]);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0 && workspaces[0]) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [selectedWorkspaceId, workspaces]);

  const loadConversations = useCallback(async () => {
    if (!client) return;
    setLoadingInit(true);
    setPageError(null);
    try {
      const [list, caps] = await Promise.all([
        client.listConversations(),
        client.getComputerUseCapabilities().catch(() => null),
      ]);
      if (caps) {
        setEmergencyActive(caps.emergency_stop_active);
      }
      setConversations(list);
      if (list.length > 0 && list[0]) {
        const detailed = await client.getConversation(list[0].id);
        setActiveConv(detailed);
        const lastTaskMsg = [...(detailed.messages ?? [])]
          .reverse()
          .find((m) => Boolean(m.task_id));
        if (lastTaskMsg?.task_id) {
          const t = await client.getTask(lastTaskMsg.task_id);
          setActiveTask(t);
        }
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingInit(false);
    }
  }, [client]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const activeTaskId = activeTask?.id ?? null;
  const activeTaskStatus = activeTask?.status ?? null;
  useEffect(() => {
    if (!client || !activeTaskId || !activeTaskStatus) return;
    if (["completed", "failed", "cancelled"].includes(activeTaskStatus)) return;

    const controller = new AbortController();
    void client
      .subscribeTaskEvents(
        activeTaskId,
        (eventName, data) => {
          setLiveEvents((prev) => [...prev.slice(-12), `${eventName}: ${JSON.stringify(data)}`]);
          void client.getTask(activeTaskId).then((fresh) => setActiveTask(fresh));
        },
        controller.signal,
      )
      .catch(() => {
        // Stream aborted on unmount or completion.
      });

    return () => controller.abort();
  }, [client, activeTaskId, activeTaskStatus]);

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

  const handleSelectConversation = async (convId: string) => {
    if (!client) return;
    setPageError(null);
    try {
      const detailed = await client.getConversation(convId);
      setActiveConv(detailed);
      const lastTaskMsg = [...(detailed.messages ?? [])].reverse().find((m) => Boolean(m.task_id));
      if (lastTaskMsg?.task_id) {
        setActiveTask(await client.getTask(lastTaskMsg.task_id));
      } else {
        setActiveTask(null);
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleNewConversation = async () => {
    if (!client) return;
    setPageError(null);
    try {
      const created = await client.createConversation({
        title: `Session ${conversations.length + 1}`,
        workspace_id: selectedWorkspaceId || null,
        provider_id: selectedProvider,
        model: selectedModel,
      });
      setConversations((prev) => [created, ...prev]);
      setActiveConv(created);
      setActiveTask(null);
      setLiveEvents([]);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleProviderChange = (providerId: string) => {
    setSelectedProvider(providerId);
    const found = providers.find((p) => p.id === providerId);
    if (found) {
      setSelectedModel(found.default_model);
    }
  };

  const handleSubmitInstruction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!client || !instruction.trim()) return;
    setSubmitting(true);
    setPageError(null);
    setLiveEvents([]);
    try {
      let convId = activeConv?.id ?? null;
      if (!convId) {
        const created = await client.createConversation({
          title: instruction.trim().slice(0, 60),
          workspace_id: selectedWorkspaceId || null,
          provider_id: selectedProvider,
          model: selectedModel,
        });
        convId = created.id;
        setConversations((prev) => [created, ...prev]);
      }

      const task = await client.createTask({
        instruction: instruction.trim(),
        conversation_id: convId,
        workspace_id: selectedWorkspaceId || null,
        provider_id: selectedProvider,
        model: selectedModel,
        attachments,
        auto_execute_read_only: true,
      });

      setActiveTask(task);
      setInstruction("");
      setAttachments([]);
      if (convId) {
        setActiveConv(await client.getConversation(convId));
      }
      if (task.status === "awaiting_approval") {
        setApprovalDialogOpen(true);
        notify("Plan ready: review sensitive steps before execution.", "info");
      } else if (task.status === "completed") {
        notify("Task executed and verified.", "success");
      } else if (task.status === "failed") {
        notify(task.result_summary ?? "Task failed.", "error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageError(msg);
      notify(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovalDecision = async (approve: boolean) => {
    if (!client || !activeTask) return;
    setSubmitting(true);
    setApprovalDialogOpen(false);
    try {
      const updated = await client.approveTask(activeTask.id, { approve, ttl_minutes: 15 });
      setActiveTask(updated);
      if (activeConv) {
        setActiveConv(await client.getConversation(activeConv.id));
      }
      notify(
        approve
          ? updated.status === "completed"
            ? "Approved steps executed and verified."
            : `Task status: ${updated.status}`
          : "Execution declined and task cancelled.",
        approve && updated.status === "completed" ? "success" : "info",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageError(msg);
      notify(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelTask = async () => {
    if (!client || !activeTask) return;
    try {
      const cancelled = await client.cancelTask(activeTask.id);
      setActiveTask(cancelled);
      notify("Task cancelled.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRollback = async () => {
    if (!client || !activeTask) return;
    try {
      const res = await client.rollbackTask(activeTask.id);
      notify(`Restored ${res.restored_count} recorded file operation(s).`, "success");
      setActiveTask(await client.getTask(activeTask.id));
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleExportReport = async () => {
    if (!client || !activeTask) return;
    try {
      const rep = await client.exportTaskReport(activeTask.id);
      downloadTextFile(rep.filename, rep.markdown, "text/markdown");
      notify(`Exported ${rep.filename}.`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  if (loadingInit) {
    return <LoadingState label="Loading assistant workspace..." />;
  }

  const activeProviderObj = providers.find((p) => p.id === selectedProvider);
  const canRollback = Boolean(activeTask?.steps.some((s) => Boolean(s.rollback)));
  const isTaskRunning = Boolean(
    activeTask && !["completed", "failed", "cancelled"].includes(activeTask.status),
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        title="Assistant"
        description="Turn natural-language instructions into structured plans, explicit permission gates, and verified results."
        action={
          <>
            <Button variant="secondary" size="sm" onClick={() => void handleNewConversation()}>
              <Plus className="w-3.5 h-3.5" aria-hidden={true} />
              New session
            </Button>
            <Button
              variant={emergencyActive ? "primary" : "danger"}
              size="sm"
              onClick={() => void handleToggleEmergencyStop()}
            >
              <ShieldAlert className="w-3.5 h-3.5" aria-hidden={true} />
              {emergencyActive ? "Clear emergency stop" : "Emergency stop"}
            </Button>
            {isTaskRunning && (
              <Button variant="danger" size="sm" onClick={() => void handleCancelTask()}>
                <Square className="w-3.5 h-3.5" aria-hidden={true} />
                Stop task
              </Button>
            )}
          </>
        }
      />

      {emergencyActive && (
        <div
          role="alert"
          className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-tint)] text-[var(--danger-ink)] px-5 py-3.5 type-secondary font-medium"
        >
          Emergency stop is active. All non-read-only tool executions are blocked until cleared.
        </div>
      )}

      {pageError && <ErrorState message={pageError} />}

      {/* Translucent Inline Session Controls */}
      <GlassPanel variant="surface" padding="sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="asst-provider"
              className="block type-meta text-[var(--ink-secondary)] mb-1.5"
            >
              AI Provider
            </label>
            <select
              id="asst-provider"
              value={selectedProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="glass-input w-full px-3 py-2"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} {p.ready ? "" : "(API key required)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="asst-model"
              className="block type-meta text-[var(--ink-secondary)] mb-1.5"
            >
              Model
            </label>
            <input
              id="asst-model"
              type="text"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="glass-input w-full px-3 py-2 font-mono"
            />
          </div>

          <div>
            <label
              htmlFor="asst-workspace"
              className="block type-meta text-[var(--ink-secondary)] mb-1.5"
            >
              Authorized Workspace
            </label>
            <div className="flex gap-2">
              <select
                id="asst-workspace"
                value={selectedWorkspaceId}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                className="glass-input flex-1 min-w-0 px-3 py-2"
              >
                <option value="">No workspace (read-only diagnostics/web)</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name} ({ws.read_only ? "RO" : "RW"})
                  </option>
                ))}
              </select>
              {workspaces.length === 0 && (
                <Button variant="secondary" size="sm" onClick={() => setRoute("settings")}>
                  Add
                </Button>
              )}
            </div>
          </div>
        </div>
      </GlassPanel>

      {activeProviderObj?.capabilities.is_mock && (
        <div className="rounded-[12px] border border-[var(--warning-border)] bg-[var(--warning-tint)] text-[var(--warning-ink)] px-4 py-3 type-secondary">
          Offline Deterministic Test Mode is active. Plans use local deterministic rules without
          calling external APIs. Configure a live provider in Settings whenever ready.
        </div>
      )}

      {/* Split AI Workspace: Conversation Stream + Floating Glass Execution Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section
          aria-label="Conversation and command input"
          className="xl:col-span-7 flex flex-col gap-5"
        >
          {conversations.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              {conversations.slice(0, 8).map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => void handleSelectConversation(conv.id)}
                  className={[
                    "px-3.5 py-1.5 rounded-full type-meta border shrink-0 transition-colors duration-150",
                    activeConv?.id === conv.id
                      ? "bg-[var(--accent-tint)] border-[var(--accent-border)] text-[var(--accent-ink)]"
                      : "bg-[var(--glass-surface)] border-[var(--border-hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
                  ].join(" ")}
                >
                  {conv.title}
                </button>
              ))}
            </div>
          )}

          <GlassPanel
            variant="surface"
            padding="none"
            className="min-h-[260px] max-h-[360px] overflow-y-auto p-5 flex flex-col gap-4"
          >
            {!activeConv?.messages || activeConv.messages.length === 0 ? (
              <div className="my-auto py-4 flex flex-col gap-5">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-[11px] bg-[var(--accent-tint)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent-ink)] shrink-0">
                    <Sparkles className="w-4 h-4" aria-hidden={true} />
                  </span>
                  <div className="min-w-0">
                    <p className="type-section-title text-[var(--ink-primary)] m-0">
                      Ready for an instruction
                    </p>
                    <p className="type-secondary text-[var(--ink-secondary)] mt-1 mb-0">
                      Read-only tools run and verify automatically. Mutations pause for explicit
                      approval.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {STARTER_PROMPTS.map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => setInstruction(sample)}
                      className="text-left type-secondary px-4 py-3 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)]/85 hover:border-[var(--accent-border)] hover:bg-[var(--accent-tint)]/35 text-[var(--ink-primary)] transition-colors duration-150"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeConv.messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={[
                        "max-w-[90%] rounded-[16px] px-4 py-3.5 type-body border",
                        isUser
                          ? "bg-[var(--accent-tint)] border-[var(--accent-border)] text-[var(--ink-primary)] rounded-br-[4px]"
                          : "bg-[var(--surface-elevated)] border-[var(--border-hairline)] text-[var(--ink-primary)] rounded-bl-[4px] shadow-[var(--shadow-surface)]",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-4 type-meta text-[var(--ink-secondary)] mb-1.5">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink-primary)]">
                          {!isUser && (
                            <span
                              aria-hidden="true"
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: "var(--accent)" }}
                            />
                          )}
                          {isUser ? "You" : "AgentOS"}
                        </span>
                        {msg.task_id && (
                          <button
                            type="button"
                            onClick={() =>
                              client &&
                              void client.getTask(msg.task_id!).then((t) => setActiveTask(t))
                            }
                            className="font-mono type-meta underline text-[var(--accent-ink)]"
                          >
                            {msg.task_id}
                          </button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] m-0">
                        {msg.content}
                      </p>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {msg.attachments.map((att, idx) => (
                            <span
                              key={`${att.name}-${idx}`}
                              className="type-meta font-mono px-2.5 py-0.5 rounded-full bg-[var(--surface-recessed)] border border-[var(--border-hairline)]"
                            >
                              {att.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </GlassPanel>

          <AgentComposer
            instruction={instruction}
            onInstructionChange={setInstruction}
            attachments={attachments}
            onAddAttachments={(files) => setAttachments((prev) => [...prev, ...files])}
            onRemoveAttachment={(index) =>
              setAttachments((prev) => prev.filter((_, i) => i !== index))
            }
            submitting={submitting}
            onSubmit={(e) => void handleSubmitInstruction(e)}
          />
        </section>

        {/* Right: Floating Liquid Glass Execution Plan & Verification Inspector */}
        <section
          aria-label="Execution plan and verification inspector"
          className="xl:col-span-5 flex flex-col gap-5"
        >
          {!activeTask ? (
            <EmptyState
              title="No active execution plan"
              description="Submit an instruction on the left to inspect its structured plan, risk classifications, permission previews, and verified tool outputs here."
            />
          ) : (
            <GlassPanel variant="frosted" padding="md" className="flex flex-col gap-5">
              <div className="flex flex-col gap-3 pb-4 border-b border-[var(--border-hairline)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono type-meta font-normal text-[var(--ink-secondary)]">
                    {activeTask.id}
                  </span>
                  <TaskStatusBadge status={activeTask.status} />
                </div>
                <h2 className="type-section-title m-0 text-[var(--ink-primary)] break-words [overflow-wrap:anywhere]">
                  {activeTask.instruction}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {canRollback && (
                    <Button variant="secondary" size="sm" onClick={() => void handleRollback()}>
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden={true} />
                      Restore files
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => void handleExportReport()}>
                    <Download className="w-3.5 h-3.5" aria-hidden={true} />
                    Export report
                  </Button>
                </div>
              </div>

              {/* High-contrast opaque approval callout */}
              {activeTask.status === "awaiting_approval" && (
                <div className="rounded-[12px] border border-[var(--warning-border)] bg-[var(--warning-tint)] p-4 text-[var(--warning-ink)] flex flex-col gap-3">
                  <div className="flex items-center gap-2 type-body font-semibold">
                    <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden={true} />
                    <span>Approval required before sensitive execution</span>
                  </div>
                  <p className="type-secondary m-0">
                    Review the planned steps and exact arguments below. Nothing has been modified
                    yet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={() => setApprovalDialogOpen(true)}>
                      Review & approve
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleApprovalDecision(false)}
                    >
                      Decline plan
                    </Button>
                  </div>
                </div>
              )}

              {/* Execution Metrics Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-[12px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)] px-4 py-3">
                <div>
                  <span className="type-meta font-normal text-[var(--ink-secondary)] block">
                    Tool calls
                  </span>
                  <span className="type-secondary font-semibold tabular-nums text-[var(--ink-primary)]">
                    {activeTask.usage.tool_calls}/{activeTask.budget.max_tool_calls}
                  </span>
                </div>
                <div>
                  <span className="type-meta font-normal text-[var(--ink-secondary)] block">
                    Tokens
                  </span>
                  <span className="type-secondary font-semibold tabular-nums text-[var(--ink-primary)]">
                    {activeTask.usage.total_tokens}/{activeTask.budget.max_tokens}
                  </span>
                </div>
                <div>
                  <span className="type-meta font-normal text-[var(--ink-secondary)] block">
                    Duration
                  </span>
                  <span className="type-secondary font-semibold tabular-nums text-[var(--ink-primary)]">
                    {activeTask.usage.elapsed_sec}s
                  </span>
                </div>
                <div>
                  <span className="type-meta font-normal text-[var(--ink-secondary)] block">
                    Est. cost
                  </span>
                  <span className="type-secondary font-semibold tabular-nums text-[var(--ink-primary)]">
                    {activeTask.usage.estimated_cost_usd !== null
                      ? `$${activeTask.usage.estimated_cost_usd.toFixed(5)}`
                      : "n/a"}
                  </span>
                </div>
              </div>

              <TaskTimeline steps={activeTask.steps} showResults={true} />

              {liveEvents.length > 0 && (
                <details className="type-meta">
                  <summary className="text-[var(--ink-secondary)] select-none">
                    Live SSE stream ({liveEvents.length} events)
                  </summary>
                  <pre className="mt-2 p-3 rounded-[10px] bg-[var(--surface-recessed)] border border-[var(--border-hairline)] overflow-x-auto type-meta font-mono font-normal m-0">
                    {liveEvents.join("\n")}
                  </pre>
                </details>
              )}
            </GlassPanel>
          )}
        </section>
      </div>

      {/* Native <dialog> Permission Confirmation Modal */}
      <ModalDialog
        open={approvalDialogOpen && activeTask?.status === "awaiting_approval"}
        title="Approve sensitive execution plan"
        description="Inspect the exact tools and arguments below before granting a time-limited task permission (15 min)."
        onClose={() => setApprovalDialogOpen(false)}
        allowBackdropDismiss={false}
      >
        {activeTask && (
          <div className="flex flex-col gap-4">
            <ul className="m-0 p-0 list-none flex flex-col gap-3">
              {activeTask.steps
                .filter((s) => s.requires_approval)
                .map((s) => (
                  <li
                    key={s.id}
                    className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-recessed)] p-4 type-secondary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="type-body font-semibold text-[var(--ink-primary)]">
                        {s.title}
                      </span>
                      <RiskBadge level={s.risk_level} />
                    </div>
                    <p className="font-mono type-meta font-normal text-[var(--ink-secondary)] mt-1 mb-0">
                      {s.tool_id}
                    </p>
                    <pre className="mt-2.5 p-3 rounded-[10px] bg-[var(--surface-elevated)] border border-[var(--border-hairline)] type-meta font-mono font-normal overflow-x-auto m-0">
                      {JSON.stringify(s.arguments, null, 2)}
                    </pre>
                  </li>
                ))}
            </ul>
            <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--border-hairline)]">
              <Button
                variant="secondary"
                autoFocus
                onClick={() => void handleApprovalDecision(false)}
              >
                Decline
              </Button>
              <Button variant="primary" onClick={() => void handleApprovalDecision(true)}>
                Approve & execute
              </Button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
