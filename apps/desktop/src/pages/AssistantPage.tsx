import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Square,
  X,
} from "lucide-react";
import type { ConversationRecord, TaskRecord } from "@agentos/shared";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  ModalDialog,
  RiskBadge,
  TaskStatusBadge,
} from "@agentos/ui";
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
  const [attachments, setAttachments] = useState<Array<{ name: string; size_bytes: number }>>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadingInit, setLoadingInit] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState<boolean>(false);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      const list = await client.listConversations();
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

  // Subscribe to live SSE updates while a task is active.
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

  const handleFileAttach = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, size_bytes: f.size })),
    ]);
    event.target.value = "";
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Assistant</h1>
          <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
            Turn natural-language instructions into structured plans, explicit permission gates, and verified results.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void handleNewConversation()}>
            <Plus className="w-3.5 h-3.5" aria-hidden={true} />
            New session
          </Button>
          {activeTask && !["completed", "failed", "cancelled"].includes(activeTask.status) && (
            <Button variant="danger" size="sm" onClick={() => void handleCancelTask()}>
              <Square className="w-3.5 h-3.5" aria-hidden={true} />
              Stop task
            </Button>
          )}
        </div>
      </div>

      {pageError && <ErrorState message={pageError} />}

      {/* Context bar: Provider, Model, Workspace */}
      <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-3.5 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label htmlFor="asst-provider" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            AI Provider
          </label>
          <select
            id="asst-provider"
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-2.5 py-1.5 text-[13px]"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} {p.ready ? "" : "(API key required)"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="asst-model" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            Model
          </label>
          <input
            id="asst-model"
            type="text"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-2.5 py-1.5 text-[13px] font-mono"
          />
        </div>

        <div>
          <label htmlFor="asst-workspace" className="block text-[12px] font-medium text-[var(--ink-secondary)] mb-1">
            Authorized Workspace
          </label>
          <div className="flex gap-1.5">
            <select
              id="asst-workspace"
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              className="flex-1 min-w-0 rounded-[6px] border border-[var(--border-control)] bg-[var(--canvas)] px-2.5 py-1.5 text-[13px]"
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

      {activeProviderObj?.capabilities.is_mock && (
        <div className="rounded-[6px] border border-[var(--warning-border)] bg-[var(--warning-tint)] text-[var(--warning-ink)] px-3.5 py-2 text-[12px]">
          Offline Deterministic Test Mode is active. Plans use deterministic local rules without calling external AI APIs. Configure a live provider in Settings whenever ready.
        </div>
      )}

      {/* Split Workspace: Conversation + Plan/Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Conversation history & command composer */}
        <section
          aria-label="Conversation and command input"
          className="xl:col-span-6 flex flex-col gap-4"
        >
          {conversations.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {conversations.slice(0, 8).map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => void handleSelectConversation(conv.id)}
                  className={[
                    "px-2.5 py-1 rounded-[6px] text-[12px] border shrink-0 transition-colors",
                    activeConv?.id === conv.id
                      ? "bg-[var(--surface-elevated)] border-[var(--accent)] font-medium text-[var(--ink-primary)]"
                      : "bg-[var(--surface-recessed)] border-[var(--border-hairline)] text-[var(--ink-secondary)]",
                  ].join(" ")}
                >
                  {conv.title}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-4 min-h-[260px] max-h-[420px] overflow-y-auto flex flex-col gap-3">
            {!activeConv?.messages || activeConv.messages.length === 0 ? (
              <div className="text-[13px] text-[var(--ink-secondary)]">
                <p className="font-medium text-[var(--ink-primary)]">Ready for an instruction</p>
                <p className="mt-1">
                  Describe a concrete task. Read-only steps execute and verify automatically; file mutations, form submissions, and terminal commands pause for your explicit approval.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    "Inspect system health diagnostics",
                    "List files and detect duplicate files in workspace",
                    "Suggest folder organization for this workspace",
                    "Create folder reports in workspace",
                  ].map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => setInstruction(sample)}
                      className="text-left text-[12px] px-2.5 py-1.5 rounded-[6px] border border-[var(--border-hairline)] bg-[var(--canvas)] hover:border-[var(--border-control)] text-[var(--ink-primary)]"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeConv.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={[
                    "rounded-[6px] px-3.5 py-2.5 text-[13px] border",
                    msg.role === "user"
                      ? "bg-[var(--canvas)] border-[var(--border-control)] ml-6"
                      : "bg-[var(--surface-recessed)] border-[var(--border-hairline)] mr-6",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between text-[11px] text-[var(--ink-secondary)] mb-1">
                    <span className="font-medium">{msg.role === "user" ? "You" : "AgentOS"}</span>
                    {msg.task_id && (
                      <button
                        type="button"
                        onClick={() =>
                          client &&
                          void client.getTask(msg.task_id!).then((t) => setActiveTask(t))
                        }
                        className="font-mono underline text-[var(--accent-ink)]"
                      >
                        {msg.task_id}
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap m-0">{msg.content}</p>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {msg.attachments.map((att, idx) => (
                        <span
                          key={`${att.name}-${idx}`}
                          className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--surface-elevated)] border border-[var(--border-hairline)]"
                        >
                          {att.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Command composer */}
          <form
            onSubmit={(e) => void handleSubmitInstruction(e)}
            className="rounded-[8px] border border-[var(--border-control)] bg-[var(--surface-elevated)] p-3.5 flex flex-col gap-3"
          >
            <label htmlFor="asst-instruction" className="text-[12px] font-medium text-[var(--ink-secondary)]">
              Instruction
            </label>
            <textarea
              id="asst-instruction"
              rows={3}
              required
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Example: Analyze workspace files, detect duplicates, and generate a Markdown summary report."
              className="w-full resize-y rounded-[6px] border border-[var(--border-hairline)] bg-[var(--canvas)] px-3 py-2 text-[14px]"
            />

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att, idx) => (
                  <span
                    key={`${att.name}-${idx}`}
                    className="inline-flex items-center gap-1.5 text-[12px] font-mono px-2 py-0.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--surface-recessed)]"
                  >
                    {att.name}
                    <button
                      type="button"
                      aria-label={`Remove attachment ${att.name}`}
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="w-3 h-3" aria-hidden={true} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="visually-hidden"
                  aria-label="Attach files"
                  onChange={handleFileAttach}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="w-3.5 h-3.5" aria-hidden={true} />
                  Attach file
                </Button>
              </div>
              <Button type="submit" variant="primary" loading={submitting}>
                <Play className="w-3.5 h-3.5" aria-hidden={true} />
                Plan & run
              </Button>
            </div>
          </form>
        </section>

        {/* Right: Structured Execution Plan, Approval Gate, Live Verification & Report */}
        <section
          aria-label="Execution plan and verification inspector"
          className="xl:col-span-6 flex flex-col gap-4"
        >
          {!activeTask ? (
            <EmptyState
              title="No active execution plan"
              description="Submit an instruction on the left to inspect its structured plan, risk classifications, permission previews, and verified tool outputs here."
            />
          ) : (
            <div className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-elevated)] p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-hairline)] pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-[var(--ink-secondary)]">
                      {activeTask.id}
                    </span>
                    <TaskStatusBadge status={activeTask.status} />
                  </div>
                  <h2 className="text-[15px] font-semibold mt-1">{activeTask.instruction}</h2>
                </div>
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

              {/* Approval banner when awaiting_approval */}
              {activeTask.status === "awaiting_approval" && (
                <div className="rounded-[6px] border border-[var(--warning-border)] bg-[var(--warning-tint)] p-4 text-[var(--warning-ink)] flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 font-semibold text-[14px]">
                    <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden={true} />
                    <span>Approval required before sensitive execution</span>
                  </div>
                  <p className="text-[13px] m-0">
                    Review the planned steps and affected targets below. Nothing has been modified yet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setApprovalDialogOpen(true)}
                    >
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

              {/* Budget & usage strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] rounded-[6px] bg-[var(--canvas)] border border-[var(--border-hairline)] p-3">
                <div>
                  <span className="text-[var(--ink-secondary)] block">Tool calls</span>
                  <span className="font-mono font-medium">
                    {activeTask.usage.tool_calls}/{activeTask.budget.max_tool_calls}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--ink-secondary)] block">Tokens</span>
                  <span className="font-mono font-medium">
                    {activeTask.usage.total_tokens}/{activeTask.budget.max_tokens}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--ink-secondary)] block">Duration</span>
                  <span className="font-mono font-medium">{activeTask.usage.elapsed_sec}s</span>
                </div>
                <div>
                  <span className="text-[var(--ink-secondary)] block">Est. cost</span>
                  <span className="font-mono font-medium">
                    {activeTask.usage.estimated_cost_usd !== null
                      ? `$${activeTask.usage.estimated_cost_usd.toFixed(5)}`
                      : "n/a"}
                  </span>
                </div>
              </div>

              {/* Execution Steps */}
              <ol className="m-0 p-0 list-none flex flex-col gap-3">
                {activeTask.steps.map((step) => {
                  const verified = Boolean(step.verification?.verified);
                  return (
                    <li
                      key={step.id}
                      className={[
                        "relative rounded-[6px] border p-3.5 bg-[var(--canvas)]",
                        step.status === "running"
                          ? "border-[var(--accent)]"
                          : "border-[var(--border-hairline)]",
                      ].join(" ")}
                    >
                      {step.status === "running" && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r bg-[var(--accent)]"
                        />
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[12px] font-mono text-[var(--ink-secondary)]">
                            #{step.step_index + 1}
                          </span>
                          <span className="text-[14px] font-medium truncate">{step.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <RiskBadge level={step.risk_level} />
                          <span className="text-[12px] font-mono text-[var(--ink-secondary)]">
                            {step.status}
                          </span>
                        </div>
                      </div>

                      <p className="text-[12px] font-mono text-[var(--ink-secondary)] mt-1">
                        {step.tool_id}
                        {step.duration_ms !== null ? ` (${step.duration_ms} ms)` : ""}
                      </p>

                      {step.description && (
                        <p className="text-[13px] text-[var(--ink-secondary)] mt-1 mb-0">
                          {step.description}
                        </p>
                      )}

                      {step.error_message && (
                        <p className="text-[13px] text-[var(--danger-ink)] mt-2 mb-0 font-medium">
                          {step.error_message}
                        </p>
                      )}

                      {step.result && (
                        <details className="mt-2.5 text-[12px]">
                          <summary className="font-medium text-[var(--ink-primary)]">
                            Result: {String(step.result.summary ?? "Completed")}
                            {verified && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[var(--success-ink)]">
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden={true} />
                                Verified
                              </span>
                            )}
                          </summary>
                          <pre className="mt-2 p-2.5 rounded bg-[var(--surface-recessed)] overflow-x-auto text-[11px] max-h-[220px]">
                            {JSON.stringify(step.result.data ?? step.result, null, 2)}
                          </pre>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>

              {liveEvents.length > 0 && (
                <details className="text-[12px]">
                  <summary className="text-[var(--ink-secondary)]">
                    Live SSE stream ({liveEvents.length} events)
                  </summary>
                  <pre className="mt-2 p-2.5 rounded bg-[var(--surface-recessed)] overflow-x-auto text-[11px]">
                    {liveEvents.join("\n")}
                  </pre>
                </details>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Native <dialog> permission confirmation modal (safe Cancel gets autofocus) */}
      <ModalDialog
        open={approvalDialogOpen && activeTask?.status === "awaiting_approval"}
        title="Approve sensitive execution plan"
        description="Inspect the exact tools and arguments below before granting a time-limited task permission (15 min)."
        onClose={() => setApprovalDialogOpen(false)}
        allowBackdropDismiss={false}
      >
        {activeTask && (
          <div className="flex flex-col gap-4">
            <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
              {activeTask.steps
                .filter((s) => s.requires_approval)
                .map((s) => (
                  <li
                    key={s.id}
                    className="rounded-[6px] border border-[var(--border-hairline)] bg-[var(--canvas)] p-3 text-[13px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.title}</span>
                      <RiskBadge level={s.risk_level} />
                    </div>
                    <p className="font-mono text-[12px] text-[var(--ink-secondary)] mt-1">
                      {s.tool_id}
                    </p>
                    <pre className="mt-1.5 p-2 rounded bg-[var(--surface-recessed)] text-[11px] overflow-x-auto">
                      {JSON.stringify(s.arguments, null, 2)}
                    </pre>
                  </li>
                ))}
            </ul>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-hairline)]">
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
