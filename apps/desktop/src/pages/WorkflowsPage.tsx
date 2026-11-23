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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workflows.map((wf) => (
            <GlassPanel
              key={wf.id}
              as="article"
              variant="surface"
              padding="md"
              className="flex flex-col justify-between gap-5"
            >
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="type-section-title text-[var(--ink-primary)] m-0">{wf.name}</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusIndicator
                      tone={wf.schedule_enabled ? "ready" : "idle"}
                      label={
                        wf.schedule_enabled ? `Every ${wf.schedule_interval_minutes}m` : "Manual"
                      }
                    />
                    {wf.is_builtin && (
                      <span className="type-meta px-2.5 py-0.5 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-recessed)] text-[var(--ink-secondary)]">
                        Template
                      </span>
                    )}
                  </div>
                </div>
                <p className="type-secondary text-[var(--ink-secondary)] m-0">{wf.description}</p>
                <p className="type-meta font-mono font-normal text-[var(--ink-secondary)] bg-[var(--surface-recessed)] border border-[var(--border-hairline)] rounded-[10px] px-3.5 py-2.5 m-0 break-words [overflow-wrap:anywhere]">
                  {wf.instruction_template}
                </p>
              </div>

              <div className="flex flex-col gap-3.5 pt-4 border-t border-[var(--border-hairline)]">
                <div>
                  <label
                    htmlFor={`wf-ws-${wf.id}`}
                    className="block type-meta text-[var(--ink-secondary)] mb-1.5"
                  >
                    Target workspace
                  </label>
                  <select
                    id={`wf-ws-${wf.id}`}
                    value={wf.workspace_id ?? ""}
                    onChange={(e) => void handleAssignWorkspace(wf.id, e.target.value)}
                    className="glass-input w-full px-3 py-2"
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
                  <div className="flex items-center gap-2">
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
          <GlassPanel variant="surface" padding="md">
            <p className="type-secondary text-[var(--ink-secondary)] m-0">
              No workflow runs recorded yet. Select Run now on any workflow above.
            </p>
          </GlassPanel>
        ) : (
          <GlassPanel variant="surface" padding="none" className="overflow-x-auto">
            <table className="w-full text-left border-collapse type-secondary">
              <caption className="visually-hidden">Workflow execution history</caption>
              <thead>
                <tr className="border-b border-[var(--border-hairline)] bg-[var(--surface-recessed)]/70">
                  <th scope="col" className="px-5 py-3 type-meta font-semibold">
                    Run ID
                  </th>
                  <th scope="col" className="px-5 py-3 type-meta font-semibold">
                    Trigger
                  </th>
                  <th scope="col" className="px-5 py-3 type-meta font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 type-meta font-semibold">
                    Summary
                  </th>
                  <th scope="col" className="px-5 py-3 type-meta font-semibold">
                    Task
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3 font-mono type-meta font-normal">{r.id}</td>
                    <td className="px-5 py-3">{r.trigger}</td>
                    <td className="px-5 py-3">
                      <StatusIndicator
                        tone={
                          r.status === "completed"
                            ? "ready"
                            : r.status === "failed"
                              ? "error"
                              : "running"
                        }
                        label={r.status}
                      />
                    </td>
                    <td className="px-5 py-3 max-w-[380px] text-[var(--ink-secondary)] break-words [overflow-wrap:anywhere]">
                      {r.summary ?? r.error_message ?? ""}
                    </td>
                    <td className="px-5 py-3">
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
        <form onSubmit={(e) => void handleSaveWorkflow(e)} className="flex flex-col gap-4">
          <div>
            <label htmlFor="wf-name" className="block type-meta text-[var(--ink-secondary)] mb-1.5">
              Name
            </label>
            <input
              id="wf-name"
              type="text"
              required
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Daily Workspace Health Check"
              className="glass-input w-full px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="wf-desc" className="block type-meta text-[var(--ink-secondary)] mb-1.5">
              Description
            </label>
            <input
              id="wf-desc"
              type="text"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Checks large files and system health."
              className="glass-input w-full px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="wf-inst" className="block type-meta text-[var(--ink-secondary)] mb-1.5">
              Instruction template
            </label>
            <textarea
              id="wf-inst"
              rows={3}
              required
              value={draftInstruction}
              onChange={(e) => setDraftInstruction(e.target.value)}
              placeholder="Inspect system health and find large files in the authorized workspace."
              className="glass-input w-full px-3 py-2"
            />
          </div>
          <div>
            <label
              htmlFor="wf-ws-create"
              className="block type-meta text-[var(--ink-secondary)] mb-1.5"
            >
              Authorized workspace
            </label>
            <select
              id="wf-ws-create"
              value={draftWs}
              onChange={(e) => setDraftWs(e.target.value)}
              className="glass-input w-full px-3 py-2"
            >
              <option value="">None</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor="wf-sched" className="inline-flex items-center gap-2 type-secondary">
              <input
                id="wf-sched"
                type="checkbox"
                checked={draftSchedule}
                onChange={(e) => setDraftSchedule(e.target.checked)}
              />
              Enable in-app schedule
            </label>
            {draftSchedule && (
              <div className="flex items-center gap-2">
                <label htmlFor="wf-int" className="type-meta text-[var(--ink-secondary)]">
                  Every (minutes):
                </label>
                <input
                  id="wf-int"
                  type="number"
                  min={1}
                  max={10080}
                  value={draftInterval}
                  onChange={(e) => setDraftInterval(Number(e.target.value) || 60)}
                  className="glass-input w-20 px-2.5 py-1.5"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--border-hairline)]">
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
