import React, { useCallback, useEffect, useState } from "react";
import { Clock, Pencil, Play, Plus, Trash2 } from "lucide-react";
import type { WorkflowRecord, WorkflowRunRecord } from "@agentos/shared";
import {
  Button,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  ModalDialog,
  SectionHeader,
  StatusIndicator,
} from "@agentos/ui";
import { useApp } from "../stores/AppContext.js";

export function WorkflowsPage(): React.JSX.Element {
  const { client, workspaces, notify, setRoute } = useApp();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRecord | null>(null);

  const [draftName, setDraftName] = useState<string>("");
  const [draftDesc, setDraftDesc] = useState<string>("");
  const [draftInstruction, setDraftInstruction] = useState<string>("");
  const [draftWs, setDraftWs] = useState<string>("");
  const [draftSchedule, setDraftSchedule] = useState<boolean>(false);
  const [draftInterval, setDraftInterval] = useState<number>(60);

  const loadData = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [wfList, runList] = await Promise.all([
        client.listWorkflows(),
        client.listWorkflowRuns(),
      ]);
      setWorkflows(wfList);
      setRuns(runList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingWorkflow(null);
    setDraftName("");
    setDraftDesc("");
    setDraftInstruction("");
    setDraftWs("");
    setDraftSchedule(false);
    setDraftInterval(60);
    setEditorOpen(true);
  };

  const openEditModal = (wf: WorkflowRecord) => {
    setEditingWorkflow(wf);
    setDraftName(wf.name);
    setDraftDesc(wf.description);
    setDraftInstruction(wf.instruction_template);
    setDraftWs(wf.workspace_id ?? "");
    setDraftSchedule(wf.schedule_enabled);
    setDraftInterval(wf.schedule_interval_minutes ?? 60);
    setEditorOpen(true);
  };

  const handleRun = async (workflowId: string) => {
    if (!client) return;
    setRunningId(workflowId);
    try {
      const res = await client.runWorkflow(workflowId);
      notify(`Workflow run finished with status: ${res.task.status}`, "success");
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRunningId(null);
    }
  };

  const handleAssignWorkspace = async (workflowId: string, workspaceId: string) => {
    if (!client) return;
    try {
      await client.updateWorkflow(workflowId, { workspace_id: workspaceId || null });
      await loadData();
      notify("Workflow workspace updated.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleToggleSchedule = async (wf: WorkflowRecord) => {
    if (!client) return;
    try {
      const enable = !wf.schedule_enabled;
      await client.updateWorkflow(wf.id, {
        schedule_enabled: enable,
        schedule_interval_minutes: wf.schedule_interval_minutes ?? 60,
      });
      await loadData();
      notify(
        enable ? "In-app schedule enabled (runs while AgentOS is open)." : "Schedule paused.",
        "info",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleSaveWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!client) return;
    try {
      if (editingWorkflow) {
        await client.updateWorkflow(editingWorkflow.id, {
          name: draftName.trim(),
          description: draftDesc.trim(),
          instruction_template: draftInstruction.trim(),
          workspace_id: draftWs || null,
          schedule_enabled: draftSchedule,
          schedule_interval_minutes: draftSchedule ? draftInterval : null,
        });
        notify("Workflow updated.", "success");
      } else {
        await client.createWorkflow({
          name: draftName.trim(),
          description: draftDesc.trim(),
          instruction_template: draftInstruction.trim(),
          workspace_id: draftWs || null,
          schedule_enabled: draftSchedule,
          schedule_interval_minutes: draftSchedule ? draftInterval : null,
        });
        notify("Workflow created.", "success");
      }
      setEditorOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleConfirmDelete = async () => {
    if (!client || !deleteTarget) return;
    try {
      await client.deleteWorkflow(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
      notify("Workflow deleted.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        title="Workflows"
        description="Reusable task templates with manual execution and in-app interval scheduling (active while AgentOS is running)."
        action={
          <Button variant="primary" size="sm" onClick={openCreateModal}>
            <Plus className="w-3.5 h-3.5" aria-hidden={true} />
            New workflow
          </Button>
        }
      />

      {loading && <LoadingState label="Loading workflows..." />}
      {error && <ErrorState message={error} onRetry={() => void loadData()} />}

      {!loading && workflows.length === 0 && (
        <EmptyState
          title="No workflows configured"
          description="Create a reusable instruction template to run on demand or on an interval while AgentOS is open."
          actionLabel="Create workflow"
          onAction={openCreateModal}
        />
      )}

      {!loading && workflows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((wf) => (
            <GlassPanel
              key={wf.id}
              as="article"
              variant="surface"
              padding="md"
              className="flex flex-col justify-between gap-4"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-[var(--ink-primary)] m-0">
                    {wf.name}
                  </h2>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <StatusIndicator
                      tone={wf.schedule_enabled ? "ready" : "idle"}
                      label={
                        wf.schedule_enabled ? `Every ${wf.schedule_interval_minutes}m` : "Manual"
                      }
                    />
                    {wf.is_builtin && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-recessed)] text-[var(--ink-secondary)]">
                        Template
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[13px] text-[var(--ink-secondary)] m-0">{wf.description}</p>
                <p className="text-[12px] font-mono text-[var(--ink-secondary)] bg-[var(--surface-recessed)]/80 border border-[var(--border-hairline)] rounded-[8px] px-3 py-2 m-0">
                  {wf.instruction_template}
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-3 border-t border-[var(--border-hairline)]">
                <div>
                  <label
                    htmlFor={`wf-ws-${wf.id}`}
                    className="block text-[11.5px] font-medium text-[var(--ink-secondary)] mb-1"
                  >
                    Target workspace
                  </label>
                  <select
                    id={`wf-ws-${wf.id}`}
                    value={wf.workspace_id ?? ""}
                    onChange={(e) => void handleAssignWorkspace(wf.id, e.target.value)}
                    className="glass-input w-full px-2.5 py-1.5 text-[12.5px]"
                  >
                    <option value="">No workspace bound</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleToggleSchedule(wf)}
                  >
                    <Clock className="w-3.5 h-3.5" aria-hidden={true} />
                    {wf.schedule_enabled
                      ? `Every ${wf.schedule_interval_minutes}m (Active)`
                      : "Schedule off"}
                  </Button>
                  <div className="flex items-center gap-1.5">
                    {!wf.is_builtin && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit workflow ${wf.name}`}
                          onClick={() => openEditModal(wf)}
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden={true} />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Delete workflow ${wf.name}`}
                          onClick={() => setDeleteTarget(wf)}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden={true} />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      loading={runningId === wf.id}
                      onClick={() => void handleRun(wf.id)}
                    >
                      <Play className="w-3.5 h-3.5" aria-hidden={true} />
                      Run now
                    </Button>
                  </div>
                </div>
              </div>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* Execution History */}
      <section aria-labelledby="wf-runs-heading" className="flex flex-col gap-3">
        <SectionHeader id="wf-runs-heading" title="Recent Workflow Runs" />
        {runs.length === 0 ? (
          <GlassPanel variant="subtle" padding="md">
            <p className="text-[13px] text-[var(--ink-secondary)] m-0">
              No workflow runs recorded yet. Select Run now on any workflow above.
            </p>
          </GlassPanel>
        ) : (
          <GlassPanel variant="surface" padding="none" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <caption className="visually-hidden">Workflow execution history</caption>
              <thead>
                <tr className="border-b border-[var(--border-hairline)] bg-[var(--surface-recessed)]/70">
                  <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">
                    Run ID
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">
                    Trigger
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">
                    Summary
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">
                    Task
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[12px]">{r.id}</td>
                    <td className="px-4 py-2.5">{r.trigger}</td>
                    <td className="px-4 py-2.5">
                      <StatusIndicator
                        tone={
                          r.status === "completed"
                            ? "ready"
                            : r.status === "failed"
                              ? "error"
                              : "running"
                        }
                        label={r.status}
                        mono
                      />
                    </td>
                    <td className="px-4 py-2.5 max-w-[360px] truncate text-[var(--ink-secondary)]">
                      {r.summary ?? r.error_message ?? ""}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.task_id && (
                        <Button variant="ghost" size="sm" onClick={() => setRoute("tasks")}>
                          Inspect
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassPanel>
        )}
      </section>

      <ModalDialog
        open={editorOpen}
        title={editingWorkflow ? "Edit workflow" : "Create custom workflow"}
        description="Define a reusable instruction template. Scheduled workflows run only while AgentOS is open."
        onClose={() => setEditorOpen(false)}
      >
        <form onSubmit={(e) => void handleSaveWorkflow(e)} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="wf-name" className="block text-[12px] font-medium mb-1">
              Name
            </label>
            <input
              id="wf-name"
              type="text"
              required
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Daily Workspace Health Check"
              className="glass-input w-full px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="wf-desc" className="block text-[12px] font-medium mb-1">
              Description
            </label>
            <input
              id="wf-desc"
              type="text"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Checks large files and system health."
              className="glass-input w-full px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="wf-inst" className="block text-[12px] font-medium mb-1">
              Instruction template
            </label>
            <textarea
              id="wf-inst"
              rows={3}
              required
              value={draftInstruction}
              onChange={(e) => setDraftInstruction(e.target.value)}
              placeholder="Inspect system health and find large files in the authorized workspace."
              className="glass-input w-full px-3 py-1.5 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="wf-ws-create" className="block text-[12px] font-medium mb-1">
              Authorized workspace
            </label>
            <select
              id="wf-ws-create"
              value={draftWs}
              onChange={(e) => setDraftWs(e.target.value)}
              className="glass-input w-full px-3 py-1.5 text-[13px]"
            >
              <option value="">None</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="wf-sched" className="inline-flex items-center gap-2 text-[13px]">
              <input
                id="wf-sched"
                type="checkbox"
                checked={draftSchedule}
                onChange={(e) => setDraftSchedule(e.target.checked)}
              />
              Enable in-app schedule
            </label>
            {draftSchedule && (
              <div className="flex items-center gap-1.5">
                <label htmlFor="wf-int" className="text-[12px]">
                  Every (minutes):
                </label>
                <input
                  id="wf-int"
                  type="number"
                  min={1}
                  max={10080}
                  value={draftInterval}
                  onChange={(e) => setDraftInterval(Number(e.target.value) || 60)}
                  className="glass-input w-20 px-2 py-1 text-[13px]"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-hairline)]">
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save workflow
            </Button>
          </div>
        </form>
      </ModalDialog>

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title={`Delete workflow "${deleteTarget?.name ?? ""}"?`}
        description="This removes the custom workflow template. Previous task execution history remains preserved."
        confirmLabel="Delete workflow"
        tone="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
